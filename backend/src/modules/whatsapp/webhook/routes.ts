import { Router, Request, Response } from "express";
import { prisma } from "../../../infra/prisma.js";
import { WhatsAppAdapter } from "../../messaging/adapters.js";
import { handleInboundMessage } from "../../conversations/service.js";
import type { InboundType, InboundMedia } from "../../runtime/types.js";
import { verifyWebhookSignature } from "./security.js";
import { pickInboundConnection } from "./routing.js";
import { triggerOf } from "../../triggers/keywords.js";

export const webhookRouter = Router();

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

  // Match the token against any connection's verifyToken.
  const connection = await prisma.connection.findFirst({
    where: { verifyToken: String(token) },
  });

  if (connection) {
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

    // Several journeys can share one WhatsApp number; each has its own trigger
    // keyword. Route by keyword / ongoing conversation (see routing.ts).
    const connections = await prisma.connection.findMany({
      where: { phoneNumberId },
      include: { chatbot: { select: { name: true, isActive: true, activeVersionId: true, updatedAt: true } } },
    });
    const liveConns = connections.filter((c) => c.chatbot.isActive && c.chatbot.activeVersionId);

    // Trigger of each live journey = START node of its PUBLISHED version.
    const liveVersions = liveConns.length > 1
      ? await prisma.workflowVersion.findMany({
          where: { id: { in: liveConns.map((c) => c.chatbot.activeVersionId!) } },
          select: { id: true, definition: true },
        })
      : [];
    const triggerByVersion = new Map(liveVersions.map((v) => [v.id, triggerOf(v.definition)]));
    const candidates = connections.map((c) => ({
      ...c,
      trigger: c.chatbot.activeVersionId ? triggerByVersion.get(c.chatbot.activeVersionId) : undefined,
    }));

    const ongoing = liveConns.length > 1
      ? await prisma.conversation.findMany({
          where: { waUserId: from, chatbotId: { in: liveConns.map((c) => c.chatbotId) }, status: { in: ["ACTIVE", "WAITING_FOR_INPUT"] } },
          orderBy: { updatedAt: "desc" },
          select: { chatbotId: true },
        })
      : [];
    const route = pickInboundConnection(candidates, ongoing.map((c) => c.chatbotId), text);
    if (!route.pick) {
      console.warn(`[webhook] message for phone number ${phoneNumberId} not handled: ${route.reason}`);
      return;
    }
    if (route.liveCount > 1) {
      console.log(`[webhook] ${route.liveCount} live journeys on ${phoneNumberId}; routed to "${route.pick.chatbot.name}" (${route.reason})`);
    }
    const connection = route.pick;
    if (!connection.accessToken) return;

    // Switching journeys: close the user's open conversation in the other
    // journey(s) on this number, so only one journey talks to them at a time.
    if (route.closeChatbotIds.length) {
      await prisma.conversation.updateMany({
        where: { waUserId: from, chatbotId: { in: route.closeChatbotIds }, status: { in: ["ACTIVE", "WAITING_FOR_INPUT"] } },
        data: { status: "COMPLETED", currentNodeId: null },
      });
    }

    // Build the WhatsApp adapter from the stored (backend-only) credentials.
    const messaging = new WhatsAppAdapter(phoneNumberId, connection.accessToken);

    // Run the workflow for this message, passing the typed inbound payload and
    // the sender's profile name (so a new Contact gets a readable name).
    await handleInboundMessage(connection.chatbotId, from, text, messaging, { inbound, profileName, forceRestart: route.restart });
  } catch (err) {
    console.error("Webhook processing error:", err);
  }
});
