"use client";

import { api } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import { FidelityReport, type FidelityReportData } from "./FidelityReport";
import { dialog } from "@/app/components/Dialog";

// Saved AI build reports for this bot. Each AI (draw.io) build stores its
// verification report on the server; this popup lists them so the creator
// can re-open one as a summary while finishing the journey, or delete it.

interface ReportMeta {
  id: string;
  title: string;
  status: FidelityReportData["status"];
  createdAt: string;
  createdByEmail: string | null;
}

const STATUS_PILL: Record<string, string> = {
  passed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  not_tested: "bg-slate-50 text-slate-600 border-slate-200",
};
const STATUS_LABEL: Record<string, string> = {
  passed: "Passed", warning: "Warning", failed: "Failed", not_tested: "Not tested",
};

export function ReportsPanel({
  chatbotId,
  onClose,
  onFocusNode,
  onCountChange,
}: {
  chatbotId: string;
  onClose: () => void;
  onFocusNode?: (id: string) => void;
  onCountChange?: (n: number) => void;
}) {
  const [list, setList] = useState<ReportMeta[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<FidelityReportData | null>(null);
  const [opening, setOpening] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get(`/api/chatbots/${chatbotId}/workflow/reports`);
      const reports: ReportMeta[] = res.data?.reports ?? [];
      setList(reports);
      onCountChange?.(reports.length);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Couldn't load reports.");
    }
  }, [chatbotId, onCountChange]);

  useEffect(() => { load(); }, [load]);

  // Close on Escape (detail view first, then the panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openId) { setOpenId(null); setOpenReport(null); } else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, onClose]);

  async function open(id: string) {
    setOpenId(id);
    setOpenReport(null);
    setOpening(true);
    setError("");
    try {
      const res = await api.get(`/api/chatbots/${chatbotId}/workflow/reports/${id}`);
      setOpenReport(res.data?.report ?? null);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Couldn't open this report.");
      setOpenId(null);
    } finally {
      setOpening(false);
    }
  }

  async function remove(id: string) {
    if (!(await dialog.confirm({ title: "Delete this report?", message: "This can't be undone.", danger: true }))) return;
    setDeletingId(id);
    try {
      await api.delete(`/api/chatbots/${chatbotId}/workflow/reports/${id}`);
      if (openId === id) { setOpenId(null); setOpenReport(null); }
      const next = (list ?? []).filter((r) => r.id !== id);
      setList(next);
      onCountChange?.(next.length);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Couldn't delete the report.");
    } finally {
      setDeletingId(null);
    }
  }

  const current = list?.find((r) => r.id === openId);

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl w-[620px] max-w-full max-h-[80vh] overflow-hidden flex flex-col font-sans"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reports-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            {openId && (
              <button
                onClick={() => { setOpenId(null); setOpenReport(null); }}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
                aria-label="Back to all reports"
              >
                <i className="ph-bold ph-arrow-left text-sm" />
              </button>
            )}
            <div className="min-w-0">
              <h3 id="reports-title" className="text-lg font-bold text-slate-900 truncate">
                {openId ? current?.title ?? "Report" : "AI build reports"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {openId && current
                  ? `${new Date(current.createdAt).toLocaleString()}${current.createdByEmail ? ` · ${current.createdByEmail}` : ""}`
                  : "Verification summaries from AI builds. Use them as a checklist while you finish the journey."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {openId && (
              <button
                onClick={() => remove(openId)}
                disabled={deletingId === openId}
                className="px-2.5 h-8 rounded-lg border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-600 hover:bg-rose-100 flex items-center gap-1.5 disabled:opacity-60"
              >
                <i className="ph-bold ph-trash text-xs" /> Delete
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400" aria-label="Close reports">
              <i className="ph-bold ph-x text-sm" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <p role="alert" className="mb-3 text-xs text-rose-600">{error}</p>}

          {openId ? (
            opening || !openReport ? (
              <p className="text-center text-xs text-slate-500 py-10">Loading report…</p>
            ) : (
              <FidelityReport
                report={openReport}
                onFocusNode={onFocusNode ? (id) => { onFocusNode(id); onClose(); } : undefined}
              />
            )
          ) : !list ? (
            <p className="text-center text-xs text-slate-500 py-10">Loading…</p>
          ) : list.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              <i className="ph ph-seal-check text-3xl text-slate-300 block mb-2" aria-hidden="true" />
              No reports yet. Build a journey from a draw.io file with AI Generate and its report is saved here.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-teal-300 transition">
                  <button onClick={() => open(r.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 truncate">{r.title}</span>
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${STATUS_PILL[r.status] ?? STATUS_PILL.not_tested}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {new Date(r.createdAt).toLocaleString()}{r.createdByEmail ? ` · ${r.createdByEmail}` : ""}
                    </div>
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    disabled={deletingId === r.id}
                    className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center disabled:opacity-50"
                    aria-label={`Delete report ${r.title}`}
                    title="Delete report"
                  >
                    <i className="ph-bold ph-trash text-sm" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
