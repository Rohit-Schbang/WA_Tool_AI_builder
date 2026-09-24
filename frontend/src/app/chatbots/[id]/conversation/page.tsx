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

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  messageType: string;
  content: any;
  createdAt: string;
}

// ---- Small display helpers (presentation only) ----------------------------

// Compact relative time like "2m ago", "1h 12m ago", "3h ago".
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function clockTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fullTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Two-letter initials from a wa user id / name.
function initials(id: string): string {
  const clean = (id || "").replace(/[^a-zA-Z0-9]/g, "");
  return (clean.slice(0, 2) || "??").toUpperCase();
}

// Status → pill styling. Unknown statuses fall back to slate.
function statusPill(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "WAITING_FOR_INPUT":
    case "WAITING":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "FAILED":
    case "FAILED_VALIDATION":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "ACTIVE":
      return "bg-teal-50 text-teal-700 border-teal-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

export default function ConversationsPage() {
  const router = useRouter();
  const params = useParams();
  const chatbotId = params.id as string;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [botName, setBotName] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api
      .get(`/api/chatbots/${chatbotId}/conversations`)
      .then((res) => setConversations(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Fetch the chatbot's name for the page header.
    api
      .get(`/api/chatbots/${chatbotId}`)
      .then((res) => setBotName(res.data.name ?? ""))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load messages when a conversation is selected.
  async function openConversation(id: string) {
    setSelectedId(id);
    setMsgLoading(true);
    try {
      const res = await api.get(`/api/chatbots/${chatbotId}/conversations/${id}`);
      setMessages(res.data.messages ?? []);
    } catch {
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  }

  const selected = conversations.find((c) => c.id === selectedId);

  // ---- Derived stats (real data) ----
  const stats = useMemo(() => {
    const total = conversations.length;
    const waiting = conversations.filter((c) => c.status === "WAITING_FOR_INPUT" || c.status === "WAITING").length;
    const completed = conversations.filter((c) => c.status === "COMPLETED").length;
    const failed = conversations.filter((c) => c.status === "FAILED" || c.status === "FAILED_VALIDATION").length;
    return { total, waiting, completed, failed };
  }, [conversations]);

  // ---- Filtered + searched list ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (statusFilter === "WAITING" && !(c.status === "WAITING_FOR_INPUT" || c.status === "WAITING")) return false;
      if (statusFilter === "COMPLETED" && c.status !== "COMPLETED") return false;
      if (statusFilter === "FAILED" && !(c.status === "FAILED" || c.status === "FAILED_VALIDATION")) return false;
      if (!q) return true;
      return c.waUserId.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    });
  }, [conversations, search, statusFilter]);

  const selectedVarEntries = Object.entries(selected?.variables ?? {}).filter(([k]) => !k.startsWith("__"));

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
              {botName || "Conversations"}
            </span>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href={`/chatbots/${chatbotId}/builder`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow-sm shadow-teal-700/20 transition-all"
            >
              <i className="ph-bold ph-arrow-left" aria-hidden="true"></i>
              Back to Builder
            </Link>
          </div>
        </header>

        {/* Scrollable main */}
        <main className="flex-1 flex flex-col min-h-0 bg-[#f8f9ff] px-6 py-4 overflow-hidden">
          {/* Header + stats */}
          <section className="mb-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2 flex-wrap">
                  {botName ? (
                    <span className="text-teal-700">{botName}</span>
                  ) : (
                    "Conversations & Logs"
                  )}
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono">
                    Bot ID: #{chatbotId.slice(0, 8)}
                  </span>
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {botName ? "Conversations & logs · " : ""}Session history, collected variables, and message logs for this WhatsApp journey.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-sm">
                <p className="text-[11px] font-semibold tracking-wider uppercase text-slate-400">Total Runs</p>
                <p className="text-xl font-bold text-slate-900 mt-0.5">{stats.total.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-xl border border-amber-200/80 bg-amber-50/20 p-3 shadow-sm">
                <p className="text-[11px] font-semibold tracking-wider uppercase text-amber-700">Waiting For Input</p>
                <p className="text-xl font-bold text-amber-900 mt-0.5">{stats.waiting}</p>
              </div>
              <div className="bg-white rounded-xl border border-emerald-200/80 p-3 shadow-sm">
                <p className="text-[11px] font-semibold tracking-wider uppercase text-emerald-700">Completed</p>
                <p className="text-xl font-bold text-emerald-950 mt-0.5">{stats.completed}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-sm">
                <p className="text-[11px] font-semibold tracking-wider uppercase text-slate-500">Failed / Expired</p>
                <p className="text-xl font-bold text-slate-800 mt-0.5">{stats.failed}</p>
              </div>
            </div>
          </section>

          {/* Two-column workspace */}
          <section className="flex-1 grid grid-cols-12 gap-4 min-h-0">
            {/* LEFT: session list */}
            <div className="col-span-12 lg:col-span-5 xl:col-span-4 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col min-h-0 overflow-hidden">
              <div className="p-3 border-b border-slate-200/80 bg-white">
                <div className="relative">
                  <i className="ph ph-magnifying-glass text-slate-400 absolute left-3 top-2 text-base" aria-hidden="true"></i>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-600 focus:border-teal-600 placeholder-slate-400"
                    placeholder="Search by session ID or user..."
                    type="text"
                  />
                </div>

                <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-0.5 text-xs">
                  {[
                    { key: "ALL", label: `All (${stats.total})` },
                    { key: "WAITING", label: `Waiting (${stats.waiting})` },
                    { key: "COMPLETED", label: "Completed" },
                    { key: "FAILED", label: "Failed" },
                  ].map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setStatusFilter(t.key)}
                      className={`px-2.5 py-1 rounded-md font-semibold text-[11px] whitespace-nowrap transition ${
                        statusFilter === t.key
                          ? "bg-teal-800 text-white shadow-sm"
                          : "bg-slate-100 hover:bg-slate-200/80 text-slate-700"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loading ? (
                  <div className="flex justify-center py-16">
                    <span className="loading loading-spinner loading-md text-teal-600"></span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-16 px-4">
                    <div className="text-3xl mb-2">📭</div>
                    <h3 className="font-semibold text-slate-700 text-sm">No conversations</h3>
                    <p className="text-slate-500 text-xs mt-1">
                      They appear here once users message your published bot.
                    </p>
                  </div>
                ) : (
                  filtered.map((c) => {
                    const active = selectedId === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => openConversation(c.id)}
                        className={`w-full text-left p-3 rounded-xl cursor-pointer transition-all ${
                          active
                            ? "border-2 border-teal-600 bg-teal-50/40 shadow-sm"
                            : "border border-transparent hover:border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`font-mono text-xs font-bold truncate ${active ? "text-teal-950" : "text-slate-800"}`}>
                              {c.waUserId}
                            </span>
                            {active && <span className="w-2 h-2 rounded-full bg-teal-600 shrink-0"></span>}
                          </div>
                          <span
                            className={`text-[10px] font-mono font-bold tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${statusPill(
                              c.status
                            )}`}
                          >
                            {c.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-2 text-xs text-slate-600">
                          <div className="flex items-center gap-1.5 font-medium min-w-0">
                            <i className="ph ph-user text-slate-400" aria-hidden="true"></i>
                            <span className="truncate">{c.waUserId}</span>
                          </div>
                          <span className="text-[11px] text-slate-400 shrink-0 ml-2">
                            {timeAgo(c.lastMessageAt ?? c.createdAt)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT: transcript */}
            <div className="col-span-12 lg:col-span-7 xl:col-span-8 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col min-h-0 overflow-hidden">
              {!selected ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <div className="w-14 h-14 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 mb-3">
                    <i className="ph ph-chat-circle-dots text-2xl" aria-hidden="true"></i>
                  </div>
                  <h3 className="font-semibold text-slate-700">Select a conversation</h3>
                  <p className="text-slate-500 text-sm mt-1">
                    Pick a session on the left to view its transcript and collected variables.
                  </p>
                </div>
              ) : (
                <>
                  {/* Detail header */}
                  <div className="p-4 border-b border-slate-200/80 bg-white flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
                        <i className="ph ph-chat-circle-dots text-xl" aria-hidden="true"></i>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="font-mono text-sm font-bold text-slate-900 tracking-tight truncate">
                            {selected.waUserId}
                          </h2>
                          <span
                            className={`text-[11px] font-mono font-bold tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${statusPill(
                              selected.status
                            )}`}
                          >
                            {selected.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Initiated: <strong>{fullTime(selected.createdAt)}</strong>
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => openConversation(selected.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
                      title="Refresh transcript"
                    >
                      <i className="ph ph-arrows-clockwise text-slate-500" aria-hidden="true"></i>
                      Refresh
                    </button>
                  </div>

                  {/* Variables strip */}
                  <div className="bg-slate-50/80 px-4 py-2.5 border-b border-slate-200/80 flex items-center gap-2 flex-wrap overflow-x-auto text-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <i className="ph ph-database text-slate-400" aria-hidden="true"></i>
                      Variables:
                    </span>
                    {selectedVarEntries.length === 0 ? (
                      <span className="text-slate-400 italic text-[11px]">none collected yet</span>
                    ) : (
                      selectedVarEntries.map(([k, v]) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 font-mono text-[11px] text-slate-700 shadow-sm"
                        >
                          <span className="text-teal-700 font-medium">{k}:</span>
                          <strong className="font-semibold">{String(v)}</strong>
                        </span>
                      ))
                    )}
                  </div>

                  {/* Transcript */}
                  <div className="flex-1 overflow-y-auto p-5 pf-convo-canvas relative space-y-2.5">
                    <div className="absolute inset-0 opacity-[0.04] pointer-events-none pf-convo-dots"></div>

                    {msgLoading ? (
                      <div className="flex justify-center py-16 relative z-10">
                        <span className="loading loading-spinner loading-md text-teal-600"></span>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="text-center text-slate-400 text-sm py-16 relative z-10">
                        No messages logged for this session yet.
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-center my-2 relative z-10">
                          <span className="px-3 py-1 rounded-full bg-white/90 backdrop-blur shadow-sm border border-slate-200/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                            {fullTime(messages[0]?.createdAt ?? selected.createdAt)}
                          </span>
                        </div>

                        {messages.map((m) =>
                          m.direction === "INBOUND" ? (
                            <div key={m.id} className="flex items-center gap-2 relative z-10">
                              <div className="w-7 h-7 rounded-full bg-slate-300 text-slate-700 font-bold text-[10px] flex items-center justify-center shrink-0 self-start mt-0.5">
                                {initials(selected.waUserId)}
                              </div>
                              <div className="relative bg-white text-slate-900 rounded-2xl rounded-tl-sm px-3.5 py-2 shadow-sm border border-slate-200/70 pf-bubble-in max-w-[75%]">
                                <div className="flex items-end gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-slate-800 whitespace-pre-line break-words">
                                    {m.content?.text ?? JSON.stringify(m.content)}
                                  </p>
                                  <span className="text-[10px] text-slate-400 leading-none shrink-0 ml-auto">
                                    {clockTime(m.createdAt)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div key={m.id} className="flex justify-end relative z-10">
                              <div className="relative bg-[#005c4b] text-white rounded-2xl rounded-tr-sm px-3.5 py-2 shadow-sm pf-bubble-out max-w-[75%]">
                                <div className="flex items-end gap-2 flex-wrap">
                                  <p className="text-sm font-normal leading-relaxed text-emerald-50 whitespace-pre-line break-words">
                                    {m.content?.text ?? JSON.stringify(m.content)}
                                  </p>
                                  <span className="flex items-center gap-1 text-[10px] text-emerald-200/80 leading-none shrink-0 ml-auto">
                                    {clockTime(m.createdAt)}
                                    <i className="ph-bold ph-checks text-teal-200" aria-hidden="true"></i>
                                  </span>
                                </div>
                              </div>
                            </div>
                          )
                        )}

                        {(selected.status === "WAITING_FOR_INPUT" || selected.status === "WAITING") && (
                          <div className="flex items-center justify-center pt-3 relative z-10">
                            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-amber-50/95 border border-amber-200/90 text-amber-900 shadow-sm backdrop-blur">
                              <div className="flex space-x-1">
                                <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-bounce"></div>
                                <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                                <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                              </div>
                              <span className="text-xs font-semibold">Awaiting the contact's reply on WhatsApp...</span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Footer */}
          <footer className="mt-3 py-2 px-4 bg-white rounded-xl border border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="font-medium text-slate-700">Meta Cloud Webhook Gateway:</span>
              <span className="font-mono text-[11px] text-slate-500">Connected</span>
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1 font-medium text-emerald-700">
                <i className="ph-bold ph-check" aria-hidden="true"></i>
                Encryption TLS 1.3 Active
              </span>
              <span>•</span>
              <span className="font-mono">Meta Cloud Graph API v20.0</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
