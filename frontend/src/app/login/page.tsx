"use client";

import { api } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// Password strength scoring: returns a 0-4 score plus a label, bar color,
// and a hint describing what's still missing.
type Strength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  barClass: string;
  textClass: string;
  hint: string;
};

function getPasswordStrength(pw: string): Strength {
  if (!pw) {
    return {
      score: 0,
      label: "Enter a password",
      barClass: "bg-slate-200",
      textClass: "text-slate-400",
      hint: "Min. 8 characters",
    };
  }

  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const longEnough = pw.length >= 8;
  const veryLong = pw.length >= 12;

  // Base points from character variety.
  let points = 0;
  if (hasLower) points += 1;
  if (hasUpper) points += 1;
  if (hasDigit) points += 1;
  if (hasSymbol) points += 1;
  if (veryLong) points += 1;

  // A password shorter than 8 chars can never rank above "Weak".
  let score: 0 | 1 | 2 | 3 | 4;
  if (!longEnough) {
    score = 1;
  } else if (points <= 2) {
    score = 2;
  } else if (points === 3) {
    score = 3;
  } else {
    score = 4;
  }

  const missing: string[] = [];
  if (!longEnough) missing.push("8+ characters");
  if (!hasUpper) missing.push("an uppercase letter");
  if (!hasDigit) missing.push("a number");
  if (!hasSymbol) missing.push("a symbol");

  const meta: Record<number, { label: string; barClass: string; textClass: string }> = {
    1: { label: "Weak password", barClass: "bg-error", textClass: "text-error" },
    2: { label: "Fair password", barClass: "bg-peach-500", textClass: "text-peach-600" },
    3: { label: "Good password", barClass: "bg-teal-500", textClass: "text-teal-700" },
    4: { label: "Strong password", barClass: "bg-teal-600", textClass: "text-teal-700" },
  };

  const { label, barClass, textClass } = meta[score];
  const hint = missing.length ? `Add ${missing.join(", ")}` : "Includes numbers & symbols";

  return { score, label, barClass, textClass, hint };
}

// Small inline brand mark for PingFlow — avoids depending on an external image asset.
function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <div className={`${className} rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-sm shrink-0`}>
      <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
        bolt
      </span>
    </div>
  );
}

// Google "G" icon used by the social auth buttons.
function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
    </svg>
  );
}

// Right-side showcase: realistic animated WhatsApp Business chat mockup + floating metric cards.
// Shared between the Sign In and Create Account screens.
function Showcase() {
  return (
    <div className="lg:col-span-7 xl:col-span-7 relative flex flex-col items-center">
      <div className="w-full relative bg-gradient-to-br from-teal-50/60 via-slate-50/70 to-peach-50/60 border border-teal-100/80 rounded-3xl p-5 sm:p-7 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="flex flex-col xl:flex-row gap-6 items-center">
          {/* Phone frame */}
          <div className="w-full max-w-[315px] shrink-0 bg-[#0B141B] rounded-[2.5rem] p-2.5 shadow-2xl shadow-slate-900/15 border-[5px] border-slate-800">
            <div className="bg-[#EFEAE2] rounded-[2rem] overflow-hidden flex flex-col h-[520px] relative">
              {/* Status bar */}
              <div className="bg-[#005D4B] px-4 pt-2 pb-1.5 flex justify-between items-center text-white/90 text-[10px] font-medium tracking-wide">
                <span>9:41</span>
                <div className="w-14 h-3 bg-black/30 rounded-full" />
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">signal_cellular_alt</span>
                  <span className="material-symbols-outlined text-[13px]">wifi</span>
                  <span className="material-symbols-outlined text-[13px]">battery_full</span>
                </div>
              </div>

              {/* Chat header */}
              <div className="bg-[#005D4B] px-3 py-2 flex items-center justify-between text-white border-b border-teal-700/50">
                <div className="flex items-center gap-2">
                  <button type="button" className="text-white hover:opacity-80 -ml-1">
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                  </button>
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-teal-700">
                      <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#005D4B]">
                      <span className="material-symbols-outlined text-white text-[8px] font-bold">check</span>
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <h3 className="font-bold text-[11px] text-white leading-tight truncate">PingFlow Concierge</h3>
                      <span className="material-symbols-outlined text-emerald-300 text-[13px] shrink-0">verified</span>
                    </div>
                    <p className="text-[9px] text-teal-100/90 leading-tight truncate">Online • Replies instantly</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-white/90 shrink-0">
                  <span className="material-symbols-outlined text-[17px]">videocam</span>
                  <span className="material-symbols-outlined text-[16px]">call</span>
                  <span className="material-symbols-outlined text-[16px]">more_vert</span>
                </div>
              </div>

              {/* Chat body */}
              <div className="flex-1 p-2.5 space-y-2.5 overflow-y-auto bg-[radial-gradient(#005D4B08_1px,transparent_1px)] [background-size:14px_14px]">
                <div className="flex justify-center">
                  <span className="bg-white/80 backdrop-blur-sm text-slate-600 text-[9px] font-medium px-2 py-0.5 rounded-md border border-slate-200/50 uppercase tracking-wide">
                    Today
                  </span>
                </div>

                <div className="flex justify-end">
                  <div className="max-w-[85%] bg-[#E7FFDB] text-slate-800 rounded-2xl rounded-tr-sm px-2.5 py-1.5 text-[11px] border border-[#D0F2BE]">
                    <p className="leading-snug">Hi! I left items in my cart earlier, do you have that 15% discount code?</p>
                    <div className="flex items-center justify-end gap-1 mt-0.5 text-[9px] text-slate-400">
                      <span>10:41 AM</span>
                      <span className="material-symbols-outlined text-teal-600 text-[12px]">done_all</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-start">
                  <div className="max-w-[92%] bg-white rounded-2xl rounded-tl-sm p-2 text-[11px] border border-slate-200/70 text-slate-800 space-y-1.5">
                    <p className="leading-snug">
                      Hey Sarah! 👋 Yes, we reserved your items for 2 hours. Here is your VIP code:{" "}
                      <strong className="text-teal-700 bg-teal-50 px-1 py-0.5 rounded border border-teal-200 font-mono text-[10px]">VIP15</strong>.
                    </p>
                    <div className="bg-slate-50 border border-slate-200/80 rounded-lg overflow-hidden p-1.5 flex items-center gap-2">
                      <div className="w-10 h-10 rounded-md bg-teal-900/10 flex items-center justify-center text-teal-700 shrink-0">
                        <span className="material-symbols-outlined text-[20px]">headphones</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-800 text-[11px] truncate leading-tight">Ultra Titanium Headphones</h4>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="font-bold text-teal-800 text-[11px]">$102.00</span>
                          <span className="line-through text-slate-400 text-[9px]">$120.00</span>
                          <span className="text-[8px] bg-peach-100 text-peach-700 font-semibold px-1 rounded">-15%</span>
                        </div>
                      </div>
                    </div>
                    <div className="pt-0.5 space-y-1">
                      <button type="button" className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold text-[10.5px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-colors">
                        <span className="material-symbols-outlined text-[13px] text-peach-300">bolt</span>
                        <span>⚡ Complete Checkout (15% Off)</span>
                      </button>
                      <button type="button" className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[10px] py-1 px-2 rounded-lg flex items-center justify-center gap-1 transition-colors">
                        <span className="material-symbols-outlined text-[13px] text-teal-600">forum</span>
                        <span>💬 Speak to Live Agent</span>
                      </button>
                    </div>
                    <div className="flex items-center justify-end text-[9px] text-slate-400 pt-0.5">
                      <span>10:41 AM</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="bg-[#E7FFDB] text-slate-800 rounded-xl rounded-tr-sm px-2.5 py-1 text-[10px] font-medium border border-[#D0F2BE] flex items-center gap-1">
                    <span className="material-symbols-outlined text-teal-700 text-[12px]">check_circle</span>
                    <span>Order #PF-8821 confirmed!</span>
                    <span className="material-symbols-outlined text-teal-600 text-[11px] ml-0.5">done_all</span>
                  </div>
                </div>
              </div>

              {/* Input footer */}
              <div className="bg-[#F0F2F5] px-2 py-1.5 flex items-center gap-1.5 border-t border-slate-200">
                <div className="flex items-center gap-0.5 text-slate-500">
                  <span className="material-symbols-outlined text-[18px]">mood</span>
                  <span className="material-symbols-outlined text-[18px]">attach_file</span>
                </div>
                <div className="flex-1 bg-white rounded-full px-2.5 py-1 text-[11px] text-slate-400 border border-slate-200 flex items-center justify-between">
                  <span className="truncate">Type a message...</span>
                  <span className="material-symbols-outlined text-[15px] text-slate-400 shrink-0 ml-1">photo_camera</span>
                </div>
                <button type="button" className="w-7 h-7 rounded-full bg-[#005D4B] text-white flex items-center justify-center shrink-0 hover:bg-teal-700 transition-colors">
                  <span className="material-symbols-outlined text-[15px]">mic</span>
                </button>
              </div>
            </div>
          </div>

          {/* Floating metric cards */}
          <div className="flex-1 w-full flex flex-col gap-3.5 justify-center">
            <div className="animate-float-1 bg-white p-4 rounded-2xl border border-teal-100 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-teal-700 uppercase tracking-wider">Engagement</span>
                <span className="material-symbols-outlined text-teal-600 text-[20px]">mark_email_read</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-slate-900 tracking-tight">98.2%</span>
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">vs 21% Email</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 font-medium">Message Open Rate within 3 minutes</p>
            </div>

            <div className="animate-float-2 bg-white p-4 rounded-2xl border border-peach-200/80 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-peach-600 uppercase tracking-wider">Revenue Impact</span>
                <span className="material-symbols-outlined text-peach-500 text-[20px]">bolt</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-slate-900 tracking-tight">3.4x</span>
                <span className="text-xs font-semibold text-peach-600 bg-peach-50 px-2 py-0.5 rounded-full border border-peach-200">+240% Lift</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 font-medium">Checkout Conversion on abandoned journeys</p>
            </div>

            <div className="animate-float-3 bg-white/95 p-3.5 rounded-2xl border border-teal-200/70 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
                <span className="material-symbols-outlined text-[22px]">verified</span>
              </div>
              <div>
                <h4 className="font-bold text-xs text-slate-900">Official WhatsApp Cloud API Partner</h4>
                <p className="text-[11px] text-slate-500">Tier-1 Meta BSP with end-to-end encryption &amp; sub-500ms webhook latency.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();

  // Current mode: login or register
  const [mode, setMode] = useState<"login" | "register">("login");

  // Form inputs
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [remember, setRemember] = useState(true);

  // UI state
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isRegister = mode === "register";
  const strength = useMemo(() => getPasswordStrength(password), [password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const path = isRegister ? "/api/auth/register" : "/api/auth/login";
      const payload = isRegister
        ? { email, name, password, phone: phone ? `${countryCode}${phone}` : undefined }
        : { email, password };
      const res = await api.post(path, payload);
      saveToken(res.data.token);
      router.push("/chatbots");
    } catch (error: any) {
      setError(error.response?.data?.error ?? "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }

  function switchMode() {
    setMode(isRegister ? "login" : "register");
    setError("");
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans text-slate-800 antialiased flex flex-col justify-between selection:bg-teal-100 selection:text-teal-900 relative overflow-x-hidden">
      {/* Ambient serene glow accents */}
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-teal-200/20 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="fixed top-1/3 right-10 w-96 h-96 bg-peach-100/35 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="fixed -bottom-20 left-10 w-80 h-80 bg-teal-100/30 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-6 sm:px-8 pt-6 flex items-center justify-between">
        <a href="/login" className="flex items-center gap-2.5 group">
          <Logo className="h-9 w-9" />
          <span className="font-bold text-lg text-slate-900 tracking-tight group-hover:text-teal-700 transition-colors">PingFlow</span>
        </a>
        <div className="flex items-center gap-2 bg-teal-50/90 border border-teal-200/80 text-teal-800 text-xs font-semibold px-3 py-1 rounded-full">
          <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
          <span>WhatsApp Cloud API Ready</span>
        </div>
      </header>

      <main className="w-full flex-1 flex flex-col justify-center py-8 lg:py-12 px-6 sm:px-8">
        <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Column: Auth Form */}
          <div className="lg:col-span-5 xl:col-span-5 flex flex-col justify-center py-2 lg:pr-4">
            {/* Brand & header */}
            {isRegister ? (
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Logo className="w-11 h-11" />
                  <span className="font-bold text-lg text-slate-900 tracking-tight">PingFlow</span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-peach-600 bg-peach-50 px-3 py-1 rounded-full border border-peach-200/70 tracking-wider uppercase font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-peach-500 animate-ping" />
                  14-day free trial
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3 mb-6">
                <Logo className="w-11 h-11" />
                <div>
                  <span className="font-bold text-lg text-slate-900 tracking-tight block">PingFlow</span>
                  <span className="text-[11px] text-peach-600 bg-peach-50 px-2 py-0.5 rounded-full border border-peach-200/70 tracking-wider uppercase font-semibold">
                    Workspace Auth
                  </span>
                </div>
              </div>
            )}

            <div className="mb-6">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1.5 tracking-tight">
                {isRegister ? "Build journeys that convert" : "Welcome back"}
              </h1>
              <p className="text-sm text-slate-600">
                {isRegister
                  ? "Automate onboarding, abandoned cart recovery, and 24/7 AI chat flows on WhatsApp Cloud API."
                  : "Log in to manage and trigger your automated customer journeys."}
              </p>
            </div>

            {isRegister && (
              <button
                type="button"
                className="w-full h-11 mb-4 px-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2.5"
              >
                <GoogleIcon />
                <span>Sign up with Google</span>
              </button>
            )}

            {isRegister && (
              <div className="relative mb-4 flex items-center justify-center">
                <div className="w-full h-px bg-slate-200" />
                <span className="absolute bg-[#f8fafc] px-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                  Or with work email
                </span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5" htmlFor="fullname">
                    Full Name
                  </label>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3 text-slate-400 pointer-events-none select-none text-[20px]">badge</span>
                    <input
                      id="fullname"
                      type="text"
                      placeholder="Ada Lovelace"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full h-11 pl-10 pr-3.5 bg-white text-slate-800 border border-slate-200 text-sm rounded-xl shadow-sm placeholder:text-slate-400 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5" htmlFor="work-email">
                  Work Email
                </label>
                <div className="relative flex items-center">
                  <span className="material-symbols-outlined absolute left-3 text-slate-400 pointer-events-none select-none text-[20px]">mail</span>
                  <input
                    id="work-email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full h-11 pl-10 pr-3.5 bg-white text-slate-800 border border-slate-200 text-sm rounded-xl shadow-sm placeholder:text-slate-400 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
                  />
                </div>
              </div>

              {isRegister && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5" htmlFor="phone">
                    WhatsApp Business Number
                  </label>
                  <div className="flex gap-2">
                    <div className="relative w-36 shrink-0">
                      <select
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        className="w-full h-11 pl-3 pr-8 bg-white text-slate-800 border border-slate-200 text-sm rounded-xl shadow-sm appearance-none focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
                      >
                        <option value="+1">🇺🇸 +1 (US)</option>
                        <option value="+91">🇮🇳 +91 (IN)</option>
                        <option value="+44">🇬🇧 +44 (UK)</option>
                        <option value="+49">🇩🇪 +49 (DE)</option>
                        <option value="+65">🇸🇬 +65 (SG)</option>
                        <option value="+55">🇧🇷 +55 (BR)</option>
                      </select>
                      <span className="material-symbols-outlined absolute right-2.5 top-2.5 text-slate-400 pointer-events-none text-[20px]">expand_more</span>
                    </div>
                    <div className="relative flex items-center flex-1">
                      <span className="material-symbols-outlined absolute left-3 text-slate-400 pointer-events-none select-none text-[20px]">chat</span>
                      <input
                        id="phone"
                        type="tel"
                        placeholder="98765 43210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full h-11 pl-10 pr-3.5 bg-white text-slate-800 border border-slate-200 text-sm rounded-xl shadow-sm placeholder:text-slate-400 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700" htmlFor="account-password">
                    {isRegister ? "Create Password" : "Password"}
                  </label>
                  {!isRegister && (
                    <a href="#" className="text-xs font-semibold text-teal-700 hover:text-teal-800 transition-colors">
                      Forgot password?
                    </a>
                  )}
                </div>
                <div className="relative flex items-center">
                  <span className="material-symbols-outlined absolute left-3 text-slate-400 pointer-events-none select-none text-[20px]">lock</span>
                  <input
                    id="account-password"
                    type={showPassword ? "text" : "password"}
                    placeholder={isRegister ? "Min. 8 characters" : "••••••••••••"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full h-11 pl-10 pr-10 bg-white text-slate-800 border border-slate-200 text-sm rounded-xl shadow-sm placeholder:text-slate-400 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label="Toggle password visibility"
                    className="absolute right-3 text-slate-400 hover:text-slate-600 transition-colors flex items-center justify-center p-1"
                  >
                    <span className="material-symbols-outlined text-[20px]">{showPassword ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>

                {isRegister && (
                  <>
                    <div className="mt-2 flex items-center gap-1.5">
                      {[1, 2, 3, 4].map((bar) => (
                        <div
                          key={bar}
                          className={`h-1.5 flex-1 rounded-full transition-colors ${
                            strength.score >= bar ? strength.barClass : "bg-slate-200"
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between items-center mt-1 gap-2">
                      <span className={`text-xs font-semibold ${strength.textClass}`}>{strength.label}</span>
                      <span className="text-xs text-slate-500 text-right">{strength.hint}</span>
                    </div>
                  </>
                )}
              </div>

              {isRegister ? (
                <label className="flex items-start gap-2.5 cursor-pointer select-none py-0.5">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-teal-600 focus:ring-teal-500/20 accent-teal-600 cursor-pointer border-slate-300"
                  />
                  <span className="text-xs text-slate-600 leading-tight">
                    I agree to PingFlow's <a href="#" className="text-teal-700 hover:underline font-medium">Terms of Service</a>,{" "}
                    <a href="#" className="text-teal-700 hover:underline font-medium">Data Processing Addendum</a>, and{" "}
                    <a href="#" className="text-teal-700 hover:underline font-medium">Privacy Policy</a>.
                  </span>
                </label>
              ) : (
                <div className="flex items-center justify-between py-0.5">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500/20 accent-teal-600 cursor-pointer border-slate-300"
                    />
                    <span className="text-xs text-slate-600">Remember this workstation for 30 days</span>
                  </label>
                </div>
              )}

              {error && <p className="text-xs text-error">{error}</p>}

              <button
                type="submit"
                disabled={isLoading || (isRegister && !agreed)}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-semibold text-sm rounded-xl shadow-md shadow-teal-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:active:scale-100"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Authenticating Session...</span>
                  </>
                ) : (
                  <>
                    <span>{isRegister ? "Start Building Free" : "Sign In to Workspace"}</span>
                    <span className="material-symbols-outlined text-[18px] group-hover:translate-x-0.5 transition-transform">arrow_forward</span>
                  </>
                )}
              </button>
            </form>

            {!isRegister && (
              <>
                <div className="relative my-6 flex items-center justify-center">
                  <div className="w-full h-px bg-slate-200" />
                  <span className="absolute bg-[#f8fafc] px-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Or quick access</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button type="button" className="h-10 px-3.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2.5">
                    <GoogleIcon />
                    <span>Google Workspace</span>
                  </button>
                  <button type="button" className="h-10 px-3.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-teal-600">chat</span>
                    <span>WhatsApp OTP</span>
                  </button>
                </div>
              </>
            )}

            {/* Footer / mode switch */}
            <div className={isRegister ? "mt-6 text-center" : "mt-6 pt-4"}>
              {isRegister ? (
                <p className="text-xs text-slate-600">
                  Already using PingFlow?
                  <button type="button" onClick={switchMode} className="font-semibold text-teal-700 hover:text-teal-800 transition-colors underline ml-1">
                    Sign In
                  </button>
                </p>
              ) : (
                <p className="text-xs text-slate-600 text-center sm:text-left">
                  Don't have an account?
                  <button type="button" onClick={switchMode} className="font-semibold text-teal-700 hover:text-teal-800 transition-colors underline ml-1">
                    Start 14-day free trial
                  </button>
                </p>
              )}
              <div className="mt-3 flex items-center gap-1.5 text-slate-500 text-xs justify-center sm:justify-start">
                <span className="material-symbols-outlined text-[16px] text-teal-600">verified_user</span>
                <span>SOC2 Type II Certified Infrastructure • 99.99% Guaranteed SLA</span>
              </div>
            </div>
          </div>

          <Showcase />
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 sm:px-8 pb-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-500 text-xs">
        <p>© 2024 PingFlow Inc. High-velocity visual journey orchestration.</p>
        <div className="flex items-center gap-6">
          <a className="hover:text-slate-800 transition-colors" href="#">Privacy Policy</a>
          <a className="hover:text-slate-800 transition-colors" href="#">Terms of Service</a>
          <a className="hover:text-slate-800 transition-colors" href="#">System Status</a>
        </div>
      </footer>
    </div>
  );
}
