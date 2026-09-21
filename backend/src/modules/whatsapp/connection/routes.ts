
import { Request, Response, Router } from "express";
import { z } from "zod";
import { getChatbot } from "../../chatbots/service.js";
import { getConnection, ToSafeConnection, upsertConnection } from "./service.js";
export const whatsappRouter = Router();


// Using " mergeparams " which lets this router to read :chatbotID from the paraent path
//  when we mount it under /api/chatbots/:chatbotId/connection

export const connectionRouter = Router({ mergeParams: true })

// Client may sent the optional updates 

const connectionSchema = z.object({
  businessName: z.string().optional(),
  phoneNumber: z.string().optional(),
  phoneNumberId: z.string().optional(),
  wabaId: z.string().optional(),
  accessToken: z.string().optional(),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  verifyToken: z.string().optional()
})

//  GET -------->>>>> api/chatbots/:chatbotId/connection

connectionRouter.get("/", async (req: Request, res: Response) => {

  const chatbotId = req.params.chatbotId

  // getting chatbot of the current user ownership ----------->>>>>

  const bot = await getChatbot(req.userId!!, chatbotId)

  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const connection = await getConnection(chatbotId)

  // Getting connection ----->>>>>

  if (!connection) return res.status(404).json({ error: "No Connection Configured" })

  return res.json(ToSafeConnection(connection))

})

// PUT --------->>>>> api/chatbots/:chatbotId/connection

connectionRouter.put("/", async (req: Request, res: Response) => {

  const chatbotId = req.params.chatbotId

  const bot = await getChatbot(req.userId!!, chatbotId)

  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const parsed = connectionSchema.safeParse(req.body)

  if (!parsed.success) return res.status(400).json({ error: "Invalid inputs", details: parsed.error.flatten() })

  const conn = await upsertConnection(chatbotId, parsed.data)
  return res.json(ToSafeConnection(conn))


})