import { generateJson } from "../runtime/aiProvider.js";
import { validateWorkflow } from "./validator.js";
import { ensureSingleStart } from "./startNode.js";
import {
  parseDrawio,
  describeDiagram,
  CLASSIFY_GUIDE,
  BUILD_RULES,
  specFromPlan,
  describeSpec,
  layoutFromSpec,
  type ParsedDiagram,
  type FlowSpec,
} from "./drawio.js";
import { z } from "zod";
import crypto from "crypto";
import { config } from "../../infra/config.js";
import { BUILDER_TYPES, toBuilderNode, toBuilderType } from "./capabilities.js";
import {
  enforceSpec,
  checkFidelity,
  simulateBranches,
  buildReport,
  repairableProblems,
  failedCount,
  type FidelityReport,
  type CheckItem,
} from "./fidelity.js";

// AI Journey Generator — turns a natural-language description and/or a draw.io
// diagram into a workflow definition (nodes + edges + variables) that the
// builder drops onto the canvas.
//
// Two modes:
//  - DIAGRAM mode (a draw.io file was attached): the file is parsed in code
//    (drawio.ts) into an exact list of shapes + connections. The AI only maps
//    each shape to a node type and writes the config; it must keep one node per
//    shape (same id) and one edge per connection. Afterwards we check coverage
//    against the parsed diagram and run a targeted fix for anything missing,
//    then place nodes at their draw.io positions.
//  - DESCRIPTION mode: plan -> build -> QC -> validate -> repair (as before).

// The node catalog the model must stick to. Kept in sync with the executors
// registry + builder palette. START is always present exactly once.
const NODE_CATALOG = `
Available node types and their config fields (use ONLY these):

- START: the entry point. Exactly one. config: { keywords?: string[], matchType?: "contains"|"exact"|"starts_with" }
- SEND_MESSAGE: send a WhatsApp message. config: { text: string, footer?: string,
    header?: { type: "text"|"image"|"document"|"video", value: string },
    buttons?: [{ id: string, label: string, kind: "cta"|"url", url?: string }] }
    (buttons are optional; kind "cta" branches to another node via an edge whose sourceHandle = the button id; kind "url" opens a link)
- ASK_INPUT: ask a question and store the answer. config: { text: string, variable: string,
    footer?: string, expectedType?: "text"|"image"|"audio"|"document"|"video"|"location"|"any",
    validationType?: "none"|"phone"|"email"|"url"|"number"|"alphanumeric"|"custom",
    regex?: string, retryLimit?: number, failureMessage?: string }
    (expectedType defaults to "text". When the question asks for a FILE, set the exact media type — "record/upload a video" or "testimonial video" → "video"; photo/picture/selfie → "image"; document/file/PDF → "document"; voice note/audio → "audio"; location → "location". Never use "text" or "any" for a file request. validationType/regex apply ONLY when expectedType is "text".)
- LIST: prompt with a list of options. config: { text: string, buttonText?: string,
    rows: [{ id: string, label: string }] } (each row branches via an edge whose sourceHandle = the row id)
- CONDITION: branch on a variable. config: { field: string, value: string }
    Has TWO outgoing edges: sourceHandle "true" and sourceHandle "else".
- AI_RESPONSE: generate a reply with AI. config: { prompt: string, variable?: string, sendReply?: boolean, fallbackText?: string }
- SET_VARIABLE: set a variable. config: { variable: string, value: string }
- TRANSFORM: run a JS expression, store result. config: { expression: string (use vars.x), variable: string }
- API_REQUEST: call an HTTP API via a saved API CONFIG of this bot (never inline). config: { apiConfig: string (the config NAME, or "" if none fits),
    endpointId?: string (an endpoint id within that config — REQUIRED if the config lists endpoints),
    query?: [{key,value}], responseMap?: [{path,variable}], statusVariable?: string, timeoutMs?: number }
    Do NOT include url/method/headers/body — the method, URL and body come from the chosen config/endpoint.
    Use an apiConfig NAME from the "Available API configs" list below; if none exist or none fit, leave apiConfig "" (the user picks one later).
    Has TWO outgoing edges: sourceHandle "true" (2xx success) and sourceHandle "else" (failure).
- WAIT: pause. config: { seconds: number }

There is NO separate validation block. To check an answer's format (email, phone,
number…), set validationType (and failureMessage) on the ASK_INPUT itself — it
re-asks automatically until the answer is valid. Never invent other node types.

Reference variables inside any text/url/body with double braces, e.g. {{name}}.
`;

const RULES = `
Rules:
1. Output STRICT JSON only, matching this shape:
   { "variables": [{ "name": string, "type": "text"|"number"|"boolean", "default": string }],
     "nodes": [{ "id": string, "nodeType": string, "config": object }],
     "edges": [{ "id": string, "source": string, "target": string, "sourceHandle": string|null }] }
2. Include exactly ONE START node with id "start".
3. Every non-START node must have at least one incoming edge (be reachable from START).
4. Never create an edge whose target is the START node.
5. CONDITION nodes must have exactly two outgoing edges with sourceHandle "true" and "else".
6. API_REQUEST nodes must have two outgoing edges with sourceHandle "true" and "else". They reference an API config by name via config.apiConfig (empty string if none is available). NEVER put url/method/headers/body on an API_REQUEST node.
7. For SEND_MESSAGE cta buttons and LIST rows, the outgoing edge's sourceHandle must equal that button/row id.
8. Use short, unique node ids like "n1","n2". Give each node a config.name (a short human label).
9. Declare any {{variables}} you reference in the "variables" array.
10. Keep it practical and complete — a real, runnable WhatsApp journey.
`;

export interface GeneratedDefinition {
  variables: { name: string; type: string; default: string }[];
  nodes: { id: string; nodeType: string; seq: number; position: { x: number; y: number }; config: any }[];
  edges: { id: string; source: string; target: string; sourceHandle: string | null }[];
  meta?: { layout?: "drawio" };
}

// Describe this bot's API configs so the AI can reference them by name.
function apiConfigsBlock(apiConfigs?: any[]): string {
  const list = Array.isArray(apiConfigs) ? apiConfigs.filter((c) => c?.name) : [];
  if (!list.length) {
    return `\nAvailable API configs: NONE yet. If the journey needs an API call, still create the API_REQUEST node with config.apiConfig "" — the user will choose a config later.\n`;
  }
  const lines = list.map((c) => {
    const eps = Array.isArray(c.endpoints) ? c.endpoints : [];
    const epStr = eps.length
      ? eps.map((e: any) => `endpointId "${e.id}" (${(e.method || "GET")} ${e.path || ""}${e.name ? ` — ${e.name}` : ""})`).join("; ")
      : "no endpoints (calls base URL directly)";
    return `- apiConfig "${c.name}" (baseUrl: ${c.baseUrl || "n/a"}): ${epStr}`;
  });
  return `\nAvailable API configs (use ONLY these names for API_REQUEST nodes):\n${lines.join("\n")}\n`;
}



// Repair the raw model output into a canvas-ready definition: unique ids,
// known node types, seq numbers, positions, well-formed edges, exactly one START.
// `partial` = one batch of a larger flow: don't add/rewire START (other
// batches contain it); the merged result is repaired again as a whole.
function repair(raw: any, opts: { partial?: boolean } = {}): GeneratedDefinition {
  const rawNodes: any[] = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const rawEdges: any[] = Array.isArray(raw?.edges) ? raw.edges : [];
  const rawVars: any[] = Array.isArray(raw?.variables) ? raw.variables : [];

  // Unique ids: keep the first use of an id; later duplicates / missing ids get
  // a fresh id that can't collide with one the model used.
  const used = new Set<string>();
  const fresh = (i: number) => {
    let id = `n_${i + 1}`;
    for (let k = 2; used.has(id); k++) id = `n_${i + 1}_${k}`;
    return id;
  };
  const nodes = rawNodes
    .filter((n) => n && typeof n === "object")
    .map((n, i) => {
      let id = n.id != null && String(n.id).trim() ? String(n.id).trim() : "";
      if (!id || used.has(id)) id = fresh(i);
      used.add(id);
      // Only builder-palette types: VALIDATE/BUTTONS map to their palette twin.
      const mapped = toBuilderNode({
        nodeType: String(n.nodeType ?? "SEND_MESSAGE"),
        config: (typeof n.config === "object" && n.config) || {},
      });
      const t = toBuilderType(mapped.nodeType);
      return {
        id,
        nodeType: BUILDER_TYPES.has(t) ? t : "SEND_MESSAGE",
        seq: i,
        position: { x: 0, y: i * 140 }, // dagre (or the draw.io layout) re-places this
        config: mapped.config,
      };
    });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seenEdge = new Set<string>();
  const edges = rawEdges
    // In a batch, targets may live in another batch — keep them; the merge
    // step validates endpoints across the whole flow.
    .filter((e) => e && nodeIds.has(String(e.source)) && (opts.partial || nodeIds.has(String(e.target))))
    .map((e, i) => ({
      id: e.id != null ? String(e.id) : `e${i + 1}`,
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle != null && e.sourceHandle !== "" ? String(e.sourceHandle) : null,
    }))
    .filter((e) => {
      const key = `${e.source}|${e.target}|${e.sourceHandle ?? ""}`;
      if (seenEdge.has(key)) return false;
      seenEdge.add(key);
      return true;
    })
    // unique edge ids
    .map((e, i, all) => (all.findIndex((x) => x.id === e.id) === i ? e : { ...e, id: `${e.id}_${i}` }));

  const variables = rawVars
    .filter((v) => v && v.name)
    .map((v) => ({
      name: String(v.name).replace(/[{}]/g, "").trim(),
      type: ["text", "number", "boolean"].includes(v.type) ? v.type : "text",
      default: v.default != null ? String(v.default) : "",
    }));

  if (opts.partial) return { variables, nodes, edges };
  return ensureSingleStart({ variables, nodes, edges }) as GeneratedDefinition;
}

// A single planned stage (a "todo") the agent produces before building.
export interface PlanStage {
  step: number;
  title: string;        // short label, e.g. "Ask for email"
  nodeType: string;     // which node type this maps to
  detail: string;       // what it does + how it branches
  sourceId?: string;    // node id this stage becomes (diagram mode)
  sourceIds?: string[]; // diagram shapes this stage represents (diagram mode)
  text?: string;        // exact user-facing text (diagram mode)
  textSource?: "verbatim" | "written";
  variable?: string;
  validationType?: string;
  expectedType?: string;
  confidence?: string;
  ambiguity?: string;
}

export interface DiagramSummary {
  shapes: number;
  connections: number;
  pages: number;
  warnings: string[];
}

export interface GenerateResult {
  ok: boolean;
  definition?: GeneratedDefinition;
  plan?: PlanStage[];
  errors?: string[];
  warnings?: string[];
  report?: FidelityReport;   // diagram mode: source-to-output verification
}

// Structured-output schema for the AI's plan (diagram mode). Invalid stages
// are dropped rather than trusted; specFromPlan then re-adds anything missing.
const PlanStageSchema = z.object({
  title: z.string().max(200).optional(),
  nodeType: z.string().max(40),
  sourceIds: z.array(z.string().max(200)).max(200).optional(),
  sourceId: z.string().max(200).optional(),
  detail: z.string().max(2000).optional(),
  text: z.string().max(4096).optional(),
  textSource: z.string().max(20).optional(),
  variable: z.string().max(80).optional(),
  validationType: z.string().max(30).optional(),
  expectedType: z.string().max(30).optional(),
  confidence: z.string().max(20).optional(),
  ambiguity: z.string().max(500).optional(),
}).passthrough();

function sanitizePlan(raw: any): PlanStage[] {
  const list: any[] = Array.isArray(raw?.plan) ? raw.plan : [];
  return list.flatMap((s, i) => {
    const r = PlanStageSchema.safeParse(s);
    if (!r.success) {
      console.warn(`[drawio] dropped invalid plan stage #${i + 1}:`, r.error.issues[0]?.message);
      return [];
    }
    return [{ ...r.data, step: i + 1, title: r.data.title ?? "", detail: r.data.detail ?? "" } as PlanStage];
  });
}

// ---------------------------------------------------------------------------
// Edit mode context.
// ---------------------------------------------------------------------------
interface EditContext {
  existing: { variables?: any[]; nodes: any[]; edges: any[] };
  editInstruction: string;
  anchorNodeId?: string;
}

function editContextBlock(ctx?: EditContext): string {
  if (!ctx) return "";
  const anchor = ctx.anchorNodeId
    ? `\nIMPORTANT: apply the change relative to the node with id "${ctx.anchorNodeId}" (insert immediately after it / act on it as the anchor).\n`
    : "";
  return `\nThis is an EDIT of an existing journey. Here is the CURRENT journey:\n${JSON.stringify(ctx.existing, null, 2)}\n${anchor}
Plan ONLY the change described below (do not re-plan the whole journey). List
the stage(s) being added, edited, or removed and where they sit in the flow:\n"""\n${ctx.editInstruction}\n"""\n`;
}

// Errors the generator should NOT try to "fix" by itself: an API node without
// a chosen config is expected (the user picks one); publish still enforces it.
function relevantErrors(def: GeneratedDefinition): string[] {
  const r = validateWorkflow({ nodes: def.nodes, edges: def.edges } as any);
  return r.errors.map((e) => e.message).filter((m) => !/must use a saved global API config/i.test(m));
}

// Parse once; returns null when there's no usable diagram.
function loadDiagram(drawioXml?: string): ParsedDiagram | null {
  if (!drawioXml || !drawioXml.trim()) return null;
  return parseDrawio(drawioXml);
}

// ---------------------------------------------------------------------------
// Size limits.
//
// What limits the AI is the number of STEPS, not the file size: one AI reply
// can only be so long. Building is batched (BUILD_BATCH_SIZE blocks per call),
// so it scales; the PLAN is one call that must list every shape, so the step
// count is capped to keep that reply within the model's output limit (~150
// shapes at ~150 output tokens each ≈ 22k of the 32k-token budget).
// File size is only a safety net (the request body limit in app.ts / routes).
// ---------------------------------------------------------------------------
export const DIAGRAM_LIMITS = {
  maxSteps: 150,          // non-END shapes per generation
  recommendedSteps: 80,   // above this, generation gets slow — suggest splitting
  maxFileBytes: 5_000_000,
};

function assertDiagramSize(d: ParsedDiagram | null) {
  if (!d) return;
  const steps = d.shapes.filter((s) => !s.isEnd).length;
  if (steps > DIAGRAM_LIMITS.maxSteps) throw new Error(`DIAGRAM_TOO_LARGE:${steps}`);
}

export function summarizeDiagram(d: ParsedDiagram): DiagramSummary {
  const steps = d.shapes.filter((s) => !s.isEnd).length;
  const warnings = [...d.warnings];
  if (steps > DIAGRAM_LIMITS.recommendedSteps) {
    const batches = Math.ceil(steps / BUILD_BATCH_SIZE);
    warnings.push(`Large diagram (${steps} steps): building runs in ${batches} parts and can take a few minutes. Splitting it into smaller pages is faster and easier to review.`);
  }
  return { shapes: steps, connections: d.edges.length, pages: d.pages, warnings };

}



// ---------------------------------------------------------------------------
// STEP 1 — PLAN
// ---------------------------------------------------------------------------

// Small in-memory plan cache (per server instance).
const PLAN_CACHE_TTL_MS = 60 * 60 * 1000;
const PLAN_CACHE_MAX = 30;
const planCache = new Map<string, { at: number; plan: PlanStage[] }>();
async function planJourney(
  description: string,
  diagram: ParsedDiagram | null,
  edit?: EditContext,
  apiConfigs?: any[]
): Promise<PlanStage[]> {
  if (diagram && diagram.shapes.length && !edit) {
    // Same diagram + same description + same API configs -> same plan. Reuse
    // it (e.g. "Start over" / re-planning) instead of paying for a new call.
    const key = crypto.createHash("sha256")
      .update(JSON.stringify([description, diagram.shapes, diagram.edges, (apiConfigs ?? []).map((c: any) => c?.name)]))
      .digest("hex");
    const hit = planCache.get(key);
    if (hit && Date.now() - hit.at < PLAN_CACHE_TTL_MS) {
      console.log("[drawio] plan cache hit");
      return structuredClone(hit.plan);
    }
    const plan = await planFromDiagram(description, diagram, apiConfigs);
    if (plan.length) {
      planCache.set(key, { at: Date.now(), plan: structuredClone(plan) });
      if (planCache.size > PLAN_CACHE_MAX) planCache.delete(planCache.keys().next().value!);
    }
    return plan;
  }

  let p = `You are an expert WhatsApp chatbot flow architect. Before building anything,
PLAN the journey as an ordered list of stages (like a coding agent writing TODOs).

${NODE_CATALOG}
${apiConfigsBlock(apiConfigs)}

Think step by step about the goal and produce the sequence of stages.
For each stage give: the step number, a short title, the single nodeType it maps
to (from the catalog above), and a detail describing what it does and how it
branches (mention button/list options and true/else branches explicitly).

Return STRICT JSON: { "plan": [ { "step": number, "title": string, "nodeType": string, "detail": string } ] }
Start the plan with the START node. Be complete but concise.\n`;
  if (description) p += `\nUser's description:\n"""\n${description}\n"""\n`;
  p += editContextBlock(edit);

  const raw = await generateJson(p, { step: "plan" });
  return Array.isArray(raw?.plan) ? raw.plan : [];
}

async function planFromDiagram(description: string, d: ParsedDiagram, apiConfigs?: any[]): Promise<PlanStage[]> {
  const p = `You are an expert WhatsApp chatbot flow architect. The user drew their journey
in draw.io. It has been parsed EXACTLY into the shapes and connections below.
Your job is to UNDERSTAND each shape and decide which block it needs — or whether
it isn't a bot block at all (trigger, user action, system event, note).

${NODE_CATALOG}
${apiConfigsBlock(apiConfigs)}
${CLASSIFY_GUIDE}
${describeDiagram(d)}

The "suggested" value is only a keyword-based hint — reason about the label and
its position in the flow and override it whenever it's wrong.

Produce the plan as ordered stages following the flow. Each stage has:
- "title": a short name for the block
- "nodeType": one of the catalog types, or "SKIP" for shapes that aren't bot blocks
- "sourceIds": the ids of ALL diagram shapes this stage represents (a block may absorb
  the user-action / system-event shapes around it)
- "detail": what the block does / says / asks and how it branches; for SKIP, why.
- "text", "textSource", "variable", "validationType", "expectedType" (see TEXT FIDELITY)
- "confidence" and, when not high, "ambiguity"
Exactly ONE stage has nodeType "START". Every shape id (except END shapes) must appear
in exactly one stage's sourceIds.
Keep each "detail" short (one sentence, max ~25 words) — branches are tracked from the
diagram itself, so don't repeat every connection.

Return STRICT JSON: { "plan": [ { "title": string, "nodeType": string, "sourceIds": string[], "detail": string,
  "text"?: string, "textSource"?: "verbatim"|"written", "variable"?: string, "validationType"?: string,
  "expectedType"?: string, "confidence": "high"|"medium"|"low", "ambiguity"?: string } ] }
${description ? `\nExtra context from the user (wording, intent):\n"""\n${description}\n"""\n` : ""}`;

  let raw: any;
  try {
    raw = await generateJson(p, { temperature: 0.2, step: "plan" });
  } catch (err) {
    if (isTruncation(err)) throw new Error(`PLAN_TOO_LARGE:${d.shapes.length}`);
    throw err;
  }
  const plan = sanitizePlan(raw);

  // Normalise against the diagram: guarantees one START, every shape accounted
  // for (missing ones classified by the parser's hints), and stable node ids.
  const spec = specFromPlan(plan, d, BUILDER_TYPES);
  return specToPlan(spec, d);
}

// The plan the user reviews is derived from the normalised spec, so what they
// approve is exactly what gets built (blocks first, then skipped shapes).
function specToPlan(spec: FlowSpec, d: ParsedDiagram): PlanStage[] {
  const label = (id: string) => d.shapes.find((s) => s.id === id)?.label ?? id;
  const stages: PlanStage[] = spec.nodes.map((n, i) => {
    const out = spec.edges.filter((e) => e.source === n.id);
    const branches = out.length > 1 ? ` Branches: ${out.map((e) => `${e.label || label(e.target)} → ${e.target}`).join(", ")}.` : "";
    const absorbed = n.shapeIds.filter((id) => id !== n.id).map((id) => `“${label(id)}”`);
    const covers = absorbed.length ? ` Includes: ${absorbed.join(", ")}.` : "";
    const fallback = spec.edges.find((e) => e.source === n.id && e.kind === "fallback");
    const event = fallback ? ` If no reply in ${fallback.minutes} min → ${fallback.target}.` : "";
    return {
      step: i + 1,
      title: n.title,
      nodeType: n.nodeType,
      detail: `${n.detail}${branches}${event}${covers}`.trim(),
      sourceId: n.id,
      sourceIds: n.shapeIds,
      ...(n.text ? { text: n.text } : {}),
      ...(n.textSource ? { textSource: n.textSource } : {}),
      ...(n.variable ? { variable: n.variable } : {}),
      ...(n.validationType ? { validationType: n.validationType } : {}),
      ...(n.expectedType ? { expectedType: n.expectedType } : {}),
      ...(n.confidence ? { confidence: n.confidence } : {}),
      ...(n.ambiguity ? { ambiguity: n.ambiguity } : {}),
    };
  });
  for (const s of spec.skipped) {
    stages.push({ step: stages.length + 1, title: s.label.slice(0, 60), nodeType: "SKIP", detail: s.reason, sourceIds: [s.id] });
  }
  return stages;
}

// ---------------------------------------------------------------------------
// STEP 2 — BUILD
// ---------------------------------------------------------------------------
async function buildFromPlan(description: string, plan: PlanStage[], fixErrors?: string[], apiConfigs?: any[]): Promise<GeneratedDefinition> {
  let p = `You are an expert WhatsApp chatbot flow builder. Build the workflow JSON by
following the APPROVED PLAN below EXACTLY — one node per stage, with the
branches each stage describes. Do not invent extra stages or drop any.

${NODE_CATALOG}
${RULES}
${apiConfigsBlock(apiConfigs)}

APPROVED PLAN (follow it stage by stage):
${JSON.stringify(plan, null, 2)}

Original user description (for wording of messages etc.):
"""\n${description || "(none provided)"}\n"""\n`;
  if (fixErrors && fixErrors.length) {
    p += `\nYour previous build failed checks with these errors — fix them and return corrected JSON:\n- ${fixErrors.join("\n- ")}\n`;
  }
  return repair(await generateJson(p, { step: fixErrors?.length ? "fix" : "build" }));
}

// ---------------------------------------------------------------------------
// Batched building. One AI reply has a hard output limit, so a large diagram
// can't be written in a single answer. The block list and connections are
// already fixed by the spec, so each batch only writes the config for a few
// blocks and the connections leaving them; the batches are merged in code.
// A batch that still gets cut off is split in half and retried.
// ---------------------------------------------------------------------------
export const BUILD_BATCH_SIZE = 12;   // blocks per AI call (~5–8k output tokens)
const BUILD_CONCURRENCY = config.AI_BUILD_CONCURRENCY; // parallel AI calls

const isTruncation = (err: any) => /AI_OUTPUT_TRUNCATED|invalid JSON/i.test(String(err?.message ?? err));

async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Merge batch results: one node per id (later batches never override earlier
// ones unless `replace` is given), edges de-duplicated, variables merged.
function mergeDefs(base: GeneratedDefinition, parts: GeneratedDefinition[], replaceIds?: Set<string>): GeneratedDefinition {
  const nodes = new Map(base.nodes.map((n) => [n.id, n]));
  let edges = base.edges.filter((e) => !replaceIds?.has(e.source));
  const vars = new Map(base.variables.map((v) => [v.name, v]));
  for (const p of parts) {
    for (const n of p.nodes) if (replaceIds?.has(n.id) || !nodes.has(n.id)) nodes.set(n.id, n);
    edges.push(...p.edges);
    for (const v of p.variables) if (!vars.has(v.name)) vars.set(v.name, v);
  }
  const ids = new Set(nodes.keys());
  const seen = new Set<string>();
  edges = edges.filter((e) => {
    const k = `${e.source}|${e.target}|${e.sourceHandle ?? ""}`;
    if (!ids.has(e.source) || !ids.has(e.target) || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((e, i) => ({ ...e, id: `e_${i + 1}` }));
  return { variables: [...vars.values()], nodes: [...nodes.values()], edges };
}

function batchPrompt(
  description: string,
  spec: FlowSpec,
  d: ParsedDiagram,
  ids: Set<string>,
  apiConfigs: any[] | undefined,
  extra = ""
): string {
  const total = spec.nodes.length;
  const index = spec.nodes.map((n) => `${n.id} (${n.nodeType}) "${n.title}"`).join("; ");
  return `You are an expert WhatsApp chatbot flow builder. The user's draw.io diagram has
already been analysed into an exact list of ${total} blocks and their connections.
${ids.size < total ? `The flow is built in parts. In THIS part, create ONLY the ${ids.size} blocks listed under
BLOCKS TO CREATE and ONLY the connections leaving them. The other blocks are created
separately — you may connect to them by id, but do NOT output them.` : "Build the workflow JSON."}

${NODE_CATALOG}
${RULES}
${apiConfigsBlock(apiConfigs)}
${BUILD_RULES}
${describeSpec(spec, d, ids)}
${ids.size < total ? `\nALL BLOCK IDS IN THE FLOW (reference only): ${index}\n` : ""}
${description ? `\nUser's extra context (wording, intent):\n"""\n${description}\n"""\n` : ""}${extra}`;
}

async function buildFromSpec(description: string, spec: FlowSpec, d: ParsedDiagram, apiConfigs?: any[]): Promise<GeneratedDefinition> {
  const buildIds = async (ids: string[]): Promise<GeneratedDefinition[]> => {
    try {
      const raw = await generateJson(batchPrompt(description, spec, d, new Set(ids), apiConfigs), { temperature: 0.2, step: "build" });
      return [repair(raw, { partial: true })];
    } catch (err) {
      if (isTruncation(err) && ids.length > 1) {
        console.warn(`[drawio] batch of ${ids.length} was cut off — splitting`);
        const mid = Math.ceil(ids.length / 2);
        return [...(await buildIds(ids.slice(0, mid))), ...(await buildIds(ids.slice(mid)))];
      }
      throw err;
    }
  };

  const batches = chunk(spec.nodes.map((n) => n.id), BUILD_BATCH_SIZE);
  console.log(`[drawio] building ${spec.nodes.length} blocks in ${batches.length} batch(es)`);
  const parts = (await runPool(batches, BUILD_CONCURRENCY, buildIds)).flat();
  const merged = mergeDefs({ variables: [], nodes: [], edges: [] }, parts);
  return ensureSingleStart(merged) as GeneratedDefinition;
}

// Diagram-mode repair: re-generate ONLY the blocks with failed checks (and
// the connections leaving them), in batches, then merge them back. Keeps the
// prompt and the answer small no matter how big the flow is.
async function fixBlocks(
  def: GeneratedDefinition,
  items: CheckItem[],
  spec: FlowSpec,
  d: ParsedDiagram,
  description: string,
  apiConfigs?: any[],
  final = false // last attempt: more thinking, only for what still fails
): Promise<GeneratedDefinition> {
  const failed = items.filter((i) => i.status === "failed");
  const specIds = new Set(spec.nodes.map((n) => n.id));
  const affected = new Set(failed.map((i) => i.nodeId).filter((id): id is string => !!id && specIds.has(id)));
  // Problems not tied to a block (e.g. "exactly one Start") -> repair START.
  if (failed.some((i) => !i.nodeId)) affected.add(spec.nodes.find((n) => n.nodeType === "START")?.id ?? "start");
  if (!affected.size) return def;

  const parts = (await runPool(chunk([...affected], BUILD_BATCH_SIZE), BUILD_CONCURRENCY, async (ids) => {
    const set = new Set(ids);
    const current = {
      nodes: def.nodes.filter((n) => set.has(n.id)).map((n) => ({ id: n.id, nodeType: n.nodeType, config: n.config })),
      edges: def.edges.filter((e) => set.has(e.source)),
    };
    const problems = failed.filter((i) => !i.nodeId || set.has(i.nodeId)).map((i) => `[${i.category}] ${i.message}`);
    const extra = `\nTHESE BLOCKS WERE BUILT BEFORE BUT FAILED VERIFICATION. Fix exactly these problems:\n- ${problems.join("\n- ")}\n\nCURRENT JSON OF THESE BLOCKS:\n${JSON.stringify(current, null, 2)}\n`;
    const raw = await generateJson(batchPrompt(description, spec, d, set, apiConfigs, extra), { temperature: 0.1, step: final ? "repair_final" : "repair" });
    return repair(raw, { partial: true });
  }));

  return ensureSingleStart(mergeDefs(def, parts, affected)) as GeneratedDefinition;
}

// Targeted fix: send the current JSON back with an exact list of problems
// (missing blocks/connections and/or validation errors).
async function fixDefinition(
  def: GeneratedDefinition,
  problems: string[],
  spec: { spec: FlowSpec; d: ParsedDiagram } | null,
  apiConfigs?: any[]
): Promise<GeneratedDefinition> {
  const p = `You are fixing a generated WhatsApp workflow. Return the COMPLETE corrected
workflow as STRICT JSON (same shape). Keep every existing node id, node and edge
that isn't part of a problem unchanged.

${NODE_CATALOG}
${RULES}
${apiConfigsBlock(apiConfigs)}
${spec ? BUILD_RULES + "\n" + describeSpec(spec.spec, spec.d) : ""}

PROBLEMS TO FIX:
- ${problems.join("\n- ")}

CURRENT WORKFLOW JSON:
${JSON.stringify({ variables: def.variables, nodes: def.nodes.map((n) => ({ id: n.id, nodeType: n.nodeType, config: n.config })), edges: def.edges }, null, 2)}
`;
  return repair(await generateJson(p, { temperature: 0.1, step: "fix" }));
}


// EDIT BUILD — apply the approved change-plan to the EXISTING flow as a PATCH,
// preserving the ids of nodes that stay (so the frontend keeps their positions).
async function patchBuild(edit: EditContext, plan: PlanStage[], fixErrors?: string[], apiConfigs?: any[]): Promise<GeneratedDefinition> {
  const anchor = edit.anchorNodeId
    ? `\nInsert/act relative to the node with id "${edit.anchorNodeId}". If adding a node "after" it, rewire: the edge that currently leaves "${edit.anchorNodeId}" must now point to the NEW node, and the new node connects to that edge's old target.\n`
    : "";
  let p = `You are PATCHING an existing WhatsApp workflow. Apply ONLY the approved change
below to the current workflow and return the COMPLETE updated workflow as JSON.

${NODE_CATALOG}
${RULES}
${apiConfigsBlock(apiConfigs)}

CRITICAL PATCH RULES:
- PRESERVE the existing "id" of every node you keep. Only assign NEW ids
  (like "n_new1") to nodes you add.
- Keep every part the change doesn't touch EXACTLY as-is (same ids, config).
- To insert a node "after X": rewire the edge leaving X to point to the new
  node, then connect the new node to X's old target. Do NOT append at the end.
- To delete a node: omit it and reconnect its predecessor to its successor.
${anchor}
APPROVED CHANGE PLAN:
${JSON.stringify(plan, null, 2)}

CURRENT WORKFLOW:
${JSON.stringify(edit.existing, null, 2)}

Change instruction (for wording): """\n${edit.editInstruction}\n"""\n`;
  if (fixErrors && fixErrors.length) {
    p += `\nYour previous patch failed checks with these errors — fix them and return corrected JSON:\n- ${fixErrors.join("\n- ")}\n`;
  }
  return repair(await generateJson(p, { step: "patch" }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// STEP 1 only — produce the plan for the user to review/approve.
export async function planOnly(
  description: string,
  drawioXml?: string,
  edit?: EditContext,
  apiConfigs?: any[]
): Promise<{ plan: PlanStage[]; diagram: DiagramSummary | null }> {
  const diagram = edit ? null : loadDiagram(drawioXml);
  if (diagram && !diagram.shapes.length && !description.trim()) {
    throw new Error("DIAGRAM_UNREADABLE");
  }
  assertDiagramSize(diagram);
  const plan = await planJourney(description, diagram, edit, apiConfigs);
  return {
    plan: plan.map((s, i) => ({
      ...s,
      step: i + 1,
      title: String(s.title ?? `Stage ${i + 1}`),
      nodeType: String(s.nodeType ?? "SEND_MESSAGE"),
      detail: String(s.detail ?? ""),
      ...(s.sourceId ? { sourceId: String(s.sourceId) } : {}),
      ...(Array.isArray(s.sourceIds) ? { sourceIds: s.sourceIds.map(String) } : {}),
    })),
    diagram: diagram ? summarizeDiagram(diagram) : null,
  };
}

export async function generateJourney(
  description: string,
  drawioXml?: string,
  approvedPlan?: PlanStage[],
  edit?: EditContext,
  apiConfigs?: any[]
): Promise<GenerateResult> {
  const diagram = edit ? null : loadDiagram(drawioXml);
  assertDiagramSize(diagram);
  const useDiagram = !!diagram && diagram.shapes.length > 0;
  const warnings: string[] = useDiagram ? [...diagram!.warnings] : [];

  // 1) PLAN — reuse the user-approved plan if provided, else generate one.
  let plan: PlanStage[] = Array.isArray(approvedPlan) && approvedPlan.length ? approvedPlan : [];
  if (!plan.length) {
    try {
      plan = await planJourney(description, useDiagram ? diagram : null, edit, apiConfigs);
    } catch {
      plan = []; // planning is best-effort; build can still proceed
    }
  }

  if (useDiagram) return generateFromDiagram(description, plan, diagram!, apiConfigs, warnings);

  // 2) BUILD (description / edit modes)
  let def: GeneratedDefinition;
  if (edit) {
    def = await patchBuild(edit, plan, undefined, apiConfigs);
  } else {
    // (The old AI self-review pass was removed: it re-sent the whole flow for
    // little gain. validateWorkflow + one targeted fix below covers it.)
    def = await buildFromPlan(description, plan, undefined, apiConfigs);
  }

  // 3) VALIDATE + one repair pass.
  let errors = relevantErrors(def);
  if (errors.length) {
    try {
      const def2 = edit
        ? await patchBuild(edit, plan, errors, apiConfigs)
        : await fixDefinition(def, errors, null, apiConfigs);
      const errors2 = relevantErrors(def2);
      if (errors2.length < errors.length) { def = def2; errors = errors2; }
    } catch { /* keep def */ }
  }

  return errors.length
    ? { ok: false, definition: def, plan, errors, warnings }
    : { ok: true, definition: def, plan, warnings };
}

// Max targeted AI repairs after fidelity validation: one low-thinking pass,
// then one final higher-thinking pass on whatever still fails.
const MAX_REPAIRS = config.AI_MAX_REPAIRS;

async function verify(def: GeneratedDefinition, spec: FlowSpec, d: ParsedDiagram) {
  const enforced = enforceSpec(def, spec, d);
  const items: CheckItem[] = [
    ...checkFidelity(enforced.def, spec, d),
    ...(await simulateBranches(enforced.def, spec, d)),
  ];
  return { def: enforced.def, items, corrections: enforced.corrections };
}

// Diagram mode: build from the analysed spec, verify against the source
// independently (static checks + simulated execution), repair only what failed,
// re-verify, and report exactly what was and wasn't confirmed.
async function generateFromDiagram(
  description: string,
  plan: PlanStage[],
  d: ParsedDiagram,
  apiConfigs: any[] | undefined,
  warnings: string[]
): Promise<GenerateResult> {
  const spec = specFromPlan(plan, d, BUILDER_TYPES);
  console.log(`[drawio] spec: ${spec.nodes.length} blocks, ${spec.edges.length} connections, ${spec.skipped.length} skipped`);

  let current = await verify(await buildFromSpec(description, spec, d, apiConfigs), spec, d);
  const corrections = [...current.corrections];
  let attempts = 0;

  // Escalating repair: a cheap low-thinking pass first; whatever still fails
  // gets ONE final pass with more thinking (AI_THINKING_REPAIR_FINAL).
  while (failedCount(current.items) > 0 && attempts < MAX_REPAIRS) {
    attempts++;
    const final = attempts === MAX_REPAIRS;
    const problems = repairableProblems(current.items);
    console.log(`[drawio] repair ${attempts}/${MAX_REPAIRS}${final ? " (final)" : ""}: ${problems.length} failed check(s)`);
    try {
      const candidate = await verify(await fixBlocks(current.def, current.items, spec, d, description, apiConfigs, final), spec, d);
      // Only keep a repair that strictly reduces failures (never regress).
      if (failedCount(candidate.items) < failedCount(current.items)) {
        current = candidate;
        corrections.push(...candidate.corrections);
      } else {
        console.log(`[drawio] repair ${attempts} didn't improve (${failedCount(candidate.items)} vs ${failedCount(current.items)} failed)`);
        // A cheap pass that didn't help still leaves the final, stronger one.
        if (final) break;
      }
    } catch (err: any) {
      console.warn(`[drawio] repair ${attempts} failed:`, err?.message ?? err);
      if (final) break;
    }
  }

  const def: GeneratedDefinition = { ...layoutFromSpec(current.def, spec, d), meta: { layout: "drawio" } };
  const report = buildReport(def, spec, d, current.items, corrections, attempts);
  const failures = current.items.filter((i) => i.status === "failed").map((i) => i.message);
  warnings.push(...spec.notes);

  console.log(`[drawio] done: status=${report.status} failed=${failures.length} repairs=${attempts}`);
  return failures.length
    ? { ok: false, definition: def, plan, errors: failures, warnings, report }
    : { ok: true, definition: def, plan, warnings, report };
}

// Build an EditContext from a current definition + instruction.
export function makeEditContext(existing: any, editInstruction: string, anchorNodeId?: string): EditContext {
  return {
    existing: {
      variables: existing?.variables ?? [],
      nodes: (existing?.nodes ?? []).map((n: any) => ({ id: n.id, nodeType: n.nodeType, config: n.config })),
      edges: (existing?.edges ?? []).map((e: any) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
    },
    editInstruction,
    anchorNodeId: anchorNodeId || undefined,
  };
}
