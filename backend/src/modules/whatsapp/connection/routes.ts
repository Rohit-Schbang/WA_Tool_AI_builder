
import { Request, Response, Router } from "express";
import { z } from "zod";
import { getChatbot } from "../../chatbots/service.js";
import { getConnection, ToSafeConnection, upsertConnection } from "./service.js";
import { config } from "../../../infra/config.js";
import { completeEmbeddedSignup, isEmbeddedSignupConfigured, EmbeddedSignupError } from "./embeddedSignup.js";
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

// GET ---> api/chatbots/:chatbotId/connection/meta-config
// Public-safe config the frontend needs to initialise the Facebook JS SDK for
// Embedded Signup. Returns ONLY the app id + config id + graph version (never
// the app secret). `enabled` tells the UI whether to show the "Connect with
// Facebook" button or fall back to manual entry.
connectionRouter.get("/meta-config", async (req: Request, res: Response) => {
  const bot = await getChatbot(req.userId!!, req.params.chatbotId)
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  return res.json({
    enabled: isEmbeddedSignupConfigured(),
    appId: config.META_APP_ID ?? null,
    configId: config.META_CONFIG_ID ?? null,
    graphVersion: config.META_GRAPH_VERSION,
  })
})

// POST ---> api/chatbots/:chatbotId/connection/embedded-signup
// Completes Meta Embedded Signup: exchanges the short-lived code for a token,
// provisions the WABA + phone number, and stores the credentials.
const embeddedSignupSchema = z.object({
  code: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
})

connectionRouter.post("/embedded-signup", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId
  const bot = await getChatbot(req.userId!!, chatbotId)
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const parsed = embeddedSignupSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid inputs", details: parsed.error.flatten() })

  try {
    const conn = await completeEmbeddedSignup(chatbotId, parsed.data)
    return res.json(ToSafeConnection(conn))
  } catch (err) {
    if (err instanceof EmbeddedSignupError) {
      console.error("Embedded signup error:", err.message, err.detail)
      return res.status(502).json({ error: err.message })
    }
    console.error("Embedded signup unexpected error:", err)
    return res.status(500).json({ error: "Failed to complete WhatsApp connection" })
  }
})