// ---------------------------------------------------------------------------
// Fidelity validation for draw.io-generated journeys.
//
// Compares the generated workflow against the analysed diagram (FlowSpec)
// INDEPENDENTLY of the AI that built it:
//   1. enforceSpec()   — deterministic, safe corrections (exact text, no-reply
//                        events, traceability refs, removing fabricated blocks)
//   2. checkFidelity() — static checks: structure, messages, questions, events,
//                        branches, configuration
//   3. simulateBranches() — runs the REAL node executors (runtime/executors.ts)
//                        with simulated replies / variables / mocked API
//                        responses to confirm each outcome reaches the
//                        destination the diagram says. No WhatsApp messages
//                        are sent and no external systems are called.
// ---------------------------------------------------------------------------

import { executors } from "../runtime/executors.js";
import { ConsoleAdapter } from "../messaging/adapters.js";
import type { ExecutionContext, WorkflowNode } from "../runtime/types.js";
import { validateWorkflow } from "./validator.js";
import { CAPABILITIES, branchOptions, producedVariables, referencedVariables } from "./capabilities.js";
import { drawioIdsFor, TIMEOUT_RE, type FlowSpec, type NodeSpec, type ParsedDiagram, type DiagramEdge } from "./drawio.js";

export type CheckStatus = "passed" | "warning" | "failed" | "not_tested";
export type CheckCategory = "structure" | "messages" | "questions" | "events" | "branches" | "configuration" | "runtime";

export interface CheckItem {
  category: CheckCategory;
  status: CheckStatus;
  message: string;
  nodeId?: string;
  sourceIds?: string[];  // draw.io cell ids for traceability
}

export interface MappingRow {
  nodeId: string;
  nodeType: string;
  title: string;
  drawioIds: string[];
  labels: string[];
  confidence: string;
  ambiguity?: string;
}

export interface FidelityReport {
  status: CheckStatus;               // overall: failed > warning > passed
  summary: {
    sourceShapes: number;
    sourceConnections: number;
    mappedShapes: number;            // became a block or were merged/skipped with a reason
    skippedShapes: number;
    nodesCreated: number;
    connectionsVerified: number;
    connectionsTotal: number;
    messagesVerified: number;
    messagesTotal: number;
    questionsVerified: number;
    questionsTotal: number;
    eventsVerified: number;
    eventsTotal: number;
    branchesVerified: number;
    branchesTotal: number;
    testsPassed: number;
    testsFailed: number;
    testsNotRun: number;
    repairAttempts: number;
  };
  items: CheckItem[];
  mapping: MappingRow[];
  skipped: { drawioId: string; label: string; reason: string }[];
  corrections: string[];            // deterministic fixes that were applied
  manualActions: string[];          // what the user must still do
}

interface Def {
  variables?: { name: string }[];
  nodes: { id: string; nodeType: string; config: any; position?: any; seq?: number }[];
  edges: { id: string; source: string; target: string; sourceHandle: string | null }[];
  [k: string]: any;
}

const YES_RE = /^(yes|y|true|valid|success|ok|correct|approved|registered|found|available|exists?|paid|confirmed|matched?|pass(ed)?)\b/i;
const NO_RE = /^(no|n|false|invalid|fail(ure|ed)?|error|not\b|incorrect|rejected|unregistered|missing|unavailable|else|other(wise)?|declined)\b/i;
const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();
const loose = (s: string) => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function similar(a: string, b: string): boolean {
  const x = loose(a), y = loose(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x) || (x.split(" ")[0] === y.split(" ")[0] && x.split(" ")[0].length > 2);
}

// ---------------------------------------------------------------------------
// 1) Deterministic corrections
// ---------------------------------------------------------------------------
export function enforceSpec<T extends Def>(def: T, spec: FlowSpec, d: ParsedDiagram): { def: T; corrections: string[] } {
  const corrections: string[] = [];
  const specById = new Map(spec.nodes.map((n) => [n.id, n]));
  const label = (id: string) => d.shapes.find((s) => s.id === id)?.label ?? id;

  // Remove fabricated blocks (not in the diagram). Allowed extras: the closing
  // "<id>_else" message the build rules permit for a one-branch decision.
  const allowedExtra = (id: string) => {
    if (!id.endsWith("_else")) return false;
    const parent = specById.get(id.slice(0, -5));
    return !!parent && CAPABILITIES[parent.nodeType]?.branch === "boolean";
  };
  const fabricated = def.nodes.filter((n) => !specById.has(n.id) && !allowedExtra(n.id));
  let nodes = def.nodes;
  let edges = def.edges;
  if (fabricated.length) {
    const ids = new Set(fabricated.map((n) => n.id));
    nodes = nodes.filter((n) => !ids.has(n.id));
    edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    corrections.push(`Removed ${fabricated.length} block(s) that aren't in the diagram: ${fabricated.map((n) => `"${n.config?.name ?? n.id}"`).join(", ")}.`);
  }

  // Remove connections between diagram blocks that the diagram doesn't have.
  const specPairs = new Set(spec.edges.filter((e) => e.kind !== "fallback").map((e) => `${e.source}|${e.target}`));
  const extraEdges = edges.filter((e) => specById.has(e.source) && specById.has(e.target) && !specPairs.has(`${e.source}|${e.target}`));
  if (extraEdges.length) {
    const ids = new Set(extraEdges.map((e) => e.id));
    edges = edges.filter((e) => !ids.has(e.id));
    corrections.push(`Removed ${extraEdges.length} connection(s) that aren't in the diagram.`);
  }

  nodes = nodes.map((n) => {
    const s = specById.get(n.id);
    if (!s) return n;
    const cap = CAPABILITIES[n.nodeType];
    const config = { ...(n.config ?? {}) };

    // Traceability: which draw.io cells this block came from.
    config.sourceRef = { drawioIds: drawioIdsFor(s, d), labels: s.shapeIds.map(label) };

    // Exact text when the diagram contains the real words.
    if (cap?.textKey && s.text && n.nodeType === s.nodeType) {
      if (s.textSource === "verbatim" && norm(config[cap.textKey]) !== norm(s.text)) {
        config[cap.textKey] = s.text;
        corrections.push(`Restored the exact diagram text in "${s.title}".`);
      } else if (!norm(config[cap.textKey])) {
        config[cap.textKey] = s.text;
        corrections.push(`Filled the missing text of "${s.title}" from the plan.`);
      }
    }
    if (n.nodeType === "ASK_INPUT") {
      if (!config.variable && s.variable) { config.variable = s.variable; corrections.push(`Set the answer variable of "${s.title}" to {{${s.variable}}}.`); }
      if (!config.validationType && s.validationType && s.validationType !== "none") config.validationType = s.validationType;
      if (!config.expectedType && s.expectedType && s.expectedType !== "text") config.expectedType = s.expectedType;
    }
    if (!config.name) config.name = s.title;
    return { ...n, config };
  });

  // No-reply events -> the native no-reply fallback on the waiting block, and
  // never also a normal connection (that would make it the default next step).
  for (const fe of spec.edges.filter((e) => e.kind === "fallback")) {
    const idx = nodes.findIndex((n) => n.id === fe.source);
    if (idx < 0) continue;
    const fb = nodes[idx].config?.fallback;
    if (!fb?.enabled || fb.goToNodeId !== fe.target || Number(fb.minutes) !== fe.minutes) {
      nodes[idx] = { ...nodes[idx], config: { ...nodes[idx].config, fallback: { ...(fb ?? {}), enabled: true, minutes: fe.minutes, goToNodeId: fe.target } } };
      corrections.push(`Configured the no-reply event on "${specById.get(fe.source)?.title}" (${fe.minutes} min → ${specById.get(fe.target)?.title ?? fe.target}).`);
    }
    const before = edges.length;
    edges = edges.filter((e) => !(e.source === fe.source && e.target === fe.target && !specPairs.has(`${e.source}|${e.target}`)));
    if (edges.length !== before) corrections.push(`Removed a normal connection that duplicated a no-reply event.`);
  }

  return { def: { ...def, nodes, edges }, corrections };
}

// ---------------------------------------------------------------------------
// 2) Static checks
// ---------------------------------------------------------------------------
export function checkFidelity(def: Def, spec: FlowSpec, d: ParsedDiagram): CheckItem[] {
  const items: CheckItem[] = [];
  const nodeById = new Map(def.nodes.map((n) => [n.id, n]));
  const specById = new Map(spec.nodes.map((n) => [n.id, n]));
  const refs = (s?: NodeSpec) => (s ? drawioIdsFor(s, d) : undefined);
  const add = (category: CheckCategory, status: CheckStatus, message: string, s?: NodeSpec, nodeId?: string) =>
    items.push({ category, status, message, nodeId: nodeId ?? s?.id, sourceIds: refs(s) });

  // --- Structure -----------------------------------------------------------
  const starts = def.nodes.filter((n) => n.nodeType === "START");
  if (starts.length === 1) add("structure", "passed", "Exactly one Start block.", undefined, starts[0].id);
  else add("structure", "failed", `Expected exactly one Start block, found ${starts.length}.`);

  for (const s of spec.nodes) {
    const n = nodeById.get(s.id);
    if (!n) { add("structure", "failed", `Missing block “${s.title}” (${s.nodeType}).`, s); continue; }
    if (n.nodeType !== s.nodeType) add("structure", "failed", `“${s.title}” should be ${s.nodeType} but was built as ${n.nodeType}.`, s);
    if (s.confidence === "low" || s.confidence === "medium" || s.ambiguity) {
      add("structure", "warning", `Review “${s.title}”: ${s.ambiguity ?? `mapping confidence is ${s.confidence}`}`, s);
    }
  }

  const normalSpecEdges = spec.edges.filter((e) => e.kind !== "fallback");
  for (const e of normalSpecEdges) {
    const ok = def.edges.some((x) => x.source === e.source && x.target === e.target);
    add("structure", ok ? "passed" : "failed",
      `${ok ? "Connection" : "Missing connection"} ${specById.get(e.source)?.title ?? e.source} → ${specById.get(e.target)?.title ?? e.target}${e.label ? ` (“${e.label}”)` : ""}.`,
      specById.get(e.source));
  }

  // Reachability from START (normal edges + no-reply fallbacks).
  const adj = new Map<string, string[]>();
  for (const e of def.edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  for (const n of def.nodes) if (n.config?.fallback?.goToNodeId) adj.set(n.id, [...(adj.get(n.id) ?? []), n.config.fallback.goToNodeId]);
  const seen = new Set<string>();
  const q = starts.map((s) => s.id);
  while (q.length) { const id = q.shift()!; if (seen.has(id)) continue; seen.add(id); q.push(...(adj.get(id) ?? [])); }
  for (const n of def.nodes) {
    if (!seen.has(n.id)) add("structure", "failed", `“${n.config?.name ?? n.id}” can't be reached from Start.`, specById.get(n.id), n.id);
  }
  if (def.edges.some((e) => starts.some((s) => s.id === e.target))) add("structure", "failed", "A connection points back into Start.");

  // Validator (same rules as Publish), minus "pick an API config" (reported below).
  for (const err of validateWorkflow({ nodes: def.nodes, edges: def.edges } as any).errors) {
    if (/must use a saved global API config/i.test(err.message)) continue;
    add("configuration", "failed", err.message, err.nodeId ? specById.get(err.nodeId) : undefined, err.nodeId);
  }

  // --- Messages & questions ---------------------------------------------------
  for (const s of spec.nodes) {
    const n = nodeById.get(s.id);
    if (!n) continue;
    const cap = CAPABILITIES[n.nodeType];
    if (cap?.textKey && ["message", "choice", "question"].includes(cap.role)) {
      const text = norm(n.config?.[cap.textKey]);
      const cat: CheckCategory = cap.role === "question" ? "questions" : "messages";
      if (!text) add(cat, "failed", `“${s.title}” has no text.`, s);
      else if (s.textSource === "verbatim" && s.text && text !== norm(s.text)) add(cat, "failed", `“${s.title}” text differs from the diagram.`, s);
      else if (s.textSource === "verbatim") add(cat, "passed", `“${s.title}” uses the exact diagram text.`, s);
      else add(cat, "passed", `“${s.title}” has text${s.textSource === "written" ? " (written from the step description — review the wording)" : ""}.`, s);
    }
    if (n.nodeType === "ASK_INPUT") {
      if (!n.config?.variable) add("questions", "failed", `“${s.title}” doesn't store the answer in a variable.`, s);
      else add("questions", "passed", `“${s.title}” stores the answer in {{${n.config.variable}}}.`, s);
      if (s.validationType && s.validationType !== "none" && (n.config?.validationType ?? "none") !== s.validationType) {
        add("questions", "warning", `“${s.title}” should validate as ${s.validationType} but uses ${n.config?.validationType ?? "none"}.`, s);
      }
    }
  }

  // Variables used but never produced/declared.
  const available = new Set<string>((def.variables ?? []).map((v) => v.name));
  for (const n of def.nodes) for (const v of producedVariables(n)) available.add(v);
  for (const n of def.nodes) {
    for (const v of referencedVariables(n)) {
      if (!available.has(v)) add("configuration", "warning", `“${n.config?.name ?? n.id}” uses {{${v}}}, which no step sets or declares.`, specById.get(n.id), n.id);
    }
  }

  // --- Events, checked against the SOURCE diagram (not the AI's plan) ---------
  // Every timeout / no-reply connector in the draw.io file must be a no-reply
  // fallback on the block holding its source, leading to the block holding its
  // target.
  const blockOf = new Map<string, string>();
  for (const s of spec.nodes) for (const sid of s.shapeIds) blockOf.set(sid, s.id);
  for (const de of d.edges.filter((e) => e.label && TIMEOUT_RE.test(e.label))) {
    const fromBlock = blockOf.get(de.source);
    const toBlock = blockOf.get(de.target);
    const fromS = fromBlock ? specById.get(fromBlock) : undefined;
    const src = d.shapes.find((s) => s.id === de.source)?.label ?? de.source;
    const dst = d.shapes.find((s) => s.id === de.target)?.label ?? de.target;
    if (!fromBlock || !toBlock || fromBlock === toBlock) {
      add("events", "failed", `Event “${de.label}” (${src} → ${dst}) was lost: its ${!toBlock ? "destination isn't a block" : "source and destination were merged into one block"}.`, fromS);
      continue;
    }
    const fb = nodeById.get(fromBlock)?.config?.fallback;
    const ok = !!fb?.enabled && fb.goToNodeId === toBlock;
    add("events", ok ? "passed" : "failed",
      `Event “${de.label}” on “${fromS?.title ?? fromBlock}” → ${specById.get(toBlock)?.title ?? toBlock}${ok ? ` (no-reply after ${fb.minutes} min)` : " is not configured"}.`,
      fromS);
  }

  // Decisions need a real predicate.
  for (const s of spec.nodes) {
    const n = nodeById.get(s.id);
    if (n?.nodeType !== "CONDITION") continue;
    const op = n.config?.operator ?? "equals";
    if (!["is_empty", "is_not_empty"].includes(op) && !norm(n.config?.value)) {
      add("configuration", "warning", `“${s.title}” checks {{${n.config?.field ?? "?"}}} ${op} an empty value — set the value the diagram's decision means.`, s);
    }
  }

  // --- Branches -----------------------------------------------------------
  for (const s of spec.nodes) {
    const n = nodeById.get(s.id);
    if (!n) continue;
    const cap = CAPABILITIES[n.nodeType];
    const out = normalSpecEdges.filter((e) => e.source === s.id);
    const built = def.edges.filter((e) => e.source === s.id);

    if (cap?.branch === "boolean") {
      const handles = built.map((e) => e.sourceHandle);
      const hasT = handles.includes("true"), hasE = handles.includes("else");
      if (n.nodeType === "API_REQUEST") {
        // The runtime simply ends the flow on an unconnected outcome, so this
        // is a review item, not a broken journey.
        if (!hasE) add("branches", "warning", `“${s.title}” has no failure path — if the API call fails the conversation just stops.`, s);
        if (!hasT && out.length) add("branches", "failed", `“${s.title}” has no success path.`, s);
      } else if (!hasT || !hasE) {
        add("branches", "failed", `“${s.title}” needs both a true and else path.`, s);
      }
      for (const e of out) {
        const be = built.find((x) => x.target === e.target);
        if (!be) continue;
        if (be.sourceHandle !== "true" && be.sourceHandle !== "else") {
          add("branches", "failed", `“${s.title}” → ${specById.get(e.target)?.title} has no true/else handle.`, s);
          continue;
        }
        const expected = e.label ? (YES_RE.test(e.label.trim()) ? "true" : NO_RE.test(e.label.trim()) ? "else" : null) : null;
        if (expected && be.sourceHandle !== expected) {
          add("branches", "failed", `“${s.title}”: the “${e.label}” path is wired as ${be.sourceHandle} (reversed).`, s);
        } else {
          add("branches", "passed", `“${s.title}”: ${e.label ? `“${e.label}”` : be.sourceHandle} → ${specById.get(e.target)?.title}.`, s);
        }
      }
    } else if (out.length >= 2) {
      if (cap?.branch !== "options") {
        add("branches", "failed", `“${s.title}” has ${out.length} outcomes in the diagram, but ${n.nodeType} can't branch.`, s);
        continue;
      }
      const opts = branchOptions(n);
      if (cap.maxOptions && opts.length > cap.maxOptions) add("branches", "failed", `“${s.title}” has ${opts.length} options; WhatsApp allows ${cap.maxOptions} here.`, s);
      for (const e of out) {
        const be = built.find((x) => x.target === e.target);
        if (!be) continue;
        const opt = opts.find((o) => o.id === be.sourceHandle);
        if (!opt) { add("branches", "failed", `“${s.title}” → ${specById.get(e.target)?.title} isn't attached to any button/option.`, s); continue; }
        const expectLabel = e.label;
        if (expectLabel && !similar(opt.label, expectLabel)) {
          // If the diagram's label matches a DIFFERENT option, the paths are swapped.
          const swapped = opts.find((o) => o.id !== opt.id && similar(o.label, expectLabel));
          add("branches", swapped ? "failed" : "warning",
            swapped
              ? `“${s.title}”: “${swapped.label}” should lead to ${specById.get(e.target)?.title}, but “${opt.label}” does (paths swapped).`
              : `“${s.title}”: option “${opt.label}” leads to ${specById.get(e.target)?.title}, but the diagram labels that path “${expectLabel}”.`,
            s);
        } else {
          add("branches", "passed", `“${s.title}”: option “${opt.label}” → ${specById.get(e.target)?.title}.`, s);
        }
      }
      for (const o of opts) {
        if (!built.some((e) => e.sourceHandle === o.id)) add("branches", "warning", `“${s.title}”: option “${o.label}” isn't connected to anything.`, s);
      }
    }

    if (n.nodeType === "API_REQUEST" && !n.config?.apiConfig) {
      add("configuration", "warning", `“${s.title}” needs an API config selected before publishing.`, s);
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// 3) Simulated execution with the real executors
// ---------------------------------------------------------------------------
const VALID_SAMPLE: Record<string, string> = {
  email: "test.user@example.com",
  phone: "+919876543210",
  number: "42",
  url: "https://example.com",
  alphanumeric: "abc123",
};

const handleOf = (r: { action: string; handle?: string }) => (r.action === "next" ? r.handle : undefined);

function nextNodeId(def: Def, from: string, handle?: string): string | null {
  const out = def.edges.filter((e) => e.source === from);
  if (!out.length) return null;
  if (handle) return out.find((e) => e.sourceHandle === handle)?.target ?? null;
  return out[0].target;
}

function ctxFor(vars: Record<string, any>, incomingText: string | null, apiConfigs?: Record<string, any>): ExecutionContext {
  return { userId: "simulator", variables: { ...vars }, incomingText, incomingType: incomingText === null ? null : "text", incomingMedia: null, messaging: new ConsoleAdapter(), apiConfigs };
}

export async function simulateBranches(def: Def, spec: FlowSpec, d: ParsedDiagram): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const specById = new Map(spec.nodes.map((n) => [n.id, n]));
  const title = (id: string | null) => (id ? specById.get(id)?.title ?? def.nodes.find((n) => n.id === id)?.config?.name ?? id : "end of flow");
  const add = (status: CheckStatus, message: string, s?: NodeSpec) =>
    items.push({ category: "runtime", status, message, nodeId: s?.id, sourceIds: s ? drawioIdsFor(s, d) : undefined });

  for (const s of spec.nodes) {
    const node = def.nodes.find((n) => n.id === s.id) as unknown as WorkflowNode | undefined;
    if (!node) continue;
    const exec = executors[node.nodeType];
    if (!exec) continue;
    const out = spec.edges.filter((e) => e.source === s.id && e.kind !== "fallback");
    const cap = CAPABILITIES[node.nodeType];

    try {
      // Choice blocks: simulate the user tapping each option.
      if (cap?.branch === "options" && out.length >= 2) {
        const opts = branchOptions(node);
        for (const e of out) {
          // Tap the option the DIAGRAM names for this path (independent of how
          // the build wired it); fall back to the wired option when the
          // diagram doesn't label the path.
          const byLabel = e.label ? opts.find((o) => similar(o.label, e.label)) : undefined;
          const be = def.edges.find((x) => x.source === s.id && x.target === e.target);
          const opt = byLabel ?? opts.find((o) => o.id === be?.sourceHandle);
          if (!opt) { add("failed", `No option leads to “${title(e.target)}” from “${s.title}”.`, s); continue; }
          const r = await exec(node, ctxFor({}, opt.label));
          const next = r.action === "next" ? nextNodeId(def, s.id, handleOf(r)) : null;
          const how = byLabel ? "" : " (diagram path unlabelled — structural check only)";
          add(next === e.target ? (byLabel ? "passed" : "warning") : "failed",
            `Reply “${opt.label}” at “${s.title}” → ${title(next)}${next === e.target ? how : ` (expected ${title(e.target)})`}.`, s);
        }
        continue;
      }

      // Decisions: drive the variable to make the condition true / false.
      if (node.nodeType === "CONDITION") {
        const field = String(node.config.field ?? "").replace(/[{}]/g, "").trim();
        const op = node.config.operator ?? "equals";
        const value = String(node.config.value ?? "");
        if (!field || !["equals", "contains", "starts_with", "ends_with"].includes(op) || !value || /\{\{/.test(value)) {
          add("not_tested", `“${s.title}” (${op}${value ? ` “${value}”` : ""}) can't be simulated automatically.`, s);
          continue;
        }
        for (const [label, vars] of [["true", { [field]: value }], ["else", { [field]: "__whatsbang_no_match__" }]] as const) {
          const r = await exec(node, ctxFor(vars, null));
          const h = handleOf(r);
          const next = nextNodeId(def, s.id, h);
          const specTarget = out.find((e) => {
            const be = def.edges.find((x) => x.source === s.id && x.target === e.target);
            return be?.sourceHandle === label;
          })?.target ?? null;
          const ok = h === label && next !== null && (specTarget === null || next === specTarget);
          add(ok ? "passed" : "failed", `“${s.title}” when ${field} ${label === "true" ? `= “${value}”` : "doesn't match"} → ${title(next)}.`, s);
        }
        continue;
      }

      // Regex validation: find a sample that passes and one that fails.
      if (node.nodeType === "VALIDATE" && (node.config.mode ?? "expression") === "regex") {
        const m = String(node.config.value ?? "").match(/^\{\{\s*(\w+)\s*\}\}$/);
        let re: RegExp | null = null;
        try { re = new RegExp(node.config.pattern ?? "", node.config.flags ?? ""); } catch { re = null; }
        const good = re ? Object.values(VALID_SAMPLE).find((x) => re!.test(x)) : undefined;
        const bad = "!! not valid !!";
        if (!m || !re || !good || re.test(bad)) {
          add("not_tested", `“${s.title}” (regex) couldn't be simulated automatically.`, s);
          continue;
        }
        for (const [label, sample] of [["true", good], ["else", bad]] as const) {
          const r = await exec(node, ctxFor({ [m[1]]: sample }, null));
          const h = handleOf(r);
          const next = nextNodeId(def, s.id, h);
          add(h === label && next ? "passed" : "failed", `“${s.title}” with ${m[1]} = “${sample}” → ${title(next)}.`, s);
        }
        continue;
      }

      // API calls: mocked success and failure (no network).
      if (node.nodeType === "API_REQUEST") {
        const simNode = { ...node, config: { ...node.config, apiConfig: "__sim__", endpointId: undefined } } as WorkflowNode;
        const apiConfigs = { __sim__: { name: "__sim__", baseUrl: "https://simulator.invalid", headers: [], endpoints: [] } };
        const realFetch = globalThis.fetch;
        for (const [label, ok] of [["true", true], ["else", false]] as const) {
          globalThis.fetch = (async () => new Response("{}", { status: ok ? 200 : 500 })) as any;
          try {
            const r = await exec(simNode, ctxFor({}, null, apiConfigs));
            const h = handleOf(r);
            const next = nextNodeId(def, s.id, h);
            // Outcome must route to the right handle; an unconnected outcome
            // ends the flow (reported as a branch warning, not a failure here).
            add(h === label ? "passed" : "failed", `“${s.title}” on mocked API ${ok ? "success" : "failure"} → ${title(next)}.`, s);
          } finally {
            globalThis.fetch = realFetch;
          }
        }
        continue;
      }

      // Questions with validation: valid answer continues, invalid re-asks.
      if (node.nodeType === "ASK_INPUT") {
        const vt = node.config.validationType ?? "none";
        const sample = VALID_SAMPLE[vt];
        if (vt === "none") {
          const r = await exec(node, ctxFor({}, "sample answer"));
          const stored = r.action === "next";
          add(stored ? "passed" : "failed", `“${s.title}” accepts an answer and continues to ${title(nextNodeId(def, s.id))}.`, s);
        } else if (sample) {
          const good = await exec(node, ctxFor({}, sample));
          const bad = await exec(node, ctxFor({}, "not valid !!"));
          add(good.action === "next" ? "passed" : "failed", `“${s.title}” accepts a valid ${vt} (“${sample}”).`, s);
          add(bad.action === "wait" ? "passed" : "failed", `“${s.title}” re-asks on an invalid ${vt}.`, s);
        } else {
          add("not_tested", `“${s.title}” uses custom validation; not simulated.`, s);
        }
        continue;
      }
    } catch (err: any) {
      add("failed", `Simulating “${s.title}” threw an error: ${err?.message ?? err}`, s);
    }
  }

  for (const fe of spec.edges.filter((e) => e.kind === "fallback")) {
    add("not_tested", `No-reply timer on “${title(fe.source)}” isn't simulated (it runs on a ${fe.minutes}-min background sweep).`, specById.get(fe.source));
  }
  return items;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
export function buildReport(
  def: Def,
  spec: FlowSpec,
  d: ParsedDiagram,
  items: CheckItem[],
  corrections: string[],
  repairAttempts: number
): FidelityReport {
  const count = (cat: CheckCategory, st?: CheckStatus) => items.filter((i) => i.category === cat && (!st || i.status === st)).length;
  const connItems = items.filter((i) => i.category === "structure" && /^(Connection|Missing connection)/.test(i.message));
  const label = (id: string) => d.shapes.find((s) => s.id === id)?.label ?? id;
  const status: CheckStatus = items.some((i) => i.status === "failed") ? "failed" : items.some((i) => i.status === "warning") ? "warning" : "passed";

  const manualActions = [
    ...items.filter((i) => i.category === "configuration" && i.status === "warning" && /API config/.test(i.message)).map((i) => i.message),
    ...items.filter((i) => i.status === "failed").map((i) => `Fix: ${i.message}`),
  ];

  return {
    status,
    summary: {
      sourceShapes: d.shapes.filter((s) => !s.isEnd).length,
      sourceConnections: d.edges.length,
      mappedShapes: d.shapes.filter((s) => !s.isEnd && (spec.nodes.some((n) => n.shapeIds.includes(s.id)) || spec.skipped.some((k) => k.id === s.id))).length,
      skippedShapes: spec.skipped.length,
      nodesCreated: def.nodes.length,
      connectionsVerified: connItems.filter((i) => i.status === "passed").length,
      connectionsTotal: connItems.length,
      messagesVerified: count("messages", "passed"),
      messagesTotal: count("messages"),
      questionsVerified: count("questions", "passed"),
      questionsTotal: count("questions"),
      eventsVerified: count("events", "passed"),
      eventsTotal: count("events"),
      branchesVerified: count("branches", "passed"),
      branchesTotal: count("branches"),
      testsPassed: count("runtime", "passed"),
      testsFailed: count("runtime", "failed"),
      testsNotRun: count("runtime", "not_tested"),
      repairAttempts,
    },
    items,
    mapping: spec.nodes.map((n) => ({
      nodeId: n.id,
      nodeType: n.nodeType,
      title: n.title,
      drawioIds: drawioIdsFor(n, d),
      labels: n.shapeIds.map(label),
      confidence: n.confidence ?? "high",
      ...(n.ambiguity ? { ambiguity: n.ambiguity } : {}),
    })),
    skipped: spec.skipped.map((s) => ({ drawioId: d.shapes.find((x) => x.id === s.id)?.drawioId ?? s.id, label: s.label, reason: s.reason })),
    corrections: [...new Set(corrections)],
    manualActions: [...new Set([...manualActions, ...spec.notes])],
  };
}

// Problems worth sending back to the AI for a targeted repair.
export function repairableProblems(items: CheckItem[]): string[] {
  return items
    .filter((i) => i.status === "failed")
    .map((i) => `[${i.category}] ${i.message}${i.nodeId ? ` (block id "${i.nodeId}")` : ""}`);
}

export const failedCount = (items: CheckItem[]) => items.filter((i) => i.status === "failed").length;

export type { DiagramEdge };
