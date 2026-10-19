import zlib from "zlib";

// ---------------------------------------------------------------------------
// draw.io parser — turns a .drawio / .xml file into a clean list of shapes and
// connections, so the AI works from the REAL structure instead of guessing
// from raw (often compressed) XML.
//
// Handles:
//  - compressed diagrams (draw.io default: base64 + raw deflate + URI-encoding)
//  - uncompressed <mxGraphModel> files, and SVG exports with embedded content
//  - multiple pages, UserObject/object wrappers, HTML labels, edge labels,
//    shapes nested in containers/swimlanes (absolute positions)
// ---------------------------------------------------------------------------

export type ShapeKind =
  | "decision"
  | "terminator"
  | "io"
  | "document"
  | "database"
  | "prep"
  | "text"
  | "process";

export interface DiagramShape {
  id: string;          // node id to use in the workflow ("start" or "d_<drawioId>")
  drawioId: string;
  label: string;
  kind: ShapeKind;
  suggested: string;   // suggested node type (+ hint), e.g. "CONDITION", "SEND_MESSAGE with buttons"
  isStart: boolean;
  isEnd: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramEdge {
  source: string;      // node ids (mapped)
  target: string;
  label: string;
}

export interface ParsedDiagram {
  shapes: DiagramShape[];      // in flow order (BFS from the entry), then by position
  edges: DiagramEdge[];
  entryId: string | null;      // first real node after START (when no start shape)
  startShapeId: string | null; // "start" when a diagram shape is the start
  pages: number;
  warnings: string[];
}

// ----------------------------- helpers -------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Labels are XML-escaped and often contain HTML (<div>, <br>, &nbsp;).
function cleanLabel(v: string | undefined): string {
  if (!v) return "";
  let s = decodeEntities(v);
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 500);
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = m[2] ?? m[3] ?? "";
  return out;
}

function decompress(body: string): string | null {
  try {
    const buf = Buffer.from(body.trim(), "base64");
    let raw: string;
    try {
      raw = zlib.inflateRawSync(buf).toString("utf8");
    } catch {
      try {
        raw = zlib.inflateSync(buf).toString("utf8");
      } catch {
        raw = buf.toString("utf8");
      }
    }
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { /* not URI-encoded */ }
    return /<mxGraphModel|<mxCell/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// Return the <mxGraphModel> XML of every page in the file.
function extractModels(xml: string, depth = 0): string[] {
  const out: string[] = [];
  let found = false;
  for (const m of xml.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/g)) {
    found = true;
    const body = m[1].trim();
    if (/<mxGraphModel/.test(body)) out.push(body);
    else if (body) {
      const dec = decompress(body);
      if (dec) out.push(dec);
    }
  }
  if (!found && /<mxGraphModel|<mxCell/.test(xml)) out.push(xml);
  // SVG/HTML export: the whole mxfile is embedded (escaped) in a content="" attribute.
  if (!out.length && depth < 2) {
    const cm = xml.match(/\scontent="([^"]+)"/);
    if (cm) return extractModels(decodeEntities(cm[1]), depth + 1);
  }
  return out;
}

interface RawCell {
  id: string;
  value: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  source?: string;
  target?: string;
  parent?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function geometry(inner: string | undefined) {
  const g = inner?.match(/<mxGeometry\b([^>]*)/);
  const a = g ? parseAttrs(g[1]) : {};
  return { x: Number(a.x) || 0, y: Number(a.y) || 0, w: Number(a.width) || 0, h: Number(a.height) || 0 };
}

function parseCells(model: string): RawCell[] {
  const cells: RawCell[] = [];

  // <UserObject label=".." id=".."><mxCell .../></UserObject> (also <object>)
  const wrapRe = /<(UserObject|object)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (const m of model.matchAll(wrapRe)) {
    const wa = parseAttrs(m[2]);
    const cm = m[3].match(/<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/);
    const ca = cm ? parseAttrs(cm[1]) : {};
    cells.push({
      id: wa.id ?? ca.id ?? "",
      value: wa.label ?? wa.value ?? ca.value ?? "",
      style: ca.style ?? "",
      vertex: ca.vertex === "1",
      edge: ca.edge === "1",
      source: ca.source,
      target: ca.target,
      parent: ca.parent,
      ...geometry(cm?.[2] ?? m[3]),
    });
  }
  const rest = model.replace(wrapRe, "");

  for (const m of rest.matchAll(/<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g)) {
    const a = parseAttrs(m[1]);
    cells.push({
      id: a.id ?? "",
      value: a.value ?? "",
      style: a.style ?? "",
      vertex: a.vertex === "1",
      edge: a.edge === "1",
      source: a.source,
      target: a.target,
      parent: a.parent,
      ...geometry(m[3]),
    });
  }
  return cells.filter((c) => c.id);
}

function kindOf(style: string): ShapeKind {
  const s = style.toLowerCase();
  if (s.includes("rhombus") || s.includes("decision")) return "decision";
  if (s.includes("terminator") || s.includes("start_1") || s.includes("start_2") || s.includes("ellipse")) return "terminator";
  if (s.includes("parallelogram") || s.includes("flowchart.data") || s.includes("manual_input") || s.includes("manualinput")) return "io";
  if (s.includes("document")) return "document";
  if (s.includes("cylinder") || s.includes("database") || s.includes("datastore")) return "database";
  if (s.includes("hexagon") || s.includes("preparation")) return "prep";
  if (/(^|;)text(;|$)/.test(s)) return "text";
  return "process";
}

const START_RE = /^(start|begin|trigger|entry|initiate|start (of )?(flow|chat|journey|conversation))\b/i;
const END_RE = /^(end|stop|exit|finish|close|done|end (of )?(flow|chat|journey|conversation))\.?$/i;
const YES_NO_RE = /^(yes|no|y|n|true|false|valid|invalid|else|other(wise)?|success|fail(ure|ed)?|ok|not ok|correct|incorrect)$/i;

// Shapes describing what the USER does, or internal SYSTEM state, are not bot
// blocks — they're triggers, answers to the previous step, or noise.
export const USER_ACTION_RE =
  /^(the\s+)?(user|customer|client|visitor|lead|person|patient|buyer)s?\s+(clicks?|taps?|sends?|types?|selects?|chooses?|picks?|repl(y|ies)|responds?|enters?|presses?|opens?|scans?|submits?|says?|messages?|uploads?|shares?|fills?|provides?|gives?|answers?|confirms?|visits?|lands?|starts?)\b/i;
export const SYSTEM_EVENT_RE =
  /\b(session|conversation|chat|chatbot|bot|flow|journey|webhook|timer|event)\b[^.]{0,30}\b(initiated|initialized|initialised|started|starts|begins?|created|opened|triggered|received|fired|ended|ends|closed|expired|resumed)\b/i;

function suggestType(shape: { label: string; kind: ShapeKind; isStart: boolean }, out: DiagramEdge[]): string {
  if (shape.isStart) return "START";
  const l = shape.label.toLowerCase();
  const labelled = out.filter((e) => e.label);
  const branching = out.length >= 2;

  if (USER_ACTION_RE.test(shape.label.trim())) return "USER ACTION (not a bot block — trigger or the user's answer)";
  if (SYSTEM_EVENT_RE.test(shape.label)) return "SYSTEM EVENT (not a bot block)";
  if (shape.kind === "text") return "NOTE (probably skip)";

  if (/\b(api|webhook|http|endpoint|crm|fetch|backend|server|database|db|sheet|erp|record|sync|store|save|update|create (a )?(lead|ticket|order|booking)|log)\b/.test(l)) return "API_REQUEST";

  if (shape.kind === "decision" || branching) {
    const yesNo = out.length === 2 && out.every((e) => !e.label || YES_NO_RE.test(e.label.trim()));
    if (yesNo) return "CONDITION";
    if (branching) return out.length <= 3 ? "SEND_MESSAGE with buttons" : "LIST";
    return "CONDITION";
  }
  if (/\b(ai|gpt|gemini|llm|openai|chatgpt)\b/.test(l)) return "AI_RESPONSE";
  if (/\b(wait|delay|pause)\b/.test(l) || /\bafter \d+\s*(s|sec|min|hour|day)/.test(l)) return "WAIT";
  if (/\b(set|assign) (a )?(variable|value)\b/.test(l)) return "SET_VARIABLE";
  if (shape.kind === "io" || /\?\s*$/.test(shape.label) || /^(ask|collect|capture|get|enter|input|request|take|prompt)\b/.test(l)) {
    return labelled.length >= 2 ? "SEND_MESSAGE with buttons" : "ASK_INPUT";
  }
  if (/^(validate|verify|check|is|are|does|has|if)\b/.test(l)) return "CONDITION";
  if (/^(set|assign|calculate|compute|format|convert|parse)\b/.test(l)) return "SET_VARIABLE or TRANSFORM";
  if (/^(bot\s+)?(send|show|display|reply|respond|greet|welcome|inform|notify|confirm|thank|share|say|tell)/.test(l) || /^(hi|hello|hey|welcome|thank|thanks|sorry|great)\b/.test(l) || /["“].+["”]/.test(shape.label)) {
    return "SEND_MESSAGE";
  }
  return "UNCLEAR — decide from context (bot message only if it's words the bot says)";
}

// ----------------------------- main ----------------------------------------

export function parseDrawio(xml: string): ParsedDiagram {
  const warnings: string[] = [];
  const models = extractModels(xml ?? "");
  if (!models.length) {
    return { shapes: [], edges: [], entryId: null, startShapeId: null, pages: 0, warnings: ["No diagram found in the file."] };
  }

  const all: RawCell[] = [];
  models.forEach((model, page) => {
    const prefix = page > 0 ? `p${page + 1}_` : "";
    for (const c of parseCells(model)) {
      all.push({
        ...c,
        id: prefix + c.id,
        parent: c.parent ? prefix + c.parent : undefined,
        source: c.source ? prefix + c.source : undefined,
        target: c.target ? prefix + c.target : undefined,
      });
    }
  });

  const byId = new Map(all.map((c) => [c.id, c]));
  const isEdgeId = (id?: string) => !!id && !!byId.get(id)?.edge;

  // Absolute position: geometry is relative to a vertex parent (containers).
  const absCache = new Map<string, { x: number; y: number }>();
  const abs = (c: RawCell, guard = 0): { x: number; y: number } => {
    const hit = absCache.get(c.id);
    if (hit) return hit;
    const p = c.parent ? byId.get(c.parent) : undefined;
    const base = p && p.vertex && guard < 20 ? abs(p, guard + 1) : { x: 0, y: 0 };
    const r = { x: base.x + c.x, y: base.y + c.y };
    absCache.set(c.id, r);
    return r;
  };

  // Edge labels can be separate vertices whose parent is the edge.
  const edgeLabel = new Map<string, string>();
  for (const c of all) {
    if (c.vertex && isEdgeId(c.parent)) {
      const t = cleanLabel(c.value);
      if (t) edgeLabel.set(c.parent!, [edgeLabel.get(c.parent!), t].filter(Boolean).join(" "));
    }
  }

  const containers = new Set<string>();
  for (const c of all) {
    if (c.vertex && c.parent && byId.get(c.parent)?.vertex) containers.add(c.parent);
  }

  const rawEdges = all.filter((c) => c.edge);
  const touched = new Set<string>();
  for (const e of rawEdges) {
    if (e.source) touched.add(e.source);
    if (e.target) touched.add(e.target);
  }

  // Keep real vertices: not edge labels, not containers/swimlanes, not
  // free-floating text notes, not empty decorations.
  const kept: RawCell[] = [];
  for (const c of all) {
    if (!c.vertex || isEdgeId(c.parent)) continue;
    const style = c.style.toLowerCase();
    const label = cleanLabel(c.value);
    const isContainer =
      (containers.has(c.id) && !touched.has(c.id)) || style.includes("swimlane") || /(^|;)group(;|$)/.test(style);
    if (isContainer) continue;
    if (kindOf(c.style) === "text" && !touched.has(c.id)) continue;
    if (!label && !touched.has(c.id)) continue;
    kept.push(c);
  }
  const keptIds = new Set(kept.map((c) => c.id));

  // Edges between kept shapes.
  let dangling = 0;
  const pending: { source: string; target: string; label: string }[] = [];
  for (const e of rawEdges) {
    if (!e.source || !e.target || !keptIds.has(e.source) || !keptIds.has(e.target)) { dangling++; continue; }
    if (e.source === e.target) continue;
    const label = cleanLabel(e.value) || edgeLabel.get(e.id) || "";
    pending.push({ source: e.source, target: e.target, label });
  }
  if (dangling) warnings.push(`${dangling} arrow(s) in the diagram aren't attached to a shape on both ends and were ignored.`);

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, typeof pending>();
  for (const e of pending) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }

  // Start / end detection.
  const pos = (c: RawCell) => abs(c);
  const byPos = (a: RawCell, b: RawCell) => pos(a).y - pos(b).y || pos(a).x - pos(b).x;
  const roots = kept.filter((c) => !incoming.get(c.id)).sort(byPos);
  const labelOf = (c: RawCell) => cleanLabel(c.value);

  let startCell =
    roots.find((c) => START_RE.test(labelOf(c))) ??
    kept.find((c) => START_RE.test(labelOf(c)) && !incoming.get(c.id)) ??
    null;
  if (!startCell) {
    const term = roots.find((c) => kindOf(c.style) === "terminator" && (outgoing.get(c.id)?.length ?? 0) > 0 && labelOf(c).split(/\s+/).length <= 3);
    if (term) startCell = term;
  }

  const endIds = new Set(
    kept.filter((c) => !(outgoing.get(c.id)?.length) && END_RE.test(labelOf(c))).map((c) => c.id)
  );

  // Map draw.io ids -> workflow node ids.
  const idMap = new Map<string, string>();
  const used = new Set<string>();
  for (const c of kept) {
    let id = startCell && c.id === startCell.id ? "start" : "d_" + c.id.replace(/[^A-Za-z0-9_-]/g, "_");
    let n = 2;
    const baseId = id;
    while (used.has(id)) id = `${baseId}_${n++}`;
    used.add(id);
    idMap.set(c.id, id);
  }

  const edges: DiagramEdge[] = pending.map((e) => ({ source: idMap.get(e.source)!, target: idMap.get(e.target)!, label: e.label }));
  const outByNode = new Map<string, DiagramEdge[]>();
  for (const e of edges) outByNode.set(e.source, [...(outByNode.get(e.source) ?? []), e]);

  const shapes: DiagramShape[] = kept.map((c) => {
    const id = idMap.get(c.id)!;
    const p = pos(c);
    const base = {
      id,
      drawioId: c.id,
      label: labelOf(c) || "(unlabeled)",
      kind: kindOf(c.style),
      isStart: id === "start",
      isEnd: endIds.has(c.id),
      x: p.x,
      y: p.y,
      w: c.w,
      h: c.h,
    };
    return { ...base, suggested: base.isEnd ? "END" : suggestType(base, outByNode.get(id) ?? []) };
  });

  // Entry: where START should connect when the diagram has no start shape.
  const rootShapes = roots.map((c) => idMap.get(c.id)!).filter((id) => !endIds.has(kept.find((k) => idMap.get(k.id) === id)!.id));
  const entryId = startCell ? null : rootShapes[0] ?? shapes[0]?.id ?? null;
  if (!startCell && rootShapes.length > 1) {
    warnings.push(`The diagram has ${rootShapes.length} starting points (shapes with no incoming arrow); only the top-most is connected to Start.`);
  }

  // Flow order: BFS from the start/entry, children ordered by position.
  const shapeById = new Map(shapes.map((s) => [s.id, s]));
  const order: DiagramShape[] = [];
  const seen = new Set<string>();
  const queue = [startCell ? "start" : entryId].filter(Boolean) as string[];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !shapeById.has(id)) continue;
    seen.add(id);
    order.push(shapeById.get(id)!);
    const next = (outByNode.get(id) ?? [])
      .map((e) => shapeById.get(e.target)!)
      .filter(Boolean)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    for (const n of next) queue.push(n.id);
  }
  for (const s of [...shapes].sort((a, b) => a.y - b.y || a.x - b.x)) if (!seen.has(s.id)) order.push(s);

  if (!shapes.length) warnings.push("No shapes could be read from the diagram.");

  return { shapes: order, edges, entryId, startShapeId: startCell ? "start" : null, pages: models.length, warnings };
}

// ------------------------- prompt + checks ---------------------------------

export function describeDiagram(d: ParsedDiagram): string {
  const lines = d.shapes.map((s) => {
    const out = d.edges.filter((e) => e.source === s.id);
    const outStr = out.length
      ? out.map((e) => `${e.target}${e.label ? ` ["${e.label}"]` : ""}`).join(", ")
      : "none";
    return `- id "${s.id}" | ${s.isEnd ? "END (no node needed)" : `suggested: ${s.suggested}`} | shape: ${s.kind} | label: "${s.label}" | goes to: ${outStr}`;
  });
  const conns = d.edges.map((e) => `- ${e.source} -> ${e.target}${e.label ? `  (label: "${e.label}")` : ""}`);
  return `DIAGRAM SHAPES (${d.shapes.length}, in flow order):\n${lines.join("\n")}\n\nDIAGRAM CONNECTIONS (${d.edges.length}):\n${conns.join("\n") || "- none"}\n`;
}

// ---------------------------------------------------------------------------
// STEP A — classification guide for the PLAN. Flowcharts mix real bot steps
// with user actions, system events and notes; only bot steps become blocks.
// ---------------------------------------------------------------------------
export const CLASSIFY_GUIDE = `
HOW TO READ THE DIAGRAM — first decide what each shape REALLY is, then pick the block.
Flowcharts mix bot steps with user actions, system events and notes. Only shapes
where the BOT does something become workflow blocks.

1. TRIGGER / ENTRY ("Start", "User sends Hi", "User clicks SEND", "Customer messages us",
   "Session initiated", "Chatbot opened"): merge into the single START stage (put the
   shape ids in START's sourceIds). If the label quotes what the user types (e.g. "Hi",
   "menu"), mention it as a START keyword in the detail.
2. USER ACTION later in the flow ("User selects Pricing", "Customer enters email",
   "User replies Yes", "User uploads photo"): NOT a block. It is the user's answer to the
   bot step right before it — merge it into that question/buttons/list stage (add its id
   to that stage's sourceIds). Its label tells you a button label or what is collected.
3. SYSTEM EVENT / internal state ("Session initiated", "Conversation started",
   "Webhook received", "Timer starts", "Flow ends"): merge into START when it's at the
   beginning, otherwise nodeType "SKIP".
4. BOT MESSAGE (bot says / sends / shows / greets / confirms / informs): SEND_MESSAGE.
   Its text must be the words the user will read, not a description of the step.
5. BOT QUESTION (ask for / collect / "Enter your …" / "What is your …?"): ASK_INPUT
   (validationType email/phone/number when obvious; expectedType for photo, document,
   location, audio).
6. MENU / OPTIONS (choose one of several branches): SEND_MESSAGE with cta buttons (≤3)
   or LIST (4+). Each branch becomes a button/row.
7. DECISION / CHECK (diamonds, "Is …?", "Valid?", "Registered?", "If …"): CONDITION on
   the relevant variable. If the diamond is really the user's choice between buttons,
   merge it into the buttons stage instead.
8. BACKEND PROCESS ("Save details", "Store in DB / sheet", "Create lead in CRM",
   "Fetch slots", "Call API", "Send to server", "Update record"): API_REQUEST.
9. VALUE PROCESSING ("Set status = new", "Store name in variable", "Calculate total",
   "Format date"): SET_VARIABLE or TRANSFORM.
10. AI step ("Generate answer with AI", "GPT replies"): AI_RESPONSE.
11. WAIT ("Wait 24h", "After 1 day"): WAIT.
12. NOTES / annotations / legends / titles: nodeType "SKIP".
13. END shapes: leave them out (the branch just ends).

NEVER turn a user action, a system event or a process description into SEND_MESSAGE.
`;

export interface NodeSpec {
  id: string;
  nodeType: string;
  title: string;
  detail: string;
  shapeIds: string[];
}

export interface FlowSpec {
  nodes: NodeSpec[];
  edges: DiagramEdge[];                                   // between NODE ids (after merges)
  skipped: { id: string; label: string; reason: string }[];
}

interface PlanLike {
  title?: string;
  nodeType?: string;
  detail?: string;
  sourceId?: string;
  sourceIds?: string[];
}

// Turn the approved plan (each stage lists the diagram shapes it represents)
// into an exact list of nodes and node-to-node connections. Arrows that pass
// through merged/skipped shapes are reconnected to the next real block, so
// removing "User clicks SEND" never breaks the flow.
export function specFromPlan(plan: PlanLike[], d: ParsedDiagram, knownTypes: Set<string>): FlowSpec {
  const shapeById = new Map(d.shapes.map((s) => [s.id, s]));
  const assign = new Map<string, string>();     // shape id -> node id
  const nodes: NodeSpec[] = [];
  const used = new Set<string>();
  const skipped: FlowSpec["skipped"] = [];
  const skippedIds = new Set<string>();

  const uniq = (base: string) => {
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}_${k}`;
    used.add(id);
    return id;
  };

  for (const stage of plan) {
    const type = String(stage.nodeType ?? "").toUpperCase().trim();
    const ids = [...(stage.sourceIds ?? []), ...(stage.sourceId ? [stage.sourceId] : [])]
      .map(String)
      .filter((id, i, a) => shapeById.has(id) && a.indexOf(id) === i && !assign.has(id) && !skippedIds.has(id));

    if (type === "SKIP") {
      for (const id of ids) {
        skippedIds.add(id);
        skipped.push({ id, label: shapeById.get(id)!.label, reason: stage.detail || "Not a bot step" });
      }
      continue;
    }

    if (type === "START") {
      let start = nodes.find((n) => n.nodeType === "START");
      if (!start) {
        start = { id: uniq("start"), nodeType: "START", title: stage.title || "Start", detail: stage.detail || "", shapeIds: [] };
        nodes.unshift(start);
      }
      for (const id of ids) { assign.set(id, start.id); start.shapeIds.push(id); }
      continue;
    }

    const nodeType = knownTypes.has(type) ? type : "SEND_MESSAGE";
    const primary = ids.find((id) => id !== "start") ?? ids[0];
    const id = uniq(primary && primary !== "start" ? primary : `n_${nodes.length + 1}`);
    nodes.push({ id, nodeType, title: stage.title || shapeById.get(primary ?? "")?.label || nodeType, detail: stage.detail || "", shapeIds: ids });
    for (const sid of ids) assign.set(sid, id);
  }

  // Shapes the plan didn't mention: user actions/system events/notes are
  // skipped (pass-through); anything else becomes a block of its suggested type.
  for (const s of d.shapes) {
    if (s.isEnd || assign.has(s.id) || skippedIds.has(s.id)) continue;
    const isStartShape = s.id === "start";
    if (isStartShape || /^(USER ACTION|SYSTEM EVENT)/.test(s.suggested)) {
      // at the very beginning these are the trigger -> merge into START
      const hasIncoming = d.edges.some((e) => e.target === s.id);
      if (isStartShape || !hasIncoming) {
        let start = nodes.find((n) => n.nodeType === "START");
        if (!start) { start = { id: uniq("start"), nodeType: "START", title: "Start", detail: "", shapeIds: [] }; nodes.unshift(start); }
        assign.set(s.id, start.id);
        start.shapeIds.push(s.id);
      } else {
        skippedIds.add(s.id);
        skipped.push({ id: s.id, label: s.label, reason: "Not a bot step (merged automatically)" });
      }
      continue;
    }
    if (/^NOTE/.test(s.suggested)) {
      skippedIds.add(s.id);
      skipped.push({ id: s.id, label: s.label, reason: "Note / annotation" });
      continue;
    }
    const t = s.suggested.split(" ")[0];
    const id = uniq(s.id);
    nodes.push({ id, nodeType: knownTypes.has(t) ? t : "SEND_MESSAGE", title: s.label.slice(0, 60), detail: "Added from diagram (not in the plan)", shapeIds: [s.id] });
    assign.set(s.id, id);
  }

  if (!nodes.some((n) => n.nodeType === "START")) {
    nodes.unshift({ id: uniq("start"), nodeType: "START", title: "Start", detail: "", shapeIds: [] });
  }

  // Collapse diagram arrows to node-level connections.
  const out = new Map<string, DiagramEdge[]>();
  for (const e of d.edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);

  // Resolve a shape to the real blocks it leads to (following through
  // merged-away / skipped shapes). Carries a label for button/branch naming.
  const resolve = (shapeId: string, label: string, seen: Set<string>): { id: string; label: string }[] => {
    if (seen.has(shapeId)) return [];
    seen.add(shapeId);
    const node = assign.get(shapeId);
    if (node) return [{ id: node, label }];
    const s = shapeById.get(shapeId);
    if (!s || s.isEnd) return [];
    // A skipped user-action shape ("User selects Pricing") is a good branch label.
    const carry = label || (/^USER ACTION/.test(s.suggested) ? s.label : "");
    return (out.get(shapeId) ?? []).flatMap((e) => resolve(e.target, carry || e.label, new Set(seen)));
  };

  const edges: DiagramEdge[] = [];
  const pairs = new Set<string>();
  for (const e of d.edges) {
    const from = assign.get(e.source);
    if (!from) continue; // handled when its predecessors resolve through it
    for (const t of resolve(e.target, e.label, new Set([e.source]))) {
      if (t.id === from) continue;            // internal to a merged block
      const key = `${from}|${t.id}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      edges.push({ source: from, target: t.id, label: t.label });
    }
  }

  // START must lead somewhere: connect it to the first block nothing points to.
  const startNode = nodes.find((n) => n.nodeType === "START")!;
  if (!edges.some((e) => e.source === startNode.id)) {
    const targeted = new Set(edges.map((e) => e.target));
    const entry = nodes.find((n) => n.id !== startNode.id && !targeted.has(n.id)) ?? nodes.find((n) => n.id !== startNode.id);
    if (entry) edges.unshift({ source: startNode.id, target: entry.id, label: "" });
  }
  // No edge may point into START.
  return { nodes, edges: edges.filter((e) => e.target !== startNode.id), skipped };
}

export function describeSpec(spec: FlowSpec, d: ParsedDiagram): string {
  const label = (id: string) => d.shapes.find((s) => s.id === id)?.label ?? id;
  const nodes = spec.nodes.map((n) => {
    const covers = n.shapeIds.length ? ` | from diagram: ${n.shapeIds.map((id) => `"${label(id)}"`).join(", ")}` : "";
    return `- id "${n.id}" | ${n.nodeType} | "${n.title}"${covers}${n.detail ? ` | ${n.detail}` : ""}`;
  });
  const edges = spec.edges.map((e) => `- ${e.source} -> ${e.target}${e.label ? `  (label "${e.label}")` : ""}`);
  return `BLOCKS TO CREATE (exactly these ids and node types, ${spec.nodes.length}):\n${nodes.join("\n")}\n\nCONNECTIONS TO CREATE (exactly these, ${spec.edges.length}):\n${edges.join("\n") || "- none"}\n`;
}

export const BUILD_RULES = `
BUILD RULES (the block list above is authoritative):
- Create exactly the listed blocks with exactly those ids and node types — no more, no less (this overrides rule 8).
- Create exactly the listed connections. Do not add others.
- Write each block's config from its title, its diagram shapes and its detail:
   • SEND_MESSAGE text = the actual words the bot sends (natural, friendly WhatsApp copy).
   • ASK_INPUT text = the question to the user; pick a sensible variable name.
   • START: put trigger words quoted in its diagram shapes (e.g. "Hi") into config.keywords.
- Branching (a block with 2+ connections):
   • CONDITION: the yes/true/valid/success connection uses sourceHandle "true", the other "else".
   • SEND_MESSAGE buttons (≤3) or LIST rows (4+): one button/row per connection, label = the connection label (or the target's purpose, max 20 chars), and that edge's sourceHandle = the button/row id.
   • API_REQUEST: success connection "true", failure "else". Leave config.apiConfig "" if no config fits.
- A CONDITION or API_REQUEST with only one listed connection: give it on "true" and add a short closing SEND_MESSAGE (id "<blockid>_else") on "else".
`;

export function specCoverage(def: { nodes: any[]; edges: any[] }, spec: FlowSpec) {
  const ids = new Set(def.nodes.map((n) => String(n.id)));
  const pairs = new Set(def.edges.map((e) => `${e.source}|${e.target}`));
  return {
    missingNodes: spec.nodes.filter((n) => !ids.has(n.id)),
    missingEdges: spec.edges.filter((e) => !pairs.has(`${e.source}|${e.target}`)),
  };
}

// Place each block where its diagram shape is (scaled up: canvas cards are much
// bigger than draw.io boxes), so the canvas mirrors the source layout.
export function layoutFromSpec<T extends { nodes: any[] }>(def: T, spec: FlowSpec, d: ParsedDiagram): T {
  const shapeById = new Map(d.shapes.map((s) => [s.id, s]));
  const anchor = new Map<string, DiagramShape>();
  for (const n of spec.nodes) {
    const s = shapeById.get(n.id) ?? n.shapeIds.map((id) => shapeById.get(id)).find(Boolean);
    if (s) anchor.set(n.id, s);
  }
  const placed = [...anchor.values()];
  if (!placed.length) return def;
  const median = (xs: number[]) => {
    const v = xs.filter((n) => n > 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  const sx = Math.min(3.5, Math.max(1, 320 / (median(placed.map((s) => s.w)) || 120)));
  const sy = Math.min(3, Math.max(1, 150 / (median(placed.map((s) => s.h)) || 60)));
  const minX = Math.min(...placed.map((s) => s.x));
  const minY = Math.min(...placed.map((s) => s.y));

  const nodes = def.nodes.map((n) => {
    const s = anchor.get(String(n.id));
    return s ? { ...n, position: { x: Math.round((s.x - minX) * sx), y: Math.round((s.y - minY) * sy) + 160 } } : n;
  });
  // Blocks without a shape (e.g. START, extra else-messages): next to a neighbour.
  for (const n of nodes) {
    if (anchor.has(String(n.id))) continue;
    const next = spec.edges.find((e) => e.source === n.id)?.target;
    const prev = spec.edges.find((e) => e.target === n.id)?.source ?? (String(n.id).endsWith("_else") ? String(n.id).slice(0, -5) : undefined);
    const ref = nodes.find((m) => m.id === (next ?? prev) && anchor.has(String(m.id)));
    if (ref) n.position = { x: ref.position.x + (next ? 0 : 340), y: ref.position.y + (next ? -170 : 170) };
  }
  return { ...def, nodes };
}
