"use client";

import { useEffect, useMemo, useState } from "react";
import { VariableTextInput, type WorkflowVariable } from "./VariableInputs";
import { WA_LIMITS } from "@/lib/waLimits";

// ---------------------------------------------------------------------------
// Content Mode — edit the WORDS of a journey without touching its logic.
//
// Lists only the blocks this journey actually uses that send something to the
// user (messages, questions, lists, AI fallbacks, closing messages), in the
// order a user meets them. Each edit is written straight into the same node
// config Developer Mode uses, so the canvas, autosave and publish all pick it
// up with no extra step. Structure stays protected: buttons/rows can be
// renamed but not added or removed, and connections can't change here.
// ---------------------------------------------------------------------------

interface FlowNode {
  id: string;
  data: { nodeType: string; seq?: number; config: Record<string, any> };
}
interface FlowEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

const CONTENT_TYPES = new Set(["SEND_MESSAGE", "ASK_INPUT", "LIST", "BUTTONS", "AI_RESPONSE", "END"]);

const TYPE_META: Record<string, { label: string; icon: string; tile: string; chip: string }> = {
  SEND_MESSAGE: { label: "Message", icon: "ph-chat-text", tile: "bg-sky-50 text-sky-600", chip: "bg-sky-50 text-sky-700" },
  ASK_INPUT: { label: "Question", icon: "ph-chat-circle-dots", tile: "bg-violet-50 text-violet-600", chip: "bg-violet-50 text-violet-700" },
  LIST: { label: "List", icon: "ph-list-bullets", tile: "bg-teal-50 text-teal-600", chip: "bg-teal-50 text-teal-700" },
  BUTTONS: { label: "Buttons", icon: "ph-cursor-click", tile: "bg-cyan-50 text-cyan-600", chip: "bg-cyan-50 text-cyan-700" },
  AI_RESPONSE: { label: "AI Reply", icon: "ph-sparkle", tile: "bg-fuchsia-50 text-fuchsia-600", chip: "bg-fuchsia-50 text-fuchsia-700" },
  END: { label: "End", icon: "ph-flag-checkered", tile: "bg-slate-100 text-slate-600", chip: "bg-slate-100 text-slate-700" },
};

const DEFAULT_NAME: Record<string, string> = {
  SEND_MESSAGE: "Send Message", ASK_INPUT: "Question", LIST: "List", BUTTONS: "Buttons", AI_RESPONSE: "AI Reply", END: "End",
};

const titleOf = (n: FlowNode) =>
  String(n.data.config?.name ?? "").trim() || `${DEFAULT_NAME[n.data.nodeType] ?? n.data.nodeType} ${n.data.seq ?? ""}`.trim();

// The text a block shows in the list (first user-facing line).
function previewOf(n: FlowNode): string {
  const c = n.data.config ?? {};
  if (n.data.nodeType === "AI_RESPONSE") return c.fallbackText || "AI-written reply";
  if (n.data.nodeType === "END") return c.text || "No closing message";
  return c.text || "No text yet";
}

// Outgoing order that matches the canvas handles: true → else, options top → bottom.
function handleOrder(n: FlowNode): string[] {
  const c = n.data.config ?? {};
  if (n.data.nodeType === "CONDITION" || n.data.nodeType === "API_REQUEST") return ["true", "else"];
  if (n.data.nodeType === "LIST") return (c.rows ?? []).map((r: any) => r.id);
  if (n.data.nodeType === "SEND_MESSAGE" || n.data.nodeType === "BUTTONS") return (c.buttons ?? []).map((b: any) => b.id);
  return [];
}

// Content blocks in the order a user meets them (walk from Start), then any
// block that isn't connected yet so nothing is hidden.
function orderedContentBlocks(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const start = nodes.find((n) => n.data.nodeType === "START");
  const seen = new Set<string>();
  const order: FlowNode[] = [];
  const queue: string[] = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    order.push(n);
    const out = edges.filter((e) => e.source === id);
    const rank = handleOrder(n);
    out.sort((a, b) => {
      const ia = rank.indexOf(String(a.sourceHandle ?? "")), ib = rank.indexOf(String(b.sourceHandle ?? ""));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    for (const e of out) queue.push(e.target);
    const fb = n.data.config?.fallback?.goToNodeId;
    if (fb) queue.push(fb);
    const inv = n.data.config?.invalidReply?.goToNodeId;
    if (inv) queue.push(inv);
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n);
  return order.filter((n) => CONTENT_TYPES.has(n.data.nodeType));
}

// ----------------------------- preview text --------------------------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// WhatsApp formatting (*bold*, _italic_, ~strike~) + {{variable}} chips.
// The text is HTML-escaped FIRST, so user content can't inject markup.
function waHtml(text: string): string {
  return esc(text ?? "")
    .replace(/\{\{\s*(\w+)\s*\}\}/g, '<span class="px-1 rounded bg-teal-100 text-teal-800 font-mono text-[10px]">$1</span>')
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~([^~\n]+)~/g, "<s>$1</s>")
    .replace(/\n/g, "<br/>");
}

function CharCount({ value, max }: { value?: string; max: number }) {
  const n = (value ?? "").length;
  const cls = n >= max ? "text-rose-600 font-semibold" : n >= max * 0.9 ? "text-amber-600" : "text-slate-400";
  return <span className={`text-[11px] font-mono tabular-nums ${cls}`}>{n} / {max}</span>;
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold text-slate-700">{children}</span>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ContentMode({
  nodes,
  edges,
  variables,
  onCreateVariable,
  onUpdate,
  onOpenInDeveloper,
  botName,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: WorkflowVariable[];
  onCreateVariable: (name: string, type?: WorkflowVariable["type"]) => void;
  // Merge `patch` into the node's config (same data Developer Mode edits).
  onUpdate: (nodeId: string, patch: Record<string, any>) => void;
  onOpenInDeveloper: (nodeId: string) => void;
  botName: string;
}) {
  const blocks = useMemo(() => orderedContentBlocks(nodes, edges), [nodes, edges]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Preview device; remembered so it stays as the user last chose.
  const [platform, setPlatform] = useState<Platform>("ios");
  useEffect(() => {
    try { if (localStorage.getItem("content.previewPlatform") === "android") setPlatform("android"); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("content.previewPlatform", platform); } catch { /* ignore */ }
  }, [platform]);

  // Keep a valid selection as blocks change (deleted / first open).
  useEffect(() => {
    if (!blocks.length) { setSelectedId(null); return; }
    if (!selectedId || !blocks.some((b) => b.id === selectedId)) setSelectedId(blocks[0].id);
  }, [blocks, selectedId]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? blocks.filter((b) => titleOf(b).toLowerCase().includes(q) || JSON.stringify(b.data.config ?? {}).toLowerCase().includes(q))
    : blocks;

  const index = blocks.findIndex((b) => b.id === selectedId);
  const node = index >= 0 ? blocks[index] : null;
  const go = (delta: number) => {
    const next = blocks[index + delta];
    if (next) setSelectedId(next.id);
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-slate-50">
      {/* Column 1 — the journey's content blocks */}
      <aside className="w-80 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Conversation content</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">The messages, questions and labels used in this journey.</p>
          </div>
          <div className="relative">
            <i className="ph-bold ph-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages…"
              aria-label="Search messages"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {!blocks.length && (
            <div className="px-3 py-8 text-center text-xs text-slate-400">
              <i className="ph ph-chat-slash text-2xl text-slate-300 block mb-1" aria-hidden="true" />
              No content blocks yet. Add a Message, Question or List in Developer Mode.
            </div>
          )}
          {blocks.length > 0 && !visible.length && (
            <div className="px-3 py-6 text-center text-xs text-slate-400">No blocks match “{query}”.</div>
          )}
          {visible.map((b) => {
            const meta = TYPE_META[b.data.nodeType];
            const active = b.id === selectedId;
            const step = blocks.indexOf(b) + 1;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedId(b.id)}
                aria-current={active ? "true" : undefined}
                className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl border transition ${
                  active ? "border-teal-500/70 bg-teal-50/50 shadow-xs" : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className="w-5 text-center text-[11px] font-semibold text-slate-400 tabular-nums">{step}</span>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.tile}`}>
                  <i className={`ph-bold ${meta.icon} text-sm`} aria-hidden="true" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`text-xs truncate ${active ? "font-bold text-slate-900" : "font-semibold text-slate-700"}`}>{titleOf(b)}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${meta.chip}`}>{meta.label}</span>
                  </span>
                  <span className="block text-[11px] text-slate-400 truncate mt-0.5">{previewOf(b)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Column 2 — edit the selected block's content */}
      <section className="flex-1 min-w-0 overflow-y-auto bg-white border-r border-slate-200">
        {node ? (
          <div className="max-w-2xl mx-auto px-8 py-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-lg font-bold text-slate-900">Edit content</h1>
                <p className="text-xs text-slate-500 mt-0.5">Changes apply to the flow immediately and save automatically. Flow logic stays unchanged.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500 font-medium tabular-nums">Step {index + 1} of {blocks.length}</span>
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                  <button type="button" onClick={() => go(-1)} disabled={index <= 0} className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-white disabled:opacity-40" aria-label="Previous block">
                    <i className="ph-bold ph-caret-left text-xs" />
                  </button>
                  <button type="button" onClick={() => go(1)} disabled={index >= blocks.length - 1} className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-white disabled:opacity-40" aria-label="Next block">
                    <i className="ph-bold ph-caret-right text-xs" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${TYPE_META[node.data.nodeType].tile}`}>
                <i className={`ph-bold ${TYPE_META[node.data.nodeType].icon}`} aria-hidden="true" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{titleOf(node)}</div>
                <div className="text-[11px] text-slate-500">{TYPE_META[node.data.nodeType].label} · sent to the user</div>
              </div>
              <button
                type="button"
                onClick={() => onOpenInDeveloper(node.id)}
                className="text-[11px] font-semibold text-teal-700 hover:underline inline-flex items-center gap-1 shrink-0"
                title="Open this block on the canvas"
              >
                <i className="ph-bold ph-code" aria-hidden="true" /> Open in Developer Mode
              </button>
            </div>

            <BlockFields
              key={node.id}
              node={node}
              variables={variables}
              onCreateVariable={onCreateVariable}
              update={(patch) => onUpdate(node.id, patch)}
            />

            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-teal-50/60 border border-teal-200/70 text-[11px] text-teal-900">
              <i className="ph-bold ph-lock-simple text-teal-600 text-sm mt-0.5" aria-hidden="true" />
              <span>
                <strong>Content only — flow logic is protected.</strong> You can edit text and rename buttons or list options here.
                Adding or removing options, connections, variables, validation and integrations are changed in Developer Mode.
              </span>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">Select a block to edit its content.</div>
        )}
      </section>

      {/* Column 3 — WhatsApp preview (iPhone / Android) */}
      <aside className="w-[340px] shrink-0 bg-slate-50 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">WhatsApp preview</h2>
            <p className="text-[11px] text-slate-500">How this block appears to your users.</p>
          </div>
          <div role="group" aria-label="Preview device" className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-medium shrink-0">
            {([
              { id: "ios", label: "iPhone", icon: "ph-apple-logo" },
              { id: "android", label: "Android", icon: "ph-android-logo" },
            ] as const).map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={platform === p.id}
                onClick={() => setPlatform(p.id)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition ${
                  platform === p.id ? "bg-white text-slate-900 shadow-2xs font-semibold" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <i className={`ph-fill ${p.icon} text-xs`} aria-hidden="true" />
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex justify-center">
          <PhonePreview node={node} botName={botName} platform={platform} />
        </div>
      </aside>
    </div>
  );
}

// ----------------------------- field editors -------------------------------
function BlockFields({
  node,
  variables,
  onCreateVariable,
  update,
}: {
  node: FlowNode;
  variables: WorkflowVariable[];
  onCreateVariable: (name: string, type?: WorkflowVariable["type"]) => void;
  update: (patch: Record<string, any>) => void;
}) {
  const c = node.data.config ?? {};
  const t = node.data.nodeType;
  const text = (label: string, key: string, max: number, opts: { rows?: number; single?: boolean; placeholder?: string; hint?: string } = {}) => (
    <div className="space-y-1.5">
      <FieldLabel hint={opts.hint}>{label}</FieldLabel>
      <VariableTextInput
        value={c[key] ?? ""}
        onChange={(v) => update({ [key]: v })}
        variables={variables}
        onCreateVariable={onCreateVariable}
        rows={opts.rows ?? 5}
        singleLine={opts.single}
        placeholder={opts.placeholder}
        maxLength={max}
      />
    </div>
  );

  // Rename-only list of buttons / rows (adding/removing changes the flow).
  const optionList = (key: "buttons" | "rows", heading: string, max: number) => {
    const list: any[] = Array.isArray(c[key]) ? c[key] : [];
    if (!list.length) return null;
    const set = (i: number, patch: Record<string, any>) =>
      update({ [key]: list.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
    return (
      <div className="space-y-2">
        <FieldLabel hint="Rename only">{heading}</FieldLabel>
        {list.map((o, i) => (
          <div key={o.id ?? i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <i className={`ph-bold ${o.kind === "url" ? "ph-link" : key === "rows" ? "ph-list-bullets" : "ph-arrow-bend-down-right"} text-slate-400 text-xs`} aria-hidden="true" />
              <input
                value={o.label ?? ""}
                maxLength={max}
                onChange={(e) => set(i, { label: e.target.value })}
                aria-label={`${heading} ${i + 1} label`}
                className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
              <CharCount value={o.label} max={max} />
            </div>
            {o.kind === "url" && (
              <input
                value={o.url ?? ""}
                onChange={(e) => set(i, { url: e.target.value })}
                placeholder="https://…"
                aria-label={`Button ${i + 1} link`}
                className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-[11px] font-mono text-slate-700 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  // Secondary messages (wrong choice / no reply) that also reach the user.
  const extras = () => {
    const inv = c.invalidReply;
    const fb = c.fallback;
    const choice = (t === "LIST" || t === "BUTTONS" || (t === "SEND_MESSAGE" && (c.buttons ?? []).some((b: any) => (b.kind ?? "cta") === "cta")));
    const showInv = choice;
    const showFb = !!fb?.enabled;
    if (!showInv && !showFb) return null;
    return (
      <div className="space-y-4 pt-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Other messages in this step</div>
        {showInv && (
          <div className="space-y-1.5">
            <FieldLabel hint="Sent when the reply matches no option">Wrong choice message</FieldLabel>
            <VariableTextInput
              value={inv?.message ?? ""}
              onChange={(v) => update({ invalidReply: { ...(inv ?? {}), message: v } })}
              variables={variables}
              onCreateVariable={onCreateVariable}
              singleLine
              placeholder="Please pick one of the options below."
              maxLength={WA_LIMITS.failureMessage}
            />
          </div>
        )}
        {showFb && (
          <div className="space-y-1.5">
            <FieldLabel hint={`Sent after ${fb.minutes ?? 5} min without a reply`}>No-reply message</FieldLabel>
            <VariableTextInput
              value={fb?.message ?? ""}
              onChange={(v) => update({ fallback: { ...fb, message: v } })}
              variables={variables}
              onCreateVariable={onCreateVariable}
              singleLine
              placeholder="Are you still there?"
              maxLength={WA_LIMITS.text}
            />
          </div>
        )}
      </div>
    );
  };

  if (t === "SEND_MESSAGE" || t === "BUTTONS") {
    const hasCta = t === "BUTTONS" || (c.buttons ?? []).some((b: any) => (b.kind ?? "cta") === "cta");
    const header = c.header;
    return (
      <div className="space-y-5">
        {header?.type === "text" && (
          <div className="space-y-1.5">
            <FieldLabel>Header</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                value={header.value ?? ""}
                maxLength={WA_LIMITS.header}
                onChange={(e) => update({ header: { ...header, value: e.target.value } })}
                className="flex-1 h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
              <CharCount value={header.value} max={WA_LIMITS.header} />
            </div>
          </div>
        )}
        {header?.type && header.type !== "text" && (
          <div className="space-y-1.5">
            <FieldLabel hint={`${header.type} header`}>Media URL</FieldLabel>
            <input
              value={header.value ?? ""}
              onChange={(e) => update({ header: { ...header, value: e.target.value } })}
              placeholder="https://…"
              className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-mono text-slate-700 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>
        )}
        {text("Message text", "text", hasCta ? WA_LIMITS.buttonBody : WA_LIMITS.text, {
          rows: 6, placeholder: "Type your WhatsApp message…", hint: hasCta ? "Shorter limit with buttons" : undefined,
        })}
        {t === "SEND_MESSAGE" && text("Footer", "footer", WA_LIMITS.footer, { single: true, placeholder: "Optional small text below the message" })}
        {optionList("buttons", "Buttons", WA_LIMITS.buttonLabel)}
        {extras()}
      </div>
    );
  }

  if (t === "ASK_INPUT") {
    const validating = (c.validationType && c.validationType !== "none") || ((c.expectedType ?? "text") !== "text" && c.expectedType !== "any");
    return (
      <div className="space-y-5">
        {text("Question", "text", WA_LIMITS.question, { rows: 5, placeholder: "Ask something…" })}
        {text("Footer", "footer", WA_LIMITS.footer, { single: true, placeholder: "Optional small text below the question" })}
        {validating && text("Invalid answer message", "failureMessage", WA_LIMITS.failureMessage, {
          rows: 3, placeholder: "That doesn't look valid. Please try again.", hint: "Sent when the answer fails validation",
        })}
        {extras()}
      </div>
    );
  }

  if (t === "LIST") {
    return (
      <div className="space-y-5">
        {text("Message text", "text", WA_LIMITS.text, { rows: 5, placeholder: "e.g. Pick a service" })}
        <div className="space-y-1.5">
          <FieldLabel>List button text</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              value={c.buttonText ?? ""}
              maxLength={WA_LIMITS.listButton}
              placeholder="View options"
              onChange={(e) => update({ buttonText: e.target.value })}
              className="flex-1 h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
            <CharCount value={c.buttonText} max={WA_LIMITS.listButton} />
          </div>
        </div>
        {optionList("rows", "List options", WA_LIMITS.rowTitle)}
        {extras()}
      </div>
    );
  }

  if (t === "AI_RESPONSE") {
    return (
      <div className="space-y-5">
        <p className="text-xs text-slate-500">The reply itself is written by AI at runtime. You can change the message sent if the AI is unavailable.</p>
        {text("Fallback message", "fallbackText", WA_LIMITS.aiFallback, { rows: 3, placeholder: "Sorry, I couldn't come up with a response right now." })}
      </div>
    );
  }

  // END
  return (
    <div className="space-y-5">
      {text("Closing message", "text", WA_LIMITS.endMessage, { rows: 4, placeholder: "e.g. Thanks for chatting with us!" })}
    </div>
  );
}

// ----------------------------- phone preview -------------------------------
type Platform = "ios" | "android";

// Per-device chrome. The chat bubbles are the same on both; the frame, status
// bar, app bar, composer and button colours follow each platform's WhatsApp.
const DEVICE: Record<Platform, {
  frame: string;      // outer phone body
  link: string;       // interactive button text colour
  bubble: string;     // bubble corner shape
  time: string;       // timestamp text
}> = {
  ios: {
    frame: "w-[280px] h-[580px] rounded-[2.6rem] border-[9px] border-slate-900",
    link: "text-[#007aff]",
    bubble: "rounded-2xl rounded-tl-md",
    time: "9:41",
  },
  android: {
    frame: "w-[280px] h-[580px] rounded-[1.6rem] border-[6px] border-slate-800",
    link: "text-[#008069]",
    bubble: "rounded-lg rounded-tl-none",
    time: "10:42",
  },
};

function StatusBar({ platform }: { platform: Platform }) {
  if (platform === "ios") {
    // iPhone: time left, Dynamic Island centre, signal/wifi/battery right.
    return (
      <div className="relative h-8 bg-[#f6f6f6] px-5 flex items-center justify-between text-[11px] font-semibold text-slate-900">
        <span>9:41</span>
        <span className="absolute left-1/2 -translate-x-1/2 top-1.5 w-20 h-5 rounded-full bg-black" aria-hidden="true" />
        <span className="flex items-center gap-1 text-[11px]">
          <i className="ph-fill ph-cell-signal-full" aria-hidden="true" />
          <i className="ph-bold ph-wifi-high" aria-hidden="true" />
          <i className="ph-fill ph-battery-full text-sm" aria-hidden="true" />
        </span>
      </div>
    );
  }
  // Android: punch-hole camera, time left, icons right, on the app-bar colour.
  return (
    <div className="relative h-6 bg-[#008069] px-3 flex items-center justify-between text-[10px] text-white">
      <span>10:42</span>
      <span className="absolute left-1/2 -translate-x-1/2 top-1 w-3 h-3 rounded-full bg-black" aria-hidden="true" />
      <span className="flex items-center gap-1">
        <i className="ph-fill ph-wifi-high" aria-hidden="true" />
        <i className="ph-fill ph-cell-signal-full" aria-hidden="true" />
        <i className="ph-fill ph-battery-full text-xs" aria-hidden="true" />
      </span>
    </div>
  );
}

function AppBar({ platform, botName, initial }: { platform: Platform; botName: string; initial: string }) {
  if (platform === "ios") {
    // iOS WhatsApp: light bar, blue back chevron, name + "Business account".
    return (
      <div className="bg-[#f6f6f6] border-b border-slate-200 px-2.5 pb-2 pt-1 flex items-center gap-2 text-slate-900">
        <i className="ph-bold ph-caret-left text-[#007aff] text-base" aria-hidden="true" />
        <span className="w-7 h-7 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold">{initial}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold truncate flex items-center gap-1">
            {botName || "Your bot"}
            <i className="ph-fill ph-seal-check text-[#25d366] text-[11px]" aria-hidden="true" />
          </div>
          <div className="text-[10px] text-slate-500">Business account</div>
        </div>
        <i className="ph ph-video-camera text-[#007aff] text-base" aria-hidden="true" />
        <i className="ph ph-phone text-[#007aff] text-base" aria-hidden="true" />
      </div>
    );
  }
  // Android WhatsApp: green bar, white arrow, video/call/overflow icons.
  return (
    <div className="bg-[#008069] text-white px-2 pb-2 pt-1 flex items-center gap-2">
      <i className="ph-bold ph-arrow-left text-sm" aria-hidden="true" />
      <span className="w-7 h-7 rounded-full bg-teal-300 text-teal-900 flex items-center justify-center text-xs font-bold">{initial}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold truncate">{botName || "Your bot"}</div>
        <div className="text-[10px] text-white/75">Business account</div>
      </div>
      <i className="ph ph-video-camera text-sm" aria-hidden="true" />
      <i className="ph ph-phone text-sm" aria-hidden="true" />
      <i className="ph-bold ph-dots-three-vertical text-sm" aria-hidden="true" />
    </div>
  );
}

function Composer({ platform, placeholder }: { platform: Platform; placeholder: string }) {
  if (platform === "ios") {
    // iOS: "+" on the left, rounded field, camera + mic icons, home indicator.
    return (
      <div className="bg-[#f6f6f6] border-t border-slate-200">
        <div className="px-2 py-1.5 flex items-center gap-2 text-[#007aff]">
          <i className="ph-bold ph-plus text-base" aria-hidden="true" />
          <div className="flex-1 h-7 rounded-full bg-white border border-slate-200 px-3 flex items-center text-[11px] text-slate-400">{placeholder}</div>
          <i className="ph ph-camera text-base" aria-hidden="true" />
          <i className="ph ph-microphone text-base" aria-hidden="true" />
        </div>
        <div className="h-4 flex items-center justify-center">
          <span className="w-24 h-1 rounded-full bg-slate-900" aria-hidden="true" />
        </div>
      </div>
    );
  }
  // Android: pill field with emoji/attach/camera inside, round green mic, nav bar.
  return (
    <div className="bg-transparent">
      <div className="px-1.5 py-1.5 flex items-center gap-1.5">
        <div className="flex-1 h-9 rounded-full bg-white shadow-xs px-2.5 flex items-center gap-2 text-slate-500">
          <i className="ph ph-smiley text-base" aria-hidden="true" />
          <span className="flex-1 text-[11px] text-slate-400 truncate">{placeholder}</span>
          <i className="ph ph-paperclip text-base -rotate-45" aria-hidden="true" />
          <i className="ph ph-camera text-base" aria-hidden="true" />
        </div>
        <span className="w-9 h-9 rounded-full bg-[#00a884] text-white flex items-center justify-center shadow-xs">
          <i className="ph-fill ph-microphone text-sm" aria-hidden="true" />
        </span>
      </div>
      <div className="h-6 bg-black flex items-center justify-around text-white/80 text-xs" aria-hidden="true">
        <i className="ph-bold ph-list" />
        <i className="ph-bold ph-circle" />
        <i className="ph-bold ph-caret-left" />
      </div>
    </div>
  );
}

function PhonePreview({ node, botName, platform }: { node: FlowNode | null; botName: string; platform: Platform }) {
  const c = node?.data.config ?? {};
  const t = node?.data.nodeType;
  const body: string = t === "AI_RESPONSE" ? (c.fallbackText || "✨ AI-written reply appears here") : (c.text ?? "");
  const cta = (c.buttons ?? []).filter((b: any) => t === "BUTTONS" || (b.kind ?? "cta") === "cta");
  const url = (c.buttons ?? []).filter((b: any) => b.kind === "url");
  const header = c.header;
  const initial = (botName || "B").trim().charAt(0).toUpperCase();
  const d = DEVICE[platform];

  return (
    <div className={`${d.frame} bg-slate-900 shadow-2xl overflow-hidden flex flex-col`} aria-label={`${platform === "ios" ? "iPhone" : "Android"} WhatsApp preview`}>
      <StatusBar platform={platform} />
      <AppBar platform={platform} botName={botName} initial={initial} />

      {/* Chat */}
      <div
        className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1.5"
        style={{
          backgroundColor: "#efeae2",
          backgroundImage: "radial-gradient(#d6cec4 0.75px, transparent 0.75px), radial-gradient(#d6cec4 0.75px, #efeae2 0.75px)",
          backgroundSize: "24px 24px",
          backgroundPosition: "0 0, 12px 12px",
        }}
      >
        <div className="flex justify-center">
          <span className={`text-[10px] text-slate-500 px-2 py-0.5 shadow-xs ${platform === "ios" ? "bg-white/90 rounded-full" : "bg-white/80 rounded-md"}`}>Today</span>
        </div>
        {!node ? (
          <div className="text-center text-[11px] text-slate-500 mt-10">Select a block to preview it.</div>
        ) : (
          <div className="max-w-[88%] space-y-1">
            <div className={`bg-white ${d.bubble} shadow-xs px-2.5 pt-1.5 pb-1 text-[12px] text-slate-800 leading-snug`}>
              {header?.type === "text" && header.value && <div className="font-bold mb-1">{header.value}</div>}
              {header?.type === "image" && (
                header.value
                  ? <img src={header.value} alt="" className="rounded-md mb-1.5 max-h-32 w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  : <div className="h-20 rounded-md bg-slate-100 mb-1.5 flex items-center justify-center text-slate-400"><i className="ph ph-image text-xl" /></div>
              )}
              {(header?.type === "video" || header?.type === "document") && (
                <div className="h-14 rounded-md bg-slate-100 mb-1.5 flex items-center justify-center gap-1.5 text-slate-500 text-[11px]">
                  <i className={`ph ${header.type === "video" ? "ph-video" : "ph-file-text"} text-lg`} /> {header.type}
                </div>
              )}
              {body ? (
                <div dangerouslySetInnerHTML={{ __html: waHtml(body) }} />
              ) : (
                <div className="italic text-slate-400">No text yet</div>
              )}
              {c.footer && t !== "END" && <div className="text-[10px] text-slate-400 mt-1">{c.footer}</div>}
              <div className="text-[9px] text-slate-400 text-right mt-0.5">{d.time}</div>
              {url.map((b: any) => (
                <div key={b.id} className={`border-t border-slate-100 mt-1 pt-1.5 pb-0.5 text-center text-[12px] ${d.link} font-medium flex items-center justify-center gap-1`}>
                  <i className="ph-bold ph-arrow-square-out text-xs" /> {b.label || "Open link"}
                </div>
              ))}
              {t === "LIST" && (
                <div className={`border-t border-slate-100 mt-1 pt-1.5 pb-0.5 text-center text-[12px] ${d.link} font-medium flex items-center justify-center gap-1`}>
                  <i className="ph-bold ph-list-bullets text-xs" /> {c.buttonText || "View options"}
                </div>
              )}
            </div>
            {cta.map((b: any) => (
              <div key={b.id} className={`bg-white ${platform === "ios" ? "rounded-2xl" : "rounded-lg"} shadow-xs py-1.5 text-center text-[12px] ${d.link} font-medium flex items-center justify-center gap-1`}>
                <i className="ph-bold ph-arrow-bend-up-left text-xs" /> {b.label || "Button"}
              </div>
            ))}
            {t === "LIST" && (c.rows ?? []).length > 0 && (
              <div className={`bg-white/90 ${platform === "ios" ? "rounded-2xl" : "rounded-lg"} shadow-xs px-2.5 py-1.5 mt-1`}>
                <div className="text-[10px] text-slate-400 mb-1">List options</div>
                {(c.rows ?? []).map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between py-1 text-[11px] text-slate-700 border-t border-slate-100 first:border-t-0">
                    <span className="truncate">{r.label || "Option"}</span>
                    <span className="w-3 h-3 rounded-full border border-slate-300 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={platform === "android" ? { backgroundColor: "#efeae2" } : undefined}>
        <Composer platform={platform} placeholder={t === "ASK_INPUT" ? "Type your answer…" : "Message"} />
      </div>
    </div>
  );
}
