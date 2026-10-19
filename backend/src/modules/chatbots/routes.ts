
import { Request, Response, Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import z from "zod";
import { createChatbot, deleteChatBot, getChatbot, listChatbots, renameChatBot, setChatbotActivate } from "./service.js";
import { logActivity } from "../activity/service.js";

export const chatbotsRouter = Router();

chatbotsRouter.get("/ping", (_req, res) => {
  res.json({ module: "chatbots", status: "ok" });
});

//  --------->> Auth middleware added to the route<<-------------- 
chatbotsRouter.use(requireAuth)

// ----------------->> Validation  schema <<---------------

const creationSchema = z.object({ name: z.string().trim().min(1).max(100) })
const renameSchema = z.object({ name: z.string().trim().min(1).max(100) })
const isActiveSchema = z.object({ isActive: z.boolean() })

//  POST --->  Create chatbot
chatbotsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = creationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Input", details: parsed.error.flatten() })
  }

  const bot = await createChatbot(req.userId!, parsed.data.name)
  logActivity(req, "chatbot.create", { chatbotId: bot.id, details: { name: bot.name } })
  return res.status(200).json(bot)
})

// GET ---> List of all chatbots (global workspace)
chatbotsRouter.get("/", async (_req: Request, res: Response) => {
  const bots = await listChatbots()
  return res.json(bots);
})

// GET ---> specific BOT
chatbotsRouter.get("/:id", async (req: Request, res: Response) => {
  const bot = await getChatbot(req.params.id)
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })
  return res.status(200).json(bot)
})

// PATCH -----------> Renaming the BOT
chatbotsRouter.patch("/:id", async (req: Request, res: Response) => {
  const parsed = renameSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() })
  }

  const before = await getChatbot(req.params.id)
  const bot = await renameChatBot(req.params.id, parsed.data.name)
  if (!bot) return res.status(404).json({ error: "ChatBot Not Found" })
  logActivity(req, "chatbot.rename", { chatbotId: bot.id, details: { from: before?.name, to: bot.name } })
  res.status(200).json(bot)
})

// PATCH -----------> Activation / Deactivation
chatbotsRouter.patch("/:id/activate", async (req: Request, res: Response) => {
  const parsed = isActiveSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" })

  const bot = await setChatbotActivate(req.params.id, parsed.data.isActive)
  if (!bot) return res.status(404).json({ error: "ChatBot Not Found" })
  logActivity(req, parsed.data.isActive ? "chatbot.activate" : "chatbot.deactivate", { chatbotId: bot.id })
  return res.status(200).json(bot)
})

// DELETE -----------> Chatbot Deletion
chatbotsRouter.delete("/:id", async (req: Request, res: Response) => {
  const before = await getChatbot(req.params.id)
  const deleted = await deleteChatBot(req.params.id)
  if (!deleted) return res.status(404).json({ error: "ChatBot Not Found" })
  logActivity(req, "chatbot.delete", { chatbotId: req.params.id, details: { name: before?.name } })
  return res.status(200).send()
})
