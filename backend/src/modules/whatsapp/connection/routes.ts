
import { Request, Response, Router } from "express";
import { z } from "zod";
import { getChatbot } from "../../chatbots/service.js";
import { requireAuth } from "../../auth/middleware.js";
import { logActivity } from "../../activity/service.js";
import { getConnection, ToSafeConnection, upsertConnection, type ConnectionInput } from "./service.js";
import { config } from "../../../infra/config.js";
import { completeEmbeddedSignup, isEmbeddedSignupConfigured, EmbeddedSignupError, getConnectionHealth, verifyManualCredentials } from "./embeddedSignup.js";
export const whatsappRouter = Router();


// Using " mergeparams " which lets this router to read :chatbotID from the paraent path
//  when we mount it under /api/chatbots/:chatbotId/connection

export const connectionRouter = Router({ mergeParams: true })

// SECURITY: every connection route reads/writes WhatsApp credentials, so it
// must require a signed-in user (previously missing — the routes were open).
connectionRouter.use(requireAuth)

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

  const bot = await getChatbot(chatbotId)

  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const connection = await getConnection(chatbotId)

  // Getting connection ----->>>>>

  if (!connection) return res.status(404).json({ error: "No Connection Configured" })

  return res.json(ToSafeConnection(connection))

})

// PUT --------->>>>> api/chatbots/:chatbotId/connection

connectionRouter.put("/", async (req: Request, res: Response) => {

  const chatbotId = req.params.chatbotId

  const bot = await getChatbot(chatbotId)

  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const parsed = connectionSchema.safeParse(req.body)

  if (!parsed.success) return res.status(400).json({ error: "Invalid inputs", details: parsed.error.flatten() })

  const data: ConnectionInput = { ...parsed.data }

  // Determine the effective access token + phone number id after this save
  // (fall back to what's already stored, since secret fields are left blank to
  // keep the existing value). If we have both, verify them against Meta and set
  // the connection status accordingly — this is what flips the manual path from
  // DISCONNECTED to CONNECTED.
  const existing = await getConnection(chatbotId)
  const effectiveToken = data.accessToken ?? existing?.accessToken ?? null
  const effectivePhoneId = data.phoneNumberId ?? existing?.phoneNumberId ?? null

  let verifyMessage: string | null = null
  if (effectiveToken && effectivePhoneId) {
    try {
      const info = await verifyManualCredentials({ accessToken: effectiveToken, phoneNumberId: effectivePhoneId })
      data.status = "CONNECTED"
      // Backfill display fields from Meta if the user didn't type them.
      if (!data.phoneNumber && info.displayPhoneNumber) data.phoneNumber = info.displayPhoneNumber
      if (!data.businessName && info.verifiedName) data.businessName = info.verifiedName
    } catch (err) {
      data.status = "ERROR"
      verifyMessage = err instanceof EmbeddedSignupError ? err.message : "Could not verify these credentials with Meta."
    }
  } else {
    // Not enough to be connected yet.
    data.status = "DISCONNECTED"
    verifyMessage = "Add both an Access Token and Phone Number ID to connect."
  }

  const conn = await upsertConnection(chatbotId, data)
  // Log WHICH fields changed (never the secret values themselves).
  logActivity(req, "connection.update", {
    chatbotId,
    details: { fields: Object.keys(parsed.data).filter((k) => (parsed.data as any)[k] !== undefined), status: conn.status },
  })
  return res.json({ ...ToSafeConnection(conn), verifyMessage })


})

// GET ---> api/chatbots/:chatbotId/connection/meta-config
// Public-safe config the frontend needs to initialise the Facebook JS SDK for
// Embedded Signup. Returns ONLY the app id + config id + graph version (never
// the app secret). `enabled` tells the UI whether to show the "Connect with
// Facebook" button or fall back to manual entry.
connectionRouter.get("/meta-config", async (req: Request, res: Response) => {
  const bot = await getChatbot(req.params.chatbotId)
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  return res.json({
    enabled: isEmbeddedSignupConfigured(),
    appId: config.META_APP_ID ?? null,
    configId: config.META_CONFIG_ID ?? null,
    solutionId: config.META_SOLUTION_ID ?? null,
    graphVersion: config.META_GRAPH_VERSION,
  })
})

// GET ---> api/chatbots/:chatbotId/connection/health
// Live number health for the dashboard (quality rating, verification, display
// name). Fetches fresh values from Meta and caches them; falls back to the
// last-known snapshot if Meta is unreachable. Never returns secrets.
connectionRouter.get("/health", async (req: Request, res: Response) => {
  const bot = await getChatbot(req.params.chatbotId)
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const health = await getConnectionHealth(req.params.chatbotId)
  if (!health) return res.status(404).json({ error: "No Connection Configured" })

  return res.json(health)
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
  const bot = await getChatbot(chatbotId)
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const parsed = embeddedSignupSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid inputs", details: parsed.error.flatten() })

  try {
    const conn = await completeEmbeddedSignup(chatbotId, parsed.data)
    logActivity(req, "connection.embedded_signup", { chatbotId, details: { phoneNumber: conn.phoneNumber } })
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