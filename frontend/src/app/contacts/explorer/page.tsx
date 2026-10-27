"use client";

/**
 * Contacts Explorer — "Audience & Live Conversation Explorer".
 *
 * A 3-column master/detail screen reachable from the Contacts tab
 * (/contacts -> "Open Explorer"):
 *   - LEFT: the real contact directory (GET /api/contacts).
 *   - CENTER: the selected contact's WhatsApp chat history for the chosen
 *     "Journey". There is no Journey entity in the backend — a chatbot (and the
 *     workflow version it runs) IS the journey here, so the Journey switcher
 *     lists the chatbots this contact has conversations with.
 *   - RIGHT: an Activity Timeline (one entry per conversation/bot) and a
 *     Variables tab (the selected conversation's captured variables).
 *
 * Everything shown is real data from the API. Fields the backend cannot
 * provide (latency, API tier, AI-confidence, opt-in verification, Meta routing)
 * were intentionally left out rather than faked.
 */

import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/app/components/Sidebar";
import { TopNav } from "@/app/components/TopNav";

// ---- Types (mirror the backend responses) --------------------------------

interface Contact {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  notes: string | null;
  createdAt?: string;
}

interface ConvMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | string;
  messageType: string;
  content: unknown;
  status: string | null;
  createdAt: string;
}

interface ContactConversation {
  id: string;
  chatbotId: string;
  chatbotName: string;
  status: string;
  currentNodeId: string | null;
  currentNodeLabel: string | null;
  variables: Record<string, unknown> | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string | null;
  messages: ConvMessage[];
}

interface ContactConversationsResponse {
  contact: Pick<Contact, "id" | "name" | "phone" | "tags" | "notes">;
  conversations: ContactConversation[];
}

// ---- Helpers --------------------------------------------------------------

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

// Extract a readable text body from a Message.content payload. The runtime
// stores different shapes per messageType; we try the common ones and fall
// back to a compact JSON string so nothing is silently dropped.
function messageText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    const c = content as Record<string, any>;
    return (
      c.text ??
      c.body ??
      c.caption ??
      c.message ??
      c.title ??
      (typeof c.payload === "string" ? c.payload : "") ??
      JSON.stringify(c)
    );
  }
  return String(content);
}

// Human label for conversation status.
function statusLabel(status: string) {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "WAITING_FOR_INPUT":
      return "Waiting for input";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

function ContactsExplorer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-link target: /contacts/explorer?contact=<id> pre-selects that contact
  // (used when opening the Explorer from a contact name on the Contacts page).
  const contactParam = searchParams.get("contact");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  // Conversations for the selected contact.
  const [conversations, setConversations] = useState<ContactConversation[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [convoError, setConvoError] = useState("");

  // The chosen "journey" = conversation id (one per chatbot the contact used).
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [journeyMenuOpen, setJourneyMenuOpen] = useState(false);

  // Right panel tab.
  const [panelTab, setPanelTab] = useState<"timeline" | "variables">("timeline");
  const [panelOpen, setPanelOpen] = useState(true);

  // ---- Data loading -------------------------------------------------------

  async function loadContacts() {
    try {
      const res = await api.get("/api/contacts");
      setContacts(res.data);
      if (Array.isArray(res.data) && res.data.length > 0) {
        // Prefer the deep-linked contact (?contact=<id>) when it exists in the
        // list; otherwise fall back to the first contact so the screen isn't
        // empty on open.
        const deepLinked =
          contactParam && res.data.some((c: Contact) => c.id === contactParam) ? contactParam : null;
        setSelectedContactId((prev) => prev ?? deepLinked ?? res.data[0].id);
      }
    } catch {
      setError("Failed to load contacts");
    } finally {
      setLoadingContacts(false);
    }
  }

  async function loadConversations(contactId: string) {
    setLoadingConvos(true);
    setConvoError("");
    setConversations([]);
    setSelectedConversationId(null);
    try {
      const res = await api.get<ContactConversationsResponse>(`/api/contacts/${contactId}/conversations`);
      const convos = res.data.conversations ?? [];
      setConversations(convos);
      if (convos.length > 0) setSelectedConversationId(convos[0].id);
    } catch (err: any) {
      setConvoError(err?.response?.data?.error ?? "Failed to load conversations");
    } finally {
      setLoadingConvos(false);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedContactId) loadConversations(selectedContactId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContactId]);

  // If the ?contact= param changes while contacts are already loaded (e.g. the
  // user clicks a different name), switch the selection to that contact.
  useEffect(() => {
    if (contactParam && contacts.some((c) => c.id === contactParam)) {
      setSelectedContactId(contactParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactParam, contacts]);

  // ---- Derived ------------------------------------------------------------

  const visibleContacts = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [contacts, search]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedContactId) ?? null,
    [contacts, selectedContactId]
  );

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const variableEntries = useMemo(() => {
    const vars = selectedConversation?.variables;
    if (!vars || typeof vars !== "object") return [] as [string, unknown][];
    return Object.entries(vars);
  }, [selectedConversation]);

  // ---- Render -------------------------------------------------------------

  return (
    <div className="bg-surface font-sans text-on-surface antialiased min-h-screen">
      <Sidebar active="contacts" />

      <div className="pl-sidebar flex flex-col min-h-screen">
        {/* Top header (matches the rest of the dashboard) */}
        <TopNav crumbs={[{ label: "Contacts & Audience", href: "/contacts" }, { label: "Conversation Explorer" }]} />

        <main className="w-full bg-surface flex-1">
          <div className="flex flex-col w-full h-[calc(100vh-4rem)] overflow-hidden">
            {/* Context bar */}
            <div className="shrink-0 px-6 py-3 bg-surface-container-lowest flex items-center justify-between shadow-[0_1px_3px_rgba(15,23,42,0.03)] z-10">
              <div className="flex items-center gap-3">
                <span className="font-label-sm text-label-sm text-on-surface-variant">Audience &amp; Live Conversation Explorer</span>
              </div>
              <Link
                href="/contacts"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary-container font-label-md text-label-md transition-all shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px]">person_add</span>
                <span>Manage Contacts</span>
              </Link>
            </div>

            {/* 3-column workspace */}
            <div className="flex-1 flex min-h-0 bg-surface">
              {/* LEFT: Contact directory */}
              <aside className="shrink-0 w-80 bg-surface-container-lowest flex flex-col shadow-[1px_0_4px_rgba(0,0,0,0.03)] z-10">
                <div className="p-3.5 border-b border-surface-container space-y-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <h2 className="font-label-lg text-label-lg text-on-surface font-bold">Contacts</h2>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">{contacts.length}</span>
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">search</span>
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search name, phone, tag..."
                      className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline text-body-sm font-body-sm focus:outline-none focus:bg-surface-container-lowest transition-all"
                      type="text"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {loadingContacts ? (
                    <div className="flex justify-center py-10">
                      <span className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    </div>
                  ) : error ? (
                    <div className="p-3 m-2 rounded-lg bg-error-container text-on-error-container font-label-sm text-label-sm">{error}</div>
                  ) : visibleContacts.length === 0 ? (
                    <div className="p-6 text-center text-on-surface-variant font-body-sm text-body-sm">
                      {contacts.length === 0 ? "No contacts yet." : `No contacts match "${search}".`}
                    </div>
                  ) : (
                    visibleContacts.map((c) => {
                      const isActive = c.id === selectedContactId;
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSelectedContactId(c.id)}
                          className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 transition-all ${
                            isActive
                              ? "bg-primary-container text-on-primary-container shadow-sm"
                              : "hover:bg-surface-container-low text-on-surface"
                          }`}
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-headline-sm text-headline-sm font-bold shrink-0 ${
                            isActive ? "bg-primary text-on-primary" : "bg-surface-container text-primary"
                          }`}>
                            {initialsOf(c.name) || "?"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="font-label-md text-label-md font-semibold block leading-tight truncate">{c.name}</span>
                            <span className={`font-body-sm text-body-sm block truncate ${isActive ? "text-on-primary-container/80" : "text-on-surface-variant"}`}>
                              {c.phone}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>

              {/* CENTER: Conversation stream */}
              <section className="flex-1 flex flex-col min-w-0 bg-surface-container-low/40">
                {!selectedContact ? (
                  <div className="flex-1 flex items-center justify-center text-on-surface-variant font-body-md text-body-md">
                    Select a contact to view their conversations.
                  </div>
                ) : (
                  <>
                    {/* Chat header */}
                    <header className="px-6 py-3.5 bg-surface-container-lowest shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-wrap items-center justify-between gap-4 z-10">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-primary text-on-primary font-headline-md text-headline-md flex items-center justify-center font-bold shadow-sm">
                          {initialsOf(selectedContact.name) || "?"}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h1 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight">{selectedContact.name}</h1>
                            {selectedContact.tags.map((t) => (
                              <span key={t} className="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold">{t}</span>
                            ))}
                          </div>
                          <div className="flex items-center gap-3 text-on-surface-variant font-body-sm text-body-sm mt-0.5">
                            <span className="font-mono text-on-surface font-medium">{selectedContact.phone}</span>
                            {selectedConversation && (
                              <>
                                <span>•</span>
                                <span className="text-primary font-medium flex items-center gap-1">
                                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                                  {statusLabel(selectedConversation.status)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Journey (= chatbot) switcher + panel toggle */}
                      <div className="flex items-center gap-2.5">
                        {conversations.length > 0 && (
                          <div className="relative inline-block text-left">
                            <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
                              <span className="font-label-sm text-label-sm text-on-surface-variant font-semibold uppercase tracking-wider">Journey:</span>
                              <button
                                className="inline-flex items-center gap-1.5 font-label-md text-label-md text-on-surface font-semibold hover:text-primary transition-colors"
                                onClick={() => setJourneyMenuOpen((o) => !o)}
                              >
                                <span>{selectedConversation?.chatbotName ?? "Select"}</span>
                                <span className="material-symbols-outlined text-[18px]">expand_more</span>
                              </button>
                            </div>
                            {journeyMenuOpen && (
                              <div className="absolute right-0 mt-2 w-72 bg-surface-container-lowest rounded-xl shadow-xl z-50 p-1.5 space-y-1">
                                <div className="px-3 py-1.5 font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">Journeys (chatbots)</div>
                                {conversations.map((c) => {
                                  const active = c.id === selectedConversationId;
                                  return (
                                    <button
                                      key={c.id}
                                      onClick={() => { setSelectedConversationId(c.id); setJourneyMenuOpen(false); }}
                                      className={`w-full text-left px-3 py-2 rounded-lg font-label-md text-label-md flex items-center justify-between transition-colors ${
                                        active ? "bg-surface-container text-primary font-semibold" : "hover:bg-surface-container text-on-surface"
                                      }`}
                                    >
                                      <span className="truncate">{c.chatbotName}</span>
                                      {active ? (
                                        <span className="material-symbols-outlined text-[16px]">check</span>
                                      ) : (
                                        <span className="text-on-surface-variant font-label-sm text-label-sm">{c.messageCount} msgs</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          className="p-2 rounded-lg bg-primary-fixed/40 text-primary hover:bg-primary-fixed-dim/60 transition-all"
                          onClick={() => setPanelOpen((o) => !o)}
                          title="Toggle insights panel"
                        >
                          <span className="material-symbols-outlined text-[19px]">data_object</span>
                        </button>
                      </div>
                    </header>

                    {/* Filter indicator banner */}
                    {selectedConversation && (
                      <div className="px-6 py-2 bg-surface-container/60 flex items-center justify-between text-on-surface-variant font-body-sm text-body-sm">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px] text-primary">filter_alt</span>
                          <span>
                            Showing <strong className="text-on-surface font-semibold">{selectedConversation.messageCount} messages</strong> from journey:{" "}
                            <strong className="text-primary font-semibold">{selectedConversation.chatbotName}</strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-on-surface-variant font-label-sm text-label-sm">
                          <span>Started: {formatDate(selectedConversation.createdAt)}</span>
                          {selectedConversation.currentNodeLabel && (
                            <>
                              <span>•</span>
                              <span className="text-secondary font-semibold">Active Node: {selectedConversation.currentNodeLabel}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Chat stream */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                      {loadingConvos ? (
                        <div className="flex justify-center py-16">
                          <span className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        </div>
                      ) : convoError ? (
                        <div className="p-3 rounded-xl bg-error-container text-on-error-container font-label-md text-label-md max-w-md mx-auto text-center">{convoError}</div>
                      ) : conversations.length === 0 ? (
                        <div className="max-w-md mx-auto p-6 rounded-xl bg-surface-container-lowest text-center space-y-2 shadow-sm">
                          <span className="material-symbols-outlined text-[32px] text-outline">forum</span>
                          <p className="font-body-md text-body-md text-on-surface-variant">
                            No conversations yet for this contact. Conversations appear here once this contact messages one of your chatbots.
                          </p>
                        </div>
                      ) : !selectedConversation ? (
                        <div className="text-center text-on-surface-variant py-16 font-body-md text-body-md">Select a journey to view messages.</div>
                      ) : selectedConversation.messages.length === 0 ? (
                        <div className="text-center text-on-surface-variant py-16 font-body-md text-body-md">This conversation has no messages logged.</div>
                      ) : (
                        <>
                          <div className="flex items-center justify-center">
                            <span className="px-3 py-1 rounded-full bg-surface-container-high/60 text-on-surface-variant font-label-sm text-label-sm uppercase font-semibold tracking-wider">
                              {formatDate(selectedConversation.createdAt)} • Session start
                            </span>
                          </div>
                          {selectedConversation.messages.map((m) => {
                            const outbound = m.direction === "OUTBOUND";
                            return (
                              <div key={m.id} className={`flex flex-col max-w-xl group ${outbound ? "items-start" : "items-end ml-auto"}`}>
                                <div className={`flex items-center gap-2 mb-1 ${outbound ? "pl-1" : "pr-1"}`}>
                                  <span className="font-label-sm text-label-sm text-on-surface-variant">
                                    {outbound ? selectedConversation.chatbotName : selectedContact.name}
                                  </span>
                                </div>
                                <div
                                  className={`p-3.5 rounded-2xl shadow-sm space-y-1 ${
                                    outbound
                                      ? "bg-surface-container-lowest text-on-surface rounded-tl-sm"
                                      : "bg-primary text-on-primary rounded-tr-sm"
                                  }`}
                                >
                                  <p className="font-body-md text-body-md leading-relaxed whitespace-pre-wrap break-words">{messageText(m.content)}</p>
                                  <div className={`flex items-center justify-end gap-1 pt-0.5 font-label-sm text-label-sm ${outbound ? "text-on-surface-variant" : "text-on-primary/70"}`}>
                                    <span>{formatTime(m.createdAt)}</span>
                                    {outbound && m.status && (
                                      <span className="font-mono uppercase">{m.status}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {selectedConversation.currentNodeLabel && (
                            <div className="flex items-center justify-center pt-2">
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container text-on-surface font-label-sm text-label-sm shadow-sm">
                                <span className="w-2 h-2 rounded-full bg-secondary-container"></span>
                                <span>Current node: {selectedConversation.currentNodeLabel} ({statusLabel(selectedConversation.status)})</span>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </section>

              {/* RIGHT: Insights panel */}
              {panelOpen && selectedContact && (
                <aside className="shrink-0 bg-surface-container-lowest flex flex-col shadow-[-1px_0_4px_rgba(0,0,0,0.03)] z-10 w-[440px]">
                  <div className="p-3.5 border-b border-surface-container space-y-3 shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary-fixed-dim/40 text-primary flex items-center justify-center">
                          <span className="material-symbols-outlined text-[18px]">timeline</span>
                        </div>
                        <div>
                          <h3 className="font-label-lg text-label-lg text-on-surface font-bold leading-tight">Contact Insights</h3>
                          <p className="font-body-sm text-body-sm text-on-surface-variant">{selectedContact.name} ({selectedContact.phone})</p>
                        </div>
                      </div>
                      <button
                        className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                        onClick={() => setPanelOpen(false)}
                        title="Collapse panel"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex items-center p-1 bg-surface-container-low rounded-xl gap-1">
                      <button
                        onClick={() => setPanelTab("timeline")}
                        className={`flex-1 py-1.5 px-2.5 rounded-lg font-label-md text-label-md flex items-center justify-center gap-1.5 transition-all ${
                          panelTab === "timeline"
                            ? "text-primary bg-surface-container-lowest shadow-sm font-semibold"
                            : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-medium"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">history</span>
                        <span>Activity Timeline</span>
                      </button>
                      <button
                        onClick={() => setPanelTab("variables")}
                        className={`flex-1 py-1.5 px-2.5 rounded-lg font-label-md text-label-md flex items-center justify-center gap-1.5 transition-all ${
                          panelTab === "variables"
                            ? "text-primary bg-surface-container-lowest shadow-sm font-semibold"
                            : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-medium"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">data_object</span>
                        <span>Variables</span>
                      </button>
                    </div>
                  </div>

                  {/* Timeline tab */}
                  {panelTab === "timeline" ? (
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      <div>
                        <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-bold block">Conversation Activity</span>
                        <span className="text-[11px] text-on-surface-variant font-body-sm">
                          {conversations.length} conversation{conversations.length === 1 ? "" : "s"} across {new Set(conversations.map((c) => c.chatbotId)).size} journey(s)
                        </span>
                      </div>

                      {conversations.length === 0 ? (
                        <div className="p-4 rounded-xl bg-surface-container-low text-on-surface-variant font-body-sm text-body-sm text-center">
                          No activity recorded for this contact.
                        </div>
                      ) : (
                        <div className="relative pl-4 space-y-4 border-l-2 border-surface-container-high/80 ml-2">
                          {conversations.map((c) => {
                            const active = c.id === selectedConversationId;
                            return (
                              <div key={c.id} className="relative group">
                                <span className="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-primary ring-4 ring-surface-container-lowest" />
                                <button
                                  onClick={() => setSelectedConversationId(c.id)}
                                  className={`w-full text-left p-3 rounded-xl space-y-2 transition-all ${
                                    active
                                      ? "bg-surface-container-low border border-primary/30 shadow-sm"
                                      : "bg-surface-container-lowest shadow-[0_1px_3px_rgba(15,23,42,0.04)] hover:bg-surface-container-low"
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="px-2 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-[10px] font-bold uppercase tracking-wider">
                                      {statusLabel(c.status)}
                                    </span>
                                    <span className="text-[11px] text-on-surface-variant font-mono">{formatDate(c.lastMessageAt ?? c.createdAt)}</span>
                                  </div>
                                  <div>
                                    <h4 className="font-label-md text-label-md text-on-surface font-bold leading-snug truncate">{c.chatbotName}</h4>
                                    <p className="text-[11px] text-on-surface-variant mt-0.5">{c.messageCount} messages logged</p>
                                  </div>
                                  {c.currentNodeLabel && (
                                    <div className="p-2 rounded-lg bg-surface-container text-[11px] text-on-surface-variant flex justify-between items-center">
                                      <span>Current node:</span>
                                      <span className="font-mono font-semibold text-secondary truncate ml-2">{c.currentNodeLabel}</span>
                                    </div>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Variables tab */
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {!selectedConversation ? (
                        <div className="p-4 rounded-xl bg-surface-container-low text-on-surface-variant font-body-sm text-body-sm text-center">
                          Select a journey to see its captured variables.
                        </div>
                      ) : (
                        <>
                          <div className="p-3.5 rounded-xl bg-surface-container-low space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-bold">Active Journey</span>
                              <span className="px-2 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-label-sm font-semibold">{statusLabel(selectedConversation.status)}</span>
                            </div>
                            <div>
                              <span className="font-label-md text-label-md text-on-surface font-bold block">{selectedConversation.chatbotName}</span>
                              <span className="font-body-sm text-body-sm text-on-surface-variant">Conversation ID: {selectedConversation.id}</span>
                            </div>
                            {selectedConversation.currentNodeLabel && (
                              <div className="flex items-center justify-between text-on-surface-variant font-body-sm text-body-sm">
                                <span>Current Node:</span>
                                <span className="text-secondary font-semibold font-mono text-[11px] bg-secondary-fixed/40 px-1.5 py-0.5 rounded">{selectedConversation.currentNodeLabel}</span>
                              </div>
                            )}
                          </div>

                          <div className="space-y-2.5">
                            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-bold">
                              Captured Variables ({variableEntries.length})
                            </span>
                            {variableEntries.length === 0 ? (
                              <div className="p-4 rounded-xl bg-surface-container-low text-on-surface-variant font-body-sm text-body-sm text-center">
                                No variables captured in this conversation yet.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {variableEntries.map(([key, value]) => (
                                  <div key={key} className="p-2.5 rounded-lg bg-surface-container-lowest shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                                    <div className="flex items-center justify-between">
                                      <span className="font-mono text-label-sm text-primary font-bold">{key}</span>
                                      <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container px-1.5 rounded">{typeof value}</span>
                                    </div>
                                    <div className="mt-1">
                                      <span className="font-label-md text-label-md text-on-surface font-semibold break-words">
                                        {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </aside>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// useSearchParams must sit inside a Suspense boundary for the production build.
export default function ContactsExplorerPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-surface min-h-screen flex items-center justify-center">
          <span className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      }
    >
      <ContactsExplorer />
    </Suspense>
  );
}