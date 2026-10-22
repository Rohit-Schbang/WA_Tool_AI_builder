// Journey import — turns an uploaded JSON file into a clean workflow definition.
//
// Accepts either:
//   - the export envelope written by the builder / dashboard
//     ({ kind: "wa-ai-tool/journey-export", exportVersion, chatbot, definition })
//   - a bare definition ({ variables?, apiConfigs?, nodes, edges })
//
// Structural problems (unknown node types, duplicate ids, connections to nodes
// that don't exist…) are ERRORS and block the import. Anything that only stops
// the flow from being PUBLISHED (missing text, unconnected option…) is returned
// as a WARNING: the journey is imported as a draft and the user fixes it on the
// canvas, exactly like an AI-generated draft.

import { CAPABILITIES, toBuilderNode } from "./capabilities.js";
import { ensureSingleStart } from "./startNode.js";
import { validateWorkflow } from "./validator.js";
import { isCustomerVar } from "../runtime/customerVars.js";

export const IMPORT_KIND = "wa-ai-tool/journey-export";
export const IMPORT_LIMITS = { maxNodes: 500, maxEdges: 2000 };

// Every type the runtime can execute (END isn't in the capability registry).
const IMPORTABLE_TYPES = new Set([...Object.keys(CAPABILITIES), "END"]);
const VAR_TYPES = new Set(["text", "number", "boolean"]);

export interface ImportedDefinition {
  version: 1;
  variables: { name: string; type: "text" | "number" | "boolean"; default: string }[];
  apiConfigs: any[];
  nodes: { id: string; nodeType: string; seq?: number; position?: { x: number; y: number }; config: Record<string, any> }[];
  edges: { id: string; source: string; target: string; sourceHandle: string | null }[];
}

export type ImportResult =
  | { ok: true; definition: ImportedDefinition; suggestedName: string | null; warnings: string[] }
  | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

// Find the flow inside whatever the user uploaded.
function locateDefinition(data: any): { def: any; name: string | null } | null {
  if (!isObj(data)) return null;
  const name = typeof data.chatbot?.name === "string" ? data.chatbot.name : null;
  if (data.kind === IMPORT_KIND || isObj(data.definition)) {
    return isObj(data.definition) ? { def: data.definition, name } : null;
  }
  if (Array.isArray(data.nodes)) return { def: data, name: null };
  return null;
}

export function parseImport(data: unknown): ImportResult {
  const found = locateDefinition(data);
  if (!found) {
    return { ok: false, errors: ["This file isn't a journey export — no \"nodes\" were found. Use a file exported from this app, or follow the sample file."] };
  }
  const { def } = found;
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- Nodes ---------------------------------------------------------------
  const rawNodes: any[] = Array.isArray(def.nodes) ? def.nodes : [];
  if (!rawNodes.length) errors.push("The journey has no nodes.");
  if (rawNodes.length > IMPORT_LIMITS.maxNodes) errors.push(`The journey has ${rawNodes.length} nodes; the limit is ${IMPORT_LIMITS.maxNodes}.`);

  const ids = new Set<string>();
  const nodes: ImportedDefinition["nodes"] = [];
  rawNodes.forEach((n, i) => {
    const where = `Node #${i + 1}`;
    if (!isObj(n)) { errors.push(`${where} isn't an object.`); return; }
    const id = typeof n.id === "string" || typeof n.id === "number" ? String(n.id).trim() : "";
    if (!id) { errors.push(`${where} has no "id".`); return; }
    if (ids.has(id)) { errors.push(`Node id "${id}" is used more than once.`); return; }
    ids.add(id);

    const type = String(n.nodeType ?? "").toUpperCase().trim();
    if (!IMPORTABLE_TYPES.has(type)) {
      errors.push(`Node "${id}" has an unknown type "${n.nodeType ?? ""}". Allowed: ${[...IMPORTABLE_TYPES].sort().join(", ")}.`);
      return;
    }
    if (n.config !== undefined && !isObj(n.config)) { errors.push(`Node "${id}" has a "config" that isn't an object.`); return; }

    // Legacy VALIDATE / BUTTONS blocks map onto their builder-palette twins.
    const mapped = toBuilderNode({ nodeType: type, config: { ...(n.config ?? {}) } });
    const x = Number(n.position?.x), y = Number(n.position?.y);
    nodes.push({
      id,
      nodeType: mapped.nodeType,
      ...(Number.isFinite(Number(n.seq)) ? { seq: Number(n.seq) } : {}),
      ...(Number.isFinite(x) && Number.isFinite(y) ? { position: { x, y } } : {}),
      config: mapped.config ?? {},
    });
  });

  // ---- Edges ---------------------------------------------------------------
  const rawEdges: any[] = Array.isArray(def.edges) ? def.edges : [];
  if (def.edges !== undefined && !Array.isArray(def.edges)) errors.push("\"edges\" must be a list.");
  if (rawEdges.length > IMPORT_LIMITS.maxEdges) errors.push(`The journey has ${rawEdges.length} connections; the limit is ${IMPORT_LIMITS.maxEdges}.`);

  const edges: ImportedDefinition["edges"] = [];
  const edgeIds = new Set<string>();
  const seen = new Set<string>();
  rawEdges.forEach((e, i) => {
    if (!isObj(e)) { errors.push(`Connection #${i + 1} isn't an object.`); return; }
    const source = String(e.source ?? "").trim();
    const target = String(e.target ?? "").trim();
    if (!ids.has(source) || !ids.has(target)) {
      errors.push(`Connection #${i + 1} (${source || "?"} → ${target || "?"}) points to a node that isn't in the file.`);
      return;
    }
    const sourceHandle = e.sourceHandle == null || e.sourceHandle === "" ? null : String(e.sourceHandle);
    const key = `${source}|${target}|${sourceHandle ?? ""}`;
    if (seen.has(key)) return; // exact duplicate — drop silently
    seen.add(key);
    let id = e.id != null && String(e.id).trim() ? String(e.id).trim() : `e_${i + 1}`;
    while (edgeIds.has(id)) id = `${id}_${i + 1}`;
    edgeIds.add(id);
    edges.push({ id, source, target, sourceHandle });
  });

  // ---- Variables -----------------------------------------------------------
  const variables: ImportedDefinition["variables"] = [];
  const varNames = new Set<string>();
  for (const v of Array.isArray(def.variables) ? def.variables : []) {
    const name = String(v?.name ?? "").replace(/[{}\s]/g, "");
    if (!name || varNames.has(name)) continue;
    if (isCustomerVar(name)) {
      warnings.push(`"${name}" is a built-in customer variable, so it doesn't need to be declared — skipped.`);
      continue;
    }
    if (!/^\w+$/.test(name)) { errors.push(`Variable "${name}" can only use letters, numbers and underscores.`); continue; }
    varNames.add(name);
    variables.push({
      name,
      type: VAR_TYPES.has(v?.type) ? v.type : "text",
      default: v?.default != null ? String(v.default) : "",
    });
  }

  // ---- API configs (referenced by name from API Request nodes) -------------
  const apiConfigs = (Array.isArray(def.apiConfigs) ? def.apiConfigs : []).filter(
    (c: any) => isObj(c) && typeof c.name === "string" && c.name.trim()
  );

  if (errors.length) return { ok: false, errors: errors.slice(0, 50) };

  // Exactly one START (adds one / merges extras, never targets START).
  const before = nodes.filter((n) => n.nodeType === "START").length;
  const normalised = ensureSingleStart({ version: 1 as const, variables, apiConfigs, nodes, edges });
  if (before === 0) warnings.push("The file had no Start node, so one was added.");
  if (before > 1) warnings.push(`The file had ${before} Start nodes; they were merged into one.`);

  // Publish-readiness — doesn't block the import (it lands as a draft).
  for (const err of validateWorkflow(normalised as any).errors) warnings.push(err.message);

  return { ok: true, definition: normalised, suggestedName: found.name, warnings };
}
