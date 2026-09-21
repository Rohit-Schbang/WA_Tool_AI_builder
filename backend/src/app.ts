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

export function createApp() {
  const app = express();

  // --- Global middleware ---
  // Allow the Next.js frontend (different port) to call this API.
  app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
  // Parse JSON request bodies into req.body.
  app.use(express.json());

  // --- Health check ---
  // A simple endpoint to confirm the server is alive.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "wa-ai-tool-backend", time: new Date().toISOString() });
  });

  // --- Module routes ---
  // Each router is mounted under a prefix. So a GET /api/auth/ping
  // is handled by authRouter's "/ping" route.
  app.use("/api/auth", authRouter);
  app.use("/api/chatbots", chatbotsRouter);
  app.use("/api/chatbots/:chatbotId/workflow", workflowsRouter);
  app.use("/api/chatbots/:chatbotId/conversations", conversationsRouter);
  app.use("/api/chatbots/:chatbotId/connection", connectionRouter);
  app.use("/api/whatsapp", webhookRouter);

  // --- 404 fallback ---
  // Runs if no route above matched.
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Not found", path: req.path });
  });

  // --- Central error handler ---
  // Express recognizes this as an error handler because it has 4 args.
  // Any error thrown in a route ends up here.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
