"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

interface Option { id: string; label: string; }
interface Media { type: "image" | "document" | "video"; url: string; }
interface Cta { label: string; url: string; }
interface ChatMessage {
  from: "user" | "bot";
  text: string;
  options?: Option[];
  media?: Media;
  cta?: Cta;
  time: string;
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// A floating chat widget that tests the PUBLISHED flow via the real
// conversation path (creates a real, logged conversation).
export function TestPanel({ chatbotId }: { chatbotId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(false);
  const [activeOptions, setActiveOptions] = useState<Option[]>([]);

  // A fresh test-user id per session so each test is its own conversation.
  const [sessionId, setSessionId] = useState<string>("");

  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the chat pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, activeOptions]);

  async function send(message: string, sid: string) {
    setLoading(true);
    setActiveOptions([]);
    try {
      const res = await api.post(`/api/chatbots/${chatbotId}/workflow/test`, {
        message,
        testUserId: sid,
      });
      const data = res.data;

      // If the bot isn't live yet (or the session finished), guide the user
      // with an accurate message per backend status.
      const statusMessages: Record<string, string> = {
        chatbot_inactive: "⚠️ Publish and activate this chatbot first, then test.",
        no_published_version: "⚠️ Publish this chatbot first, then test.",
        conversation_completed: "This test session already finished. Click ↺ to restart.",
        no_start_node: "⚠️ This flow has no Start node. Add one, then publish and test.",
        no_trigger_match: "⚠️ The Start trigger didn't match. Publish the latest version, then restart the test.",
        engine_error: "⚠️ The flow hit an error while running. Check the flow and try again.",
      };
      if (statusMessages[data.status]) {
        setMessages((m) => [...m, { from: "bot", text: statusMessages[data.status], time: nowLabel() }]);
        setEnded(true);
        return;
      }

      const botMsgs: ChatMessage[] = (data.replies ?? []).map((r: any) => ({
        from: "bot" as const,
        text: r.text,
        options: r.options,
        media: r.media,
        cta: r.cta,
        time: nowLabel(),
      }));

      // Never go silently blank — tell the user if nothing came back.
      if (botMsgs.length === 0) {
        setMessages((m) => [...m, { from: "bot", text: "⚠️ No reply produced. Make sure the chatbot is published and active.", time: nowLabel() }]);
        setEnded(true);
        return;
      }

      setMessages((m) => [...m, ...botMsgs]);

      const last = botMsgs[botMsgs.length - 1];
      setActiveOptions(last?.options ?? []);

      if (data.status === "completed") setEnded(true);
    } catch (err: any) {
      setMessages((m) => [...m, { from: "bot", text: "⚠️ " + (err.response?.data?.error ?? "Test failed."), time: nowLabel() }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || ended || loading) return;
    const text = input;
    setMessages((m) => [...m, { from: "user", text, time: nowLabel() }]);
    setInput("");
    send(text, sessionId);
  }

  function chooseOption(opt: Option) {
    if (ended || loading) return;
    setMessages((m) => [...m, { from: "user", text: opt.label, time: nowLabel() }]);
    send(opt.label, sessionId);
  }

  // Start a brand-new test session (new conversation).
  function startOver() {
    const sid = "web-test-" + Math.random().toString(36).slice(2, 9);
    setSessionId(sid);
    setMessages([]);
    setActiveOptions([]);
    setEnded(false);
    // First message triggers the flow from START.
    send("hi", sid);
  }

  return (
    <>
      {/* Floating launcher button */}
      {!open && (
        <button
          onClick={() => { setOpen(true); if (messages.length === 0) startOver(); }}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl bg-gradient-to-tr from-teal-800 via-teal-700 to-teal-500 text-white flex items-center justify-center shadow-xl shadow-teal-700/30 ring-2 ring-teal-500/30 hover:scale-105 active:scale-95 transition"
          title="Test this flow"
        >
          <i className="ph-bold ph-chat-circle-dots text-2xl leading-none" aria-hidden="true"></i>
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-[420px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col font-sans">
          {/* Header */}
          <div className="bg-gradient-to-r from-teal-800 via-teal-900 to-slate-900 px-4 py-3.5 text-white shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-full bg-teal-700/80 border border-teal-500/50 flex items-center justify-center text-white shrink-0">
                  <i className="ph-bold ph-chat-circle-dots text-teal-200 text-lg leading-none" aria-hidden="true"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold tracking-tight text-white leading-tight">Test your flow</h2>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse"></span>
                      Live Simulator
                    </span>
                  </div>
                  <p className="text-[11px] text-teal-200/80 font-normal">Interactive Mode</p>
                </div>
              </div>

              {/* Header action icons */}
              <div className="flex items-center space-x-1">
                <button
                  onClick={startOver}
                  className="p-1.5 rounded-lg text-teal-200 hover:text-white hover:bg-white/10 transition"
                  title="Restart flow"
                  type="button"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  </svg>
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg text-teal-200 hover:text-white hover:bg-white/10 transition ml-0.5"
                  title="Close simulator"
                  type="button"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  </svg>
                </button>
              </div>
            </div>

            {/* Testing context pill bar */}
            <div className="mt-2.5 pt-2 border-t border-teal-700/50 flex items-center justify-between text-[11px] text-teal-100">
              <div className="flex items-center space-x-1.5 overflow-hidden">
                <span className="text-teal-300/80 font-medium">Session:</span>
                <span className="font-mono bg-teal-950/60 px-2 py-0.5 rounded text-[10px] text-teal-200 border border-teal-700/60 truncate">
                  {sessionId || "not started"}
                </span>
              </div>
              <button
                onClick={startOver}
                className="text-xs text-teal-300 hover:underline hover:text-white flex items-center shrink-0 ml-2 font-medium"
                type="button"
              >
                Restart
              </button>
            </div>
          </div>

          {/* Chat area */}
          <div ref={scrollRef} className="pf-chat-pattern h-[380px] p-4 overflow-y-auto space-y-3.5 flex flex-col justify-start text-sm">
            {/* Session stamp */}
            <div className="flex justify-center my-1">
              <span className="px-2.5 py-1 rounded-full bg-white/90 shadow-sm border border-slate-200/80 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                Today • Flow Session Initialized
              </span>
            </div>

            {messages.map((m, i) => (
              m.from === "bot" ? (
                <div key={i} className="flex items-start max-w-[88%] self-start">
                  <div className="pf-bot-tail bg-slate-900 text-white px-3.5 py-2.5 rounded-2xl rounded-tl-sm shadow-sm space-y-1">
                    {m.media?.type === "image" && (
                      <img src={m.media.url} alt="" className="rounded-lg mb-1 max-h-40 object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    {m.media?.type === "video" && (
                      <video src={m.media.url} controls className="rounded-lg mb-1 max-h-40 w-full" />
                    )}
                    {m.media?.type === "document" && (
                      <a href={m.media.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline mb-1 break-all text-[12px]">
                        📄 {m.media.url.split("/").pop() || "Document"}
                      </a>
                    )}

                    {m.text && <p className="text-[13px] leading-relaxed whitespace-pre-line">{m.text}</p>}

                    {m.cta && (
                      <a href={m.cta.url} target="_blank" rel="noreferrer"
                        className="mt-2 flex items-center justify-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 text-teal-200 text-[12px] font-medium py-1.5 hover:bg-teal-500/20 transition">
                        🔗 {m.cta.label}
                      </a>
                    )}

                    <div className="flex items-center justify-end mt-1 text-[10px] text-slate-400 font-mono">
                      <span>{m.time}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex items-end max-w-[80%] self-end">
                  <div className="pf-user-tail bg-emerald-600 text-white px-3.5 py-2 rounded-2xl rounded-tr-sm shadow-sm">
                    <p className="text-[13px] font-medium leading-relaxed whitespace-pre-line">{m.text}</p>
                    <div className="flex items-center justify-end space-x-1.5 mt-0.5 text-[10px] text-emerald-100 font-mono">
                      <span>{m.time}</span>
                      <span className="text-sky-300 text-[11px] leading-none font-bold" title="Read by bot">✓✓</span>
                    </div>
                  </div>
                </div>
              )
            ))}

            {/* Quick-reply options as tappable chips */}
            {activeOptions.length > 0 && !ended && (
              <div className="flex flex-col gap-1.5 items-start max-w-[88%] self-start">
                {activeOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => chooseOption(opt)}
                    className="px-3 py-1.5 rounded-full bg-white text-teal-800 text-[12px] font-semibold border border-teal-200 shadow-sm hover:bg-teal-50 active:scale-95 transition"
                    type="button"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Typing indicator */}
            {loading && (
              <div className="flex items-start max-w-[88%] self-start">
                <div className="pf-bot-tail bg-slate-900 text-white px-3.5 py-3 rounded-2xl rounded-tl-sm shadow-sm">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"></span>
                  </span>
                </div>
              </div>
            )}

            {/* Session ended divider */}
            {ended && (
              <div className="flex items-center justify-center my-2">
                <div className="bg-white/95 backdrop-blur px-3 py-1.5 rounded-full border border-slate-200/90 shadow-sm flex items-center space-x-2 text-[11px] text-slate-500 font-medium">
                  <span>— Flow ended •</span>
                  <button onClick={startOver} className="text-teal-700 font-semibold hover:underline inline-flex items-center gap-1" type="button">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                    </svg>
                    Tap to restart
                  </button>
                  <span>—</span>
                </div>
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div className="bg-white border-t border-slate-200 p-3 space-y-2.5">
            {/* Quick action chips */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5 pf-scrollbar-none text-[11px]">
              <button
                onClick={startOver}
                className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium border border-slate-200/80 whitespace-nowrap transition flex items-center gap-1"
                type="button"
              >
                <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
                Restart Flow
              </button>
            </div>

            {/* Input + send */}
            <form onSubmit={handleSend} className="flex items-center space-x-2">
              <div className="relative flex-1">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={ended ? "Restart ↺ to test again" : "Type a message as WhatsApp user..."}
                  disabled={ended || loading}
                  className="w-full bg-slate-50 hover:bg-white focus:bg-white text-xs text-slate-800 placeholder-slate-400 pl-3.5 pr-9 py-2.5 rounded-xl border border-slate-200 focus:border-teal-600 focus:ring-1 focus:ring-teal-600 outline-none transition disabled:opacity-60"
                  type="text"
                />
                <button
                  type="button"
                  onClick={startOver}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-teal-600 text-xs font-mono"
                  title="Quick reset"
                >
                  ↺
                </button>
              </div>

              <button
                type="submit"
                disabled={ended || loading || !input.trim()}
                className="w-9 h-9 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-white flex items-center justify-center shadow-sm shadow-teal-600/30 transition shrink-0 disabled:opacity-50 disabled:active:scale-100"
              >
                <i className="ph-bold ph-paper-plane-tilt text-base leading-none" aria-hidden="true"></i>
              </button>
            </form>

            {/* Meta footer */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono px-0.5">
              <div className="flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`}></span>
                <span className="text-slate-500">{loading ? "Sending…" : "Ready"}</span>
              </div>
              <span>Meta Cloud Graph API v20.0</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
