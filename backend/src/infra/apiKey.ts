import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "./config.js";

// Optional API-key guard for machine / server-to-server callers.
//
// Usage: apply `requireApiKey` to any router or route that external systems
// call directly (NOT the browser frontend, which authenticates with a JWT via
// requireAuth). The caller must send:  x-api-key: <BACKEND_API_KEY>
//
// Behaviour:
//   - If BACKEND_API_KEY is not configured, the guard is effectively disabled
//     and requests pass through (so the app still boots/works in dev). Log once
//     so it's obvious the protection isn't active.
//   - If configured, a missing or wrong key is rejected with 401, using a
//     timing-safe comparison to avoid leaking the key via response timing.
let warnedMissing = false;

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = config.BACKEND_API_KEY;

  if (!expected) {
    if (!warnedMissing) {
      console.warn("requireApiKey is applied but BACKEND_API_KEY is not set — API-key protection is OFF.");
      warnedMissing = true;
    }
    return next();
  }

  const provided = req.get("x-api-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }

  return next();
}
