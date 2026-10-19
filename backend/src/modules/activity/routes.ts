import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware.js";
import { listActivity } from "./service.js";

// Activity log: any signed-in user can view it.
export const activityRouter = Router();

activityRouter.use(requireAuth);

// GET /api/activity?chatbotId=&limit=&before=
activityRouter.get("/", async (req: Request, res: Response) => {
  const chatbotId = typeof req.query.chatbotId === "string" ? req.query.chatbotId : undefined;
  const limit = Number(req.query.limit) || undefined;
  const beforeRaw = typeof req.query.before === "string" ? new Date(req.query.before) : undefined;
  const before = beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : undefined;
  const entries = await listActivity({ chatbotId, limit, before });
  res.json({ entries });
});
