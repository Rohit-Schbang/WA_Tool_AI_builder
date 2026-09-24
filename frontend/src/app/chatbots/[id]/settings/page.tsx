"use client";

import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/app/components/Sidebar";

// Shape of the safe connection returned from the backend (no secret values).
interface SafeConnection {
  businessName: string | null;
  phoneNumber: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  status: string;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const params = useParams();
  const chatbotId = params.id as string;

  // Form fields
  const [businessName, setBusinessName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  const [existing, setExisting] = useState<SafeConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // Real webhook endpoint derived from the configured API base URL.
  const webhookUrl = useMemo(() => {
    const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
    return `${base}/api/whatsapp/webhook`;
  }, []);

  const connected = existing?.status === "CONNECTED";

  async function loadConnection() {
    try {
      const res = await api.get(`/api/chatbots/${chatbotId}/connection`);
      const conn: SafeConnection = res.data;
      setExisting(conn);
      // Prefill the SAFE (non-secret) fields. Secrets stay blank.
      setBusinessName(conn.businessName ?? "");
      setPhoneNumber(conn.phoneNumber ?? "");
      setPhoneNumberId(conn.phoneNumberId ?? "");
      setWabaId(conn.wabaId ?? "");
    } catch (err: any) {
      // 404 = no connection configured yet. That's fine; show empty form.
      if (err.response?.status !== 404) {
        setMessage("Failed to load connection");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setSaving(true);

    // Only include secret fields if the user typed one, so we don't
    // overwrite a saved token with an empty string.
    const payload: Record<string, string> = {
      businessName,
      phoneNumber,
      phoneNumberId,
      wabaId,
    };
    if (accessToken) payload.accessToken = accessToken;
    if (appSecret) payload.appSecret = appSecret;
    if (verifyToken) payload.verifyToken = verifyToken;

    try {
      await api.put(`/api/chatbots/${chatbotId}/connection`, payload);
      setMessage("Saved.");
      // Clear the secret inputs and refresh the "configured" indicators.
      setAccessToken("");
      setAppSecret("");
      setVerifyToken("");
      loadConnection();
    } catch {
      setMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  const inputClass =
    "w-full h-10 px-3 rounded-lg bg-white text-slate-800 text-sm placeholder:text-slate-400 border border-slate-200 shadow-sm focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600 transition-all";

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
            <span className="text-slate-700 font-semibold">WhatsApp Settings</span>
          </nav>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-700">
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`}></span>
              {connected ? "Connected" : existing?.status ?? "Not configured"}
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-[#f8f9ff] px-6 py-6">
          {/* Banner */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex flex-col gap-1">
              <Link
                href="/chatbots"
                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 transition-colors w-fit"
              >
                <i className="ph-bold ph-arrow-left" aria-hidden="true"></i>
                Back to chatbots
              </Link>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">WhatsApp Settings</h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200/60 text-xs font-semibold">
                  <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-teal-600 animate-pulse" : "bg-slate-400"}`}></span>
                  {connected ? "Meta Cloud Connected" : "Not connected"}
                </span>
              </div>
              <p className="text-sm text-slate-500">
                Configure Meta Cloud API credentials and the webhook endpoint for this chatbot.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <span className="loading loading-spinner loading-lg text-teal-600"></span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* ---------------- Main configuration form (8 cols) ---------------- */}
              <form onSubmit={handleSave} className="lg:col-span-8 flex flex-col gap-6">
                {/* Section 1: Business & Number Identity */}
                <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-6 flex flex-col gap-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Business &amp; Number Identity</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Public metadata used during Meta business verification.
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[11px] font-semibold uppercase tracking-wide shrink-0">
                      ID Layer
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Business Name */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-700 flex items-center gap-1" htmlFor="business-name">
                        Business name
                      </label>
                      <input
                        id="business-name"
                        className={inputClass}
                        placeholder="e.g. PingFlow Store"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                      />
                    </div>

                    {/* Phone Number */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-700" htmlFor="phone-number">
                        Phone number
                      </label>
                      <input
                        id="phone-number"
                        type="tel"
                        className={inputClass}
                        placeholder="+1 (555) 000-0000"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                      />
                    </div>

                    {/* Phone Number ID */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-700 flex items-center justify-between" htmlFor="phone-number-id">
                        <span>Phone Number ID</span>
                        {phoneNumberId && (
                          <button
                            type="button"
                            onClick={() => copy(phoneNumberId, "pnid")}
                            className="text-[11px] text-teal-700 hover:underline flex items-center gap-0.5"
                          >
                            <i className="ph ph-copy text-[13px]" aria-hidden="true"></i>
                            {copied === "pnid" ? "Copied" : "Copy"}
                          </button>
                        )}
                      </label>
                      <input
                        id="phone-number-id"
                        className={inputClass}
                        placeholder="e.g. 109845239847102"
                        value={phoneNumberId}
                        onChange={(e) => setPhoneNumberId(e.target.value)}
                      />
                      <p className="text-[11px] text-slate-400">Unique identifier assigned by Meta Graph API.</p>
                    </div>

                    {/* WABA ID */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-700 flex items-center justify-between" htmlFor="waba-id">
                        <span>WABA ID</span>
                        <span className="text-[11px] text-slate-400 font-normal">WhatsApp Business Acct</span>
                      </label>
                      <input
                        id="waba-id"
                        className={inputClass}
                        placeholder="e.g. 109845239847102"
                        value={wabaId}
                        onChange={(e) => setWabaId(e.target.value)}
                      />
                      <p className="text-[11px] text-slate-400">Required for template synchronization.</p>
                    </div>
                  </div>
                </div>

                {/* Section 2: Secrets & Tokens */}
                <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-6 flex flex-col gap-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Secrets &amp; Tokens</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Write-only. Leave a field blank to keep its current saved value.
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200/60 text-[11px] font-semibold uppercase tracking-wide shrink-0">
                      Secure
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Access Token */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-700 flex items-center justify-between" htmlFor="access-token">
                        <span>Access Token</span>
                        {existing?.hasAccessToken && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            ✓ set
                          </span>
                        )}
                      </label>
                      <input
                        id="access-token"
                        type="password"
                        className={inputClass}
                        placeholder="••••••••"
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                      />
                    </div>

                    {/* App Secret */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-700 flex items-center justify-between" htmlFor="app-secret">
                        <span>App Secret</span>
                        {existing?.hasAppSecret && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            ✓ set
                          </span>
                        )}
                      </label>
                      <input
                        id="app-secret"
                        type="password"
                        className={inputClass}
                        placeholder="••••••••"
                        value={appSecret}
                        onChange={(e) => setAppSecret(e.target.value)}
                      />
                    </div>

                    {/* Verify Token */}
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="text-xs font-semibold text-slate-700" htmlFor="verify-token">
                        Verify Token
                      </label>
                      <input
                        id="verify-token"
                        type="password"
                        className={inputClass}
                        placeholder="••••••••"
                        value={verifyToken}
                        onChange={(e) => setVerifyToken(e.target.value)}
                      />
                      <p className="text-[11px] text-slate-400">
                        Used by Meta to verify your webhook subscription (the "hub.verify_token").
                      </p>
                    </div>
                  </div>

                  {/* Action footer */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-sm active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <i className={`ph-bold ${saving ? "ph-spinner animate-spin" : "ph-floppy-disk"}`} aria-hidden="true"></i>
                        {saving ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                    {message && (
                      <p className={`text-sm font-medium ${message === "Saved." ? "text-emerald-600" : "text-rose-600"}`}>
                        {message}
                      </p>
                    )}
                  </div>
                </div>
              </form>

              {/* ---------------- Contextual side column (4 cols) ---------------- */}
              <div className="lg:col-span-4 flex flex-col gap-4">
                {/* Webhook endpoint */}
                <div className="bg-white p-5 rounded-xl border border-slate-200/90 shadow-sm flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-teal-700">
                        <i className="ph-bold ph-webhooks-logo" aria-hidden="true"></i>
                      </div>
                      <span className="text-sm font-bold text-slate-900">Webhook Endpoint</span>
                    </div>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-teal-700">
                      <span className="h-2 w-2 rounded-full bg-teal-600 animate-ping"></span>
                      Listening
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Paste this URL into Meta Developer Console → WhatsApp → Configuration → Callback URL.
                  </p>
                  <div className="p-2.5 bg-slate-50 rounded-lg flex items-center justify-between gap-2 overflow-hidden border border-slate-200/70">
                    <code className="text-[11px] text-slate-700 font-mono truncate select-all">{webhookUrl}</code>
                    <button
                      type="button"
                      onClick={() => copy(webhookUrl, "hook")}
                      className="p-1.5 rounded bg-white text-slate-600 hover:text-teal-700 transition-colors shrink-0 shadow-sm border border-slate-200"
                      title="Copy webhook endpoint"
                    >
                      <i className={`ph ${copied === "hook" ? "ph-check text-teal-600" : "ph-copy"}`} aria-hidden="true"></i>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Also enter your <strong>Verify Token</strong> above into the same Meta configuration screen.
                  </p>
                </div>

                {/* Connection status */}
                <div className="bg-white p-5 rounded-xl border border-slate-200/90 shadow-sm flex flex-col gap-3">
                  <span className="text-sm font-bold text-slate-900">Connection Status</span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="p-3 bg-slate-50 rounded-lg flex flex-col border border-slate-200/70">
                      <span className="text-[11px] text-slate-500">Status</span>
                      <span className={`text-sm font-bold mt-1 ${connected ? "text-emerald-700" : "text-slate-700"}`}>
                        {existing?.status ?? "Not set"}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg flex flex-col border border-slate-200/70">
                      <span className="text-[11px] text-slate-500">Credentials</span>
                      <span className="text-sm font-bold mt-1 text-slate-700">
                        {existing?.hasAccessToken ? "Token set" : "No token"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`inline-flex items-center gap-1 ${existing?.hasAccessToken ? "text-emerald-600" : "text-slate-400"}`}>
                      <i className={`ph-bold ${existing?.hasAccessToken ? "ph-check-circle" : "ph-circle"}`} aria-hidden="true"></i>
                      Access token
                    </span>
                    <span className={`inline-flex items-center gap-1 ${existing?.hasAppSecret ? "text-emerald-600" : "text-slate-400"}`}>
                      <i className={`ph-bold ${existing?.hasAppSecret ? "ph-check-circle" : "ph-circle"}`} aria-hidden="true"></i>
                      App secret
                    </span>
                  </div>
                </div>

                {/* Help */}
                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200/70 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <i className="ph-bold ph-book-open text-teal-700 text-lg" aria-hidden="true"></i>
                    <span className="text-sm font-bold text-slate-900">Need help connecting?</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Generate a permanent Meta Cloud API token so it doesn't expire every 24 hours, then paste the four
                    fields above.
                  </p>
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-teal-700 hover:underline flex items-center gap-1 mt-1"
                  >
                    Read the Cloud API guide
                    <i className="ph-bold ph-arrow-right text-[13px]" aria-hidden="true"></i>
                  </a>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
