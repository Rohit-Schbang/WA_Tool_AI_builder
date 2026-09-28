"use client";

import { api } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

// WhatsApp Embedded Signup — the official Meta self-onboarding flow.
// Loads the Facebook JS SDK, launches FB.login with the Login-for-Business
// config, listens for the WA_EMBEDDED_SIGNUP session events (to capture
// waba_id + phone_number_id), and posts the returned auth code to our backend
// which exchanges it for a token and provisions the connection automatically.

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
  graphVersion: string;
}

type Step = "idle" | "connecting" | "provisioning" | "done" | "error";

// The stepper stages shown to the user (mirrors what Meta's popup walks through).
const STEPS = [
  { key: "login", label: "Log in to Meta", icon: "ph-sign-in" },
  { key: "business", label: "Business & WABA", icon: "ph-buildings" },
  { key: "phone", label: "Verify number", icon: "ph-phone" },
  { key: "done", label: "Connected", icon: "ph-check-circle" },
];

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
  const [activeStage, setActiveStage] = useState(0);
  const [error, setError] = useState("");

  // Capture the session data (waba_id / phone_number_id) from the postMessage
  // listener; the FB.login callback provides the code separately.
  const sessionData = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  // 1. Fetch public Meta config (appId + configId) from our backend.
  useEffect(() => {
    api.get(`/api/chatbots/${chatbotId}/connection/meta-config`)
      .then((res) => setCfg(res.data))
      .catch(() => setCfg({ enabled: false, appId: null, configId: null, graphVersion: "v22.0" }));
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
          setActiveStage(3);
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
      setActiveStage(3);
      onConnected();
    } catch (err: any) {
      setStep("error");
      setError(err.response?.data?.error ?? "Failed to complete the connection.");
    }
  }, [chatbotId, onConnected]);

  // 5. Launch the popup.
  const launch = useCallback(() => {
    if (!window.FB || !cfg?.configId) return;
    setError("");
    setStep("connecting");
    setActiveStage(1);
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
          setup: {},
        },
      }
    );
  }, [cfg, finish]);

  // ---- Render ----

  // Not configured on the server yet — tell the user (and keep manual entry
  // available below via the parent page).
  if (cfg && !cfg.enabled) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-6 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
          <i className="ph-bold ph-plug text-xl" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900">One-click WhatsApp connection</h2>
          <p className="text-sm text-slate-500 mt-1">
            The one-click Meta signup isn&apos;t enabled on this server yet. You can still connect manually
            using the credentials form below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-6 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#25D366]/10 flex items-center justify-center text-[#128C7E] shrink-0">
            <i className="ph-fill ph-whatsapp-logo text-2xl" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Connect WhatsApp in one click</h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-md">
              Log in with Meta and pick (or create) your WhatsApp Business Account. We&apos;ll fetch the API
              credentials automatically — no manual token copying.
            </p>
          </div>
        </div>
        {connected && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold shrink-0">
            <i className="ph-fill ph-check-circle" /> Connected
          </span>
        )}
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const state = connected || step === "done"
            ? "done"
            : i < activeStage ? "done" : i === activeStage && step !== "idle" ? "active" : "todo";
          return (
            <div key={s.key} className="flex items-center gap-1.5 flex-1">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold w-full justify-center transition ${
                  state === "done" ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : state === "active" ? "bg-teal-50 text-teal-700 border border-teal-200"
                  : "bg-slate-50 text-slate-400 border border-slate-200"
                }`}
              >
                <i className={`ph-bold ${state === "active" ? "ph-spinner animate-spin" : s.icon}`} />
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={launch}
          disabled={!sdkReady || step === "connecting" || step === "provisioning"}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1877F2] hover:bg-[#166FE0] text-white text-sm font-semibold shadow-sm active:scale-[0.99] transition disabled:opacity-60"
        >
          <i className="ph-fill ph-facebook-logo text-lg" />
          {step === "provisioning" ? "Finishing…"
            : step === "connecting" ? "Waiting for Meta…"
            : connected ? "Reconnect with Facebook"
            : "Continue with Facebook"}
        </button>
        {!sdkReady && cfg?.enabled && (
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <i className="ph ph-spinner animate-spin" /> Loading Meta SDK…
          </span>
        )}
        {step === "done" && (
          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
            <i className="ph-fill ph-check-circle" /> Credentials provisioned automatically.
          </span>
        )}
      </div>
    </div>
  );
}
