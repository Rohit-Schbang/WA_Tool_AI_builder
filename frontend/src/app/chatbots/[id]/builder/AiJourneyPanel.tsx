"use client";

import { api } from "@/lib/api";
import { useRef, useState } from "react";

// AI Journey Generator panel — a floating side chat on the builder canvas.
// Two-phase, agentic: the user describes the journey (and optionally attaches a
// draw.io diagram); the agent first produces a PLAN (ordered stages) which the
// user reviews and APPROVES, then the workflow is built from that approved plan
// and applied to the canvas. Themed to match the app (teal / slate).

interface GeneratedDefinition {
  variables?: any[];
  nodes: any[];
  edges: any[];
}
interface PlanStage { step: number; title: string; nodeType: string; detail: string }

type Phase = "input" | "planning" | "review" | "building";

export function AiJourneyPanel({
  chatbotId,
  onApply,
  hasExistingNodes,
  getCurrentDefinition,
}: {
  chatbotId: string;
  onApply: (def: GeneratedDefinition) => void;
  hasExistingNodes: boolean;
  getCurrentDefinition: () => any;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [phase, setPhase] = useState<Phase>("input");
  const [description, setDescription] = useState("");
  // edit-mode instruction
  const [instruction, setInstruction] = useState("");
  // edit-mode optional anchor: insert/act relative to this node id
  const [anchorNodeId, setAnchorNodeId] = useState("");
  // node options for the anchor dropdown, captured when entering edit mode
  const [nodeOptions, setNodeOptions] = useState<{ id: string; label: string }[]>([]);
  const [drawioName, setDrawioName] = useState<string | null>(null);
  const [drawioXml, setDrawioXml] = useState<string>("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanStage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDrawioXml(String(reader.result ?? ""));
      setDrawioName(file.name);
    };
    reader.readAsText(file);
  }

  function clearFile() {
    setDrawioXml("");
    setDrawioName(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function reset() {
    setPhase("input");
    setPlan([]);
    setInstruction("");
    setAnchorNodeId("");
    setWarnings([]);
    setError("");
  }

  // Fully reset the panel back to its default "Create plan" state, clearing
  // both create- and edit-mode inputs. Called after a successful build.
  function resetAll() {
    reset();
    setDescription("");
    clearFile();
  }

  // Build a friendly, ordered list of the current nodes so the user can pick
  // an anchor ("insert after which node"). START is excluded as an anchor.
  function refreshNodeOptions() {
    try {
      const def = getCurrentDefinition?.();
      const list: any[] = Array.isArray(def?.nodes) ? def.nodes : [];
      const opts = list
        .filter((n) => n?.nodeType !== "START")
        .map((n) => {
          const cfg = n?.config ?? {};
          const label =
            cfg.name || cfg.title || cfg.label || cfg.text || cfg.question || n?.nodeType || n?.id;
          return { id: String(n.id), label: `${String(label).slice(0, 40)} · ${n?.nodeType ?? ""}`.trim() };
        });
      setNodeOptions(opts);
    } catch {
      setNodeOptions([]);
    }
  }

  function switchMode(next: "create" | "edit") {
    setMode(next);
    setError("");
    if (next === "edit") refreshNodeOptions();
  }

  // STEP 1 — ask the agent to PLAN (does not build anything).
  async function createPlan() {
    // Validate the right input per mode.
    if (mode === "edit") {
      if (!instruction.trim()) { setError("Describe the change you want to make."); return; }
    } else if (!description.trim() && !drawioXml.trim()) {
      setError("Describe the journey or attach a draw.io diagram first.");
      return;
    }
    setError("");
    setWarnings([]);
    setPhase("planning");
    try {
      const body: any = mode === "edit"
        ? {
            editInstruction: instruction,
            currentDefinition: getCurrentDefinition(),
            anchorNodeId: anchorNodeId || undefined,
          }
        : { description, drawioXml: drawioXml || undefined };
      const res = await api.post(`/api/chatbots/${chatbotId}/workflow/generate-plan`, body);
      const stages: PlanStage[] = res.data?.plan ?? [];
      if (!stages.length) {
        setError("The AI couldn't produce a plan. Try rephrasing.");
        setPhase("input");
        return;
      }
      setPlan(stages);
      setPhase("review"); // wait for the user to approve
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Failed to plan. Please try again.");
      setPhase("input");
    }
  }

  // STEP 2 — user APPROVED the plan → build the (regenerated) workflow & apply.
  async function buildApproved() {
    if (hasExistingNodes) {
      const ok = window.confirm(
        "This will replace the current flow on the canvas with the generated one. Continue?"
      );
      if (!ok) return;
    }
    setError("");
    setPhase("building");
    try {
      const body: any = mode === "edit"
        ? {
            editInstruction: instruction,
            currentDefinition: getCurrentDefinition(),
            anchorNodeId: anchorNodeId || undefined,
            plan,
          }
        : { description, drawioXml: drawioXml || undefined, plan };
      const res = await api.post(`/api/chatbots/${chatbotId}/workflow/generate`, body);
      const { definition, warnings: warns } = res.data;
      if (!definition) {
        setError("The AI couldn't build a valid journey from the plan. Try editing the instruction.");
        setPhase("review");
        return;
      }
      onApply(definition); // apply the built/patched definition to the canvas
      const warnList = Array.isArray(warns) ? warns : [];
      // Reset the panel to its default "Create plan" state after a successful
      // build, but keep any warnings visible for the user to review.
      resetAll();
      setWarnings(warnList);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Build failed. Please try again.");
      setPhase("review");
    }
  }

  const busy = phase === "planning" || phase === "building";

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-24 z-50 inline-flex items-center gap-2 px-4 h-12 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white shadow-lg shadow-teal-700/25 ring-1 ring-teal-600/30 hover:scale-105 active:scale-95 transition font-semibold text-sm"
          title="Generate a journey with AI"
        >
          <i className="ph-fill ph-sparkle text-lg" />
          AI Generate
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-[420px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col font-sans">
          {/* Header */}
          <div className="bg-gradient-to-r from-teal-800 via-teal-900 to-slate-900 px-4 py-3.5 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="ph-fill ph-sparkle text-lg text-teal-300" />
                <div>
                  <div className="font-semibold text-sm leading-tight">AI Journey Generator</div>
                  <div className="text-[11px] text-white/60">Plan first, then build</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-lg hover:bg-white/15 flex items-center justify-center" title="Close">
                <i className="ph-bold ph-x" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
            {/* Create / Edit mode toggle */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                onClick={() => switchMode("create")}
                disabled={busy}
                className={`flex-1 px-2.5 py-1.5 rounded-md font-semibold transition ${mode === "create" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"}`}
              >
                Create new
              </button>
              <button
                onClick={() => switchMode("edit")}
                disabled={busy || !hasExistingNodes}
                title={!hasExistingNodes ? "Add or generate a flow first" : "Edit the current flow"}
                className={`flex-1 px-2.5 py-1.5 rounded-md font-semibold transition disabled:opacity-40 ${mode === "edit" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"}`}
              >
                Edit current
              </button>
            </div>

            {mode === "edit" ? (
              <>
                <label className="text-xs font-semibold text-slate-700">What should I change?</label>
                <textarea
                  className="w-full min-h-[90px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-y disabled:bg-slate-50"
                  placeholder={"e.g. After the garage-name question, add a step asking for the garage address. And remove the Demo button."}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  disabled={busy}
                />
                {/* Optional anchor — helps the AI place the change in the right
                    spot instead of appending at the end of the flow. */}
                <label className="text-xs font-semibold text-slate-700 mt-1">
                  Apply after which step? <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <select
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 disabled:bg-slate-50"
                  value={anchorNodeId}
                  onChange={(e) => setAnchorNodeId(e.target.value)}
                  disabled={busy || nodeOptions.length === 0}
                >
                  <option value="">Let the AI decide</option>
                  {nodeOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400">
                  The AI reads your current flow and patches in your change — keeping existing steps,
                  ids, and positions. Pick an anchor above to control where it goes, or let the AI place
                  it. Review the plan first, then approve to update the canvas.
                </p>
              </>
            ) : (
            <>
            <label className="text-xs font-semibold text-slate-700">Describe your journey</label>
            <textarea
              className="w-full min-h-[110px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-y disabled:bg-slate-50"
              placeholder={"e.g. Greet the user, ask their name and email (validate the email), then offer Pricing or Demo as buttons. Pricing sends our price list; Demo sends a booking link."}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
            />

            {/* draw.io attach */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">Attach a draw.io diagram (optional)</span>
              {drawioName ? (
                <button onClick={clearFile} disabled={busy} className="text-[11px] text-rose-500 hover:underline disabled:opacity-50">Remove</button>
              ) : (
                <button onClick={() => fileRef.current?.click()} disabled={busy} className="text-[11px] text-teal-700 font-semibold hover:underline flex items-center gap-1 disabled:opacity-50">
                  <i className="ph-bold ph-paperclip" /> Attach
                </button>
              )}
            </div>
            {drawioName && (
              <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                <i className="ph ph-file-code text-slate-400" />
                <span className="truncate">{drawioName}</span>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".drawio,.xml,text/xml,application/xml" className="hidden" onChange={onPickFile} />
            </>
            )}

            {/* Shared status/plan display (both create & edit modes) */}
            {error && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
            )}

            {phase === "planning" && (
              <div className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 flex items-center gap-2">
                <i className="ph ph-spinner animate-spin" /> {mode === "edit" ? "Planning the change…" : "Planning the journey…"}
              </div>
            )}

            {/* Agent plan — shown for review/approval before building */}
            {plan.length > 0 && (
              <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-800 mb-2">
                  <i className="ph-fill ph-list-checks" /> Proposed plan ({plan.length} stages)
                </div>
                <ol className="flex flex-col gap-1.5">
                  {plan.map((s) => (
                    <li key={s.step} className="flex items-start gap-2 text-[11px]">
                      <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-teal-200 text-teal-800 flex items-center justify-center text-[9px] font-bold">
                        {s.step}
                      </span>
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-700">{s.title}</span>
                        <span className="ml-1 text-[10px] text-teal-600 font-mono">{s.nodeType}</span>
                        {s.detail && <div className="text-slate-500 leading-snug">{s.detail}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <div className="font-semibold mb-1">Built &amp; applied — review these:</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {phase === "review" && warnings.length === 0 && plan.length > 0 && (
              <p className="text-[11px] text-slate-400">
                Review the plan above. Approve it to update the canvas — you can still edit everything
                before publishing.
              </p>
            )}
          </div>

          {/* Footer — plan → approve → build, in both create and edit modes */}
          <div className="p-3 border-t border-slate-200 flex items-center justify-end gap-2">
            {phase === "review" ? (
              <>
                <button
                  onClick={reset}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                >
                  Start over
                </button>
                <button
                  onClick={buildApproved}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold shadow-sm active:scale-[0.99] transition"
                >
                  <i className="ph-bold ph-check" /> Approve &amp; {mode === "edit" ? "update" : "build"}
                </button>
              </>
            ) : (
              <button
                onClick={createPlan}
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold shadow-sm active:scale-[0.99] transition disabled:opacity-60"
              >
                <i className={`ph-bold ${busy ? "ph-spinner animate-spin" : "ph-list-checks"}`} />
                {phase === "planning" ? "Planning…" : phase === "building" ? "Building…" : "Create plan"}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
