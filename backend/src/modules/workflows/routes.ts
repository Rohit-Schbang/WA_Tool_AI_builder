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
import { generateJourney, planOnly, makeEditContext, DIAGRAM_LIMITS } from "./generator.js";
import { logActivity } from "../activity/service.js";
import { ensureSingleStart } from "./startNode.js";
import { reportsRouter, saveReport } from "./reports.js";

export const workflowsRouter = Router({ mergeParams: true });

workflowsRouter.use(requireAuth)          //    Auth Wrapper   -------------------->>>>>> 

// Saved AI build reports: api/chatbots/:chatbotId/workflow/reports
workflowsRouter.use("/reports", reportsRouter);

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

  const bot = await getChatbot(chatbotId)
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })                  // Checking if BOT present first, before cheking the draft

  const draft = await getDraft(chatbotId)
  if (!draft) return res.status(404).json({ error: "Draft not found" })

  res.json(draft)

})

// PUT ------------>>>>         api/chatbots/:chatbotId/workflow/draft
workflowsRouter.put("/draft", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;

  const bot = await getChatbot(chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid workflow", details: parsed.error.flatten() });

  // Guarantee exactly one START node so a corrupted/edited client copy can
  // never persist a flow without an entry point.
  const definition = ensureSingleStart(parsed.data.definition);
  const saved = await saveDraft(chatbotId, definition as Prisma.InputJsonValue);
  logActivity(req, "workflow.save", { chatbotId, version: 0, details: { nodes: definition.nodes.length } });
  return res.json(saved);
});

// POST ---------->>>>          api/chatbots/:chatbotId/workflow/publish
workflowsRouter.post("/publish", async (req: Request, res: Response) => {

  const chatbotId = req.params.chatbotId

  const bot = await getChatbot(chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" })

  const result = await publishDraft(chatbotId)
  // 422 - request was understood but the workflow is invalid
  if (!result.ok) return res.status(422).json({ error: "Workflow is not valid", details: result.errors })

  logActivity(req, "workflow.publish", { chatbotId, version: result.version })
  return res.json({ published: true, version: result.version })

})


// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

// GET ---------->>>>          api/chatbots/:chatbotId/workflow/versions
workflowsRouter.get("/versions", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  return res.json(await listVersions(chatbotId));
});

// GET ---------->>>>          api/chatbots/:chatbotId/workflow/versions/:version
// Full definition of one published version (read-only preview).
workflowsRouter.get("/versions/:version", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(chatbotId);
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
  const bot = await getChatbot(chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const row = await activateVersion(chatbotId, Number(req.params.version));
  if (!row) return res.status(404).json({ error: "Version not found" });

  logActivity(req, "workflow.activate_version", { chatbotId, version: row.version });
  return res.json({ ok: true, liveVersion: row.version });
});

// POST ---------->>>>         api/chatbots/:chatbotId/workflow/versions/:version/restore
// "Restore to editor": copy this version into the draft (canvas).
workflowsRouter.post("/versions/:version/restore", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const draft = await restoreVersionToDraft(chatbotId, Number(req.params.version));
  if (!draft) return res.status(404).json({ error: "Version not found" });

  logActivity(req, "workflow.restore_version", { chatbotId, version: Number(req.params.version) });
  return res.json({ ok: true, definition: draft.definition });
});

// POST /api/chatbots/:chatbotId/workflow/ping
// Server-side reachability check for a (third-party) URL. Runs from the backend
// so it isn't blocked by browser CORS, and reflects whether the runtime (which
// also calls from the backend) can reach the host. Any HTTP response = reachable
// (green); only network errors / timeouts = unreachable (red).
workflowsRouter.post("/ping", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(chatbotId);
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
  // Display name of the attached draw.io file (used to title the saved report).
  sourceName: z.string().max(200).optional(),
  // Uncompressed draw.io files can be large; the file is parsed in code, so a
  // generous limit is fine (the request body limit is set in app.ts).
  drawioXml: z.string().max(5_000_000, "The draw.io file is larger than 5 MB.").optional(),
  // When present, this is the user-APPROVED plan — build straight from it
  // (skip the planning step). Omit it to just get a plan back for review.
  plan: z.array(z.object({
    step: z.number().optional(),
    title: z.string().optional(),
    nodeType: z.string().optional(),
    detail: z.string().optional(),
    sourceId: z.string().optional(),           // node id this stage becomes
    sourceIds: z.array(z.string()).optional(), // diagram shapes it represents
    text: z.string().max(4096).optional(),
    textSource: z.enum(["verbatim", "written"]).optional(),
    variable: z.string().max(80).optional(),
    validationType: z.string().max(30).optional(),
    expectedType: z.string().max(30).optional(),
    confidence: z.string().max(20).optional(),
    ambiguity: z.string().max(500).optional(),
  })).max(500).optional(),
  // EDIT mode: when both are present, the journey is REGENERATED from the
  // existing flow + this instruction (create-new-from-original, not a patch).
  editInstruction: z.string().max(4000).optional(),
  currentDefinition: z.object({
    variables: z.array(z.any()).optional(),
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }).passthrough().optional(),
  // Optional: pin where the edit applies (a node id) so the AI doesn't guess.
  anchorNodeId: z.string().optional(),
  // Whether the separate AI planning stage runs. Defaults to true so existing
  // clients (which omit this) keep the current plan-first behaviour. When
  // false, the backend skips planJourney()/planFromDiagram() and builds
  // directly. Requests are JSON, so this arrives as a real boolean.
  usePlanning: z.boolean().optional().default(true),
  // The builder's current global API configs, so the AI can reference them by
  // name (API_REQUEST nodes are global-config-only; no inline URLs).
  apiConfigs: z.array(z.object({
    name: z.string(),
    baseUrl: z.string().optional(),
    headers: z.array(z.any()).optional(),
    endpoints: z.array(z.any()).optional(),
  }).passthrough()).optional(),
});

const aiErrorMessage = (err: any) =>
  /API Key/i.test(String(err?.message))
    ? "AI is not configured on the server (missing Gemini key)."
    : /spending cap|spend cap/i.test(String(err?.message))
      ? "The AI account has reached its monthly spending cap. An admin needs to raise it in Google AI Studio (ai.studio/spend)."
    : /RESOURCE_EXHAUSTED|prepayment|402/i.test(String(err?.message))
      ? "The AI account is out of credits. Please top up the Gemini billing."
      : /AI_OUTPUT_TRUNCATED/.test(String(err?.message))
        ? "Part of this flow was too long for the AI to write in one go. Try again, or split the diagram into smaller pages."
        : "Failed to generate. Please try again or rephrase.";

// Size-limit errors are the user's to act on (422), not server failures.
function diagramSizeError(err: any): string | null {
  const m = String(err?.message ?? "");
  const tooLarge = m.match(/^DIAGRAM_TOO_LARGE:(\d+)/);
  if (tooLarge) {
    return `This diagram has ${tooLarge[1]} steps; the generator supports up to ${DIAGRAM_LIMITS.maxSteps} per run. Split it into separate draw.io pages or files (e.g. one per journey branch) and generate each part.`;
  }
  const planTooLarge = m.match(/^PLAN_TOO_LARGE:(\d+)/);
  if (planTooLarge) {
    return `The AI couldn't plan all ${planTooLarge[1]} shapes in one go. Split the diagram into smaller pages or files and generate each part.`;
  }
  return null;
}

// STEP 1 — PLAN ONLY. Returns the ordered stages for the user to review;
// does NOT build or touch the canvas.
workflowsRouter.post("/generate-plan", async (req: Request, res: Response) => {
  const bot = await getChatbot(req.params.chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { description, drawioXml, editInstruction, currentDefinition, anchorNodeId, apiConfigs } = parsed.data;
  const isEdit = !!(editInstruction?.trim() && currentDefinition);
  if (!description.trim() && !drawioXml?.trim() && !isEdit) {
    return res.status(400).json({ error: "Provide a description, a draw.io diagram, or an edit instruction." });
  }
  // Prefer explicit apiConfigs; fall back to those embedded in currentDefinition (edit mode).
  const configs = apiConfigs ?? (currentDefinition as any)?.apiConfigs;

  try {
    const editCtx = isEdit ? makeEditContext(currentDefinition, editInstruction!, anchorNodeId) : undefined;
    const { plan, diagram } = await planOnly(description, drawioXml, editCtx, configs);
    return res.json({ plan, diagram });
  } catch (err: any) {
    const sizeMsg = diagramSizeError(err);
    if (sizeMsg) return res.status(422).json({ error: sizeMsg, code: "DIAGRAM_TOO_LARGE" });
    if (String(err?.message) === "DIAGRAM_UNREADABLE") {
      return res.status(422).json({
        error: "Couldn't read any shapes from this draw.io file. In draw.io use File → Export as → XML (or save as .drawio) and try again.",
      });
    }
    console.error("Journey plan error:", err?.message ?? err);
    return res.status(502).json({ error: aiErrorMessage(err) });
  }
});

// STEP 2 — BUILD. Uses the approved plan (if provided) to build the workflow.
workflowsRouter.post("/generate", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;
  const bot = await getChatbot(chatbotId);
  if (!bot) return res.status(404).json({ error: "Chatbot not found" });

  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { description, drawioXml, plan, editInstruction, currentDefinition, anchorNodeId, apiConfigs, usePlanning } = parsed.data;
  const isEdit = !!(editInstruction?.trim() && currentDefinition);
  if (!description.trim() && !drawioXml?.trim() && !(plan && plan.length) && !isEdit) {
    return res.status(400).json({ error: "Provide a description, a draw.io diagram, or an edit instruction." });
  }
  const configs = apiConfigs ?? (currentDefinition as any)?.apiConfigs;

  try {
    const editCtx = isEdit ? makeEditContext(currentDefinition, editInstruction!, anchorNodeId) : undefined;
    // When planning is OFF we never pass a plan through, so a stale/supplied
    // plan can't be reused — the generator builds directly (server-side
    // enforcement, not just the frontend skipping the plan step).
    const approvedPlan = usePlanning ? (plan as any) : undefined;
    const result = await generateJourney(description, drawioXml, approvedPlan, editCtx, configs, { usePlanning });
    const definition = result.definition ? ensureSingleStart(result.definition as any) : null;
    logActivity(req, "workflow.ai_generate", {
      chatbotId,
      details: {
        mode: isEdit ? "edit" : "create",
        usePlanning,
        nodes: definition?.nodes.length ?? 0,
        usedDrawio: !!drawioXml,
        ...(result.report ? { fidelity: result.report.status, failedChecks: result.report.items.filter((i) => i.status === "failed").length } : {}),
      },
    });
    // Keep the verification report so the creator can re-open it later.
    let savedReport = null;
    if (result.report) {
      try {
        savedReport = await saveReport({
          chatbotId,
          userId: req.userId,
          title: parsed.data.sourceName?.trim() || (isEdit ? "Edit build" : "Diagram build"),
          report: result.report as any,
        });
      } catch (err) {
        console.error("Saving AI report failed:", (err as Error)?.message ?? err);
      }
    }
    return res.json({
      ok: result.ok,
      definition,
      plan: result.plan ?? [],
      warnings: [...(result.errors ?? []), ...(result.warnings ?? [])],
      report: result.report ?? null,
      reportId: savedReport?.id ?? null,
    });
  } catch (err: any) {
    const sizeMsg = diagramSizeError(err);
    if (sizeMsg) return res.status(422).json({ error: sizeMsg, code: "DIAGRAM_TOO_LARGE" });
    console.error("Journey generation error:", err?.message ?? err);
    return res.status(502).json({ error: aiErrorMessage(err) });
  }
});

// Web-based test: runs the REAL conversation path against the latest saved
// draft, creates a real logged conversation, and returns the bot's replies.
workflowsRouter.post("/test", async (req: Request, res: Response) => {
  const chatbotId = req.params.chatbotId;

  const bot = await getChatbot(chatbotId);
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
    // Don't sleep on Delay blocks here — return them as markers so the test
    // chat shows the messages before a delay immediately and replays the gap.
    simulateDelays: true,
  });

  return res.json({
    status: result.status,
    replies: adapter.sent.map((m) =>
      m.delaySeconds != null
        ? { delaySeconds: m.delaySeconds }
        : { text: m.text, options: m.options, media: m.media, cta: m.cta }
    ),
  });
});
