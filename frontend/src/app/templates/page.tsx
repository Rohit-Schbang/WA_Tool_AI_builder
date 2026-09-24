"use client";

import { clearToken, getToken } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "@/app/components/Sidebar";

// Static WhatsApp Message Templates page. All data below is hard-coded to
// mirror the provided design; there is no backend wiring here.

export default function TemplatesPage() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncLabel, setSyncLabel] = useState("Sync with Meta");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
    }
  }, []);

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  // Micro-interaction for the "Sync with Meta" button (matches the original script).
  function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncLabel("Syncing...");
    setTimeout(() => {
      setSyncLabel("Synced with Meta");
      setTimeout(() => {
        setSyncLabel("Sync with Meta");
        setSyncing(false);
      }, 1500);
    }, 1000);
  }

  return (
    <div className="bg-surface font-sans text-on-surface antialiased min-h-screen">
      {/* Sidebar */}
      <Sidebar active="templates" />

      {/* Main area */}
      <div className="pl-72 flex flex-col min-h-screen">
        {/* Header */}
        <header className="fixed top-0 left-72 right-0 h-16 bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-40 flex items-center justify-between px-space-lg">
          <div className="flex items-center gap-space-md">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-lowest shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
              <span className="h-2 w-2 rounded-full bg-primary"></span>
              <span className="font-label-sm text-label-sm text-on-surface">Meta Cloud Connected</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant font-normal">• Active</span>
            </div>
          </div>
          <div className="flex items-center gap-space-md">
            <a className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high font-label-md text-label-md transition-all" href="#">
              <span className="material-symbols-outlined text-[18px]">help</span>
              <span>Help / Docs</span>
            </a>
            <button aria-label="Notifications" className="relative p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all">
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-secondary-container"></span>
            </button>
            <div className="h-6 w-px bg-surface-container-highest"></div>
            <button onClick={handleLogout} className="flex items-center gap-3 pl-1 group" title="Log out">
              <div className="flex flex-col text-right">
                <span className="font-label-md text-label-md text-on-surface font-semibold">Log out</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">End session</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center group-hover:opacity-90 transition-opacity">
                <span className="material-symbols-outlined text-on-primary text-[18px]">logout</span>
              </div>
            </button>
          </div>
        </header>

        <main className="w-full pt-16 bg-surface flex-1">
          <div className="flex flex-col w-full">
            <div className="px-space-xl py-space-lg flex flex-col gap-space-lg max-w-[1440px] mx-auto w-full">
              {/* Breadcrumbs & Meta State Indicator */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <a className="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors" href="#">
                    Workflows &amp; Bots
                  </a>
                  <span className="material-symbols-outlined text-outline-variant text-[16px]">chevron_right</span>
                  <span className="font-label-md text-label-md text-on-surface font-semibold">Templates</span>
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold">
                    HSM v2.4
                  </span>
                </div>
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm">
                  <span className="material-symbols-outlined text-[14px] text-primary">cloud_done</span>
                  <span>
                    Meta WABA ID: <strong className="font-semibold text-on-surface">waba_994102834</strong>
                  </span>
                  <span className="text-outline-variant">•</span>
                  <span className="text-primary font-semibold">Live Sync Active</span>
                </div>
              </div>

              {/* Header Section with Distinct Visual Weight */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md bg-surface-container-lowest p-space-lg rounded-xl shadow-sm">
                <div className="max-w-2xl">
                  <div className="inline-flex items-center gap-1.5 mb-2 px-2.5 py-0.5 rounded-md bg-surface-container text-primary font-label-sm text-label-sm tracking-wide uppercase">
                    <span className="material-symbols-outlined text-[15px]">rate_review</span>
                    <span>Official Meta HSM Hub</span>
                  </div>
                  <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
                    WhatsApp Message Templates
                  </h1>
                  <p className="mt-1 font-body-md text-body-md text-on-surface-variant leading-relaxed">
                    Create, sync, and monitor Meta-approved HSM message templates for automated journeys and broadcast
                    campaigns with zero delivery latency.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-lg text-label-lg transition-all active:scale-[0.99] disabled:opacity-70"
                  >
                    <span
                      className={`material-symbols-outlined text-[18px] text-primary transition-transform duration-700 ${
                        syncing ? "rotate-180" : ""
                      }`}
                    >
                      sync
                    </span>
                    <span>{syncLabel}</span>
                  </button>
                  <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-container text-on-primary-container hover:bg-primary font-label-lg text-label-lg shadow-sm transition-all active:scale-[0.99]">
                    <span className="material-symbols-outlined text-[20px]">add</span>
                    <span>Create Template</span>
                  </button>
                </div>
              </div>

              {/* Meta Approval Status Bar / KPI Row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
                {/* Approved Templates */}
                <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                      Approved Templates
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-headline-xl text-headline-xl text-on-surface font-bold">18</span>
                      <span className="font-label-sm text-label-sm text-primary font-medium">85.7% total</span>
                    </div>
                  </div>
                  <div className="h-10 w-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[22px]">check_circle</span>
                  </div>
                </div>

                {/* Pending Review */}
                <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                      Pending Meta Review
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-headline-xl text-headline-xl text-on-surface font-bold">2</span>
                      <span className="font-label-sm text-label-sm text-secondary font-medium">Avg ~1.4 hrs</span>
                    </div>
                  </div>
                  <div className="h-10 w-10 rounded-full bg-secondary-fixed flex items-center justify-center text-secondary">
                    <span className="material-symbols-outlined text-[22px]">schedule</span>
                  </div>
                </div>

                {/* Rejected / Action Required */}
                <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                      Action Required
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-headline-xl text-headline-xl text-error font-bold">1</span>
                      <span className="font-label-sm text-label-sm text-error font-medium">Policy Fix</span>
                    </div>
                  </div>
                  <div className="h-10 w-10 rounded-full bg-error-container flex items-center justify-center text-error">
                    <span className="material-symbols-outlined text-[22px]">error</span>
                  </div>
                </div>

                {/* Supported Languages */}
                <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                      Languages Active
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-headline-xl text-headline-xl text-on-surface font-bold">4</span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant">EN, ES, HI, DE</span>
                    </div>
                  </div>
                  <div className="h-10 w-10 rounded-full bg-tertiary-fixed flex items-center justify-center text-tertiary">
                    <span className="material-symbols-outlined text-[22px]">translate</span>
                  </div>
                </div>
              </div>

              {/* Filter & Controls Toolbar */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-surface-container-lowest p-3 rounded-xl shadow-sm">
                  {/* Category Tabs */}
                  <div className="flex items-center gap-1 overflow-x-auto p-1 bg-surface-container-low rounded-lg">
                    <button className="px-3.5 py-1.5 rounded-md bg-surface-container-lowest shadow-sm font-label-md text-label-md text-primary font-semibold transition-all">
                      All Templates <span className="ml-1 text-on-surface-variant text-[11px] font-normal">21</span>
                    </button>
                    <button className="px-3.5 py-1.5 rounded-md hover:bg-surface-container-high font-label-md text-label-md text-on-surface-variant transition-all">
                      Marketing <span className="ml-1 text-on-surface-variant text-[11px]">11</span>
                    </button>
                    <button className="px-3.5 py-1.5 rounded-md hover:bg-surface-container-high font-label-md text-label-md text-on-surface-variant transition-all">
                      Utility <span className="ml-1 text-on-surface-variant text-[11px]">7</span>
                    </button>
                    <button className="px-3.5 py-1.5 rounded-md hover:bg-surface-container-high font-label-md text-label-md text-on-surface-variant transition-all">
                      Authentication <span className="ml-1 text-on-surface-variant text-[11px]">3</span>
                    </button>
                  </div>

                  {/* Filter Dropdowns & Live Search */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Search */}
                    <div className="relative flex-1 sm:w-80">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-outline-variant text-[18px]">
                        search
                      </span>
                      <input
                        className="w-full pl-9 pr-4 py-2 bg-surface-container-low focus:bg-surface-container-lowest rounded-lg font-body-sm text-body-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none transition-colors"
                        placeholder="Search templates by name, body text..."
                        type="text"
                      />
                    </div>

                    {/* Status Dropdown */}
                    <div className="relative">
                      <select className="appearance-none pl-3 pr-8 py-2 bg-surface-container-low rounded-lg font-label-sm text-label-sm text-on-surface focus:outline-none cursor-pointer">
                        <option>All Statuses</option>
                        <option>Approved</option>
                        <option>Pending</option>
                        <option>Rejected</option>
                      </select>
                      <span className="material-symbols-outlined absolute right-2 top-2.5 text-on-surface-variant text-[16px] pointer-events-none">
                        expand_more
                      </span>
                    </div>

                    {/* Language Dropdown */}
                    <div className="relative">
                      <select className="appearance-none pl-3 pr-8 py-2 bg-surface-container-low rounded-lg font-label-sm text-label-sm text-on-surface focus:outline-none cursor-pointer">
                        <option>All Languages</option>
                        <option>English (US)</option>
                        <option>Spanish (es_ES)</option>
                        <option>German (de_DE)</option>
                        <option>Hindi (hi_IN)</option>
                      </select>
                      <span className="material-symbols-outlined absolute right-2 top-2.5 text-on-surface-variant text-[16px] pointer-events-none">
                        expand_more
                      </span>
                    </div>

                    <button
                      className="p-2 rounded-lg bg-surface-container-low hover:bg-surface-container-high text-on-surface-variant transition-colors"
                      title="Table or Grid view"
                    >
                      <span className="material-symbols-outlined text-[20px]">grid_view</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Template Grid: WhatsApp-style Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-lg">
                {/* Card 1: order_confirmation_v2 */}
                <div className="flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                  {/* Card Header Info */}
                  <div className="p-space-md bg-surface-container-low flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface truncate">
                          order_confirmation_v2
                        </span>
                        <button className="text-on-surface-variant hover:text-primary" title="Copy Template Name">
                          <span className="material-symbols-outlined text-[15px]">content_copy</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface-container text-tertiary">
                          Utility
                        </span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">English (US)</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-label-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                      Approved
                    </span>
                  </div>

                  {/* WhatsApp Chat Bubble Preview */}
                  <div className="p-space-md flex-1 flex flex-col justify-between bg-surface-bright">
                    <div className="flex flex-col gap-2">
                      {/* Simulated WhatsApp Message Container */}
                      <div className="bg-surface-container-lowest p-3.5 rounded-lg shadow-sm max-w-[92%] relative">
                        <div className="flex items-center gap-1.5 mb-1.5 text-primary">
                          <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                          <span className="font-label-sm text-label-sm font-bold uppercase">Order Update</span>
                        </div>
                        <p className="font-body-md text-body-md text-on-surface">
                          Hi{" "}
                          <span className="bg-primary-fixed px-1.5 py-0.5 rounded text-on-primary-fixed font-mono text-[12px] font-semibold">
                            {"{{1}}"}
                          </span>
                          , your order{" "}
                          <span className="bg-primary-fixed px-1.5 py-0.5 rounded text-on-primary-fixed font-mono text-[12px] font-semibold">
                            #{"{{2}}"}
                          </span>{" "}
                          is confirmed and on its way! Track real-time status with the button below.
                        </p>
                        <div className="flex justify-end items-center gap-1 mt-2 text-on-surface-variant">
                          <span className="font-label-sm text-label-sm">11:42 AM</span>
                          <span className="material-symbols-outlined text-[14px] text-tertiary-container">done_all</span>
                        </div>
                      </div>

                      {/* WhatsApp Interactive Action Buttons */}
                      <div className="flex flex-col gap-1.5 max-w-[92%]">
                        <div className="w-full py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-2 text-primary font-label-md text-label-md">
                          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                          <span>Track Order</span>
                        </div>
                        <div className="w-full py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-2 text-primary font-label-md text-label-md">
                          <span className="material-symbols-outlined text-[16px]">chat_bubble_outline</span>
                          <span>Need Help</span>
                        </div>
                      </div>
                    </div>

                    {/* Card Metadata Footer */}
                    <div className="mt-space-md pt-3 flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">history</span>
                        Updated 2 days ago
                      </span>
                      <div className="flex items-center gap-1 text-primary font-medium">
                        <span className="material-symbols-outlined text-[14px]">speed</span>
                        <span>Quality: High</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 2: cart_abandoned_recovery */}
                <div className="flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                  <div className="p-space-md bg-surface-container-low flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface truncate">
                          cart_abandoned_recovery
                        </span>
                        <button className="text-on-surface-variant hover:text-primary">
                          <span className="material-symbols-outlined text-[15px]">content_copy</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface-container text-secondary">
                          Marketing
                        </span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">English (US)</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-label-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                      Approved
                    </span>
                  </div>

                  <div className="p-space-md flex-1 flex flex-col justify-between bg-surface-bright">
                    <div className="flex flex-col gap-2">
                      <div className="bg-surface-container-lowest p-3.5 rounded-lg shadow-sm max-w-[92%] relative">
                        <div className="w-full h-24 mb-2.5 rounded-md overflow-hidden relative">
                          <div
                            className="w-full h-full bg-cover bg-center"
                            style={{
                              backgroundImage:
                                "url('https://lh3.googleusercontent.com/aida-public/AB6AXuBTMDrwKuRpf5scxcc5okLi45Xe6i0E4v_IkWQ08-rwmRWOqxBNOTKhria_R9vjcIwHA2zn4CZO6qoyLJ27LVecHAXJKcMaHumohYcW6bmR88bLKl9XKamhUyzeoA2Ck6V8nJhUk5ONBU3UA0Vv1bTXwhM3_nc2zrkuA8Hjz17lpuz6qyQNwICP2WYhOYOXkgUEuY_wghZcEjmHpxV-V3GiJzAnlXKYK-vLtNE9qN_FMs93v1dcJ2LX3A')",
                            }}
                          ></div>
                          <div className="absolute bottom-1 right-2 bg-on-background/70 text-surface text-[10px] px-1.5 py-0.5 rounded">
                            Media Header
                          </div>
                        </div>
                        <p className="font-body-md text-body-md text-on-surface">
                          Hello{" "}
                          <span className="bg-primary-fixed px-1.5 py-0.5 rounded text-on-primary-fixed font-mono text-[12px] font-semibold">
                            {"{{1}}"}
                          </span>
                          ! You left some favorite items in your cart. Complete checkout within 2 hours to get 15% off
                          with code <strong className="text-primary font-bold">SAVE15</strong>.
                        </p>
                        <div className="flex justify-end items-center gap-1 mt-2 text-on-surface-variant">
                          <span className="font-label-sm text-label-sm">09:15 AM</span>
                          <span className="material-symbols-outlined text-[14px] text-tertiary-container">done_all</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5 max-w-[92%]">
                        <div className="w-full py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-2 text-primary font-label-md text-label-md">
                          <span className="material-symbols-outlined text-[16px]">shopping_cart_checkout</span>
                          <span>Resume Checkout</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-space-md pt-3 flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm">
                      <span className="flex items-center gap-1 text-on-surface">
                        <span className="material-symbols-outlined text-[14px] text-primary">smart_toy</span>
                        Used in 2 live bots
                      </span>
                      <div className="flex items-center gap-1 text-primary font-medium">
                        <span className="material-symbols-outlined text-[14px]">speed</span>
                        <span>Quality: High</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 3: otp_verification_secure */}
                <div className="flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                  <div className="p-space-md bg-surface-container-low flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface truncate">
                          otp_verification_secure
                        </span>
                        <button className="text-on-surface-variant hover:text-primary">
                          <span className="material-symbols-outlined text-[15px]">content_copy</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface-container text-primary">
                          Authentication
                        </span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">English (US)</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-label-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                      Approved
                    </span>
                  </div>

                  <div className="p-space-md flex-1 flex flex-col justify-between bg-surface-bright">
                    <div className="flex flex-col gap-2">
                      <div className="bg-surface-container-lowest p-3.5 rounded-lg shadow-sm max-w-[92%] relative">
                        <div className="flex items-center gap-1.5 mb-1.5 text-primary">
                          <span className="material-symbols-outlined text-[16px]">lock</span>
                          <span className="font-label-sm text-label-sm font-bold uppercase">Security Code</span>
                        </div>
                        <p className="font-body-md text-body-md text-on-surface">
                          <span className="bg-primary-fixed px-2 py-0.5 rounded text-on-primary-fixed font-mono text-[13px] font-bold">
                            {"{{1}}"}
                          </span>{" "}
                          is your PingFlow verification code. For your security, do not share this code with anyone. Valid
                          for 10 minutes.
                        </p>
                        <div className="flex justify-end items-center gap-1 mt-2 text-on-surface-variant">
                          <span className="font-label-sm text-label-sm">Just now</span>
                          <span className="material-symbols-outlined text-[14px] text-tertiary-container">done_all</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5 max-w-[92%]">
                        <div className="w-full py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-2 text-primary font-label-md text-label-md">
                          <span className="material-symbols-outlined text-[16px]">content_copy</span>
                          <span>Copy Code</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-space-md pt-3 flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm">
                      <span className="flex items-center gap-1 text-primary">
                        <span className="material-symbols-outlined text-[14px]">verified_user</span>
                        99.9% delivery rate
                      </span>
                      <span className="text-on-surface-variant">Zero policy flags</span>
                    </div>
                  </div>
                </div>

                {/* Card 4: vip_exclusive_offer */}
                <div className="flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                  <div className="p-space-md bg-surface-container-low flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface truncate">
                          vip_exclusive_offer
                        </span>
                        <button className="text-on-surface-variant hover:text-primary">
                          <span className="material-symbols-outlined text-[15px]">content_copy</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface-container text-secondary">
                          Marketing
                        </span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">English (US)</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse"></span>
                      Pending Review
                    </span>
                  </div>

                  <div className="p-space-md flex-1 flex flex-col justify-between bg-surface-bright">
                    <div className="flex flex-col gap-2">
                      <div className="bg-surface-container-lowest p-3.5 rounded-lg shadow-sm max-w-[92%] relative opacity-90">
                        <div className="flex items-center gap-1.5 mb-1.5 text-secondary">
                          <span className="material-symbols-outlined text-[16px]">stars</span>
                          <span className="font-label-sm text-label-sm font-bold uppercase">VIP Early Access</span>
                        </div>
                        <p className="font-body-md text-body-md text-on-surface">
                          Exclusive early bird access for VIP members! Preview our new collection 24 hours before public
                          release.
                        </p>
                        <div className="flex justify-end items-center gap-1 mt-2 text-on-surface-variant">
                          <span className="font-label-sm text-label-sm">In queue</span>
                          <span className="material-symbols-outlined text-[14px]">schedule</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5 max-w-[92%]">
                        <div className="w-full py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-2 text-on-surface-variant font-label-md text-label-md">
                          <span className="material-symbols-outlined text-[16px]">launch</span>
                          <span>Shop VIP Collection</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-space-md pt-3 flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">upload_file</span>
                        Submitted 35m ago
                      </span>
                      <span className="text-secondary font-medium">Estimated: &lt; 2 hrs</span>
                    </div>
                  </div>
                </div>

                {/* Card 5: appointment_reminder */}
                <div className="flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                  <div className="p-space-md bg-surface-container-low flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface truncate">
                          appointment_reminder
                        </span>
                        <button className="text-on-surface-variant hover:text-primary">
                          <span className="material-symbols-outlined text-[15px]">content_copy</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface-container text-tertiary">
                          Utility
                        </span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">Spanish (es_ES)</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-label-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                      Approved
                    </span>
                  </div>

                  <div className="p-space-md flex-1 flex flex-col justify-between bg-surface-bright">
                    <div className="flex flex-col gap-2">
                      <div className="bg-surface-container-lowest p-3.5 rounded-lg shadow-sm max-w-[92%] relative">
                        <div className="flex items-center gap-1.5 mb-1.5 text-tertiary">
                          <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                          <span className="font-label-sm text-label-sm font-bold uppercase">Recordatorio</span>
                        </div>
                        <p className="font-body-md text-body-md text-on-surface">
                          Hola{" "}
                          <span className="bg-primary-fixed px-1.5 py-0.5 rounded text-on-primary-fixed font-mono text-[12px] font-semibold">
                            {"{{1}}"}
                          </span>
                          , te recordamos tu cita programada para el{" "}
                          <span className="bg-primary-fixed px-1.5 py-0.5 rounded text-on-primary-fixed font-mono text-[12px] font-semibold">
                            {"{{2}}"}
                          </span>{" "}
                          a las{" "}
                          <span className="bg-primary-fixed px-1.5 py-0.5 rounded text-on-primary-fixed font-mono text-[12px] font-semibold">
                            {"{{3}}"}
                          </span>
                          .
                        </p>
                        <div className="flex justify-end items-center gap-1 mt-2 text-on-surface-variant">
                          <span className="font-label-sm text-label-sm">10:00 AM</span>
                          <span className="material-symbols-outlined text-[14px] text-tertiary-container">done_all</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 max-w-[92%]">
                        <div className="py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-1.5 text-primary font-label-md text-label-md text-center">
                          <span className="material-symbols-outlined text-[16px]">check</span>
                          <span>Confirmar</span>
                        </div>
                        <div className="py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-1.5 text-primary font-label-md text-label-md text-center">
                          <span className="material-symbols-outlined text-[16px]">event_repeat</span>
                          <span>Reprogramar</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-space-md pt-3 flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm">
                      <span className="flex items-center gap-1 text-on-surface">
                        <span className="material-symbols-outlined text-[14px] text-primary">support_agent</span>
                        Active in Support Bot
                      </span>
                      <span className="text-primary font-medium">Quality: High</span>
                    </div>
                  </div>
                </div>

                {/* Card 6: lead_nurture_followup (Rejected) */}
                <div className="flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                  <div className="p-space-md bg-surface-container-low flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface truncate">
                          lead_nurture_followup
                        </span>
                        <button className="text-on-surface-variant hover:text-primary">
                          <span className="material-symbols-outlined text-[15px]">content_copy</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface-container text-secondary">
                          Marketing
                        </span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">English (US)</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container text-error font-label-sm text-label-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-error"></span>
                      Rejected
                    </span>
                  </div>

                  <div className="p-space-md flex-1 flex flex-col justify-between bg-surface-bright">
                    <div className="flex flex-col gap-2">
                      {/* Rejection Notice Banner */}
                      <div className="p-2.5 rounded-lg bg-error-container/60 text-error flex items-start gap-2">
                        <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">warning</span>
                        <div className="flex flex-col">
                          <span className="font-label-sm text-label-sm font-semibold">
                            Policy: Promotional header format
                          </span>
                          <span className="font-body-sm text-body-sm text-on-surface-variant">
                            Variable parameter {"{{1}}"} cannot occupy entire header line without context text.
                          </span>
                        </div>
                      </div>

                      <div className="bg-surface-container-lowest p-3.5 rounded-lg shadow-sm max-w-[92%] relative opacity-60">
                        <p className="font-body-md text-body-md text-on-surface">
                          Special promo notification for pingflow accounts... Click link to claim your bonus credits
                          before month end.
                        </p>
                        <div className="flex justify-end items-center gap-1 mt-2 text-on-surface-variant">
                          <span className="font-label-sm text-label-sm">Denied</span>
                          <span className="material-symbols-outlined text-[14px] text-error">close</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-space-md pt-3 flex items-center justify-between">
                      <span className="font-label-sm text-label-sm text-on-surface-variant">Meta Policy #402.1</span>
                      <a
                        className="inline-flex items-center gap-1 text-primary hover:text-primary-container font-label-md text-label-md font-semibold"
                        href="#"
                      >
                        <span>Edit &amp; Resubmit</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Batch Sync & HSM Policy Callout */}
              <div className="mt-space-sm bg-surface-container-lowest p-space-lg rounded-xl shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-space-md">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-[28px]">policy</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-headline-sm text-headline-sm text-on-surface">
                      Meta Tier 2 Automated Validation
                    </span>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      All submitted templates run PingFlow pre-flight linting against WhatsApp Cloud API Business policies
                      to ensure a 94%+ first-time approval rate.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto">
                  <a
                    className="px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors text-center w-full sm:w-auto"
                    href="#"
                  >
                    Template Guidelines
                  </a>
                  <a
                    className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container hover:bg-primary font-label-md text-label-md transition-colors text-center w-full sm:w-auto"
                    href="#"
                  >
                    Test in Sandbox
                  </a>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
