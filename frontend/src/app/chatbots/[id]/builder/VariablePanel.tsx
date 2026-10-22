"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { CUSTOMER_VAR_DEFS } from "@/lib/customerVars";

// ---------------------------------------------------------------------------
// Variable panel — the accordion picker used wherever a variable is needed
// (inserting {{var}} into text, or choosing where to store an answer).
//
// Variables are grouped by WHERE they come from, using the current flow:
//   Customer      — reserved customer_name / customer_phone
//   Questions     — ASK_INPUT answers
//   Choices       — buttons / list selections (answerVariable)
//   REST API      — one drawer per API Request node (response map + status)
//   Data & AI     — Set Variable / Custom Code / AI Reply outputs
//   Journey       — declared variables no step produces yet
// ---------------------------------------------------------------------------

type VarType = "text" | "number" | "boolean";

export interface PanelVariable {
  name: string;
  type: VarType;
  default?: string;
}

// Minimal node shape the grouping needs (matches the builder's flow nodes).
export interface SourceNode {
  id: string;
  nodeType: string;
  seq?: number;
  config: any;
}

// The builder provides the live node list so every picker can group by origin
// without threading props through ~15 call sites.
const VariableSourceContext = createContext<SourceNode[] | null>(null);

export function VariableSourceProvider({ nodes, children }: { nodes: SourceNode[]; children: React.ReactNode }) {
  return <VariableSourceContext.Provider value={nodes}>{children}</VariableSourceContext.Provider>;
}

interface PanelItem {
  name: string;
  type: VarType;
  readOnly?: boolean;
  icon?: string;     // override icon (customer vars)
  hint?: string;     // small secondary text (e.g. the producing step)
}

interface PanelGroup {
  key: string;
  title: string;
  icon: string;
  items: PanelItem[];
  // REST API: one nested drawer per API node.
  subgroups?: { key: string; title: string; items: PanelItem[] }[];
}

const TYPE_LABEL: Record<string, string> = {
  ASK_INPUT: "Question",
  LIST: "List",
  SEND_MESSAGE: "Message",
  BUTTONS: "Buttons",
  API_REQUEST: "API Request",
  SET_VARIABLE: "Set Variable",
  TRANSFORM: "Custom Code",
  AI_RESPONSE: "AI Reply",
};

const stepName = (n: SourceNode) =>
  String(n.config?.name ?? "").trim() || `${TYPE_LABEL[n.nodeType] ?? n.nodeType}${n.seq ? ` ${n.seq}` : ""}`;

const clean = (v: any) => String(v ?? "").replace(/[{}]/g, "").trim();

// Build the accordion groups from declared variables + the flow's nodes.
function buildGroups(variables: PanelVariable[], nodes: SourceNode[] | null): PanelGroup[] {
  const typeOf = (name: string): VarType => variables.find((v) => v.name === name)?.type ?? "text";
  const placed = new Set<string>(CUSTOMER_VAR_DEFS.map((c) => c.name));

  const questions: PanelItem[] = [];
  const choices: PanelItem[] = [];
  const data: PanelItem[] = [];
  const apis: { key: string; title: string; items: PanelItem[] }[] = [];

  const add = (list: PanelItem[], name: string, hint: string) => {
    if (!name || placed.has(name)) return;
    placed.add(name);
    list.push({ name, type: typeOf(name), hint });
  };

  for (const n of nodes ?? []) {
    const c = n.config ?? {};
    if (n.nodeType === "ASK_INPUT") add(questions, clean(c.variable), stepName(n));
    else if (["LIST", "BUTTONS", "SEND_MESSAGE"].includes(n.nodeType)) add(choices, clean(c.answerVariable), stepName(n));
    else if (["SET_VARIABLE", "TRANSFORM", "AI_RESPONSE"].includes(n.nodeType)) add(data, clean(c.variable), stepName(n));
    else if (n.nodeType === "API_REQUEST") {
      const items: PanelItem[] = [];
      for (const m of Array.isArray(c.responseMap) ? c.responseMap : []) add(items, clean(m?.variable), m?.path ? `← ${m.path}` : "response");
      add(items, clean(c.statusVariable), "status code");
      if (items.length) apis.push({ key: n.id, title: stepName(n), items });
    }
  }

  const journey: PanelItem[] = variables
    .filter((v) => !placed.has(v.name))
    .map((v) => ({ name: v.name, type: v.type }));

  const customer: PanelItem[] = CUSTOMER_VAR_DEFS.map((c) => ({
    name: c.name, type: "text", readOnly: c.readOnly, icon: c.icon, hint: c.label,
  }));

  return [
    { key: "customer", title: "Customer Variables", icon: "ph-user-circle", items: customer },
    { key: "questions", title: "Questions", icon: "ph-question", items: questions },
    { key: "choices", title: "Choices", icon: "ph-list-checks", items: choices },
    { key: "api", title: "REST API", icon: "ph-cloud", items: [], subgroups: apis },
    { key: "data", title: "Data & AI", icon: "ph-function", items: data },
    { key: "journey", title: "Journey Variables", icon: "ph-brackets-curly", items: journey },
  ];
}

const TYPE_ICON: Record<VarType, string> = { text: "ph-text-t", number: "ph-hash", boolean: "ph-toggle-left" };
const TYPE_TEXT: Record<VarType, string> = { text: "string", number: "number", boolean: "boolean" };

// ---------------------------------------------------------------------------
// The panel itself. `mode` decides how read-only vars behave:
//   "insert" — every variable can be inserted as {{name}}
//   "store"  — read-only ones (customer_phone) are shown but disabled
// ---------------------------------------------------------------------------
export function VariablePanel({
  variables,
  mode,
  selected,
  onPick,
  onCreate,
  onClose,
  allowCreate = true,
}: {
  variables: PanelVariable[];
  mode: "insert" | "store";
  selected?: string;
  onPick: (name: string) => void;
  onCreate: (name: string, type: VarType) => void;
  onClose?: () => void;
  // false = pick from existing variables only (no "Add variable" footer).
  allowCreate?: boolean;
}) {
  const nodes = useContext(VariableSourceContext);
  const groups = useMemo(() => buildGroups(variables, nodes), [variables, nodes]);

  const [query, setQuery] = useState("");
  // Customer open by default; everything else collapsed until opened/searched.
  const [open, setOpen] = useState<Set<string>>(() => new Set(["customer"]));
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<VarType>("text");

  const q = query.trim().toLowerCase();
  const match = (i: PanelItem) => !q || i.name.toLowerCase().includes(q) || (i.hint ?? "").toLowerCase().includes(q);

  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const submitCreate = () => {
    const name = newName.trim().replace(/[{}\s]/g, "");
    if (!name) return;
    onCreate(name, newType);
    onPick(name);
    setNewName("");
    setNewType("text");
    setCreating(false);
  };

  const renderItem = (i: PanelItem) => {
    const disabled = mode === "store" && !!i.readOnly;
    const isSel = selected === i.name;
    return (
      <button
        key={i.name}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onPick(i.name)}
        title={disabled ? "Read-only — can be used in text, but not stored into." : `{{${i.name}}}`}
        className={`group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition ${
          disabled ? "opacity-50 cursor-not-allowed" : isSel ? "bg-teal-50" : "hover:bg-slate-50"
        }`}
      >
        <span className="w-6 h-6 shrink-0 rounded-md bg-teal-50 border border-teal-100 text-teal-700 flex items-center justify-center">
          <i className={`ph-bold ${i.icon ?? TYPE_ICON[i.type]} text-[12px]`} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[12px] text-slate-800 truncate">{i.name}</span>
          {i.hint && <span className="block text-[10px] text-slate-400 truncate">{i.hint}</span>}
        </span>
        <span className="text-[10px] text-slate-400 shrink-0">{disabled ? "read-only" : TYPE_TEXT[i.type]}</span>
        {isSel ? (
          <i className="ph-bold ph-check text-teal-600 text-[11px]" aria-hidden="true" />
        ) : (
          <i className="ph-bold ph-caret-right text-slate-300 group-hover:text-slate-500 text-[10px]" aria-hidden="true" />
        )}
      </button>
    );
  };

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col max-h-[26rem] text-xs font-sans">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
        <i className="ph-bold ph-sliders-horizontal text-teal-700 text-sm" aria-hidden="true" />
        <span className="font-semibold text-slate-800 text-[13px] flex-1">Variables</span>
        {onClose && (
          <button type="button" onClick={onClose} className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center" aria-label="Close variables">
            <i className="ph-bold ph-x text-[11px]" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 focus-within:bg-white focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500">
          <i className="ph-bold ph-magnifying-glass text-slate-400 text-[11px]" aria-hidden="true" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
            placeholder="Search variables…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose?.(); }}
          />
        </div>
      </div>

      {/* Accordion sections */}
      <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-2">
        {groups.map((g) => {
          const items = g.items.filter(match);
          const subs = (g.subgroups ?? []).map((s) => ({ ...s, items: s.items.filter(match) })).filter((s) => s.items.length);
          const count = items.length + subs.reduce((n, s) => n + s.items.length, 0);
          if (q && count === 0) return null;            // hide empty sections while searching
          const isOpen = q ? true : open.has(g.key);    // searching expands everything that matches
          return (
            <div key={g.key} className="rounded-xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-2.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition"
              >
                <span className="w-6 h-6 rounded-full bg-white border border-slate-200 text-teal-700 flex items-center justify-center">
                  <i className={`ph-bold ${g.icon} text-[12px]`} aria-hidden="true" />
                </span>
                <span className="flex-1 text-left font-semibold text-slate-700">{g.title}</span>
                <span className="text-[10px] text-slate-400 tabular-nums">{count}</span>
                <i className={`ph-bold ph-caret-down text-slate-400 text-[10px] transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>

              {isOpen && (
                <div className="p-1.5 bg-white">
                  {count === 0 && (
                    <div className="px-2.5 py-2 text-[11px] text-slate-400">
                      {g.key === "api" ? "No API response mapped to a variable yet." : "Nothing here yet."}
                    </div>
                  )}
                  {items.map(renderItem)}

                  {/* REST API: one nested drawer per API Request step */}
                  {subs.map((s) => {
                    const subKey = `${g.key}:${s.key}`;
                    const subOpen = q ? true : open.has(subKey);
                    return (
                      <div key={s.key} className="rounded-lg">
                        <button
                          type="button"
                          onClick={() => toggle(subKey)}
                          aria-expanded={subOpen}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 transition"
                        >
                          <span className="w-6 h-6 rounded-md bg-sky-50 border border-sky-100 text-sky-700 flex items-center justify-center">
                            <i className="ph-bold ph-code text-[12px]" aria-hidden="true" />
                          </span>
                          <span className="flex-1 text-left text-slate-700 font-medium truncate">{s.title}</span>
                          <span className="text-[10px] text-slate-400 tabular-nums">{s.items.length}</span>
                          <i className={`ph-bold ph-caret-right text-slate-400 text-[10px] transition-transform ${subOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                        </button>
                        {subOpen && <div className="pl-4 border-l border-slate-100 ml-5">{s.items.map(renderItem)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer — create a new journey variable */}
      {allowCreate && <div className="border-t border-slate-100 p-3">
        {creating ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              <input
                autoFocus
                className="flex-1 h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 font-mono"
                placeholder="variable_name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") setCreating(false); }}
              />
              <select
                className="h-8 px-2 rounded-lg border border-slate-300 bg-white text-slate-700"
                value={newType}
                onChange={(e) => setNewType(e.target.value as VarType)}
                aria-label="Variable type"
              >
                <option value="text">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
            </div>
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setCreating(false)} className="px-3 h-7 rounded-lg text-slate-500 hover:bg-slate-100">Cancel</button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={!newName.trim()}
                className="px-3 h-7 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
              >
                Create &amp; use
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setCreating(true); setNewName(query.trim().replace(/[{}\s]/g, "")); }}
            className="w-full h-8 rounded-lg border border-dashed border-teal-400 text-teal-700 font-semibold hover:bg-teal-50 flex items-center justify-center gap-1.5"
          >
            <i className="ph-bold ph-plus text-[11px]" aria-hidden="true" /> Add variable
          </button>
        )}
      </div>}
    </div>
  );
}
