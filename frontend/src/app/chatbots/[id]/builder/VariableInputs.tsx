"use client";

import { useEffect, useRef, useState } from "react";
import { VariablePanel } from "./VariablePanel";

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
      <div ref={toolbarRef} className="relative flex items-center gap-1 border-t border-base-200 px-1 py-1 bg-base-200/40">
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
          <div className="absolute bottom-9 right-0 z-30 w-80 max-w-[calc(100vw-2rem)]">
            <VariablePanel
              variables={variables}
              mode="insert"
              onPick={insertVariable}
              onCreate={(name, type) => onCreateVariable(name, type)}
              onClose={() => setShowVars(false)}
            />
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
      {/* Save selection to a variable (required) — the chosen option is always
          stored so later steps can use it. */}
      <div className="space-y-1.5">
        <span className="block font-semibold text-slate-700">Save selection to variable <span className="text-rose-500 font-normal">*</span></span>
        <VariableSelect
          value={cfg.answerVariable ?? ""}
          onChange={(v) => updateConfig("answerVariable", v)}
          variables={variables}
          onCreateVariable={onCreateVariable}
          placeholder="Store the chosen option"
        />
        {cfg.answerVariable ? (
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
        ) : (
          <p className="text-[11px] text-rose-500">Pick or create a variable — the chosen option is always saved here.</p>
        )}
      </div>

      {/* Irrelevant / unmatched reply — when the user types something that
          isn't one of the options. The invalid reply isn't stored anywhere; a
          hidden counter drives the re-asks and is cleared on a valid pick. */}
      <div className="space-y-1.5">
        <span className="block font-semibold text-slate-700">If the reply matches no option</span>
        <label className="block text-[11px] text-slate-500">
          Message to send back (then re-show the options)
        </label>
        <input
          type="text"
          className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          value={inv.message ?? ""}
          onChange={(e) => setInv({ message: e.target.value })}
          placeholder="e.g. Please pick one of the options below."
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Re-ask up to</span>
          <input
            type="number"
            min={1}
            max={5}
            className="w-16 px-2 py-1 rounded border border-slate-300 bg-white text-slate-800 text-xs focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
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
          className="mt-0.5 w-4 h-4 rounded border-slate-300 bg-white text-teal-600 accent-teal-600 focus:ring-teal-500"
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
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative flex flex-col gap-1" ref={wrapRef}>
      {/* Trigger — shows the chosen variable; opens the accordion panel. */}
      <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left outline-none"
        >
          <i className="ph-bold ph-brackets-curly text-teal-600 text-[11px]" aria-hidden="true" />
          {value ? (
            <span className="font-mono text-slate-800 truncate" title={value}>{value}</span>
          ) : (
            <span className="text-slate-400 truncate">{placeholder}</span>
          )}
        </button>
        {value && (
          <button type="button" onClick={() => onChange("")} className="text-slate-400 hover:text-rose-600" title="Clear" aria-label="Clear variable">
            <i className="ph-bold ph-x text-[10px]" />
          </button>
        )}
        <i className={`ph-bold ph-caret-down text-slate-400 text-[9px] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </div>

      {open && (
        <div className="absolute z-40 top-full mt-1 left-0 right-0 min-w-[18rem]">
          <VariablePanel
            variables={variables}
            mode="store"
            selected={value}
            allowCreate={allowCreate}
            onPick={(name) => { onChange(name); setOpen(false); }}
            onCreate={(name, type) => onCreateVariable(name, type)}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
