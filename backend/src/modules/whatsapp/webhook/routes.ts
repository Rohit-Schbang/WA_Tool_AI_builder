import { Router, Request, Response } from "express";
import { prisma } from "../../../infra/prisma.js";
import { WhatsAppAdapter } from "../../messaging/adapters.js";
import { handleInboundMessage } from "../../conversations/service.js";

export const webhookRouter = Router();

// GET /api/whatsapp/webhook — Meta's verification handshake.
// When you subscribe, Meta calls this with a challenge; echo it back
// if the verify token matches what we stored.
webhookRouter.get("/webhook", async (req: Request, res: Response) => {
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
webhookRouter.post("/webhook", async (req: Request, res: Response) => {
  // Ack Meta quickly with 200 so it doesn't retry endlessly.
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Status updates (delivered/read) have no messages — ignore them.
    const message = value?.messages?.[0];
    if (!message || message.type !== "text") return;

    const phoneNumberId = value?.metadata?.phone_number_id;
    const from = message.from; // sender's WhatsApp id
    const text = message.text?.body ?? "";

    if (!phoneNumberId || !from) return;

    // Find the chatbot connection for this phone number id.
    const connection = await prisma.connection.findFirst({
      where: { phoneNumberId },
    });

    if (!connection || !connection.accessToken) return;

    // Build the WhatsApp adapter from the stored (backend-only) credentials.
    const messaging = new WhatsAppAdapter(phoneNumberId, connection.accessToken);

    // Run the workflow for this message.
    await handleInboundMessage(connection.chatbotId, from, text, messaging);
  } catch (err) {
    console.error("Webhook processing error:", err);
  }
});
