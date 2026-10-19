import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { requireAuth } from "../auth/middleware.js";
import { config } from "../../infra/config.js";
import { listActivity } from "./service.js";

// Viewing the activity log needs BOTH a signed-in user AND the special access
// key (header: x-activity-key = ACTIVITY_LOG_API_KEY). Unlike requireApiKey,
// this FAILS CLOSED: if no key is configured, nobody can read the log.
export const activityRouter = Router();

activityRouter.use(requireAuth);

function requireActivityKey(req: Request, res: Response, next: NextFunction) {
  const expected = config.ACTIVITY_LOG_API_KEY;
  if (!expected) {
    return res.status(503).json({ error: "Activity log access is not configured on the server." });
  }
  const provided = req.get("x-activity-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "Invalid activity access key." });
  }
  next();
}

activityRouter.use(requireActivityKey);

// POST /api/activity/verify — lets the UI check a key before showing the log.
activityRouter.post("/verify", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// GET /api/activity?chatbotId=&limit=&before=
activityRouter.get("/", async (req: Request, res: Response) => {
  const chatbotId = typeof req.query.chatbotId === "string" ? req.query.chatbotId : undefined;
  const limit = Number(req.query.limit) || undefined;
  const beforeRaw = typeof req.query.before === "string" ? new Date(req.query.before) : undefined;
  const before = beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : undefined;
  const entries = await listActivity({ chatbotId, limit, before });
  res.json({ entries });
});
