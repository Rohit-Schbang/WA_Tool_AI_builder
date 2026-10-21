"use client";

import { api } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

// Connection Health — the live "number status" dashboard a BSP shows
// (Gupshup/Wati): messaging quality rating, code-verification status, and
// display-name approval status, refreshed from Meta. Auto-polls while the tab
// is open and offers a manual refresh.

interface Health {
  connected: boolean;
  status: string;
  phoneNumber: string | null;
  phoneNumberId?: string | null;
  systemUserId?: string | null;
  businessName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  nameStatus: string | null;
  checkedAt: string | null;
  live: boolean;
  error: string | null;
}

const POLL_MS = 60_000; // refresh once a minute while the page is open

// Map Meta's quality rating to a colour + label.
function qualityStyle(q: string | null) {
  switch ((q ?? "").toUpperCase()) {
    case "GREEN":  return { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", label: "High" };
    case "YELLOW": return { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", label: "Medium" };
    case "RED":    return { dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200", label: "Low" };
    default:       return { dot: "bg-slate-300", text: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200", label: "Unknown" };
  }
}

function prettyStatus(s: string | null): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function verificationStyle(s: string | null) {
  const v = (s ?? "").toUpperCase();
  if (v === "VERIFIED" || v === "APPROVED") return "text-emerald-700";
  if (v.includes("PENDING")) return "text-amber-700";
  if (v === "EXPIRED" || v === "DECLINED" || v === "NOT_VERIFIED") return "text-rose-700";
  return "text-slate-600";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export function ConnectionHealth({
  chatbotId,
  onHealth,
}: {
  chatbotId: string;
  // Called with each fresh result so the page's status badges stay in sync.
  onHealth?: (h: Health) => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  // Request failed (network / server) — shown instead of silently vanishing.
  const [loadError, setLoadError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onHealthRef = useRef(onHealth);
  onHealthRef.current = onHealth;

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await api.get(`/api/chatbots/${chatbotId}/connection/health`);
      setHealth(res.data);
      setNotConfigured(false);
      setLoadError("");
      onHealthRef.current?.(res.data);
    } catch (err: any) {
      if (err.response?.status === 404) { setNotConfigured(true); setLoadError(""); }
      // Keep the last good snapshot on screen; just note the failure.
      else setLoadError(err.response?.data?.error ?? "Couldn't refresh number health.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [chatbotId]);

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(), POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const q = qualityStyle(health?.qualityRating ?? null);
  const hasCredentials = !!health?.phoneNumberId || !!health?.connected;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-teal-700">
            <i className="ph-bold ph-heartbeat" aria-hidden="true"></i>
          </div>
          <div>
            <span className="text-sm font-bold text-slate-900">Number Health</span>
            <div className="text-[11px] text-slate-400" aria-live="polite">
              {loading
                ? "Checking with Meta…"
                : notConfigured || !health
                ? "Not available yet"
                : `Updated ${relativeTime(health.checkedAt)}`}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing || loading}
          className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:text-teal-700 hover:border-teal-300 transition flex items-center justify-center disabled:opacity-50"
          title="Refresh now"
        >
          <i className={`ph-bold ph-arrows-clockwise ${refreshing ? "animate-spin" : ""}`} aria-hidden="true"></i>
        </button>
      </div>

      {loading ? (
        <div className="h-24 rounded-xl bg-slate-50 border border-slate-100 animate-pulse" role="status" aria-label="Loading number health" />
      ) : notConfigured || (!health && !loadError) || (health && !hasCredentials) ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs text-slate-500">
          <i className="ph ph-plug text-2xl text-slate-300 block mb-1" aria-hidden="true"></i>
          Connect a WhatsApp number to see its quality rating, verification and display-name status here.
        </div>
      ) : !health ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-xs text-amber-800 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <i className="ph-bold ph-warning-circle" aria-hidden="true"></i>
            {loadError}
          </span>
          <button type="button" onClick={() => load(true)} className="font-semibold underline">Retry</button>
        </div>
      ) : (
        <>
          {/* Phone + connection line */}
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <i className="ph-fill ph-whatsapp-logo text-[#128C7E] text-lg shrink-0" aria-hidden="true"></i>
              <span className="font-semibold text-slate-800 truncate">
                {health?.phoneNumber ?? health?.businessName ?? "WhatsApp number"}
              </span>
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${health?.connected ? "text-emerald-700" : "text-slate-400"}`}>
              <span className={`w-2 h-2 rounded-full ${health?.connected ? "bg-emerald-500" : "bg-slate-400"}`}></span>
              {prettyStatus(health?.status ?? null)}
            </span>
          </div>

          {/* Metric grid */}
          <div className="grid grid-cols-3 gap-2.5">
            {/* Quality */}
            <div className={`p-2.5 rounded-xl border ${q.border} ${q.bg} flex flex-col gap-1`}>
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Quality</span>
              <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${q.text}`}>
                <span className={`w-2 h-2 rounded-full ${q.dot}`}></span>
                {q.label}
              </span>
            </div>
            {/* Verification */}
            <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Verification</span>
              <span className={`text-sm font-bold ${verificationStyle(health?.codeVerificationStatus ?? null)}`}>
                {prettyStatus(health?.codeVerificationStatus ?? null)}
              </span>
            </div>
            {/* Display name */}
            <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Name</span>
              <span className={`text-sm font-bold ${verificationStyle(health?.nameStatus ?? null)}`}>
                {prettyStatus(health?.nameStatus ?? null)}
              </span>
            </div>
          </div>

          {(health.phoneNumberId || health.systemUserId) && (
            <dl className="grid grid-cols-2 gap-2.5 text-[11px]">
              <div className="min-w-0">
                <dt className="text-slate-500">Phone Number ID</dt>
                <dd className="font-mono text-slate-800 truncate">{health.phoneNumberId ?? "—"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-500">System User ID</dt>
                <dd className="font-mono text-slate-800 truncate">{health.systemUserId ?? "—"}</dd>
              </div>
            </dl>
          )}

          {loadError && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
              <i className="ph-bold ph-warning-circle" aria-hidden="true"></i>
              Showing last-known status — {loadError}
            </div>
          )}

          {health?.error && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
              <i className="ph-bold ph-warning-circle" aria-hidden="true"></i>
              Showing last-known status — {health.error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
