"use client";

import { useRef, useState } from "react";

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
}: {
  value: string;
  onChange: (v: string) => void;
  variables: WorkflowVariable[];
  onCreateVariable: (name: string) => void;
  placeholder?: string;
  rows?: number;
  singleLine?: boolean;
  // Hide the B/I/S + emoji formatting controls (e.g. for API paths/bodies
  // where WhatsApp markdown & emoji don't apply). Keeps only "+ Add variable".
  hideFormatting?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [showVars, setShowVars] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [newName, setNewName] = useState("");

  // Insert text at the current cursor position (or append if no focus).
  function insertAtCursor(text: string) {
    const el = ref.current;
    if (!el) {
      onChange((value ?? "") + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
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
    const next = value.slice(0, start) + marker + selected + marker + value.slice(end);
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
    onCreateVariable(name);
    insertVariable(name);
    setNewName("");
  }

  return (
    <div className="border border-base-300 rounded-lg overflow-visible">
      {singleLine ? (
        <input
          ref={ref as any}
          className="w-full px-2 py-1.5 text-sm bg-transparent outline-none"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <textarea
          ref={ref as any}
          className="w-full px-2 py-1.5 text-sm bg-transparent outline-none resize-y"
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
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

        {/* Add variable */}
        <button type="button" onClick={() => { setShowVars((s) => !s); setShowEmoji(false); }} className="btn btn-ghost btn-xs text-primary">
          + Add variable
        </button>
        {showVars && (
          <div className="absolute bottom-8 right-0 z-30 bg-base-100 border border-base-300 rounded shadow w-56 max-h-64 overflow-y-auto">
            {variables.length > 0 ? (
              variables.map((v) => (
                <button key={v.name} type="button" onClick={() => insertVariable(v.name)} className="w-full text-left px-3 py-1.5 hover:bg-base-200 text-sm font-mono">
                  {`{{${v.name}}}`}
                  <span className="text-base-content/40 ml-2 font-sans text-xs">{v.type}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-base-content/50">No variables yet.</div>
            )}
            <div className="border-t border-base-200 p-2 flex gap-1">
              <input
                className="input input-bordered input-xs flex-1"
                placeholder="new variable"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createAndInsert(); }}
              />
              <button type="button" onClick={createAndInsert} disabled={!newName.trim()} className="btn btn-xs btn-primary">Create</button>
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
// VariableSelect — pick an existing variable to store into, or create a new
// one inline. Used for "store answer in variable" style fields.
// ---------------------------------------------------------------------------
export function VariableSelect({
  value,
  onChange,
  variables,
  onCreateVariable,
  placeholder = "Select or create a variable",
}: {
  value: string;
  onChange: (v: string) => void;
  variables: WorkflowVariable[];
  onCreateVariable: (name: string) => void;
  placeholder?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  function handleSelect(v: string) {
    if (v === "__create__") {
      setCreating(true);
      return;
    }
    onChange(v);
  }

  function createAndSelect() {
    // Strip any {{ }} a user typed — destinations are bare names.
    const name = newName.trim().replace(/[{}]/g, "").trim();
    if (!name) return;
    onCreateVariable(name);
    onChange(name);
    setNewName("");
    setCreating(false);
  }

  // If the current value isn't among declared vars, still show it as selected
  // (free-typed legacy value) so we never lose an existing binding.
  const hasValue = value && !variables.some((v) => v.name === value);

  return (
    <div className="flex flex-col gap-1">
      {!creating ? (
        <select
          className="select select-bordered select-sm"
          value={value ?? ""}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">{placeholder}</option>
          {hasValue && <option value={value}>{value}</option>}
          {variables.map((v) => (
            <option key={v.name} value={v.name}>{v.name}</option>
          ))}
          <option value="__create__">+ Create new variable…</option>
        </select>
      ) : (
        <div className="flex gap-1">
          <input
            autoFocus
            className="input input-bordered input-sm flex-1"
            placeholder="new variable name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createAndSelect(); if (e.key === "Escape") setCreating(false); }}
          />
          <button type="button" onClick={createAndSelect} disabled={!newName.trim()} className="btn btn-sm btn-primary">Add</button>
          <button type="button" onClick={() => setCreating(false)} className="btn btn-sm btn-ghost">✕</button>
        </div>
      )}
    </div>
  );
}
