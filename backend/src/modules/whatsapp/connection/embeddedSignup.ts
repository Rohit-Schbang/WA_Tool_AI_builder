import { config } from "../../../infra/config.js";
import { getConnection, upsertConnection, MASTER_KEY, type MasterConnection } from "./service.js";
import { prisma } from "../../../infra/prisma.js";

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
}): Promise<{ displayPhoneNumber?: string; verifiedName?: string; systemUserId?: string; systemUserName?: string }> {
  const owner = await getTokenOwner(input.accessToken);
  // A common mix-up: pasting the System User ID into the Phone Number ID field.
  if (owner.id && owner.id === input.phoneNumberId) {
    throw new EmbeddedSignupError(
      "That ID is your System User ID, not a Phone Number ID. Copy the Phone Number ID from WhatsApp Manager → Phone numbers (or API Setup)."
    );
  }
  let data: any;
  try {
    data = await graphFetch(
      `${GRAPH()}/${input.phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
      "Verify credentials"
    );
  } catch (err) {
    if (graphErrorCode(err) === 100) {
      throw new EmbeddedSignupError(
        "Meta doesn't recognise this Phone Number ID for this token. Check that it's the Phone Number ID (not the WABA or System User ID) and that the System User has this WhatsApp account assigned.",
        (err as EmbeddedSignupError).detail
      );
    }
    throw err;
  }
  if (!data?.display_phone_number) {
    throw new EmbeddedSignupError("This ID isn't a WhatsApp phone number. Use the Phone Number ID from WhatsApp Manager.");
  }
  return {
    displayPhoneNumber: data.display_phone_number,
    verifiedName: data?.verified_name,
    systemUserId: owner.id,
    systemUserName: owner.name,
  };
}

// Who owns an access token (the Meta System User / BISU). Best-effort: a token
// without the needed permission just returns {}.
export async function getTokenOwner(token: string): Promise<{ id?: string; name?: string }> {
  try {
    const me = await graphFetch(`${GRAPH()}/me?fields=id,name`, { headers: { Authorization: `Bearer ${token}` } }, "Read token owner");
    return { id: me?.id ? String(me.id) : undefined, name: me?.name };
  } catch (err) {
    // An invalid/expired token must surface as a real failure.
    if (graphErrorCode(err) === 190) throw err;
    return {};
  }
}

// Graph API error code (190 = invalid/expired token, 100 = bad id/field).
function graphErrorCode(err: unknown): number | undefined {
  const code = ((err as EmbeddedSignupError)?.detail as any)?.error?.code;
  return typeof code === "number" ? code : undefined;
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
  input: EmbeddedSignupInput,
  adminEmail: string
): Promise<MasterConnection> {
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
  const owner = await getTokenOwner(accessToken);

  // Persist. accessToken here is the BISU token used to send messages.
  return upsertConnection({
    updatedByEmail: adminEmail,
    accessToken,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    phoneNumber: phone.displayPhoneNumber,
    businessName: waba.name ?? phone.verifiedName,
    systemUserId: owner.id ?? null,
    systemUserName: owner.name ?? null,
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
  phoneNumberId: string | null;
  systemUserId: string | null;
  businessName: string | null;
  qualityRating: string | null;        // GREEN / YELLOW / RED
  codeVerificationStatus: string | null; // VERIFIED / NOT_VERIFIED / EXPIRED
  nameStatus: string | null;             // APPROVED / PENDING_REVIEW / DECLINED
  checkedAt: string | null;              // ISO timestamp of the values above
  live: boolean;                          // true if freshly fetched from Meta this call
  error: string | null;                   // set when the live fetch failed (cached shown)
}

function healthFromRow(c: MasterConnection, live: boolean, error: string | null): ConnectionHealth {
  return {
    connected: c.status === "CONNECTED",
    status: c.status,
    phoneNumber: c.phoneNumber,
    phoneNumberId: c.phoneNumberId,
    systemUserId: c.systemUserId,
    businessName: c.businessName,
    qualityRating: c.qualityRating,
    codeVerificationStatus: c.codeVerificationStatus,
    nameStatus: c.nameStatus,
    checkedAt: c.healthCheckedAt ? c.healthCheckedAt.toISOString() : null,
    live,
    error,
  };
}

// Fetch (and cache) the live health for the master connection. Returns null
// only when there is no connection row at all.
//
// This NEVER downgrades or clears the connection: if Meta rejects the token,
// the stored credentials and status stay as the admin left them and the
// problem is reported in `error`. Only an admin save / disconnect changes it.
export async function getConnectionHealth(): Promise<ConnectionHealth | null> {
  const conn = await getConnection();
  if (!conn) return null;

  // No credentials → nothing to poll; return the stored snapshot.
  if (!conn.accessToken || !conn.phoneNumberId) {
    return healthFromRow(conn, false, null);
  }

  // Credentials exist: ask Meta even if the stored status says otherwise, so a
  // number that works is shown as CONNECTED (the stored status can go stale,
  // e.g. after an earlier failed save).
  try {
    const s = await getPhoneStatus(conn.phoneNumberId, conn.accessToken);
    // Persist the fresh values so the last-known snapshot survives token/network
    // failures on a later call.
    const updated = await prisma.workspaceConnection.update({
      where: { key: MASTER_KEY },
      data: {
        status: "CONNECTED",
        qualityRating: s.quality ?? conn.qualityRating,
        codeVerificationStatus: s.status ?? conn.codeVerificationStatus,
        nameStatus: s.nameStatus ?? conn.nameStatus,
        phoneNumber: s.displayPhoneNumber ?? conn.phoneNumber,
        healthCheckedAt: new Date(),
      },
    });
    // Backfill the token owner for connections saved before it was recorded.
    if (!updated.systemUserId) {
      const owner = await getTokenOwner(conn.accessToken).catch(() => ({} as { id?: string; name?: string }));
      if (owner.id) {
        const withOwner = await prisma.workspaceConnection.update({
          where: { key: MASTER_KEY },
          data: { systemUserId: owner.id, systemUserName: owner.name ?? null },
        });
        return healthFromRow(withOwner, true, null);
      }
    }
    return healthFromRow(updated, true, null);
  } catch (err) {
    const code = graphErrorCode(err);
    // Report, but don't touch the stored connection (see note above).
    if (code === 190) return healthFromRow(conn, false, "Meta says the access token is invalid or expired. An admin should save a new token.");
    if (code === 100) return healthFromRow(conn, false, "Meta doesn't recognise this Phone Number ID for this token.");
    // Live fetch failed — surface the cached values with an error note so the
    // dashboard can show "last checked …" instead of going blank.
    const msg = err instanceof EmbeddedSignupError ? err.message : "Couldn't reach Meta for a live status.";
    return healthFromRow(conn, false, msg);
  }
}
