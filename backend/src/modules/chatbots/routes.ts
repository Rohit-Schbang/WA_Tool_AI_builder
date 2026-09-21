
import { Request, Response, Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import z from "zod";
import { createChatbot, deleteChatBot, getChatbot, listChatbots, renameChatBot, setChatbotActivate } from "./service.js";

export const chatbotsRouter = Router();

chatbotsRouter.get("/ping", (_req, res) => {
  res.json({ module: "chatbots", status: "ok" });
});

//  --------->> Auth middleware added to the route<<-------------- 
chatbotsRouter.use(requireAuth)

// ----------------->> Validation  schema <<---------------

const creationSchema = z.object({ name: z.string().min(1) })
const renameSchema = z.object({ name: z.string().min(1) })
const isActiveSchema = z.object({ isActive: z.boolean() })

//  POST --->  Create chatbot
chatbotsRouter.post("/", async (req: Request, res: Response) => {

  const parsed = creationSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Input", details: parsed.error.flatten() })
  }

  //  BOT Creation
  const bot = await createChatbot(req.userId!, parsed.data.name)
  return res.status(200).json(bot)

})

// GET ---> List of user's chatbots

chatbotsRouter.get("/", async (req: Request, res: Response) => {

  const bots = await listChatbots(req.userId!)
  return res.json(bots);

})

// GET ---> specific BOT of the User's choosen

chatbotsRouter.get("/:id", async (req: Request, res: Response) => {

  const bot = await getChatbot(req.userId!, req.params.id)

  if (!bot) {
    return res.status(404).json({
      error: "Chatbot not found"
    })
  }

  return res.status(200).json(bot)

})

// PATCH -----------> Renaming the BOT

chatbotsRouter.patch("/:id", async (req: Request, res: Response) => {

  const parsed = renameSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid input", details: parsed.error.flatten()
    })
  }

  const bot = await renameChatBot(req.userId!, req.params.id, parsed.data.name)
  if (!bot) return res.status(404).json({ error: "ChatBot Not Found" })
  res.status(201).json(bot)

})

// PATCH -----------> Activation / Deactivation

chatbotsRouter.patch("/:id/activate", async (req: Request, res: Response) => {

  const parsed = isActiveSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" })
  }

  const bot = await setChatbotActivate(req.userId!, req.params.id, parsed.data.isActive)
  if (!bot) return res.status(404).json({ error: "ChatBot Not Found" })
  return res.status(200).json(bot)

})

// DELETE -----------> Chatbot Deletion

chatbotsRouter.delete("/:id", async (req: Request, res: Response) => {

  const deleted = await deleteChatBot(req.userId!, req.params.id)
  if (!deleted) return res.status(404).json({ error: "ChatBot Not Found" })
  return res.status(200).send()


})
