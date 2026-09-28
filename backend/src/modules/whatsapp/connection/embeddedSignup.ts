import { config } from "../../../infra/config.js";
import { upsertConnection } from "./service.js";
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
async function subscribeApp(wabaId: string, token: string): Promise<void> {
  await graphFetch(
    `${GRAPH()}/${wabaId}/subscribed_apps`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    "Subscribe app to WABA"
  );
}

// Step 4 — register the phone number for Cloud API (idempotent-ish; ignore
// "already registered" errors so re-connecting doesn't hard-fail).
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
    // If it's already registered, Meta returns an error we can safely ignore.
    const detail = (err as EmbeddedSignupError).detail as any;
    const sub = detail?.error?.error_subcode;
    const msg = String((err as Error).message || "");
    const alreadyRegistered = sub === 2388004 || /already/i.test(msg);
    if (!alreadyRegistered) throw err;
  }
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
