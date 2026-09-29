/**
 * Workflows module routes.
 * Save draft + publish immutable versions + validation — implemented in Phases 2-3.
 */
import { Request, Response, Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import z from "zod";
import { getChatbot } from "../chatbots/service.js";
import { Prisma } from "@prisma/client";
import {
  activateVersion,
  getDraft,
  getPublishedVersion,
  listVersions,
  publishDraft,
  restoreVersionToDraft,
  saveDraft,
} from "./service.js";
import { handleInboundMessage } from "../conversations/service.js";
import { ConsoleAdapter } from "../messaging/adapters.js";
import { generateJourney, planOnly } from "./generator.js";

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


// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

// GET ---------->>>>          api/chatbots/:chatbotId/workflow/versions
workflowsRouter.get("/versions", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  return res.json(await listVersions(chatbotId));
});

// GET ---------->>>>          api/chatbots/:chatbotId/workflow/versions/:version
// Full definition of one published version (read-only preview).
workflowsRouter.get("/versions/:version", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const row = await getPublishedVersion(chatbotId, Number(req.params.version));
  if (!row) return res.status(404).json({ error: "Version not found" });

  return res.json({
    version: row.version,
    publishedAt: row.publishedAt,
    isLive: row.id === bot.activeVersionId,
    definition: row.definition,
  });
});

// POST ---------->>>>         api/chatbots/:chatbotId/workflow/versions/:version/activate
// "Make live": the bot immediately starts running this version.
workflowsRouter.post("/versions/:version/activate", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const row = await activateVersion(chatbotId, Number(req.params.version));
  if (!row) return res.status(404).json({ error: "Version not found" });

  return res.json({ ok: true, liveVersion: row.version });
});

// POST ---------->>>>         api/chatbots/:chatbotId/workflow/versions/:version/restore
// "Restore to editor": copy this version into the draft (canvas).
workflowsRouter.post("/versions/:version/restore", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const draft = await restoreVersionToDraft(chatbotId, Number(req.params.version));
  if (!draft) return res.status(404).json({ error: "Version not found" });

  return res.json({ ok: true, definition: draft.definition });
});

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
// POST /api/chatbots/:chatbotId/workflow/generate
// AI Journey Generator: turns a description (+ optional draw.io XML) into a
// workflow definition the frontend can drop onto the canvas. Does NOT save it.
const generateSchema = z.object({
  description: z.string().max(8000).optional().default(""),
  drawioXml: z.string().max(200000).optional(),
  // When present, this is the user-APPROVED plan — build straight from it
  // (skip the planning step). Omit it to just get a plan back for review.
  plan: z.array(z.object({
    step: z.number().optional(),
    title: z.string().optional(),
    nodeType: z.string().optional(),
    detail: z.string().optional(),
  })).optional(),
});

const aiErrorMessage = (err: any) =>
  /API Key/i.test(String(err?.message))
    ? "AI is not configured on the server (missing Gemini key)."
    : /RESOURCE_EXHAUSTED|prepayment|402/i.test(String(err?.message))
      ? "The AI account is out of credits. Please top up the Gemini billing."
      : "Failed to generate. Please try again or rephrase.";

// STEP 1 — PLAN ONLY. Returns the ordered stages for the user to review;
// does NOT build or touch the canvas.
workflowsRouter.post("/generate-plan", async (req: Request, res: Response) => {
  const bot = await getChatbot(req.userId!, req.params.chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { description, drawioXml } = parsed.data;
  if (!description.trim() && !drawioXml?.trim()) {
    return res.status(400).json({ error: "Provide a description or a draw.io diagram." });
  }

  try {
    const plan = await planOnly(description, drawioXml);
    return res.json({ plan });
  } catch (err: any) {
    console.error("Journey plan error:", err?.message ?? err);
    return res.status(502).json({ error: aiErrorMessage(err) });
  }
});

// STEP 2 — BUILD. Uses the approved plan (if provided) to build the workflow.
workflowsRouter.post("/generate", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(req.userId!, chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { description, drawioXml, plan } = parsed.data;
  if (!description.trim() && !drawioXml?.trim() && !(plan && plan.length)) {
    return res.status(400).json({ error: "Provide a description or a draw.io diagram." });
  }

  try {
    const result = await generateJourney(description, drawioXml, plan as any);
    return res.json({
      ok: result.ok,
      definition: result.definition ?? null,
      plan: result.plan ?? [],
      warnings: result.errors ?? [],
    });
  } catch (err: any) {
    console.error("Journey generation error:", err?.message ?? err);
    return res.status(502).json({ error: aiErrorMessage(err) });
  }
});

// Web-based test: runs the REAL conversation path against the latest saved
// draft, creates a real logged conversation, and returns the bot's replies.
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
    // Test what's on the canvas (latest saved draft), not the last publish.
    useDraft: true,
  });

  return res.json({
    status: result.status,
    replies: adapter.sent.map((m) => ({ text: m.text, options: m.options, media: m.media, cta: m.cta })),
  });
});
