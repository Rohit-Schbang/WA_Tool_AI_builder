"use client";

import { api } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

// User activity log for one bot (who changed what, across versions).
// Visible to any signed-in user.

interface Entry {
  id: string;
  userEmail: string | null;
  action: string;
  chatbotId: string | null;
  version: number | null;
  details: any;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  "chatbot.create": "Created the bot",
  "chatbot.rename": "Renamed the bot",
  "chatbot.activate": "Activated the bot",
  "chatbot.deactivate": "Deactivated the bot",
  "chatbot.delete": "Deleted the bot",
  "workflow.save": "Edited the draft",
  "workflow.publish": "Published",
  "workflow.activate_version": "Made a version live",
  "workflow.restore_version": "Restored a version to the editor",
  "workflow.ai_generate": "Generated a flow with AI",
  "connection.update": "Updated WhatsApp settings",
  "connection.embedded_signup": "Connected to Meta",
};

function describe(e: Entry): string {
  const d = e.details ?? {};
  if (e.action === "chatbot.rename" && d.to) return `“${d.from ?? "?"}” → “${d.to}”`;
  if (e.action === "workflow.ai_generate") return `${d.mode === "edit" ? "Edit" : "Create"} · ${d.nodes ?? 0} nodes${d.usedDrawio ? " · from draw.io" : ""}`;
  if (e.action === "workflow.save" && d.nodes != null) return `${d.nodes} nodes`;
  if (e.action === "connection.update" && Array.isArray(d.fields)) return `Fields: ${d.fields.join(", ") || "—"} · ${d.status ?? ""}`;
  return "";
}

export function ActivityLogPanel({ chatbotId, onClose }: { chatbotId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/api/activity`, { params: { chatbotId, limit: 100 } });
      setEntries(res.data?.entries ?? []);
    } catch (err: any) {
      setEntries(null);
      setError(err.response?.data?.error ?? "Couldn't load the activity log.");
    } finally {
      setLoading(false);
    }
  }, [chatbotId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl w-[620px] max-w-full max-h-[80vh] overflow-hidden flex flex-col font-sans"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 id="activity-title" className="text-lg font-bold text-slate-900">Activity log</h3>
            <p className="text-xs text-slate-500 mt-0.5">Who changed this bot, and when.</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              disabled={loading}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 disabled:opacity-50"
              aria-label="Refresh activity log"
            >
              <i className={`ph-bold ph-arrow-clockwise text-sm ${loading ? "animate-spin" : ""}`} />
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400" aria-label="Close activity log">
              <i className="ph-bold ph-x text-sm" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <p role="alert" className="text-center text-xs text-rose-600 py-10">{error}</p>
          ) : !entries ? (
            <p className="text-center text-xs text-slate-500 py-10">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-center text-xs text-slate-500 py-10">No activity recorded for this bot yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {entries.map((e) => (
                <li key={e.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200">
                  <i className="ph-bold ph-user-circle text-lg text-slate-400 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800">
                      <span className="font-semibold">{e.userEmail ?? "Unknown user"}</span>{" "}
                      {ACTION_LABEL[e.action] ?? e.action}
                      {e.version != null && e.version > 0 && <span className="ml-1 font-mono text-xs text-teal-700">v{e.version}</span>}
                    </div>
                    {describe(e) && <div className="text-xs text-slate-500 mt-0.5">{describe(e)}</div>}
                  </div>
                  <time className="text-[11px] text-slate-400 shrink-0" dateTime={e.createdAt}>
                    {new Date(e.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
