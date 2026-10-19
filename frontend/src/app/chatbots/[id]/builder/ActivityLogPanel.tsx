"use client";

import { api } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

// User activity log for one bot (who changed what, across versions).
// Viewing requires a special access key, checked on the SERVER
// (x-activity-key header). The key is kept in sessionStorage only, so it's
// forgotten when the tab closes.

interface Entry {
  id: string;
  userEmail: string | null;
  action: string;
  chatbotId: string | null;
  version: number | null;
  details: any;
  createdAt: string;
}

const KEY_STORAGE = "pf-activity-key";

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
  const [key, setKey] = useState<string>(() =>
    typeof window !== "undefined" ? sessionStorage.getItem(KEY_STORAGE) ?? "" : ""
  );
  const [keyDraft, setKeyDraft] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (k: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/api/activity`, {
        params: { chatbotId, limit: 100 },
        headers: { "x-activity-key": k },
      });
      setEntries(res.data?.entries ?? []);
      sessionStorage.setItem(KEY_STORAGE, k);
      setKey(k);
    } catch (err: any) {
      const status = err.response?.status;
      setEntries(null);
      if (status === 403) { sessionStorage.removeItem(KEY_STORAGE); setKey(""); }
      setError(err.response?.data?.error ?? "Couldn't load the activity log.");
    } finally {
      setLoading(false);
    }
  }, [chatbotId]);

  useEffect(() => { if (key) load(key); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            <p className="text-xs text-slate-500 mt-0.5">Who changed this bot, and when. Requires an access key.</p>
          </div>
          <div className="flex items-center gap-1">
            {key && (
              <button
                onClick={() => { sessionStorage.removeItem(KEY_STORAGE); setKey(""); setEntries(null); }}
                className="text-[11px] text-slate-500 hover:text-slate-800 px-2 py-1"
              >
                Lock
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400" aria-label="Close activity log">
              <i className="ph-bold ph-x text-sm" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!key || !entries ? (
            <form
              onSubmit={(e) => { e.preventDefault(); if (keyDraft.trim()) load(keyDraft.trim()); }}
              className="flex flex-col gap-3 max-w-sm mx-auto py-6"
            >
              <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center self-center">
                <i className="ph-bold ph-lock-key text-xl" />
              </div>
              <label htmlFor="activity-key" className="text-xs font-semibold text-slate-700">Access key</label>
              <input
                id="activity-key"
                type="password"
                autoComplete="off"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                placeholder="Enter the activity access key"
              />
              {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={loading || !keyDraft.trim()}
                className="h-10 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold disabled:opacity-60"
              >
                {loading ? "Checking…" : "View activity"}
              </button>
            </form>
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
