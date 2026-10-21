"use client";

import { useEffect, useRef, useState } from "react";

// A declared workflow variable (kept loose here to avoid a circular import).
export interface WorkflowVariable {
  name: string;
  type: "text" | "number" | "boolean";
  default: string;
}

const EMOJIS = ["😀", "😊", "👍", "🙏", "🎉", "❤️", "🔥", "✅", "⚠️", "📞", "📧", "📍"];

// ---------------------------------------------------------------------------
// VariableTextInput — a textarea (or single-line input) with a small toolbar:
//   - WhatsApp formatting: *bold*, _italic_, ~strike~
//   - emoji inserter
//   - "+ Add variable": insert {{name}} at the cursor, or create a new variable
// Used for every free-text field (message body, prompts, values, etc.).
// ---------------------------------------------------------------------------
export function VariableTextInput({
  value,
  onChange,
  variables,
  onCreateVariable,
  placeholder,
  rows = 3,
  singleLine = false,
  hideFormatting = false,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  variables: WorkflowVariable[];
  onCreateVariable: (name: string, type?: WorkflowVariable["type"]) => void;
  placeholder?: string;
  rows?: number;
  singleLine?: boolean;
  // Hide the B/I/S + emoji formatting controls (e.g. for API paths/bodies
  // where WhatsApp markdown & emoji don't apply). Keeps only "+ Add variable".
  hideFormatting?: boolean;
  // WhatsApp character cap for this field. When set, the input is hard-capped
  // and a "123 / N" counter is shown in the toolbar (turns amber near the
  // limit, red at it). Inserts (emoji/variables/formatting) are clamped too.
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [showVars, setShowVars] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<WorkflowVariable["type"]>("text");

  // Close the variable / emoji popovers when clicking anywhere outside the toolbar.
  useEffect(() => {
    if (!showVars && !showEmoji) return;
    function handlePointerDown(e: MouseEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowVars(false);
        setShowEmoji(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showVars, showEmoji]);

  // Clamp a candidate value to maxLength (no-op when unset).
  const clamp = (v: string) => (maxLength != null ? v.slice(0, maxLength) : v);

  // Emit onChange with the value clamped to the cap.
  const emit = (v: string) => onChange(clamp(v));

  // Insert text at the current cursor position (or append if no focus).
  function insertAtCursor(text: string) {
    const el = ref.current;
    if (!el) {
      emit((value ?? "") + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = clamp(value.slice(0, start) + text + value.slice(end));
    onChange(next);
    // restore cursor just after the inserted text
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  // Wrap the current selection with markers (for bold/italic/strike).
  function wrapSelection(marker: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = value.slice(start, end) || "text";
    const next = clamp(value.slice(0, start) + marker + selected + marker + value.slice(end));
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    });
  }

  function insertVariable(name: string) {
    insertAtCursor(`{{${name}}}`);
    setShowVars(false);
  }

  function createAndInsert() {
    // Strip braces from the name; we insert the {{ }} form ourselves.
    const name = newName.trim().replace(/[{}]/g, "").trim();
    if (!name) return;
    onCreateVariable(name, newType);
    insertVariable(name);
    setNewName("");
    setNewType("text");
  }

  return (
    <div className="border border-base-300 rounded-lg overflow-visible">
      {singleLine ? (
        <input
          ref={ref as any}
          className="w-full px-2 py-1.5 text-sm bg-transparent outline-none"
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          onChange={(e) => emit(e.target.value)}
        />
      ) : (
        <textarea
          ref={ref as any}
          className="w-full px-2 py-1.5 text-sm bg-transparent outline-none resize-y"
          rows={rows}
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          onChange={(e) => emit(e.target.value)}
        />
      )}

      {/* Toolbar */}
      <div className="relative flex items-center gap-1 border-t border-base-200 px-1 py-1 bg-base-200/40">
        {!hideFormatting && (
          <>
            <button type="button" title="Bold" onClick={() => wrapSelection("*")} className="btn btn-ghost btn-xs font-bold">B</button>
            <button type="button" title="Italic" onClick={() => wrapSelection("_")} className="btn btn-ghost btn-xs italic">I</button>
            <button type="button" title="Strikethrough" onClick={() => wrapSelection("~")} className="btn btn-ghost btn-xs line-through">S</button>

            {/* Emoji */}
            <button type="button" title="Emoji" onClick={() => { setShowEmoji((s) => !s); setShowVars(false); }} className="btn btn-ghost btn-xs">😊</button>
            {showEmoji && (
              <div className="absolute bottom-8 left-0 z-30 bg-base-100 border border-base-300 rounded shadow p-2 grid grid-cols-6 gap-1 w-56">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" className="hover:bg-base-200 rounded text-lg" onClick={() => { insertAtCursor(e); setShowEmoji(false); }}>{e}</button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex-1" />

        {/* Character counter (only when a cap is set). Amber within 10% of the
            limit, red at/over it. */}
        {maxLength != null && (
          <span
            className={`text-[11px] font-mono mr-1 tabular-nums ${
              value.length >= maxLength
                ? "text-rose-600 font-semibold"
                : value.length >= maxLength * 0.9
                ? "text-amber-600"
                : "text-base-content/40"
            }`}
            title={`${value.length} of ${maxLength} characters`}
          >
            {value.length} / {maxLength}
          </span>
        )}

        {/* Add variable */}
        <button type="button" onClick={() => { setShowVars((s) => !s); setShowEmoji(false); }} className="btn btn-ghost btn-xs text-primary">
          + Add variable
        </button>
        {showVars && (
          <div className="absolute bottom-8 right-0 z-30 bg-base-100 border border-base-300 rounded shadow w-56 max-h-64 overflow-y-auto">
            {/* Search box: filters the list AND becomes the new-variable name. */}
            <div className="p-2 border-b border-base-200 sticky top-0 bg-base-100">
              <input
                autoFocus
                className="input input-bordered input-xs w-full"
                placeholder="Search or new variable…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createAndInsert(); if (e.key === "Escape") setShowVars(false); }}
              />
            </div>
            {(() => {
              const qv = newName.trim().toLowerCase();
              const list = qv ? variables.filter((v) => v.name.toLowerCase().includes(qv)) : variables;
              return list.length > 0 ? (
                list.map((v) => (
                  <button key={v.name} type="button" onClick={() => insertVariable(v.name)} className="w-full text-left px-3 py-1.5 hover:bg-base-200 text-sm font-mono">
                    {`{{${v.name}}}`}
                    <span className="text-base-content/40 ml-2 font-sans text-xs">{v.type === "text" ? "string" : v.type}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-base-content/50">{qv ? "No match — create below." : "No variables yet."}</div>
              );
            })()}
            <div className="border-t border-base-200 p-2 flex flex-col gap-1">
              <div className="flex gap-1">
                <select
                  className="select select-bordered select-xs flex-1"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as WorkflowVariable["type"])}
                >
                  <option value="text">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                </select>
                <button type="button" onClick={createAndInsert} disabled={!newName.trim()} className="btn btn-xs btn-primary">Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NoReplyFallback — configure a no-response timeout on a waiting node:
//   - enable + timeout minutes (max 10)
//   - fallback message (optional)
//   - go-to node (optional): route the flow onward on timeout
// Stored under config.fallback = { enabled, minutes, message, goToNodeId }.
// ---------------------------------------------------------------------------
export function NoReplyFallback({
  node,
  otherNodes,
  nodeName,
  updateConfig,
  variables,
  onCreateVariable,
}: {
  node: any;
  otherNodes: any[];
  nodeName: (n: any) => string;
  updateConfig: (key: string, value: any) => void;
  variables: WorkflowVariable[];
  onCreateVariable: (name: string) => void;
}) {
  const fb = node.data.config.fallback ?? {};
  const setFb = (patch: Record<string, any>) =>
    updateConfig("fallback", { ...fb, ...patch });

  return (
    <div className="border-t border-base-200 pt-2 mt-1">
      <label className="label cursor-pointer justify-start gap-2 py-1">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={!!fb.enabled}
          onChange={(e) => setFb({ enabled: e.target.checked })}
        />
        <span className="label-text font-medium">No-reply fallback</span>
      </label>
      {fb.enabled && (
        <div className="flex flex-col gap-2 pl-1">
          <label className="form-control">
            <span className="label-text">If no reply within (minutes, max 10)</span>
            <input
              type="number"
              min={1}
              max={10}
              className="input input-bordered input-sm w-24"
              value={fb.minutes ?? 5}
              onChange={(e) => {
                const n = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                setFb({ minutes: n });
              }}
            />
          </label>
          <label className="form-control">
            <span className="label-text">Fallback message (optional)</span>
            <VariableTextInput
              value={fb.message ?? ""}
              onChange={(v) => setFb({ message: v })}
              variables={variables}
              onCreateVariable={onCreateVariable}
              singleLine
              placeholder="Are you still there?"
            />
          </label>
          <label className="form-control">
            <span className="label-text">Then go to node (optional)</span>
            <select
              className="select select-bordered select-sm"
              value={fb.goToNodeId ?? ""}
              onChange={(e) => setFb({ goToNodeId: e.target.value })}
            >
              <option value="">Stay / end here</option>
              {otherNodes.map((n) => (
                <option key={n.id} value={n.id}>{nodeName(n)}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChoiceBehaviour — shared config for choice nodes (Send Message w/ CTA
// buttons, List): save the selection to a variable, handle an irrelevant
// reply, and optionally lock the node so a user can't re-answer on backtrack.
//   config.answerVariable : variable to store the chosen option in
//   config.answerValue    : "label" | "id" (what to store; default label)
//   config.invalidReply    : { message?, maxRetries?, goToNodeId? }
//   config.lockAfterAnswer : boolean (ignore a 2nd answer if revisited)
// ---------------------------------------------------------------------------
export function ChoiceBehaviour({
  node,
  otherNodes,
  nodeName,
  updateConfig,
  variables,
  onCreateVariable,
}: {
  node: any;
  otherNodes: any[];
  nodeName: (n: any) => string;
  updateConfig: (key: string, value: any) => void;
  variables: WorkflowVariable[];
  onCreateVariable: (name: string, type?: WorkflowVariable["type"]) => void;
}) {
  const cfg = node.data.config ?? {};
  const inv = cfg.invalidReply ?? {};
  const setInv = (patch: Record<string, any>) => updateConfig("invalidReply", { ...inv, ...patch });

  return (
    <div className="flex flex-col gap-4 border-t border-slate-200 pt-3 mt-1 text-xs">
      {/* Save selection to a variable */}
      <div className="space-y-1.5">
        <span className="block font-semibold text-slate-700">Save selection to variable <span className="text-slate-400 font-normal">(optional)</span></span>
        <VariableSelect
          value={cfg.answerVariable ?? ""}
          onChange={(v) => updateConfig("answerVariable", v)}
          variables={variables}
          onCreateVariable={onCreateVariable}
          placeholder="Store the chosen option"
        />
        {cfg.answerVariable && (
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[11px] text-slate-500">Store the</span>
            <select
              className="text-[11px] rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-700"
              value={cfg.answerValue ?? "label"}
              onChange={(e) => updateConfig("answerValue", e.target.value)}
            >
              <option value="label">option label (what the user sees)</option>
              <option value="id">option id (stable key)</option>
            </select>
          </div>
        )}
      </div>

      {/* Irrelevant / unmatched reply */}
      <div className="space-y-1.5">
        <span className="block font-semibold text-slate-700">If the reply matches no option</span>
        <VariableTextInput
          value={inv.message ?? ""}
          onChange={(v) => setInv({ message: v })}
          variables={variables}
          onCreateVariable={onCreateVariable}
          singleLine
          hideFormatting
          placeholder="Please pick one of the options below."
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Re-ask up to</span>
          <input
            type="number"
            min={1}
            max={5}
            className="w-16 px-2 py-1 rounded border border-slate-300 text-xs"
            value={inv.maxRetries ?? 3}
            onChange={(e) => setInv({ maxRetries: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
          />
          <span className="text-[11px] text-slate-500">times, then go to</span>
        </div>
        <select
          className="select select-bordered select-sm"
          value={inv.goToNodeId ?? ""}
          onChange={(e) => setInv({ goToNodeId: e.target.value })}
        >
          <option value="">Keep waiting (don&apos;t move on)</option>
          {otherNodes.map((n) => (
            <option key={n.id} value={n.id}>{nodeName(n)}</option>
          ))}
        </select>
      </div>

      {/* Backtrack lock */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={!!cfg.lockAfterAnswer}
          onChange={(e) => updateConfig("lockAfterAnswer", e.target.checked)}
        />
        <span>
          <span className="font-semibold text-slate-700">Lock after answering</span>
          <span className="block text-[11px] text-slate-400">If the user returns to this step, ignore a second selection and remind them they already answered.</span>
        </span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VariableSelect — pick an existing variable to store into, or create a new
// one inline. Used for "store answer in variable" style fields.
// ---------------------------------------------------------------------------
export function VariableSelect({
  value,
  onChange,
  variables,
  onCreateVariable,
  placeholder = "Select or create a variable",
  allowCreate = true,
}: {
  value: string;
  onChange: (v: string) => void;
  variables: WorkflowVariable[];
  onCreateVariable: (name: string, type?: WorkflowVariable["type"]) => void;
  placeholder?: string;
  // Set false to only pick from existing variables (no "create" affordance).
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newType, setNewType] = useState<WorkflowVariable["type"]>("text");
  const [active, setActive] = useState(0); // highlighted row for keyboard nav
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? variables.filter((v) => v.name.toLowerCase().includes(q)) : variables;
  // Offer "create" only when the typed name is new and valid.
  const typedName = query.trim().replace(/[{}]/g, "").trim();
  const canCreate = allowCreate && !!typedName && !variables.some((v) => v.name.toLowerCase() === typedName.toLowerCase());
  const rows = [
    ...filtered.map((v) => ({ kind: "var" as const, name: v.name, type: v.type })),
    ...(canCreate ? [{ kind: "create" as const, name: typedName, type: newType }] : []),
  ];

  const choose = (name: string) => { onChange(name); setQuery(""); setOpen(false); };
  const create = () => {
    if (!typedName) return;
    onCreateVariable(typedName, newType);
    choose(typedName);
    setNewType("text");
  };
  const pick = (i: number) => {
    const r = rows[i];
    if (!r) return;
    r.kind === "create" ? create() : choose(r.name);
  };

  const typeLabel = (t: string) => (t === "text" ? "string" : t);

  return (
    <div className="relative flex flex-col gap-1" ref={wrapRef}>
      <div
        className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 cursor-text focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        <i className="ph-bold ph-magnifying-glass text-slate-400 text-[11px]" aria-hidden="true" />
        <input
          ref={inputRef}
          className="flex-1 bg-transparent outline-none placeholder:text-slate-400"
          placeholder={value || placeholder}
          value={open ? query : value ? "" : ""}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); pick(active); }
            else if (e.key === "Escape") { setOpen(false); setQuery(""); }
          }}
        />
        {value && !open && (
          <span className="font-mono text-slate-800 truncate max-w-[55%]" title={value}>{value}</span>
        )}
        {value && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(""); setQuery(""); }} className="text-slate-400 hover:text-rose-600" title="Clear" aria-label="Clear variable">
            <i className="ph-bold ph-x text-[10px]" />
          </button>
        )}
        <i className="ph-bold ph-caret-down text-slate-400 text-[9px]" aria-hidden="true" />
      </div>

      {open && (
        <div className="absolute z-40 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto py-1">
          {rows.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-slate-400">No variables{q ? " match" : " yet"}.</div>
          )}
          {rows.map((r, i) =>
            r.kind === "var" ? (
              <button
                key={`v-${r.name}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r.name)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between ${i === active ? "bg-teal-50" : "hover:bg-slate-50"}`}
              >
                <span className="font-mono text-slate-800">{r.name}</span>
                <span className="text-slate-400 text-[10px] ml-2">{typeLabel(r.type)}</span>
              </button>
            ) : (
              <div key="create" className={`px-3 py-1.5 ${i === active ? "bg-teal-50" : ""}`} onMouseEnter={() => setActive(i)}>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={create} className="flex-1 text-left text-xs font-semibold text-teal-700 flex items-center gap-1">
                    <i className="ph-bold ph-plus text-[10px]" /> Create “{r.name}”
                  </button>
                  <select
                    className="text-[11px] rounded border border-slate-200 bg-white px-1 py-0.5 text-slate-600"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as WorkflowVariable["type"])}
                    onClick={(e) => e.stopPropagation()}
                    title="New variable type"
                  >
                    <option value="text">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </select>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
