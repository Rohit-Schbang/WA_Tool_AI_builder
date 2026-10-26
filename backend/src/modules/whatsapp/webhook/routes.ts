import { Router, Request, Response } from "express";
import { prisma } from "../../../infra/prisma.js";
import { WhatsAppAdapter } from "../../messaging/adapters.js";
import { handleInboundMessage, matchesTrigger } from "../../conversations/service.js";
import type { InboundType, InboundMedia, WorkflowDefinition } from "../../runtime/types.js";
import { verifyWebhookSignature } from "./security.js";
import { getConnection, getSendingCredentials } from "../connection/service.js";
import { pickJourney } from "./routing.js";

export const webhookRouter = Router();

// Load the live journeys + this user's open conversations and pick one.
async function routeInbound(waUserId: string, text: string): Promise<string | null> {
  const bots = await prisma.chatbot.findMany({
    where: { isActive: true, activeVersionId: { not: null } },
    select: { id: true, name: true, updatedAt: true, activeVersionId: true },
  });
  const versions = await prisma.workflowVersion.findMany({
    where: { id: { in: bots.map((b) => b.activeVersionId!) } },
    select: { id: true, definition: true },
  });
  const defById = new Map(versions.map((v) => [v.id, v.definition as unknown as WorkflowDefinition]));

  const live = bots.map((b) => {
    const start = defById.get(b.activeVersionId!)?.nodes?.find((n) => n.nodeType === "START");
    const keywords = Array.isArray(start?.config?.keywords) ? start!.config.keywords.filter((k: unknown) => String(k ?? "").trim()) : [];
    return { chatbotId: b.id, name: b.name, updatedAt: b.updatedAt, hasKeywords: keywords.length > 0, matches: matchesTrigger(start, text) };
  });

  const ongoing = await prisma.conversation.findMany({
    where: { waUserId, status: { in: ["ACTIVE", "WAITING_FOR_INPUT"] }, chatbotId: { in: bots.map((b) => b.id) } },
    orderBy: { updatedAt: "desc" },
    select: { chatbotId: true },
  });

  const r = pickJourney(live, ongoing.map((o) => o.chatbotId));
  if (!r.chatbotId) console.warn(`[webhook] no journey answers ${waUserId}: ${r.reason}`);
  return r.chatbotId;
}

// Turn a raw Meta webhook `message` object into a plain text string + a typed
// inbound descriptor (type + media/location payload). The text is a best-effort
// human-readable representation so text-based nodes/logging still work:
//   - text            -> the body
//   - image/video/doc -> the caption (if any) or the filename
//   - interactive     -> the button/list reply title (and we expose its id as text)
//   - location        -> "lat,long"
function parseInbound(message: any): { text: string; inbound: { type: InboundType; media: InboundMedia | null } } {
  const rawType: string = message?.type ?? "unknown";

  switch (rawType) {
    case "text":
      return { text: message.text?.body ?? "", inbound: { type: "text", media: null } };

    case "image":
    case "video":
    case "audio":
    case "document": {
      const m = message[rawType] ?? {};
      const caption: string = m.caption ?? "";
      const filename: string = m.filename ?? "";
      return {
        text: caption || filename || "",
        inbound: {
          type: rawType as InboundType,
          media: { id: m.id, mimeType: m.mime_type, caption: caption || undefined, filename: filename || undefined, sha256: m.sha256 },
        },
      };
    }

    case "location": {
      const loc = message.location ?? {};
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      const text = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : (loc.name ?? "");
      return { text, inbound: { type: "location", media: { latitude: lat, longitude: lng, caption: loc.name } } };
    }

    case "interactive": {
      // Button or list reply. Capture the chosen option's title as the text so
      // existing text validations / conditions still work.
      const i = message.interactive ?? {};
      const reply = i.button_reply ?? i.list_reply ?? {};
      return { text: reply.title ?? reply.id ?? "", inbound: { type: "interactive", media: null } };
    }

    case "button": {
      // Legacy template quick-reply button.
      return { text: message.button?.text ?? "", inbound: { type: "interactive", media: null } };
    }

    case "contacts":
      return { text: "", inbound: { type: "contacts", media: null } };

    default:
      return { text: "", inbound: { type: "unknown", media: null } };
  }
}

// GET /api/whatsapp/webhook — Meta's verification handshake.
// When you subscribe, Meta calls this with a challenge; echo it back
// if the verify token matches what we stored.
webhookRouter.get("/webhook", async (req: Request, res: Response) => {
  console.log(req.body)
  console.log(req.query)
  console.log(req.params)

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode !== "subscribe" || !token) {
    return res.sendStatus(400);
  }

  // Match the token against the master connection's verifyToken.
  const connection = await getConnection();

  if (connection?.verifyToken && connection.verifyToken === String(token)) {
    return res.status(200).send(String(challenge));
  }
  return res.sendStatus(403);
});

// POST /api/whatsapp/webhook — inbound messages from Meta.
// Guarded by verifyWebhookSignature: a forged/unsigned POST is rejected with
// 401 before any processing happens.
webhookRouter.post("/webhook", verifyWebhookSignature, async (req: Request, res: Response) => {
  // Ack Meta quickly with 200 so it doesn't retry endlessly.
  res.sendStatus(200);
  console.log(req.body)
  console.log(req.query)
  console.log(req.params)

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Status updates (delivered/read) have no messages — ignore them.
    const message = value?.messages?.[0];
    if (!message) return;

    const phoneNumberId = value?.metadata?.phone_number_id;
    const from = message.from; // sender's WhatsApp id
    if (!phoneNumberId || !from) return;

    // The sender's WhatsApp display name (used to name an auto-created Contact).
    // Meta puts it under value.contacts[].profile.name; match it to the sender.
    const profileName: string | undefined =
      (value?.contacts ?? []).find((c: any) => c?.wa_id === from)?.profile?.name
      ?? value?.contacts?.[0]?.profile?.name;

    // Parse the message into a text string + typed inbound descriptor so a
    // Question node can expect media (image/audio/document/video/location) and
    // not just text. Unsupported/unknown types still flow through as "unknown".
    const { text, inbound } = parseInbound(message);

    // The workspace's master connection must own this number.
    const creds = await getSendingCredentials();
    if (!creds || creds.phoneNumberId !== String(phoneNumberId)) {
      console.warn(`[webhook] message for phone number ${phoneNumberId} ignored: it isn't the connected master number`);
      return;
    }

    // Pick which live journey answers (they all share the master number).
    const chatbotId = await routeInbound(from, text);
    if (!chatbotId) return;

    // Build the WhatsApp adapter from the stored (backend-only) credentials.
    const messaging = new WhatsAppAdapter(creds.phoneNumberId, creds.accessToken);

    // Run the workflow for this message, passing the typed inbound payload and
    // the sender's profile name (so a new Contact gets a readable name).
    await handleInboundMessage(chatbotId, from, text, messaging, { inbound, profileName });
  } catch (err) {
    console.error("Webhook processing error:", err);
  }
});
