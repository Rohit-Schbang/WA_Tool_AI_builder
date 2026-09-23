"use client";

import { useState } from "react";
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

  async function send(message: string, sid: string) {
    setLoading(true);
    setActiveOptions([]);
    try {
      const res = await api.post(`/api/chatbots/${chatbotId}/workflow/test`, {
        message,
        testUserId: sid,
      });
      const data = res.data;

      // If the bot isn't live yet (or the session finished), guide the user.
      if (
        data.status === "chatbot_inactive" ||
        data.status === "no_published_version" ||
        data.status === "conversation_completed"
      ) {
        const msg =
          data.status === "conversation_completed"
            ? "This test session already finished. Click ↺ to restart."
            : "⚠️ Publish and activate this chatbot first, then test.";
        setMessages((m) => [...m, { from: "bot", text: msg }]);
        setEnded(true);
        return;
      }

      const botMsgs: ChatMessage[] = (data.replies ?? []).map((r: any) => ({
        from: "bot" as const,
        text: r.text,
        options: r.options,
        media: r.media,
        cta: r.cta,
      }));

      // Never go silently blank — tell the user if nothing came back.
      if (botMsgs.length === 0) {
        setMessages((m) => [...m, { from: "bot", text: "⚠️ No reply produced. Make sure the chatbot is published and active." }]);
        setEnded(true);
        return;
      }

      setMessages((m) => [...m, ...botMsgs]);

      const last = botMsgs[botMsgs.length - 1];
      setActiveOptions(last?.options ?? []);

      if (data.status === "completed") setEnded(true);
    } catch (err: any) {
      setMessages((m) => [...m, { from: "bot", text: "⚠️ " + (err.response?.data?.error ?? "Test failed.") }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || ended) return;
    const text = input;
    setMessages((m) => [...m, { from: "user", text }]);
    setInput("");
    send(text, sessionId);
  }

  function chooseOption(opt: Option) {
    if (ended) return;
    setMessages((m) => [...m, { from: "user", text: opt.label }]);
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
      {!open && (
        <button
          onClick={() => { setOpen(true); if (messages.length === 0) startOver(); }}
          className="btn btn-primary btn-circle fixed bottom-6 right-6 shadow-lg text-xl z-50"
          title="Test this flow"
        >
          ▶
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 w-80 h-[28rem] bg-base-100 rounded-2xl shadow-2xl border border-base-300 flex flex-col z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-base-300 bg-primary text-primary-content rounded-t-2xl">
            <span className="font-semibold text-sm">Test your flow</span>
            <div className="flex gap-1">
              <button onClick={startOver} className="btn btn-ghost btn-xs text-primary-content" title="Restart">↺</button>
              <button onClick={() => setOpen(false)} className="btn btn-ghost btn-xs text-primary-content" title="Close">✕</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-base-200">
            {messages.map((m, i) => (
              <div key={i} className={`chat ${m.from === "user" ? "chat-end" : "chat-start"}`}>
                <div className={`chat-bubble ${m.from === "user" ? "chat-bubble-primary" : ""} text-sm max-w-[85%]`}>
                  {/* #12 — media header preview */}
                  {m.media?.type === "image" && (
                    <img src={m.media.url} alt="" className="rounded mb-1 max-h-40 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                  {m.media?.type === "video" && (
                    <video src={m.media.url} controls className="rounded mb-1 max-h-40 w-full" />
                  )}
                  {m.media?.type === "document" && (
                    <a href={m.media.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline mb-1 break-all">
                      📄 {m.media.url.split("/").pop() || "Document"}
                    </a>
                  )}

                  {m.text && <div className="whitespace-pre-line">{m.text}</div>}

                  {/* #10 — CTA URL button */}
                  {m.cta && (
                    <a href={m.cta.url} target="_blank" rel="noreferrer"
                      className="btn btn-xs btn-outline mt-2 w-full">
                      🔗 {m.cta.label}
                    </a>
                  )}
                </div>
              </div>
            ))}

            {activeOptions.length > 0 && !ended && (
              <div className="flex flex-col gap-1 items-start pl-2">
                {activeOptions.map((opt) => (
                  <button key={opt.id} onClick={() => chooseOption(opt)} className="btn btn-xs btn-outline btn-primary">
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {loading && <div className="chat chat-start"><div className="chat-bubble text-sm"><span className="loading loading-dots loading-sm"></span></div></div>}
            {ended && <div className="text-center text-xs text-base-content/50 py-2">— Session ended · ↺ to restart —</div>}
          </div>

          <form onSubmit={handleSend} className="p-2 border-t border-base-300 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ended ? "Restart ↺" : "Type a message..."}
              disabled={ended || loading}
              className="input input-bordered input-sm flex-1"
            />
            <button type="submit" disabled={ended || loading} className="btn btn-primary btn-sm">Send</button>
          </form>
        </div>
      )}
    </>
  );
}
