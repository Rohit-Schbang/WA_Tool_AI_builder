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
  specCoverage,
  layoutFromSpec,
  type ParsedDiagram,
  type FlowSpec,
} from "./drawio.js";

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
    (expectedType defaults to "text"; set it to a media type to require the user to send a photo/audio/document/video/location. validationType/regex apply ONLY when expectedType is "text".)
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

const KNOWN_TYPES = new Set([
  "START", "SEND_MESSAGE", "ASK_INPUT", "BUTTONS", "LIST", "CONDITION", "AI_RESPONSE",
  "SET_VARIABLE", "VALIDATE", "TRANSFORM", "API_REQUEST", "WAIT",
]);

// Repair the raw model output into a canvas-ready definition: unique ids,
// known node types, seq numbers, positions, well-formed edges, exactly one START.
function repair(raw: any): GeneratedDefinition {
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
      const t = String(n.nodeType ?? "SEND_MESSAGE").toUpperCase();
      return {
        id,
        nodeType: KNOWN_TYPES.has(t) ? t : "SEND_MESSAGE",
        seq: i,
        position: { x: 0, y: i * 140 }, // dagre (or the draw.io layout) re-places this
        config: (typeof n.config === "object" && n.config) || {},
      };
    });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seenEdge = new Set<string>();
  const edges = rawEdges
    .filter((e) => e && nodeIds.has(String(e.source)) && nodeIds.has(String(e.target)))
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

export function summarizeDiagram(d: ParsedDiagram): DiagramSummary {
  return { shapes: d.shapes.filter((s) => !s.isEnd).length, connections: d.edges.length, pages: d.pages, warnings: d.warnings };

}



// ---------------------------------------------------------------------------
// STEP 1 — PLAN
// ---------------------------------------------------------------------------
async function planJourney(
  description: string,
  diagram: ParsedDiagram | null,
  edit?: EditContext,
  apiConfigs?: any[]
): Promise<PlanStage[]> {
  if (diagram && diagram.shapes.length && !edit) return planFromDiagram(description, diagram, apiConfigs);

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

  const raw = await generateJson(p);
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
Exactly ONE stage has nodeType "START". Every shape id (except END shapes) must appear
in exactly one stage's sourceIds.

Return STRICT JSON: { "plan": [ { "title": string, "nodeType": string, "sourceIds": string[], "detail": string } ] }
${description ? `\nExtra context from the user (wording, intent):\n"""\n${description}\n"""\n` : ""}`;

  const raw = await generateJson(p, { temperature: 0.2 });
  const plan: PlanStage[] = Array.isArray(raw?.plan) ? raw.plan : [];

  // Normalise against the diagram: guarantees one START, every shape accounted
  // for (missing ones classified by the parser's hints), and stable node ids.
  const spec = specFromPlan(plan, d, KNOWN_TYPES);
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
    return {
      step: i + 1,
      title: n.title,
      nodeType: n.nodeType,
      detail: `${n.detail}${branches}${covers}`.trim(),
      sourceId: n.id,
      sourceIds: n.shapeIds,
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
  return repair(await generateJson(p));
}

async function buildFromSpec(description: string, spec: FlowSpec, d: ParsedDiagram, apiConfigs?: any[]): Promise<GeneratedDefinition> {
  const p = `You are an expert WhatsApp chatbot flow builder. The user's draw.io diagram has
already been analysed into the exact blocks and connections below (user actions,
system events and notes were merged or removed). Build the workflow JSON.

${NODE_CATALOG}
${RULES}
${apiConfigsBlock(apiConfigs)}
${BUILD_RULES}
${describeSpec(spec, d)}
${description ? `\nUser's extra context (wording, intent):\n"""\n${description}\n"""\n` : ""}`;
  return repair(await generateJson(p, { temperature: 0.2 }));
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
  return repair(await generateJson(p, { temperature: 0.1 }));
}

type SpecCoverage = ReturnType<typeof specCoverage>;
const coverageCount = (c: SpecCoverage) => c.missingNodes.length + c.missingEdges.length;

function coverageProblems(c: SpecCoverage): string[] {
  return [
    ...c.missingNodes.map((n) => `Missing block id "${n.id}" (${n.nodeType}, "${n.title}"). Create it with exactly this id and type.`),
    ...c.missingEdges.map((e) => `Missing connection ${e.source} -> ${e.target}${e.label ? ` (label "${e.label}")` : ""}. Add the edge (with the correct sourceHandle if the source branches).`),
  ];
}

function coverageWarnings(c: SpecCoverage): string[] {
  return [
    ...c.missingNodes.map((n) => `Diagram step “${n.title}” wasn't created — add it manually.`),
    ...c.missingEdges.map((e) => `Connection ${e.source} → ${e.target}${e.label ? ` (“${e.label}”)` : ""} is missing.`),
  ];
}

// QC (description mode only): a model self-review against the plan.
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
  return repair(await generateJson(p));
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
  return repair(await generateJson(p));
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
  const plan = await planJourney(description, diagram, edit, apiConfigs);
  return {
    plan: plan.map((s, i) => ({
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

  // In diagram mode the (approved) plan says which shapes are real blocks and
  // which were merged/skipped; turn it into the exact block + connection list.
  const spec = useDiagram ? specFromPlan(plan, diagram!, KNOWN_TYPES) : null;
  const specCtx = spec ? { spec, d: diagram! } : null;

  // 2) BUILD
  let def: GeneratedDefinition;
  if (edit) {
    def = await patchBuild(edit, plan, undefined, apiConfigs);
  } else if (spec) {
    def = await buildFromSpec(description, spec, diagram!, apiConfigs);
    // Coverage check against the block list — up to two targeted fixes.
    for (let attempt = 0; attempt < 2; attempt++) {
      const cov = specCoverage(def, spec);
      if (!coverageCount(cov)) break;
      try {
        const fixed = await fixDefinition(def, coverageProblems(cov), specCtx, apiConfigs);
        if (coverageCount(specCoverage(fixed, spec)) < coverageCount(cov)) def = fixed;
        else break;
      } catch { break; }
    }
  } else {
    def = await buildFromPlan(description, plan, undefined, apiConfigs);
    try {
      const reviewed = await qcReview(plan, def);
      // Never accept a QC pass that loses nodes.
      if (reviewed.nodes.length >= def.nodes.length) def = reviewed;
    } catch { /* keep the pre-QC build */ }
  }

  // 3) VALIDATE + one repair pass.
  let errors = relevantErrors(def);
  if (errors.length) {
    try {
      const def2 = edit
        ? await patchBuild(edit, plan, errors, apiConfigs)
        : await fixDefinition(def, errors, specCtx, apiConfigs);
      const errors2 = relevantErrors(def2);
      // In diagram mode, don't trade structural fidelity for validity.
      const keepsCoverage = !spec || coverageCount(specCoverage(def2, spec)) <= coverageCount(specCoverage(def, spec));
      if (errors2.length < errors.length && keepsCoverage) { def = def2; errors = errors2; }
    } catch { /* keep def */ }
  }

  if (spec) {
    warnings.push(...coverageWarnings(specCoverage(def, spec)));
    def = { ...layoutFromSpec(def, spec, diagram!), meta: { layout: "drawio" } };
  }

  return errors.length
    ? { ok: false, definition: def, plan, errors, warnings }
    : { ok: true, definition: def, plan, warnings };
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
