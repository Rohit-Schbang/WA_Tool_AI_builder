"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";

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

export default function ConversationsPage() {
  const router = useRouter();
  const params = useParams();
  const chatbotId = params.id as string;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api.get(`/api/chatbots/${chatbotId}/conversations`)
      .then((res) => setConversations(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load messages when a conversation is selected.
  async function openConversation(id: string) {
    setSelectedId(id);
    const res = await api.get(`/api/chatbots/${chatbotId}/conversations/${id}`);
    setMessages(res.data.messages ?? []);
  }

  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className="min-h-screen">
      <nav className="navbar bg-base-100 border-b border-base-300 px-6">
        <div className="flex-1">
          <Link href="/chatbots" className="text-lg font-bold flex items-center gap-2">
            <span className="text-xl">💬</span> WA AI Tool
          </Link>
        </div>
        <Link href={`/chatbots/${chatbotId}/builder`} className="btn btn-ghost btn-sm">Builder</Link>
      </nav>

      <main className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-1">Conversations</h1>
        <p className="text-base-content/60 text-sm mb-6">Message history and execution logs for this chatbot.</p>

        {loading ? (
          <div className="flex justify-center py-16"><span className="loading loading-spinner loading-lg text-primary"></span></div>
        ) : conversations.length === 0 ? (
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body items-center text-center py-16">
              <div className="text-4xl mb-2">📭</div>
              <h3 className="font-semibold">No conversations yet</h3>
              <p className="text-base-content/60">They'll appear here once users message your published bot.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {/* List */}
            <div className="md:col-span-1 flex flex-col gap-2">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={`card bg-base-100 shadow-sm text-left p-3 hover:shadow-md transition-shadow ${selectedId === c.id ? "ring-2 ring-primary" : ""}`}
                >
                  <div className="font-medium text-sm">{c.waUserId}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`badge badge-sm ${c.status === "COMPLETED" ? "badge-success" : c.status === "FAILED" ? "badge-error" : "badge-ghost"}`}>
                      {c.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Detail */}
            <div className="md:col-span-2">
              {!selected ? (
                <div className="text-base-content/50 text-sm p-6">Select a conversation to view its messages.</div>
              ) : (
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold">{selected.waUserId}</h3>
                      <span className="badge badge-ghost">{selected.status}</span>
                    </div>

                    {/* Variables collected */}
                    {Object.keys(selected.variables ?? {}).length > 0 && (
                      <div className="text-xs bg-base-200 rounded p-2 mb-3">
                        <span className="font-medium">Variables: </span>
                        {Object.entries(selected.variables).map(([k, v]) => `${k}=${v}`).join(", ")}
                      </div>
                    )}

                    {/* Messages */}
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {messages.map((m) => (
                        <div key={m.id} className={`chat ${m.direction === "INBOUND" ? "chat-start" : "chat-end"}`}>
                          <div className={`chat-bubble text-sm ${m.direction === "OUTBOUND" ? "chat-bubble-primary" : ""}`}>
                            {m.content?.text ?? JSON.stringify(m.content)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
