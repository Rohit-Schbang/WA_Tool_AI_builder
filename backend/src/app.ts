/**
 * app.ts — assembles the Express application.
 *
 * This file is the "wiring diagram" of the backend. It:
 *   1. Applies global middleware (CORS, JSON body parsing)
 *   2. Mounts each module's router under an /api/... prefix
 *   3. Defines a health-check endpoint
 *   4. Adds a fallback 404 and a central error handler
 *
 * Middleware = functions that run on every request in order, before
 * the route handler. e.g. express.json() reads the request body and
 * turns it into a JS object on req.body.
 */
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./infra/config.js";

// Module routers
import { authRouter } from "./modules/auth/routes.js";
import { chatbotsRouter } from "./modules/chatbots/routes.js";
import { workflowsRouter } from "./modules/workflows/routes.js";
import { conversationsRouter } from "./modules/conversations/routes.js";
import { connectionRouter } from "./modules/whatsapp/connection/routes.js";
import { webhookRouter } from "./modules/whatsapp/webhook/routes.js";
import { contactsRouter } from "./modules/contacts/routes.js";
import { apiLimiter } from "./infra/rateLimit.js";
import { activityRouter } from "./modules/activity/routes.js";

export function createApp() {
  const app = express();

  // Trust the first proxy hop so express-rate-limit keys on the real client IP
  // (X-Forwarded-For) when deployed behind a load balancer / reverse proxy.
  app.set("trust proxy", 1);

  // --- Global middleware ---
  // Allow the Next.js frontend(s) to call this API. FRONTEND_ORIGIN may be a
  // comma-separated list (e.g. "https://waaitool.vercel.app,http://localhost:3000").
  // Trailing slashes and case are normalised so a stray "/" doesn't break CORS.
  const normalizeOrigin = (o: string) => o.trim().replace(/\/+$/, "").toLowerCase();
  const allowedOrigins = config.FRONTEND_ORIGIN.split(",").map(normalizeOrigin).filter(Boolean);
  app.use(
    cors({
      // No Origin header = server-to-server / curl / Meta webhook → allow.
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(normalizeOrigin(origin))),
      credentials: true,
      // Let the browser cache the CORS preflight (the automatic OPTIONS request
      // before each cross-origin call with an Authorization header) for 2 hours,
      // instead of sending one before every request. Browsers cap this
      // (Chrome at 2h), so a larger value wouldn't help.
      maxAge: 7200,
    }),
  );
  // Parse JSON request bodies into req.body. The `verify` hook also stashes the
  // RAW request bytes on req.rawBody — needed to verify Meta's webhook
  // X-Hub-Signature-256 HMAC, which is computed over the exact payload bytes
  // (a re-serialized req.body would not byte-match and the check would fail).
  app.use(
    express.json({
      // Large enough for uncompressed draw.io files sent to the AI generator.
      limit: "6mb",
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // --- Health check ---
  // A simple endpoint to confirm the server is alive.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "wa-ai-tool-backend", time: new Date().toISOString() });
  });

  // --- Keep-alive ping ---
  // Ultra-light endpoint for an EXTERNAL uptime cron (e.g. cron-job.org,
  // UptimeRobot) to hit every ~10 minutes so Render's free tier doesn't spin
  // the service down for inactivity (which causes 30-60s cold starts and can
  // delay/miss the first WhatsApp webhook). No DB, no auth, and it sits above
  // the /api rate limiter so the pinger is never throttled (429).
  app.get("/ping", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, uptime: process.uptime() });
  });

  // --- Module routes ---
  // Each router is mounted under a prefix. So a GET /api/auth/ping
  // is handled by authRouter's "/ping" route.
  // apiLimiter (100 req/min per IP) guards the JSON API. The webhook is mounted
  // WITHOUT it — Meta delivers inbound messages in bursts and is secured by
  // HMAC signature verification instead.
  app.use("/api/auth", apiLimiter, authRouter);
  app.use("/api/chatbots", apiLimiter, chatbotsRouter);
  app.use("/api/chatbots/:chatbotId/workflow", apiLimiter, workflowsRouter);
  app.use("/api/chatbots/:chatbotId/conversations", apiLimiter, conversationsRouter);
  app.use("/api/chatbots/:chatbotId/connection", apiLimiter, connectionRouter);
  app.use("/api/whatsapp", webhookRouter);
  app.use("/api/contacts", apiLimiter, contactsRouter);
  app.use("/api/activity", apiLimiter, activityRouter);

  // --- 404 fallback ---
  // Runs if no route above matched.
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Not found", path: req.path });
  });

  // --- Central error handler ---
  // Express recognizes this as an error handler because it has 4 args.
  // Any error thrown in a route ends up here.
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    // A body that claims to be JSON but isn't (e.g. a GET sent with
    // "Content-Type: application/json" and a blank body). That's the
    // client's mistake — answer 400, not 500.
    if (err?.type === "entity.parse.failed") {
      console.warn(`[http] invalid JSON body on ${req.method} ${req.path}`);
      return res.status(400).json({
        error: "The request body isn't valid JSON. Send valid JSON, or for GET requests send no body and no \"Content-Type: application/json\" header.",
        code: "INVALID_JSON",
      });
    }
    // Other errors the body parser marks as safe to show (e.g. 413 body too
    // large) keep their own 4xx status and message.
    const status = Number(err?.status ?? err?.statusCode);
    if (err?.expose && status >= 400 && status < 500) {
      return res.status(status).json({ error: err.message });
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
