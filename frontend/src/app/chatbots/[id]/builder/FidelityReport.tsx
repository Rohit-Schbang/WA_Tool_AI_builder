"use client";

import { useState } from "react";

// Verification report for a journey generated from a draw.io file.
// Mirrors backend/src/modules/workflows/fidelity.ts (FidelityReport).

type Status = "passed" | "warning" | "failed" | "not_tested";

export interface FidelityReportData {
  status: Status;
  summary: {
    sourceShapes: number;
    sourceConnections: number;
    mappedShapes: number;
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
  items: { category: string; status: Status; message: string; nodeId?: string; sourceIds?: string[] }[];
  mapping: { nodeId: string; nodeType: string; title: string; drawioIds: string[]; labels: string[]; confidence: string; ambiguity?: string }[];
  skipped: { drawioId: string; label: string; reason: string }[];
  corrections: string[];
  manualActions: string[];
}

const STATUS_STYLE: Record<Status, { label: string; cls: string; icon: string }> = {
  passed: { label: "Passed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "ph-check-circle" },
  warning: { label: "Warning", cls: "bg-amber-50 text-amber-800 border-amber-200", icon: "ph-warning" },
  failed: { label: "Failed", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: "ph-x-circle" },
  not_tested: { label: "Not tested", cls: "bg-slate-50 text-slate-600 border-slate-200", icon: "ph-minus-circle" },
};

const ORDER: Status[] = ["failed", "warning", "not_tested", "passed"];

function Stat({ label, done, total }: { label: string; done: number; total: number }) {
  const ok = total === 0 || done === total;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm font-bold ${ok ? "text-slate-800" : "text-rose-700"}`}>
        {total === 0 ? "—" : `${done}/${total}`}
      </div>
    </div>
  );
}

export function FidelityReport({ report, onFocusNode }: { report: FidelityReportData; onFocusNode?: (id: string) => void }) {
  const [showPassed, setShowPassed] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const s = report.summary;
  const st = STATUS_STYLE[report.status];
  const items = [...report.items].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const visible = items.filter((i) => showPassed || i.status !== "passed");
  const counts = ORDER.map((k) => [k, report.items.filter((i) => i.status === k).length] as const);

  return (
    <section aria-labelledby="fidelity-title" className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 id="fidelity-title" className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <i className="ph-bold ph-seal-check text-teal-700" aria-hidden="true" /> Diagram verification
        </h3>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${st.cls}`}>
          <i className={`ph-bold ${st.icon}`} aria-hidden="true" /> {st.label}
        </span>
      </div>

      <p className="text-[11px] text-slate-600 leading-snug">
        {s.mappedShapes}/{s.sourceShapes} diagram shapes accounted for ({s.skippedShapes} not bot steps) →{" "}
        <b>{s.nodesCreated}</b> blocks.
        {s.repairAttempts > 0 && ` ${s.repairAttempts} automatic repair pass${s.repairAttempts > 1 ? "es" : ""}.`}
      </p>

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Connections" done={s.connectionsVerified} total={s.connectionsTotal} />
        <Stat label="Messages" done={s.messagesVerified} total={s.messagesTotal} />
        <Stat label="Questions" done={s.questionsVerified} total={s.questionsTotal} />
        <Stat label="Branches" done={s.branchesVerified} total={s.branchesTotal} />
        <Stat label="Events" done={s.eventsVerified} total={s.eventsTotal} />
        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Sim. tests</div>
          <div className="text-sm font-bold text-slate-800">
            <span className={s.testsFailed ? "text-rose-700" : ""}>{s.testsPassed}✓</span>
            {s.testsFailed > 0 && <span className="text-rose-700"> {s.testsFailed}✗</span>}
            {s.testsNotRun > 0 && <span className="text-slate-400 font-medium text-xs"> {s.testsNotRun} n/t</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {counts.map(([k, n]) => (
          <span key={k} className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${STATUS_STYLE[k].cls}`}>
            {STATUS_STYLE[k].label}: {n}
          </span>
        ))}
      </div>

      {report.manualActions.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
          <div className="text-[11px] font-semibold text-amber-800 mb-1">Before this journey is ready</div>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-800">
            {report.manualActions.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <ul className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1" aria-label="Verification checks">
        {visible.map((it, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px]">
            <i className={`ph-bold ${STATUS_STYLE[it.status].icon} mt-0.5 ${it.status === "failed" ? "text-rose-600" : it.status === "warning" ? "text-amber-600" : it.status === "passed" ? "text-emerald-600" : "text-slate-400"}`} aria-hidden="true" />
            <span className="sr-only">{STATUS_STYLE[it.status].label}:</span>
            <span className="text-slate-700 leading-snug">
              <span className="text-slate-400">[{it.category}]</span> {it.message}
              {it.nodeId && onFocusNode && (
                <button type="button" onClick={() => onFocusNode(it.nodeId!)} className="ml-1 text-teal-700 hover:underline">
                  show
                </button>
              )}
            </span>
          </li>
        ))}
        {visible.length === 0 && <li className="text-[11px] text-slate-500">No problems found.</li>}
      </ul>

      <div className="flex items-center gap-3 text-[11px]">
        <button type="button" onClick={() => setShowPassed((v) => !v)} className="text-teal-700 hover:underline">
          {showPassed ? "Hide passed checks" : `Show passed checks (${report.items.filter((i) => i.status === "passed").length})`}
        </button>
        <button type="button" onClick={() => setShowMap((v) => !v)} className="text-teal-700 hover:underline">
          {showMap ? "Hide source mapping" : "Show source mapping"}
        </button>
      </div>

      {showMap && (
        <div className="max-h-56 overflow-y-auto border-t border-slate-200 pt-2">
          <table className="w-full text-[10px]">
            <caption className="sr-only">Diagram shape to block mapping</caption>
            <thead>
              <tr className="text-left text-slate-400">
                <th scope="col" className="font-semibold pb-1">Block</th>
                <th scope="col" className="font-semibold pb-1">From diagram</th>
                <th scope="col" className="font-semibold pb-1">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {report.mapping.map((m) => (
                <tr key={m.nodeId} className="align-top border-t border-slate-100">
                  <td className="py-1 pr-2 text-slate-700"><b>{m.title}</b><div className="font-mono text-slate-400">{m.nodeType}</div></td>
                  <td className="py-1 pr-2 text-slate-600">{m.labels.join(" · ") || "—"}{m.ambiguity && <div className="text-amber-700">{m.ambiguity}</div>}</td>
                  <td className="py-1 text-slate-600">{m.confidence}</td>
                </tr>
              ))}
              {report.skipped.map((k) => (
                <tr key={k.drawioId} className="align-top border-t border-slate-100 text-slate-400">
                  <td className="py-1 pr-2 line-through">{k.label}</td>
                  <td className="py-1 pr-2" colSpan={2}>Not a bot step — {k.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.corrections.length > 0 && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer">Automatic corrections ({report.corrections.length})</summary>
          <ul className="list-disc pl-4 mt-1 space-y-0.5">
            {report.corrections.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
