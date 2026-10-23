
import { Request, Response, Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import z from "zod";
import { createChatbot, createChatbotWithDraft, deleteChatBot, getChatbot, listChatbots, renameChatBot, setChatbotActivate } from "./service.js";
import { logActivity } from "../activity/service.js";
import { parseImport } from "../workflows/importer.js";
import { guardActivation, KeywordConflictError } from "../triggers/guard.js";
import type { Prisma } from "@prisma/client";

export const chatbotsRouter = Router();

chatbotsRouter.get("/ping", (_req, res) => {
  res.json({ module: "chatbots", status: "ok" });
});

//  --------->> Auth middleware added to the route<<-------------- 
chatbotsRouter.use(requireAuth)

// ----------------->> Validation  schema <<---------------

const creationSchema = z.object({ name: z.string().trim().min(1).max(100) })
const renameSchema = z.object({ name: z.string().trim().min(1).max(100) })
const isActiveSchema = z.object({
  isActive: z.boolean(),
  // Switch off the ACTIVE journeys on the same number that share a trigger
  // keyword with this one, then activate it (the alert's "Deactivate & activate").
  deactivateConflicting: z.boolean().optional().default(false),
})

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

//  POST --->  Import a journey JSON as a NEW chatbot (draft only, never published)
const importSchema = z.object({
  name: z.string().trim().max(100).optional(),
  data: z.unknown(),
})

chatbotsRouter.post("/import", async (req: Request, res: Response) => {
  const parsed = importSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", errors: ["The request is missing the file contents."] })

  const result = parseImport(parsed.data.data)
  if (!result.ok) return res.status(422).json({ error: "This file can't be imported.", errors: result.errors })

  const name = (parsed.data.name || result.suggestedName || "Imported journey").trim().slice(0, 100) || "Imported journey"
  const bot = await createChatbotWithDraft(req.userId!, name, result.definition as unknown as Prisma.InputJsonValue)
  logActivity(req, "chatbot.import", {
    chatbotId: bot.id,
    details: { name: bot.name, nodes: result.definition.nodes.length, warnings: result.warnings.length },
  })
  return res.status(200).json({ bot, warnings: result.warnings, stats: { nodes: result.definition.nodes.length, edges: result.definition.edges.length } })
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

  // Deactivating is always allowed.
  if (!parsed.data.isActive) {
    const bot = await setChatbotActivate(req.params.id, false)
    if (!bot) return res.status(404).json({ error: "ChatBot Not Found" })
    logActivity(req, "chatbot.deactivate", { chatbotId: bot.id })
    return res.status(200).json(bot)
  }

  // Activating: two ACTIVE journeys on one number must not share a trigger
  // keyword (checked under a per-number lock).
  const existing = await getChatbot(req.params.id)
  if (!existing) return res.status(404).json({ error: "ChatBot Not Found" })
  try {
    const { deactivated } = await guardActivation(existing.id, parsed.data.deactivateConflicting)
    for (const d of deactivated) {
      logActivity(req, "chatbot.deactivate", { chatbotId: d.chatbotId, details: { reason: `trigger keyword clash with "${existing.name}"` } })
    }
    logActivity(req, "chatbot.activate", { chatbotId: existing.id })
    const bot = await getChatbot(existing.id)
    return res.status(200).json({ ...bot, deactivated })
  } catch (err) {
    if (err instanceof KeywordConflictError) {
      return res.status(409).json({
        error: "Another active journey on this phone number uses the same trigger keyword.",
        code: "KEYWORD_CONFLICT",
        scope: "activation",
        conflicts: err.conflicts,
      })
    }
    throw err
  }
})

// DELETE -----------> Chatbot Deletion
chatbotsRouter.delete("/:id", async (req: Request, res: Response) => {
  const before = await getChatbot(req.params.id)
  const deleted = await deleteChatBot(req.params.id)
  if (!deleted) return res.status(404).json({ error: "ChatBot Not Found" })
  logActivity(req, "chatbot.delete", { chatbotId: req.params.id, details: { name: before?.name } })
  return res.status(200).send()
})
