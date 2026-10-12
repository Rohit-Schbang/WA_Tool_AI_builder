"use client";

import { api } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

// Connect to Meta — the official Meta self-onboarding flow, presented as a
// single clean "Connect to Meta" button (in the spirit of "Sign in with
// Google"). Loads the Facebook JS SDK, launches FB.login with the
// Login-for-Business config, listens for the WA_EMBEDDED_SIGNUP session events
// (to capture waba_id + phone_number_id), and posts the returned auth code to
// our backend which exchanges it for a token and provisions the connection.

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

interface MetaConfig {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  solutionId: string | null;
  graphVersion: string;
}

type Step = "idle" | "connecting" | "provisioning" | "done" | "error";

// The Meta "infinity" wordmark glyph, rendered inline so the button looks
// official without depending on an icon font that may lack it.
function MetaGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 287 191" className={className} aria-hidden="true" fill="currentColor">
      <path d="M31.06 126.6c0 11 2.41 19.42 5.56 24.52 4.13 6.68 10.29 9.51 16.57 9.51 8.1 0 15.51-2.01 29.79-21.76 11.44-15.83 24.92-38.05 33.99-51.98l15.36-23.6c10.67-16.39 23.02-34.61 37.18-46.96C181.11 6.31 193.54 0 206.06 0c21.02 0 41.04 12.18 56.36 35.02 16.76 25.01 24.9 56.51 24.9 89.02 0 19.32-3.81 33.52-10.29 44.73-6.27 10.84-18.49 21.67-39.04 21.67v-30.98c17.6 0 21.99-16.17 21.99-34.67 0-26.37-6.15-55.63-19.71-76.55-9.62-14.83-22.1-23.9-35.83-23.9-14.85 0-26.79 11.2-40.23 31.17-7.14 10.61-14.47 23.54-22.7 38.13l-9.06 16.05c-18.21 32.27-22.83 39.62-31.95 51.77-15.97 21.27-29.6 29.3-47.57 29.3-21.22 0-34.63-9.19-42.94-23.03C3.06 156.72 0 141.9 0 125.01l31.06 1.59z"/>
      <path d="M24.49 37.21C38.7 15.4 59.2 0 82.71 0c13.61 0 27.14 4.03 41.28 15.57 15.46 12.62 31.94 33.4 52.51 67.65l7.38 12.3c17.81 29.66 27.94 44.92 33.87 52.12 7.63 9.24 12.98 11.99 19.92 11.99 17.6 0 21.99-16.17 21.99-34.67l27.4-.86c0 19.32-3.81 33.52-10.29 44.73-6.27 10.84-18.49 21.67-39.04 21.67-12.78 0-24.1-2.78-36.62-14.59-9.63-9.06-20.88-25.14-29.54-39.62l-25.76-43.02c-12.92-21.59-24.79-37.69-31.65-44.98-7.39-7.85-16.89-17.33-32.05-17.33-12.28 0-22.7 8.61-31.42 21.79L24.49 37.21z"/>
      <path d="M82.16 30.98c-12.28 0-22.7 8.61-31.42 21.79-12.33 18.61-19.88 46.34-19.88 72.95 0 11 2.41 19.42 5.56 24.52L10.36 168.9C3.06 156.72 0 141.9 0 125.01 0 94.27 8.44 62.22 24.49 37.21 38.7 15.4 59.2 0 82.71 0l-.55 30.98z"/>
    </svg>
  );
}

export function EmbeddedSignup({
  chatbotId,
  connected,
  onConnected,
}: {
  chatbotId: string;
  connected: boolean;
  onConnected: () => void;
}) {
  const [cfg, setCfg] = useState<MetaConfig | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");

  // Capture the session data (waba_id / phone_number_id) from the postMessage
  // listener; the FB.login callback provides the code separately.
  const sessionData = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  // 1. Fetch public Meta config (appId + configId) from our backend.
  useEffect(() => {
    api.get(`/api/chatbots/${chatbotId}/connection/meta-config`)
      .then((res) => setCfg(res.data))
      .catch(() => setCfg({ enabled: false, appId: null, configId: null, solutionId: null, graphVersion: "v22.0" }));
  }, [chatbotId]);

  // 2. Load the Facebook JS SDK once we know the appId.
  useEffect(() => {
    if (!cfg?.enabled || !cfg.appId) return;
    if (window.FB) { setSdkReady(true); return; }

    window.fbAsyncInit = function () {
      window.FB.init({
        appId: cfg.appId,
        cookie: true,
        xfbml: true,
        version: cfg.graphVersion,
      });
      setSdkReady(true);
    };

    const id = "facebook-jssdk";
    if (!document.getElementById(id)) {
      const js = document.createElement("script");
      js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.async = true;
      js.defer = true;
      document.body.appendChild(js);
    }
  }, [cfg]);

  // 3. Listen for the embedded-signup session events from Meta's popup.
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (typeof event.origin !== "string" || !event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH") {
          sessionData.current = {
            wabaId: data.data?.waba_id,
            phoneNumberId: data.data?.phone_number_id,
          };
        } else if (data.event === "CANCEL") {
          setStep("idle");
          setError(`Cancelled${data.data?.current_step ? ` at: ${data.data.current_step}` : ""}.`);
        } else if (data.event === "ERROR") {
          setStep("error");
          setError(data.data?.error_message || "Meta reported an error during signup.");
        }
      } catch {
        /* non-JSON messages from other sources — ignore */
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  // 4. Post the captured code + ids to our backend to finish provisioning.
  const finish = useCallback(async (code: string) => {
    setStep("provisioning");
    try {
      await api.post(`/api/chatbots/${chatbotId}/connection/embedded-signup`, {
        code,
        wabaId: sessionData.current.wabaId,
        phoneNumberId: sessionData.current.phoneNumberId,
      });
      setStep("done");
      onConnected();
    } catch (err: any) {
      setStep("error");
      setError(err.response?.data?.error ?? "Failed to complete the connection.");
    }
  }, [chatbotId, onConnected]);

  // 5. Launch the Meta OAuth popup.
  const launch = useCallback(() => {
    if (!window.FB || !cfg?.configId) return;
    setError("");
    setStep("connecting");
    sessionData.current = {};

    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (response?.status === "connected" && code) {
          finish(code); // exchange server-side immediately (~60s expiry)
        } else {
          setStep("idle");
          if (response?.status === "not_authorized") {
            setError("You logged in but didn't authorize the app.");
          }
        }
      },
      {
        config_id: cfg.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          sessionInfoVersion: "3",
          // Attribute the onboarded WhatsApp account to our Tech Provider
          // "solution" when configured (the BSP model used by Gupshup/Wati).
          ...(cfg.solutionId ? { setup: { solutionID: cfg.solutionId } } : { setup: {} }),
        },
      }
    );
  }, [cfg, finish]);

  const busy = step === "connecting" || step === "provisioning";

  // ---- Render ----

  // Not configured on the server yet — tell the user (manual entry is still
  // available below via the parent page's advanced setup).
  if (cfg && !cfg.enabled) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
          <i className="ph-bold ph-plug text-xl" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900">Connect to Meta</h2>
          <p className="text-sm text-slate-500 mt-1">
            One-click Meta connection isn&apos;t enabled on this server yet. You can still connect manually
            using the advanced setup below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-7 flex flex-col items-center text-center gap-5">
      {/* Brand mark */}
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0866FF] to-[#0064E0] flex items-center justify-center text-white shadow-md shadow-[#0866FF]/25">
        <MetaGlyph className="w-8 h-8" />
      </div>

      <div className="max-w-sm">
        <h2 className="text-lg font-bold text-slate-900">Connect to Meta</h2>
        <p className="text-sm text-slate-500 mt-1.5">
          {connected
            ? "Your WhatsApp Business account is linked. Reconnect any time to refresh credentials."
            : "Sign in with Meta and pick your WhatsApp Business account. We fetch the API credentials automatically — no tokens to copy."}
        </p>
      </div>

      {connected && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
          <i className="ph-fill ph-check-circle" /> Connected
        </span>
      )}

      {error && (
        <div className="w-full text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* The Connect-to-Meta button (Google-auth-style: single primary action) */}
      <button
        type="button"
        onClick={launch}
        disabled={!sdkReady || busy}
        className="group inline-flex items-center justify-center gap-3 w-full max-w-xs h-12 rounded-xl bg-[#0866FF] hover:bg-[#0064E0] text-white text-sm font-semibold shadow-sm shadow-[#0866FF]/30 active:scale-[0.99] transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? (
          <i className="ph-bold ph-spinner animate-spin text-lg" />
        ) : (
          <MetaGlyph className="w-5 h-5" />
        )}
        {step === "provisioning" ? "Finishing…"
          : step === "connecting" ? "Waiting for Meta…"
          : connected ? "Reconnect to Meta"
          : "Continue with Meta"}
      </button>

      {!sdkReady && cfg?.enabled && (
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <i className="ph ph-spinner animate-spin" /> Loading Meta…
        </span>
      )}
      {step === "done" && (
        <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
          <i className="ph-fill ph-check-circle" /> Credentials provisioned automatically.
        </span>
      )}

      <p className="text-[11px] text-slate-400 max-w-xs">
        By continuing you authorize this app to manage the WhatsApp Business account you select.
      </p>
    </div>
  );
}
