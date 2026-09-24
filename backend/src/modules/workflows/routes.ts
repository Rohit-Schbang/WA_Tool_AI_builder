/**
 * Workflows module routes.
 * Save draft + publish immutable versions + validation — implemented in Phases 2-3.
 */
import { Request, Response, Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import z from "zod";
import { getChatbot } from "../chatbots/service.js";
import { Prisma } from "@prisma/client";
import { getDraft, publishDraft, saveDraft } from "./service.js";
import { handleInboundMessage } from "../conversations/service.js";
import { ConsoleAdapter } from "../messaging/adapters.js";

export const workflowsRouter = Router({ mergeParams: true });

workflowsRouter.use(requireAuth)          //    Auth Wrapper   -------------------->>>>>> 

// DRAFT Schema ----------------------->>  >>>>

const draftSchema = z.object({
  definition: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any())
  }).passthrough(),
})

// GET------------>>>>        api/chatbots/:chatbotId/workflow/draft
workflowsRouter.get("/draft", async (req: Request, res: Response) => {

  const chatbotId = req.params.chatbotId;

  const bot = await getChatbot(req.userId!, chatbotId)
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })                  // Checking if BOT present first, before cheking the draft

  const draft = await getDraft(chatbotId)
  if (!draft) return res.status(404).json({ error: "Draft not found" })

  res.json(draft)

})

// PUT ------------>>>>         api/chatbots/:chatbotId/workflow/draft
workflowsRouter.put("/draft", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;

  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid workflow", details: parsed.error.flatten() });

  const saved = await saveDraft(chatbotId, parsed.data.definition as Prisma.InputJsonValue);
  return res.json(saved);
});

// POST ---------->>>>          api/chatbots/:chatbotId/workflow/publish
workflowsRouter.post("/publish", async (req: Request, res: Response) => {

  const chatbotId = req.params.chatbotId

  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const result = await publishDraft(chatbotId)
  // 422 - request was understood but the workflow is invalid
  if (!result.ok) return res.status(422).json({ error: "Workflow is not valid", details: result.errors })

  return res.json({ published: true, version: result.version })

})


// POST /api/chatbots/:chatbotId/workflow/ping
// Server-side reachability check for a (third-party) URL. Runs from the backend
// so it isn't blocked by browser CORS, and reflects whether the runtime (which
// also calls from the backend) can reach the host. Any HTTP response = reachable
// (green); only network errors / timeouts = unreachable (red).
workflowsRouter.post("/ping", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const { url, headers } = req.body ?? {};
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ ok: false, error: "A valid http(s) URL is required" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const started = Date.now();
  try {
    const hdrs: Record<string, string> = {};
    if (Array.isArray(headers)) {
      for (const h of headers) if (h?.key) hdrs[h.key] = String(h.value ?? "");
    }
    // HEAD first (cheap); some servers reject HEAD, so fall back to GET.
    let response: globalThis.Response;
    try {
      response = await fetch(url, { method: "HEAD", headers: hdrs, signal: controller.signal });
    } catch {
      response = await fetch(url, { method: "GET", headers: hdrs, signal: controller.signal });
    }
    clearTimeout(timer);
    return res.json({ ok: true, reachable: true, status: response.status, ms: Date.now() - started });
  } catch (err: any) {
    clearTimeout(timer);
    const timedOut = err?.name === "AbortError";
    return res.json({ ok: true, reachable: false, error: timedOut ? "timeout" : String(err?.message ?? err) });
  }
});

// POST /api/chatbots/:chatbotId/workflow/test
// Web-based test: runs the REAL conversation path (published + active version),
// creates a real logged conversation, and returns the bot's replies.
workflowsRouter.post("/test", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;

  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const { message, testUserId } = req.body ?? {};

  // A stable per-session test user id so the conversation continues.
  const waUserId = testUserId ?? "web-test";

  // Capture the bot's outgoing messages via a ConsoleAdapter.
  const adapter = new ConsoleAdapter();

  const result = await handleInboundMessage(chatbotId, waUserId, message ?? "", adapter, {
    bypassTrigger: true,
  });

  return res.json({
    status: result.status,
    replies: adapter.sent.map((m) => ({ text: m.text, options: m.options, media: m.media, cta: m.cta })),
  });
});
