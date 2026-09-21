import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware.js";
import { getChatbot } from "../chatbots/service.js";
import { listConversations, getConversationDetail } from "./read/service.js";

// mergeParams  for the parmas mounting on the Top of branch
export const conversationsRouter = Router({ mergeParams: true });

conversationsRouter.use(requireAuth);

// GET  ------------->>>>>>>>>>>         /api/chatbots/:chatbotId/conversations
conversationsRouter.get("/", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;

  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const conversations = await listConversations(chatbotId);
  return res.json(conversations);
});

// GET   ------------->>>>>>>>>>>           /api/chatbots/:chatbotId/conversations/:conversationId
conversationsRouter.get("/:conversationId", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;

  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const detail = await getConversationDetail(chatbotId, req.params.conversationId);
  if (!detail) return res.status(404).json({ error: "Conversation not found" });

  return res.json(detail);
});
