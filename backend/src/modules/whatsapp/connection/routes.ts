
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth, requireSettingsAdmin } from "../../auth/middleware.js";
import { logActivity } from "../../activity/service.js";
import { disconnectConnection, getConnection, ToSafeConnection, upsertConnection, type ConnectionInput } from "./service.js";
import { config } from "../../../infra/config.js";
import { completeEmbeddedSignup, isEmbeddedSignupConfigured, EmbeddedSignupError, getConnectionHealth, verifyManualCredentials } from "./embeddedSignup.js";

// The workspace's master WhatsApp connection, mounted at
// /api/whatsapp/connection. One connection for every journey; it is NOT tied
// to a chatbot, so journey create/import/delete never affects it.
export const connectionRouter = Router()

// SECURITY: every route reads/writes WhatsApp credentials. Signed-in users on
// the SETTINGS_ADMIN_EMAILS list only (others get 403).
connectionRouter.use(requireAuth)
connectionRouter.use(requireSettingsAdmin)

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

// GET ---> /api/whatsapp/connection
connectionRouter.get("/", async (_req: Request, res: Response) => {
  const connection = await getConnection()
  if (!connection) return res.status(404).json({ error: "No Connection Configured" })
  return res.json(ToSafeConnection(connection))
})

// PUT ---> /api/whatsapp/connection  (manual setup)
connectionRouter.put("/", async (req: Request, res: Response) => {
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
  const existing = await getConnection()
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
      // Backfill display fields from Meta if the admin didn't type them.
      if (!data.phoneNumber && info.displayPhoneNumber) data.phoneNumber = info.displayPhoneNumber
      if (!data.businessName && info.verifiedName) data.businessName = info.verifiedName
    } catch (err) {
      const message = err instanceof EmbeddedSignupError ? err.message : "Could not verify these credentials with Meta."
      // New credentials that Meta rejects are NOT saved — the existing
      // connection stays exactly as it was.
      if (credentialsChanged) {
        return res.status(422).json({ error: message, status: existing?.status ?? "DISCONNECTED", saved: false })
      }
      // Same credentials, other fields edited: save those, but keep the
      // current status (a failed check never drops the connection).
      verifyMessage = `Saved, but Meta couldn't confirm the connection right now: ${message}`
    }
  } else {
    data.status = "DISCONNECTED"
    verifyMessage = "Add both an Access Token and Phone Number ID to connect."
  }

  const conn = await upsertConnection({ ...data, updatedByEmail: req.userEmail ?? null })
  // Log WHICH fields changed (never the secret values themselves).
  logActivity(req, "connection.update", {
    details: { fields: Object.keys(data).filter((k) => k !== "status"), status: conn.status },
  })
  return res.json({ ...ToSafeConnection(conn), verifyMessage })
})

// DELETE ---> /api/whatsapp/connection
// Explicit admin disconnect: the only way a working connection is removed.
connectionRouter.delete("/", async (req: Request, res: Response) => {
  const conn = await disconnectConnection(req.userEmail!)
  if (!conn) return res.status(404).json({ error: "No Connection Configured" })
  logActivity(req, "connection.disconnect", { details: { phoneNumber: conn.phoneNumber } })
  return res.json(ToSafeConnection(conn))
})

// GET ---> /api/whatsapp/connection/meta-config
// Public-safe config for the Facebook JS SDK (Embedded Signup). Never the app
// secret. `enabled` tells the UI whether to show "Continue with Meta".
connectionRouter.get("/meta-config", (_req: Request, res: Response) => {
  return res.json({
    enabled: isEmbeddedSignupConfigured(),
    appId: config.META_APP_ID ?? null,
    configId: config.META_CONFIG_ID ?? null,
    solutionId: config.META_SOLUTION_ID ?? null,
    graphVersion: config.META_GRAPH_VERSION,
  })
})

// GET ---> /api/whatsapp/connection/health
// Live number health (quality rating, verification, display name). Never
// returns secrets and never changes the saved connection on failure.
connectionRouter.get("/health", async (_req: Request, res: Response) => {
  const health = await getConnectionHealth()
  if (!health) return res.status(404).json({ error: "No Connection Configured" })
  return res.json(health)
})

// POST ---> /api/whatsapp/connection/embedded-signup
const embeddedSignupSchema = z.object({
  code: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
})

connectionRouter.post("/embedded-signup", async (req: Request, res: Response) => {
  const parsed = embeddedSignupSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid inputs", details: parsed.error.flatten() })

  try {
    const conn = await completeEmbeddedSignup(parsed.data, req.userEmail!)
    logActivity(req, "connection.embedded_signup", { details: { phoneNumber: conn.phoneNumber } })
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
