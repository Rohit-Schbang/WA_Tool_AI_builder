// Native node capability registry — what the runtime (runtime/executors.ts)
// and validator (workflows/validator.ts) actually support. The draw.io mapper,
// the builder prompts and the fidelity checks all read from here so they never
// drift from the real engine.

export type BranchKind =
  | "none"      // single outgoing edge (sourceHandle null)
  | "boolean"   // two edges: sourceHandle "true" / "else"
  | "options";  // one edge per option; sourceHandle = option id

export interface NodeCapability {
  type: string;
  role: "trigger" | "message" | "question" | "choice" | "decision" | "integration" | "data" | "ai" | "timer";
  branch: BranchKind;
  optionsKey?: "buttons" | "rows";   // where options live (branch "options")
  maxOptions?: number;               // WhatsApp limit
  textKey?: string;                  // config key holding user-facing text
  required: string[];                // config keys required to run
  waits: boolean;                    // pauses for a user reply
}

export const CAPABILITIES: Record<string, NodeCapability> = {
  START:        { type: "START", role: "trigger", branch: "none", required: [], waits: false },
  SEND_MESSAGE: { type: "SEND_MESSAGE", role: "message", branch: "options", optionsKey: "buttons", maxOptions: 3, textKey: "text", required: ["text"], waits: false },
  BUTTONS:      { type: "BUTTONS", role: "choice", branch: "options", optionsKey: "buttons", maxOptions: 3, textKey: "text", required: ["text"], waits: true },
  LIST:         { type: "LIST", role: "choice", branch: "options", optionsKey: "rows", maxOptions: 10, textKey: "text", required: ["text"], waits: true },
  ASK_INPUT:    { type: "ASK_INPUT", role: "question", branch: "none", textKey: "text", required: ["text", "variable"], waits: true },
  CONDITION:    { type: "CONDITION", role: "decision", branch: "boolean", required: ["field"], waits: false },
  VALIDATE:     { type: "VALIDATE", role: "decision", branch: "boolean", required: [], waits: false },
  API_REQUEST:  { type: "API_REQUEST", role: "integration", branch: "boolean", required: ["apiConfig"], waits: false },
  SET_VARIABLE: { type: "SET_VARIABLE", role: "data", branch: "none", required: ["variable"], waits: false },
  TRANSFORM:    { type: "TRANSFORM", role: "data", branch: "none", required: ["expression", "variable"], waits: false },
  AI_RESPONSE:  { type: "AI_RESPONSE", role: "ai", branch: "none", required: ["prompt"], waits: false },
  WAIT:         { type: "WAIT", role: "timer", branch: "none", required: ["seconds"], waits: true },
};

export const KNOWN_TYPES = new Set(Object.keys(CAPABILITIES));

// Options on a node (buttons / list rows). SEND_MESSAGE only branches on
// "cta" buttons; "url" buttons open a link and don't branch.
export function branchOptions(node: { nodeType: string; config?: any }): { id: string; label: string }[] {
  const cap = CAPABILITIES[node.nodeType];
  if (!cap || cap.branch !== "options") return [];
  const list: any[] = Array.isArray(node.config?.[cap.optionsKey!]) ? node.config[cap.optionsKey!] : [];
  return list
    .filter((o) => node.nodeType !== "SEND_MESSAGE" || (o?.kind ?? "cta") === "cta")
    .map((o) => ({ id: String(o?.id ?? ""), label: String(o?.label ?? "") }))
    .filter((o) => o.id);
}

// No-reply fallback (the app's native timeout/"event" mechanism): a waiting
// node can jump elsewhere after N minutes of silence. See fallbackSweeper.ts.
export const FALLBACK_MINUTES = { min: 1, max: 10 };

// Variables a node PRODUCES (so later nodes can reference {{var}}).
export function producedVariables(node: { nodeType: string; config?: any }): string[] {
  const c = node.config ?? {};
  const out: string[] = [];
  if (["ASK_INPUT", "SET_VARIABLE", "TRANSFORM", "AI_RESPONSE"].includes(node.nodeType) && c.variable) out.push(String(c.variable));
  if (node.nodeType === "API_REQUEST") {
    for (const m of c.responseMap ?? []) if (m?.variable) out.push(String(m.variable));
    for (const k of ["statusVariable", "responseVariable", "errorVariable"]) if (c[k]) out.push(String(c[k]));
  }
  return out.map((v) => v.replace(/[{}]/g, "").trim()).filter(Boolean);
}

// Variables a node READS via {{var}} in any of its text-ish config.
export function referencedVariables(node: { config?: any }): string[] {
  const s = JSON.stringify(node.config ?? {});
  return [...new Set([...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
}
