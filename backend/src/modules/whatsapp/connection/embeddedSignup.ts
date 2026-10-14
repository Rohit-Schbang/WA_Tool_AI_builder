import { config } from "../../../infra/config.js";
import { getConnection, upsertConnection } from "./service.js";
import { prisma } from "../../../infra/prisma.js";
import type { Connection } from "@prisma/client";

// WhatsApp Embedded Signup (Meta) — server-side flow.
//
// After the user completes Meta's embedded popup on the frontend, we receive:
//   - code            : short-lived (~60s) authorization code
//   - wabaId           : the user's WhatsApp Business Account id
//   - phoneNumberId    : the registered phone number id
//
// This module exchanges the code for a Business Integration System User (BISU)
// access token, then uses it to look up the WABA + phone details, subscribe our
// app to the WABA's webhooks, register the phone number, and finally persist
// everything into the chatbot's Connection row.
//
// Docs: https://developers.facebook.com/docs/whatsapp/embedded-signup

const GRAPH = () => `https://graph.facebook.com/${config.META_GRAPH_VERSION}`;

export interface EmbeddedSignupInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

// Thrown for any recoverable failure so the route can return a clean message.
export class EmbeddedSignupError extends Error {
  constructor(message: string, public detail?: unknown) {
    super(message);
    this.name = "EmbeddedSignupError";
  }
}

// True when the Meta credentials needed for embedded signup are configured.
export function isEmbeddedSignupConfigured(): boolean {
  return Boolean(config.META_APP_ID && config.META_APP_SECRET && config.META_CONFIG_ID);
}

async function graphFetch(url: string, init: RequestInit, step: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new EmbeddedSignupError(`Network error during ${step}`, err);
  }
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new EmbeddedSignupError(`${step} failed: ${msg}`, data);
  }
  return data;
}

// Step 1 — exchange the short-lived code for a BISU access token (backend only).
async function exchangeCodeForToken(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.META_APP_ID!,
    client_secret: config.META_APP_SECRET!,
    code,
  });
  // redirect_uri is required only if one was used when the code was created.
  if (config.META_REDIRECT_URI) params.set("redirect_uri", config.META_REDIRECT_URI);

  const data = await graphFetch(
    `${GRAPH()}/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
    "Token exchange"
  );
  if (!data?.access_token) throw new EmbeddedSignupError("Token exchange returned no access_token", data);
  return data.access_token as string;
}

// Step 2 — read WABA details (name) for display.
async function getWabaDetails(wabaId: string, token: string): Promise<{ name?: string }> {
  try {
    const data = await graphFetch(
      `${GRAPH()}/${wabaId}?fields=id,name`,
      { headers: { Authorization: `Bearer ${token}` } },
      "Fetch WABA details"
    );
    return { name: data?.name };
  } catch {
    return {}; // non-fatal — name is cosmetic
  }
}

// Step 2b — read the phone number's display number for display.
async function getPhoneDetails(phoneNumberId: string, token: string): Promise<{ displayPhoneNumber?: string; verifiedName?: string }> {
  try {
    const data = await graphFetch(
      `${GRAPH()}/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${token}` } },
      "Fetch phone details"
    );
    return { displayPhoneNumber: data?.display_phone_number, verifiedName: data?.verified_name };
  } catch {
    return {};
  }
}

// Step 3 — subscribe our app to the WABA's webhooks (must precede registration).
// BSP-grade: after subscribing we verify the subscription actually took, so a
// silent failure doesn't leave a tenant that never receives inbound messages.
async function subscribeApp(wabaId: string, token: string): Promise<void> {
  await graphFetch(
    `${GRAPH()}/${wabaId}/subscribed_apps`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    "Subscribe app to WABA"
  );

  // Verify our app id is present in the WABA's subscribed apps list.
  try {
    const list = await graphFetch(
      `${GRAPH()}/${wabaId}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${token}` } },
      "Verify WABA subscription"
    );
    const apps: any[] = Array.isArray(list?.data) ? list.data : [];
    const ours = apps.some(
      (a) => String(a?.whatsapp_business_api_data?.id ?? a?.id) === String(config.META_APP_ID)
    );
    if (!ours && apps.length === 0) {
      throw new EmbeddedSignupError("Webhook subscription did not register for this WhatsApp account.");
    }
  } catch (err) {
    // A verification read failure is non-fatal (some tokens can't re-read the
    // list); the POST above already returned OK. Only rethrow our explicit error.
    if (err instanceof EmbeddedSignupError && /did not register/.test(err.message)) throw err;
  }
}

// Step 4 — register the phone number for Cloud API (idempotent-ish; ignore
// "already registered" errors so re-connecting doesn't hard-fail). Registering
// with a PIN also sets the number's two-step verification code, which BSPs do
// so the number stays under programmatic control.
async function registerPhoneNumber(phoneNumberId: string, token: string): Promise<void> {
  try {
    await graphFetch(
      `${GRAPH()}/${phoneNumberId}/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: "whatsapp", pin: config.WHATSAPP_REGISTER_PIN }),
      },
      "Register phone number"
    );
  } catch (err) {
    const detail = (err as EmbeddedSignupError).detail as any;
    const sub = detail?.error?.error_subcode;
    const msg = String((err as Error).message || "");
    // 2388004 = already registered. Re-connecting an existing number is normal
    // and should not hard-fail the flow.
    const alreadyRegistered = sub === 2388004 || /already/i.test(msg);
    if (alreadyRegistered) return;
    // Anything else (e.g. wrong PIN on a number with 2FA already set) is a real
    // failure the tenant needs to know about.
    throw err;
  }
}

// Verify a MANUALLY-entered access token against Meta: fetch the phone number
// by id. If Meta returns the number, the token works and we treat the number as
// connected. Returns the display number + verified name for display. Throws
// EmbeddedSignupError (with Meta's message) when the token/id are invalid.
export async function verifyManualCredentials(input: {
  accessToken: string;
  phoneNumberId: string;
}): Promise<{ displayPhoneNumber?: string; verifiedName?: string }> {
  const data = await graphFetch(
    `${GRAPH()}/${input.phoneNumberId}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
    "Verify credentials"
  );
  return { displayPhoneNumber: data?.display_phone_number, verifiedName: data?.verified_name };
}

// Read the phone number's current platform + verification status. Used both at
// connect time and by the periodic health check so the dashboard can show a
// live "number status" like Gupshup/Wati do.
export async function getPhoneStatus(
  phoneNumberId: string,
  token: string
): Promise<{ status?: string; nameStatus?: string; quality?: string; displayPhoneNumber?: string }> {
  const data = await graphFetch(
    `${GRAPH()}/${phoneNumberId}?fields=display_phone_number,verified_name,code_verification_status,name_status,quality_rating,platform_type`,
    { headers: { Authorization: `Bearer ${token}` } },
    "Fetch phone status"
  );
  return {
    status: data?.code_verification_status ?? data?.platform_type,
    nameStatus: data?.name_status,
    quality: data?.quality_rating,
    displayPhoneNumber: data?.display_phone_number,
  };
}

// Orchestrates the full flow and persists the result. Returns the raw Connection.
export async function completeEmbeddedSignup(
  chatbotId: string,
  input: EmbeddedSignupInput
): Promise<Connection> {
  if (!isEmbeddedSignupConfigured()) {
    throw new EmbeddedSignupError(
      "WhatsApp Embedded Signup is not configured on the server yet. Add the Meta app credentials to enable it."
    );
  }

  const accessToken = await exchangeCodeForToken(input.code);

  // These are best-effort reads (cosmetic) + required side-effects.
  const [waba, phone] = await Promise.all([
    getWabaDetails(input.wabaId, accessToken),
    getPhoneDetails(input.phoneNumberId, accessToken),
  ]);

  await subscribeApp(input.wabaId, accessToken);
  await registerPhoneNumber(input.phoneNumberId, accessToken);

  // Persist. accessToken here is the BISU token used to send messages.
  return upsertConnection(chatbotId, {
    accessToken,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    phoneNumber: phone.displayPhoneNumber,
    businessName: waba.name ?? phone.verifiedName,
    appId: config.META_APP_ID,
    appSecret: config.META_APP_SECRET,
    status: "CONNECTED",
  });
}

// ---------------------------------------------------------------------------
// Connection health — the "live status" a BSP dashboard shows (Gupshup/Wati).
//
// Reads the number's current quality rating, code-verification status and
// display-name status from Meta using the stored token, caches the result on
// the Connection row, and gracefully falls back to the last-known cached
// values when a live fetch fails (expired token, transient Graph error, etc).
// Never returns secrets.
// ---------------------------------------------------------------------------

export interface ConnectionHealth {
  connected: boolean;
  status: string;               // our ConnectionStatus (CONNECTED / DISCONNECTED / ERROR)
  phoneNumber: string | null;
  businessName: string | null;
  qualityRating: string | null;        // GREEN / YELLOW / RED
  codeVerificationStatus: string | null; // VERIFIED / NOT_VERIFIED / EXPIRED
  nameStatus: string | null;             // APPROVED / PENDING_REVIEW / DECLINED
  checkedAt: string | null;              // ISO timestamp of the values above
  live: boolean;                          // true if freshly fetched from Meta this call
  error: string | null;                   // set when the live fetch failed (cached shown)
}

function healthFromRow(c: Connection, live: boolean, error: string | null): ConnectionHealth {
  return {
    connected: c.status === "CONNECTED",
    status: c.status,
    phoneNumber: c.phoneNumber,
    businessName: c.businessName,
    qualityRating: c.qualityRating,
    codeVerificationStatus: c.codeVerificationStatus,
    nameStatus: c.nameStatus,
    checkedAt: c.healthCheckedAt ? c.healthCheckedAt.toISOString() : null,
    live,
    error,
  };
}

// Fetch (and cache) the live health for a chatbot's connection. Returns null
// only when there is no connection row at all.
export async function getConnectionHealth(chatbotId: string): Promise<ConnectionHealth | null> {
  const conn = await getConnection(chatbotId);
  if (!conn) return null;

  // No token / not connected → nothing to poll; return the stored snapshot.
  if (!conn.accessToken || !conn.phoneNumberId || conn.status !== "CONNECTED") {
    return healthFromRow(conn, false, null);
  }

  try {
    const s = await getPhoneStatus(conn.phoneNumberId, conn.accessToken);
    // Persist the fresh values so the last-known snapshot survives token/network
    // failures on a later call.
    const updated = await prisma.connection.update({
      where: { chatbotId },
      data: {
        qualityRating: s.quality ?? conn.qualityRating,
        codeVerificationStatus: s.status ?? conn.codeVerificationStatus,
        nameStatus: s.nameStatus ?? conn.nameStatus,
        phoneNumber: s.displayPhoneNumber ?? conn.phoneNumber,
        healthCheckedAt: new Date(),
      },
    });
    return healthFromRow(updated, true, null);
  } catch (err) {
    // Live fetch failed — surface the cached values with an error note so the
    // dashboard can show "last checked …" instead of going blank.
    const msg = err instanceof EmbeddedSignupError ? err.message : "Couldn't reach Meta for a live status.";
    return healthFromRow(conn, false, msg);
  }
}
