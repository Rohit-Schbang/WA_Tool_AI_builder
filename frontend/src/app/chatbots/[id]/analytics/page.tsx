"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { Sidebar } from "@/app/components/Sidebar";

interface Conversation {
  id: string;
  waUserId: string;
  status: string;
  variables: Record<string, any>;
  lastMessageAt: string | null;
  createdAt: string;
}

// Local day key (YYYY-MM-DD) for grouping.
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function AnalyticsPage() {
  const router = useRouter();
  const params = useParams();
  const chatbotId = params.id as string;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api
      .get(`/api/chatbots/${chatbotId}/conversations`)
      .then((res) => setConversations(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Derived analytics (all from real conversation data) ----
  const stats = useMemo(() => {
    const total = conversations.length;
    const completed = conversations.filter((c) => c.status === "COMPLETED").length;
    const waiting = conversations.filter((c) => c.status === "WAITING_FOR_INPUT" || c.status === "WAITING").length;
    const failed = conversations.filter((c) => c.status === "FAILED" || c.status === "FAILED_VALIDATION").length;
    const active = conversations.filter((c) => c.status === "ACTIVE").length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, waiting, failed, active, completionRate };
  }, [conversations]);

  // Runs per day over the last 14 days (real timestamps).
  const daily = useMemo(() => {
    const days: { key: string; count: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ key, count: 0 });
    }
    const index = new Map(days.map((d, i) => [d.key, i]));
    for (const c of conversations) {
      const k = dayKey(c.lastMessageAt ?? c.createdAt);
      const i = index.get(k);
      if (i !== undefined) days[i].count += 1;
    }
    return days;
  }, [conversations]);

  const maxDaily = Math.max(1, ...daily.map((d) => d.count));

  // Status breakdown for a simple distribution bar.
  const breakdown = useMemo(() => {
    const items = [
      { label: "Completed", value: stats.completed, color: "bg-emerald-500", text: "text-emerald-700" },
      { label: "Waiting", value: stats.waiting, color: "bg-amber-500", text: "text-amber-700" },
      { label: "Active", value: stats.active, color: "bg-teal-500", text: "text-teal-700" },
      { label: "Failed", value: stats.failed, color: "bg-rose-500", text: "text-rose-700" },
    ];
    return items.filter((i) => i.value > 0);
  }, [stats]);

  const statCards = [
    { label: "Total Runs", value: stats.total.toLocaleString(), tone: "text-slate-900", border: "border-slate-200/90", bg: "" },
    { label: "Completion Rate", value: `${stats.completionRate}%`, tone: "text-teal-800", border: "border-teal-200/80", bg: "" },
    { label: "Waiting For Input", value: String(stats.waiting), tone: "text-amber-900", border: "border-amber-200/80", bg: "bg-amber-50/20" },
    { label: "Failed / Expired", value: String(stats.failed), tone: "text-slate-800", border: "border-slate-200/90", bg: "" },
  ];

  return (
    <div className="h-screen bg-[#f8f9ff] text-slate-800 overflow-hidden pl-72">
      {/* Shared workspace sidebar */}
      <Sidebar />

      {/* ======================= MAIN CONTENT WRAPPER ======================= */}
      <div className="h-full flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-16 border-b border-slate-200/80 bg-white/95 backdrop-blur px-6 flex items-center justify-between z-10">
          <nav className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Link href="/chatbots" className="hover:text-slate-800 transition-colors">
              Workflows &amp; Bots
            </Link>
            <span>/</span>
            <span className="text-slate-700 font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-teal-500"></span>
              Analytics
            </span>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href={`/chatbots/${chatbotId}/conversation`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-sm transition-all"
            >
              <i className="ph ph-chats-circle text-slate-500" aria-hidden="true"></i>
              Chats Log
            </Link>
            <Link
              href={`/chatbots/${chatbotId}/builder`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow-sm shadow-teal-700/20 transition-all"
            >
              <i className="ph-bold ph-arrow-left" aria-hidden="true"></i>
              Back to Builder
            </Link>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-[#f8f9ff] px-6 py-6">
          {/* Header */}
          <div className="mb-6">
            <Link
              href="/chatbots"
              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 transition-colors w-fit"
            >
              <i className="ph-bold ph-arrow-left" aria-hidden="true"></i>
              Back to chatbots
            </Link>
            <div className="flex items-center gap-2.5 mt-1 flex-wrap">
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-none">Analytics</h1>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-mono">
                Bot ID: #{chatbotId.slice(0, 8)}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Conversation volume, completion rate, and session outcomes for this WhatsApp journey.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <span className="loading loading-spinner loading-lg text-teal-600"></span>
            </div>
          ) : error ? (
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-10 text-center text-slate-500">
              Couldn&apos;t load analytics data.
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {statCards.map((s) => (
                  <div key={s.label} className={`bg-white rounded-xl border ${s.border} ${s.bg} p-4 shadow-sm`}>
                    <p className="text-[11px] font-semibold tracking-wider uppercase text-slate-400">{s.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${s.tone}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Runs over time */}
                <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Conversation Volume</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Sessions per day over the last 14 days.</p>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Last 14 days</span>
                  </div>

                  {stats.total === 0 ? (
                    <div className="py-14 text-center text-sm text-slate-400">
                      No conversations yet. Data appears once users message your published bot.
                    </div>
                  ) : (
                    <div className="flex items-end gap-2 h-48">
                      {daily.map((d) => (
                        <div key={d.key} className="flex-1 flex flex-col items-center gap-1.5 group">
                          <div className="w-full flex items-end justify-center h-40">
                            <div
                              className="w-full max-w-[26px] rounded-t-md bg-teal-500/25 group-hover:bg-teal-500 transition-all relative"
                              style={{ height: `${Math.max(4, (d.count / maxDaily) * 100)}%` }}
                              title={`${d.count} on ${shortDay(d.key)}`}
                            >
                              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-slate-600 opacity-0 group-hover:opacity-100 transition">
                                {d.count}
                              </span>
                            </div>
                          </div>
                          <span className="text-[9px] text-slate-400 font-mono whitespace-nowrap">{shortDay(d.key)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Outcome breakdown */}
                <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 flex flex-col gap-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Session Outcomes</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Distribution by status.</p>
                  </div>

                  {stats.total === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-400">No data yet.</div>
                  ) : (
                    <>
                      {/* Distribution bar */}
                      <div className="w-full h-3 rounded-full overflow-hidden flex bg-slate-100">
                        {breakdown.map((b) => (
                          <div
                            key={b.label}
                            className={b.color}
                            style={{ width: `${(b.value / stats.total) * 100}%` }}
                            title={`${b.label}: ${b.value}`}
                          />
                        ))}
                      </div>

                      <div className="flex flex-col gap-2.5">
                        {breakdown.map((b) => (
                          <div key={b.label} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${b.color}`}></span>
                              <span className="text-slate-600">{b.label}</span>
                            </span>
                            <span className={`font-semibold ${b.text}`}>
                              {b.value}
                              <span className="text-slate-400 font-normal ml-1">
                                ({Math.round((b.value / stats.total) * 100)}%)
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
