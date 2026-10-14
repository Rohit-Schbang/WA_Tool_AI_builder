import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../../../infra/config.js";

// Express augmentation: express.json({ verify }) stashes the raw request bytes
// here so we can HMAC-verify the exact payload Meta signed.
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// Should we enforce webhook signature verification?
// - If WEBHOOK_VERIFY_SIGNATURE is explicitly set, honor it.
// - Otherwise enforce automatically whenever an App Secret is configured.
function verificationEnabled(): boolean {
  if (config.WEBHOOK_VERIFY_SIGNATURE === "true") return true;
  if (config.WEBHOOK_VERIFY_SIGNATURE === "false") return false;
  return Boolean(config.META_APP_SECRET);
}

// Verify Meta's X-Hub-Signature-256 header on inbound webhook POSTs.
//
// Meta signs every webhook payload with HMAC-SHA256 over the RAW request body,
// keyed by the app's App Secret, and sends it as:
//     X-Hub-Signature-256: sha256=<hex>
// We recompute the HMAC and compare using a timing-safe equality check. This
// cryptographically proves the request came from Meta (nobody without the App
// Secret can forge it) — the correct way to secure a public webhook.
export function verifyWebhookSignature(req: Request, res: Response, next: NextFunction) {
  if (!verificationEnabled()) return next();

  const appSecret = config.META_APP_SECRET;
  if (!appSecret) {
    // Enforcement requested but no secret to verify against — fail closed.
    console.error("Webhook signature verification is enabled but META_APP_SECRET is not set.");
    return res.sendStatus(401);
  }

  const header = req.get("x-hub-signature-256") ?? "";
  const raw = req.rawBody;
  if (!header || !raw || raw.length === 0) {
    return res.sendStatus(401);
  }

  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");

  // Timing-safe compare. Buffers must be equal length or timingSafeEqual throws.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.sendStatus(401);
  }

  return next();
}
