"use client";

import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/app/components/Sidebar";
import { EmbeddedSignup } from "./EmbeddedSignup";
import { ConnectionHealth } from "./ConnectionHealth";
import { EditableBotName } from "@/app/components/EditableBotName";
import { SecretInput } from "./SecretInput";

// Shape of the safe connection returned from the backend (no secret values).
interface SafeConnection {
  businessName: string | null;
  phoneNumber: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  systemUserId: string | null;
  systemUserName: string | null;
  status: string;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: "Connected",
  ERROR: "Connection error",
  DISCONNECTED: "Not connected",
};

// Same rules as the backend (connection/routes.ts). Catches autofilled junk
// (an email or login password in the wrong box) before anything is sent.
type FieldKey = "phoneNumber" | "phoneNumberId" | "wabaId" | "accessToken" | "appSecret" | "verifyToken";
function validateFields(v: Record<FieldKey, string>): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const t = (s: string) => s.trim();
  if (t(v.phoneNumber) && !/^\+?[\d\s()-]{6,24}$/.test(t(v.phoneNumber))) e.phoneNumber = "Use a phone number like +91 98765 43210.";
  if (t(v.phoneNumberId) && !/^\d{5,25}$/.test(t(v.phoneNumberId))) e.phoneNumberId = "Digits only — copy it from WhatsApp Manager → API Setup.";
  if (t(v.wabaId) && !/^\d{5,25}$/.test(t(v.wabaId))) e.wabaId = "Digits only.";
  if (t(v.phoneNumberId) && t(v.phoneNumberId) === t(v.wabaId)) e.wabaId = "The WABA ID is different from the Phone Number ID.";
  if (t(v.accessToken) && !/^EA[A-Za-z0-9_-]{30,}$/.test(t(v.accessToken)))
    e.accessToken = "Meta access tokens start with “EA”. If this was filled in by your browser, clear it.";
  if (t(v.appSecret) && !/^[a-f0-9]{32}$/i.test(t(v.appSecret))) e.appSecret = "32 hex characters, from Meta App → Settings → Basic.";
  if (t(v.verifyToken) && (/\s/.test(t(v.verifyToken)) || t(v.verifyToken).length < 4)) e.verifyToken = "At least 4 characters, no spaces.";
  return e;
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
  // Set when the connection couldn't be loaded (network / server), so the page
  // doesn't wrongly claim "Not connected".
  const [loadError, setLoadError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  // Advanced manual setup is collapsed by default so the primary flow is the
  // single "Connect to Meta" button (Google-auth style).
  const [showManual, setShowManual] = useState(false);

  // Real webhook endpoint derived from the configured API base URL.
  const webhookUrl = useMemo(() => {

    const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
    return `${base}/api/whatsapp/webhook`;
  }, []);

  const connected = existing?.status === "CONNECTED";
  const statusLabel = loadError
    ? "Status unavailable"
    : existing
    ? STATUS_LABEL[existing.status] ?? existing.status
    : "Not configured";

  async function loadConnection() {
    setLoadError("");
    try {
      const res = await api.get(`/api/chatbots/${chatbotId}/connection`);
      const conn: SafeConnection = res.data;
      setExisting(conn);
      // Prefill the SAFE (non-secret) fields, each from its own key. Secrets
      // are never sent by the server and always start blank.
      setBusinessName(conn.businessName ?? "");
      setPhoneNumber(conn.phoneNumber ?? "");
      setPhoneNumberId(conn.phoneNumberId ?? "");
      setWabaId(conn.wabaId ?? "");
      setAccessToken("");
      setAppSecret("");
      setVerifyToken("");
    } catch (err: any) {
      // 404 = no connection configured yet. That's fine; show empty form.
      if (err.response?.status === 404) setExisting(null);
      else setLoadError("Couldn't load the WhatsApp connection. The server may be waking up — try again.");
    } finally {
      setLoading(false);
    }
  }

  // The health check asks Meta directly, so it's the freshest status: keep the
  // page header/badges in sync with it.
  const onHealth = useCallback((h: { status: string; systemUserId?: string | null; phoneNumber?: string | null }) => {
    setExisting((prev) => (prev ? {
      ...prev,
      status: h.status,
      systemUserId: h.systemUserId ?? prev.systemUserId,
      phoneNumber: h.phoneNumber ?? prev.phoneNumber,
    } : prev));
  }, []);

  const [botName, setBotName] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api.get(`/api/chatbots/${chatbotId}`).then((res) => setBotName(res.data?.name ?? "")).catch(() => {});
    loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const errs = validateFields({ phoneNumber, phoneNumberId, wabaId, accessToken, appSecret, verifyToken });
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setMessage("Fix the highlighted fields — nothing was saved.");
      return;
    }

    // Send only fields that have a value, each under its own key. Blank secret
    // fields are omitted so a saved token is never overwritten with "".
    const payload: Record<string, string> = {};
    const put = (k: string, v: string) => { if (v.trim()) payload[k] = v.trim(); };
    put("businessName", businessName);
    put("phoneNumber", phoneNumber);
    put("phoneNumberId", phoneNumberId);
    put("wabaId", wabaId);
    put("accessToken", accessToken);
    put("appSecret", appSecret);
    put("verifyToken", verifyToken);

    setSaving(true);
    try {
      const res = await api.put(`/api/chatbots/${chatbotId}/connection`, payload);
      const status: string = res.data?.status;
      const verifyMessage: string | null = res.data?.verifyMessage ?? null;
      // Reflect the verification result from the server: CONNECTED means the
      // credentials were validated against Meta; ERROR means they were rejected.
      if (status === "CONNECTED") {
        setMessage("Connected — credentials verified with Meta.");
      } else if (status === "ERROR") {
        setMessage(verifyMessage ? `Not connected: ${verifyMessage}` : "Not connected: Meta rejected these credentials.");
      } else {
        setMessage(verifyMessage ?? "Saved.");
      }
      // Clear the secret inputs and refresh the "configured" indicators.
      setAccessToken("");
      setAppSecret("");
      setVerifyToken("");
      loadConnection();
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.field) setFieldErrors({ [data.field]: data.error } as any);
      // 422 = Meta rejected the new credentials; the old connection is untouched.
      setMessage(
        err.response?.status === 422
          ? `Not saved: ${data?.error ?? "Meta rejected these credentials"}. Your previous connection is unchanged.`
          : data?.error ?? "Failed to save"
      );
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
    <div className="h-screen bg-[#f8f9ff] dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-hidden pl-72 transition-colors">
      {/* Shared workspace sidebar */}
      <Sidebar />

      {/* ======================= MAIN CONTENT WRAPPER ======================= */}
      <div className="h-full flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-16 border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-6 flex items-center justify-between z-10">
          <nav className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Link href="/chatbots" className="hover:text-slate-800 transition-colors">
              Workflows &amp; Bots
            </Link>
            <span>/</span>
            <span className="text-slate-700 font-semibold">WhatsApp Settings</span>
          </nav>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-700">
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : existing?.status === "ERROR" ? "bg-rose-500" : "bg-slate-400"}`}></span>
              {loading ? "Checking…" : statusLabel}
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-[#f8f9ff] dark:bg-slate-950 px-6 py-6">
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
                {botName && (
                  <span className="text-lg font-bold text-teal-700">
                    · <EditableBotName botId={chatbotId} name={botName} onRenamed={setBotName} inputClassName="text-lg font-bold" />
                  </span>
                )}
                {!loading && (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
                      connected
                        ? "bg-teal-50 text-teal-700 border-teal-200/60"
                        : existing?.status === "ERROR"
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-teal-600 animate-pulse" : existing?.status === "ERROR" ? "bg-rose-500" : "bg-slate-400"}`}></span>
                    {connected ? "Meta Cloud Connected" : statusLabel}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500">
                Connect to Meta to link your WhatsApp Business account, or configure credentials manually.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <span className="loading loading-spinner loading-lg text-teal-600"></span>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
            {loadError && (
              <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <span className="flex items-center gap-2">
                  <i className="ph-bold ph-warning-circle" aria-hidden="true"></i>
                  {loadError}
                </span>
                <button type="button" onClick={() => { setLoading(true); loadConnection(); }} className="text-xs font-semibold underline">
                  Retry
                </button>
              </div>
            )}

            {/* Primary flow — one-click "Connect to Meta" (auto-provisions credentials) */}
            <EmbeddedSignup chatbotId={chatbotId} connected={connected} onConnected={loadConnection} />

            {/* Live number health dashboard (always shown; explains its state) */}
            <ConnectionHealth chatbotId={chatbotId} onHealth={onHealth} />

            {/* Advanced setup — collapsible manual credential entry (fallback). */}
            <div>
              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-slate-200" />
                <button
                  type="button"
                  onClick={() => setShowManual((v) => !v)}
                  aria-expanded={showManual}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 hover:border-slate-300 transition"
                >
                  <i className={`ph-bold ph-caret-${showManual ? "up" : "down"} text-[12px]`} aria-hidden="true"></i>
                  {showManual ? "Hide advanced setup" : "Advanced: configure manually"}
                </button>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            </div>

            {showManual && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* ---------------- Main configuration form (8 cols) ---------------- */}
              {/* autoComplete off + non-credential names: this is NOT a login
                  form, so password managers must neither save nor fill it. */}
              <form
                onSubmit={handleSave}
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                noValidate
                className="lg:col-span-8 flex flex-col gap-6"
              >
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
                        name="wa_business_name"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        className={inputClass}
                        placeholder="e.g. Whatsbang Store"
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
                        name="wa_display_phone"
                        type="tel"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        aria-invalid={!!fieldErrors.phoneNumber || undefined}
                        aria-describedby={fieldErrors.phoneNumber ? "phone-number-err" : undefined}
                        className={`${inputClass} ${fieldErrors.phoneNumber ? "!border-rose-400" : ""}`}
                        placeholder="+1 (555) 000-0000"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                      />
                      {fieldErrors.phoneNumber && <p id="phone-number-err" className="text-[11px] text-rose-600">{fieldErrors.phoneNumber}</p>}
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
                        name="wa_phone_number_id"
                        inputMode="numeric"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        aria-invalid={!!fieldErrors.phoneNumberId || undefined}
                        aria-describedby="phone-number-id-hint"
                        className={`${inputClass} ${fieldErrors.phoneNumberId ? "!border-rose-400" : ""}`}
                        placeholder="e.g. 109845239847102"
                        value={phoneNumberId}
                        onChange={(e) => setPhoneNumberId(e.target.value)}
                      />
                      <p id="phone-number-id-hint" className={`text-[11px] ${fieldErrors.phoneNumberId ? "text-rose-600" : "text-slate-400"}`}>
                        {fieldErrors.phoneNumberId ?? "WhatsApp Manager → API Setup → Phone number ID. Not your System User ID."}
                      </p>
                    </div>

                    {/* WABA ID */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-700 flex items-center justify-between" htmlFor="waba-id">
                        <span>WABA ID</span>
                        <span className="text-[11px] text-slate-400 font-normal">WhatsApp Business Acct</span>
                      </label>
                      <input
                        id="waba-id"
                        name="wa_business_account_id"
                        inputMode="numeric"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        aria-invalid={!!fieldErrors.wabaId || undefined}
                        aria-describedby="waba-id-hint"
                        className={`${inputClass} ${fieldErrors.wabaId ? "!border-rose-400" : ""}`}
                        placeholder="e.g. 102290129340398"
                        value={wabaId}
                        onChange={(e) => setWabaId(e.target.value)}
                      />
                      <p id="waba-id-hint" className={`text-[11px] ${fieldErrors.wabaId ? "text-rose-600" : "text-slate-400"}`}>
                        {fieldErrors.wabaId ?? "Required for template synchronization."}
                      </p>
                    </div>

                    {/* System User ID — read-only, read from Meta (owner of the access token). */}
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="text-xs font-semibold text-slate-700 flex items-center justify-between" htmlFor="system-user-id">
                        <span>System User ID</span>
                        {existing?.systemUserId && (
                          <button
                            type="button"
                            onClick={() => copy(existing.systemUserId!, "suid")}
                            className="text-[11px] text-teal-700 hover:underline flex items-center gap-0.5"
                          >
                            <i className="ph ph-copy text-[13px]" aria-hidden="true"></i>
                            {copied === "suid" ? "Copied" : "Copy"}
                          </button>
                        )}
                      </label>
                      <input
                        id="system-user-id"
                        readOnly
                        tabIndex={-1}
                        autoComplete="off"
                        className={`${inputClass} bg-slate-50 text-slate-600`}
                        value={existing?.systemUserId ? `${existing.systemUserId}${existing.systemUserName ? ` · ${existing.systemUserName}` : ""}` : ""}
                        placeholder="Filled in automatically after the access token is verified"
                      />
                      <p className="text-[11px] text-slate-400">The Meta System User that owns the access token. Read from Meta, not editable.</p>
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
                      <SecretInput
                        id="access-token"
                        name="wa_meta_access_token"
                        className={`${inputClass} ${fieldErrors.accessToken ? "!border-rose-400" : ""}`}
                        placeholder={existing?.hasAccessToken ? "Saved — paste a new token to replace" : "EAA…"}
                        value={accessToken}
                        onChange={setAccessToken}
                        invalid={!!fieldErrors.accessToken}
                        describedBy={fieldErrors.accessToken ? "access-token-err" : undefined}
                      />
                      {fieldErrors.accessToken && <p id="access-token-err" className="text-[11px] text-rose-600">{fieldErrors.accessToken}</p>}
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
                      <SecretInput
                        id="app-secret"
                        name="wa_meta_app_secret"
                        className={`${inputClass} ${fieldErrors.appSecret ? "!border-rose-400" : ""}`}
                        placeholder={existing?.hasAppSecret ? "Saved — enter a new one to replace" : "32-character hex"}
                        value={appSecret}
                        onChange={setAppSecret}
                        invalid={!!fieldErrors.appSecret}
                        describedBy={fieldErrors.appSecret ? "app-secret-err" : undefined}
                      />
                      {fieldErrors.appSecret && <p id="app-secret-err" className="text-[11px] text-rose-600">{fieldErrors.appSecret}</p>}
                    </div>

                    {/* Verify Token */}
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="text-xs font-semibold text-slate-700 flex items-center justify-between" htmlFor="verify-token">
                        <span>Verify Token</span>
                        {existing?.hasVerifyToken && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            ✓ set
                          </span>
                        )}
                      </label>
                      <SecretInput
                        id="verify-token"
                        name="wa_webhook_verify_token"
                        className={`${inputClass} ${fieldErrors.verifyToken ? "!border-rose-400" : ""}`}
                        placeholder={existing?.hasVerifyToken ? "Saved — enter a new one to replace" : "Any string you choose"}
                        value={verifyToken}
                        onChange={setVerifyToken}
                        invalid={!!fieldErrors.verifyToken}
                        describedBy={fieldErrors.verifyToken ? "verify-token-err" : undefined}
                      />
                      {fieldErrors.verifyToken && <p id="verify-token-err" className="text-[11px] text-rose-600">{fieldErrors.verifyToken}</p>}
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
                      <p className={`text-sm font-medium ${/^(Saved\.|Connected)/.test(message) ? "text-emerald-600" : "text-rose-600"}`}>
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
                      <span className={`text-sm font-bold mt-1 ${connected ? "text-emerald-700" : existing?.status === "ERROR" ? "text-rose-700" : "text-slate-700"}`}>
                        {statusLabel}
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
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
