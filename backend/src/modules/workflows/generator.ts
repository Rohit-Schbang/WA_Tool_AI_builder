import { generateJson } from "../runtime/aiProvider.js";
import { validateWorkflow } from "./validator.js";

// AI Journey Generator — turns a natural-language description (and optional
// draw.io XML) into a workflow definition (nodes + edges + variables) that the
// builder can drop straight onto the canvas.
//
// Reliability strategy:
//   - Give Gemini a strict catalog of the node types + their config shapes.
//   - Ask for JSON only (aiProvider.generateJson uses JSON response mode).
//   - Repair the output (assign ids/seq/positions, coerce edge shape).
//   - Validate with the same validator used at publish time; if invalid, ask
//     Gemini once to fix it using the reported errors.

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
    footer?: string, validationType?: "none"|"phone"|"email"|"url"|"number"|"alphanumeric"|"custom",
    regex?: string, retryLimit?: number, failureMessage?: string }
- LIST: prompt with a list of options. config: { text: string, buttonText?: string,
    rows: [{ id: string, label: string }] } (each row branches via an edge whose sourceHandle = the row id)
- CONDITION: branch on a variable. config: { field: string, value: string }
    Has TWO outgoing edges: sourceHandle "true" and sourceHandle "else".
- AI_RESPONSE: generate a reply with AI. config: { prompt: string, variable?: string, sendReply?: boolean, fallbackText?: string }
- SET_VARIABLE: set a variable. config: { variable: string, value: string }
- TRANSFORM: run a JS expression, store result. config: { expression: string (use vars.x), variable: string }
- API_REQUEST: call an HTTP API. config: { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", url: string,
    headers?: [{key,value}], query?: [{key,value}], body?: string, responseMap?: [{path,variable}], statusVariable?: string, timeoutMs?: number }
    Has TWO outgoing edges: sourceHandle "true" (2xx success) and sourceHandle "else" (failure).
- WAIT: pause. config: { seconds: number }

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
6. API_REQUEST nodes must have two outgoing edges with sourceHandle "true" and "else".
7. For SEND_MESSAGE cta buttons and LIST rows, the outgoing edge's sourceHandle must equal that button/row id.
8. Use short, unique node ids like "n1","n2". Give each node a config.name (a short human label).
9. Declare any {{variables}} you reference in the "variables" array.
10. Keep it practical and complete — a real, runnable WhatsApp journey.
`;

export interface GeneratedDefinition {
  variables: { name: string; type: string; default: string }[];
  nodes: { id: string; nodeType: string; seq: number; position: { x: number; y: number }; config: any }[];
  edges: { id: string; source: string; target: string; sourceHandle: string | null }[];
}

function buildPrompt(description: string, drawioXml?: string, fixErrors?: string[]): string {
  let p = `You are an expert WhatsApp chatbot flow designer. Generate a workflow (a "journey") as JSON.\n\n${NODE_CATALOG}\n${RULES}\n`;
  p += `\nUser's description of the desired journey:\n"""\n${description || "(none provided)"}\n"""\n`;
  if (drawioXml && drawioXml.trim()) {
    p += `\nThe user also provided a draw.io diagram (XML). Interpret its shapes as nodes and arrows as edges, mapping each shape to the closest node type by its label/meaning. Use it as structural guidance alongside the description:\n"""\n${drawioXml.slice(0, 20000)}\n"""\n`;
  }
  if (fixErrors && fixErrors.length) {
    p += `\nYour previous attempt failed validation with these errors — fix them and return corrected JSON:\n- ${fixErrors.join("\n- ")}\n`;
  }
  return p;
}

// Repair the raw model output into a canvas-ready definition: ensure ids,
// seq numbers, positions, and a well-formed edge shape.
function repair(raw: any): GeneratedDefinition {
  const rawNodes: any[] = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const rawEdges: any[] = Array.isArray(raw?.edges) ? raw.edges : [];
  const rawVars: any[] = Array.isArray(raw?.variables) ? raw.variables : [];

  // Ensure a START node exists exactly once.
  let hasStart = rawNodes.some((n) => n?.nodeType === "START");
  const nodes = rawNodes.map((n, i) => ({
    id: String(n?.id ?? `n${i + 1}`),
    nodeType: String(n?.nodeType ?? "SEND_MESSAGE"),
    seq: i,
    position: { x: 0, y: i * 140 }, // dagre re-lays this out on the client anyway
    config: (n && typeof n.config === "object" && n.config) || {},
  }));
  if (!hasStart) {
    nodes.unshift({ id: "start", nodeType: "START", seq: 0, position: { x: 0, y: 0 }, config: { name: "Start" } });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = rawEdges
    .filter((e) => e && nodeIds.has(String(e.source)) && nodeIds.has(String(e.target)) && String(e.target) !== "start")
    .map((e, i) => ({
      id: String(e.id ?? `e${i + 1}`),
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle != null ? String(e.sourceHandle) : null,
    }));

  const variables = rawVars
    .filter((v) => v && v.name)
    .map((v) => ({
      name: String(v.name).replace(/[{}]/g, "").trim(),
      type: ["text", "number", "boolean"].includes(v.type) ? v.type : "text",
      default: v.default != null ? String(v.default) : "",
    }));

  return { variables, nodes, edges };
}

// A single planned stage (a "todo") the agent produces before building.
export interface PlanStage {
  step: number;
  title: string;        // short label, e.g. "Ask for email"
  nodeType: string;     // which node type this maps to
  detail: string;       // what it does + how it branches
}

export interface GenerateResult {
  ok: boolean;
  definition?: GeneratedDefinition;
  plan?: PlanStage[];
  errors?: string[];
}

// ---------------------------------------------------------------------------
// AGENTIC PIPELINE: plan -> build -> QC -> repair.
//
// Instead of one big "make me the JSON" call (which hallucinates), we mimic how
// coding agents work:
//   1. PLAN  — the model outlines the journey as ordered stages/todos.
//   2. BUILD — the model turns that explicit plan into strict workflow JSON.
//   3. QC    — a self-review pass + our deterministic validator; errors are
//              fed back for one repair pass.
// Each call is smaller and more focused, which sharply reduces hallucination.
// ---------------------------------------------------------------------------

// STEP 1 — PLAN: outline the journey as ordered stages (no workflow JSON yet).
async function planJourney(description: string, drawioXml?: string): Promise<PlanStage[]> {
  let p = `You are an expert WhatsApp chatbot flow architect. Before building anything,
PLAN the journey as an ordered list of stages (like a coding agent writing TODOs).

${NODE_CATALOG}

Think step by step about the user's goal and produce the sequence of stages.
For each stage give: the step number, a short title, the single nodeType it maps
to (from the catalog above), and a detail describing what it does and how it
branches (mention button/list options and true/else branches explicitly).

Return STRICT JSON: { "plan": [ { "step": number, "title": string, "nodeType": string, "detail": string } ] }
Start the plan with the START node. Be complete but concise.\n`;
  p += `\nUser's description:\n"""\n${description || "(none provided)"}\n"""\n`;
  if (drawioXml && drawioXml.trim()) {
    p += `\nThe user also provided a draw.io diagram (XML). Use its shapes/arrows as the structural backbone of your plan:\n"""\n${drawioXml.slice(0, 20000)}\n"""\n`;
  }

  const raw = await generateJson(p);
  const plan: PlanStage[] = Array.isArray(raw?.plan) ? raw.plan : [];
  return plan;
}

// STEP 2 — BUILD: turn the approved plan into strict workflow JSON.
async function buildFromPlan(description: string, plan: PlanStage[], drawioXml?: string, fixErrors?: string[]): Promise<GeneratedDefinition> {
  let p = `You are an expert WhatsApp chatbot flow builder. Build the workflow JSON by
following the APPROVED PLAN below EXACTLY — one node per stage, wired in order,
with the branches each stage describes. Do not invent extra stages or drop any.

${NODE_CATALOG}
${RULES}

APPROVED PLAN (follow it stage by stage):
${JSON.stringify(plan, null, 2)}

Original user description (for wording of messages etc.):
"""\n${description || "(none provided)"}\n"""\n`;
  if (fixErrors && fixErrors.length) {
    p += `\nYour previous build failed checks with these errors — fix them and return corrected JSON:\n- ${fixErrors.join("\n- ")}\n`;
  }
  const raw = await generateJson(p);
  return repair(raw);
}

// STEP 3 — QC: a model self-review that fixes structural issues against the
// plan (missing stages, unwired branches). Deterministic validation happens
// separately via validateWorkflow.
async function qcReview(plan: PlanStage[], def: GeneratedDefinition): Promise<GeneratedDefinition> {
  const p = `You are doing QC on a generated WhatsApp workflow. Compare the PLAN to the built
JSON. Ensure: every plan stage exists as a node; every branch (buttons, list
rows, condition true/else, api success/failure) has a matching outgoing edge;
no edge targets the START node; all referenced {{variables}} are declared.
Fix any problems and return the corrected workflow as STRICT JSON in the same
shape. If it's already correct, return it unchanged.

${RULES}

PLAN:
${JSON.stringify(plan, null, 2)}

BUILT JSON:
${JSON.stringify({ variables: def.variables, nodes: def.nodes.map(n => ({ id: n.id, nodeType: n.nodeType, config: n.config })), edges: def.edges }, null, 2)}
`;
  const raw = await generateJson(p);
  return repair(raw);
}

// Public: STEP 1 only — produce the plan for the user to review/approve.
export async function planOnly(description: string, drawioXml?: string): Promise<PlanStage[]> {
  const plan = await planJourney(description, drawioXml);
  // number the stages defensively
  return plan.map((s, i) => ({
    step: Number(s.step) || i + 1,
    title: String(s.title ?? `Stage ${i + 1}`),
    nodeType: String(s.nodeType ?? "SEND_MESSAGE"),
    detail: String(s.detail ?? ""),
  }));
}

export async function generateJourney(
  description: string,
  drawioXml?: string,
  approvedPlan?: PlanStage[]
): Promise<GenerateResult> {
  // 1) PLAN — reuse the user-approved plan if provided, else generate one.
  let plan: PlanStage[] = Array.isArray(approvedPlan) && approvedPlan.length ? approvedPlan : [];
  if (!plan.length) {
    try {
      plan = await planJourney(description, drawioXml);
    } catch {
      plan = []; // planning is best-effort; build can still proceed
    }
  }

  // 2) BUILD from the plan
  let def = await buildFromPlan(description, plan, drawioXml);

  // 3) QC self-review pass (best-effort; keep the build if QC fails)
  try {
    const reviewed = await qcReview(plan, def);
    // Only accept the QC output if it still has the core structure.
    if (reviewed.nodes.length >= Math.max(1, def.nodes.length - 1)) {
      def = reviewed;
    }
  } catch {
    /* keep the pre-QC build */
  }

  // Deterministic validation.
  let result = validateWorkflow({ nodes: def.nodes, edges: def.edges } as any);

  // One repair pass feeding the validator's errors back to the builder.
  if (!result.valid) {
    try {
      const def2 = await buildFromPlan(description, plan, drawioXml, result.errors.map((e) => e.message));
      const result2 = validateWorkflow({ nodes: def2.nodes, edges: def2.edges } as any);
      if (result2.valid) {
        return { ok: true, definition: def2, plan };
      }
      // Return the repaired attempt but flag remaining issues for review.
      return { ok: false, definition: def2, plan, errors: result2.errors.map((e) => e.message) };
    } catch {
      return { ok: false, definition: def, plan, errors: result.errors.map((e) => e.message) };
    }
  }

  return { ok: true, definition: def, plan };
}
