
import { Request, Response, Router } from "express";
import { z } from "zod";
import { getChatbot } from "../../chatbots/service.js";
import { requireAuth } from "../../auth/middleware.js";
import { logActivity } from "../../activity/service.js";
import { getConnection, ToSafeConnection, upsertConnection, type ConnectionInput } from "./service.js";
import { config } from "../../../infra/config.js";
import { completeEmbeddedSignup, isEmbeddedSignupConfigured, EmbeddedSignupError, getConnectionHealth, verifyManualCredentials } from "./embeddedSignup.js";
import { guardKeywords, KeywordConflictError } from "../../triggers/guard.js";
export const whatsappRouter = Router();


// Using " mergeparams " which lets this router to read :chatbotID from the paraent path
//  when we mount it under /api/chatbots/:chatbotId/connection

export const connectionRouter = Router({ mergeParams: true })

// SECURITY: every connection route reads/writes WhatsApp credentials, so it
// must require a signed-in user (previously missing — the routes were open).
connectionRouter.use(requireAuth)

// Client may sent the optional updates 

// Blank = "leave unchanged" (never overwrite a saved value with ""). Each field
// is format-checked so a browser autofill (e.g. an email or login password
// dropped into the wrong box) is rejected instead of corrupting the connection.
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v), schema.optional())

const numericId = (label: string) =>
  z.string().regex(/^\d{5,25}$/, `${label} must be the numeric ID from Meta (digits only).`)

export const connectionSchema = z.object({
  businessName: optional(z.string().max(200)),
  phoneNumber: optional(z.string().regex(/^\+?[\d\s()-]{6,24}$/, "Phone number should look like +91 98765 43210.")),
  phoneNumberId: optional(numericId("Phone Number ID")),
  wabaId: optional(numericId("WABA ID")),
  // Meta access tokens start with "EA" and contain no spaces or "@".
  accessToken: optional(z.string().regex(/^EA[A-Za-z0-9_-]{30,}$/, "That doesn't look like a Meta access token (they start with \"EA\"). Your browser may have autofilled a saved password.")),
  appId: optional(numericId("App ID")),
  appSecret: optional(z.string().regex(/^[a-f0-9]{32}$/i, "The App Secret is a 32-character hex string from Meta App → Settings → Basic.")),
  verifyToken: optional(z.string().min(4).max(200).regex(/^\S+$/, "The verify token can't contain spaces.")),
})

// First field-level message from a zod error, for a friendly 400.
function firstIssue(err: z.ZodError): { field?: string; message: string } {
  const i = err.issues[0]
  return { field: i?.path?.[0] as string | undefined, message: i?.message ?? "Invalid input" }
}

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

  if (!parsed.success) {
    const issue = firstIssue(parsed.error)
    return res.status(400).json({ error: issue.message, field: issue.field, details: parsed.error.flatten() })
  }

  // Only fields that were actually provided (blank ones were dropped above).
  const data: ConnectionInput = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  ) as ConnectionInput

  if (data.phoneNumberId && data.wabaId && data.phoneNumberId === data.wabaId) {
    return res.status(400).json({ error: "Phone Number ID and WABA ID are different IDs — they can't be the same.", field: "phoneNumberId" })
  }

  // Effective token + phone number id after this save (blank secret fields keep
  // the stored value). With both, verify against Meta.
  const existing = await getConnection(chatbotId)
  const effectiveToken = data.accessToken ?? existing?.accessToken ?? null
  const effectivePhoneId = data.phoneNumberId ?? existing?.phoneNumberId ?? null
  const credentialsChanged =
    (data.accessToken !== undefined && data.accessToken !== existing?.accessToken) ||
    (data.phoneNumberId !== undefined && data.phoneNumberId !== existing?.phoneNumberId)

  let verifyMessage: string | null = null
  if (effectiveToken && effectivePhoneId) {
    try {
      const info = await verifyManualCredentials({ accessToken: effectiveToken, phoneNumberId: effectivePhoneId })
      data.status = "CONNECTED"
      if (info.systemUserId) data.systemUserId = info.systemUserId
      if (info.systemUserName) data.systemUserName = info.systemUserName
      // Backfill display fields from Meta if the user didn't type them.
      if (!data.phoneNumber && info.displayPhoneNumber) data.phoneNumber = info.displayPhoneNumber
      if (!data.businessName && info.verifiedName) data.businessName = info.verifiedName
    } catch (err) {
      const message = err instanceof EmbeddedSignupError ? err.message : "Could not verify these credentials with Meta."
      // New credentials that Meta rejects are NOT saved — the existing (maybe
      // working) connection stays exactly as it was.
      if (credentialsChanged) {
        return res.status(422).json({ error: message, status: existing?.status ?? "DISCONNECTED", saved: false })
      }
      data.status = "ERROR"
      verifyMessage = message
    }
  } else {
    // Not enough to be connected yet.
    data.status = "DISCONNECTED"
    verifyMessage = "Add both an Access Token and Phone Number ID to connect."
  }

  // Moving this journey onto a number must not clash with the trigger keywords
  // of journeys already on it (checked under a per-number lock).
  let conn
  try {
    ({ result: conn } = await guardKeywords(chatbotId, { phoneNumberId: effectivePhoneId }, () => upsertConnection(chatbotId, data)))
  } catch (err) {
    if (err instanceof KeywordConflictError) {
      return res.status(409).json({ error: err.message, code: "KEYWORD_CONFLICT", conflicts: err.conflicts, saved: false })
    }
    throw err
  }
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
    if (err instanceof KeywordConflictError) {
      return res.status(409).json({ error: err.message, code: "KEYWORD_CONFLICT", conflicts: err.conflicts })
    }
    if (err instanceof EmbeddedSignupError) {
      console.error("Embedded signup error:", err.message, err.detail)
      return res.status(502).json({ error: err.message })
    }
    console.error("Embedded signup unexpected error:", err)
    return res.status(500).json({ error: "Failed to complete WhatsApp connection" })
  }
})