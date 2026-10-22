"use client";

/**
 * ContentEditor — a "Content Mode" screen for the flow builder.
 *
 * This is a self-contained presentational component (not a route). It renders a
 * WhatsApp Flow Content Editor with a live phone preview, matching the PingFlow
 * mock. Mount it from the builder (see builder/page.tsx) and pass `onClose` to
 * return to the canvas.
 *
 * The markup was converted from the provided standalone HTML to valid JSX:
 *   class -> className, viewbox -> viewBox, self-closing tags, textarea value
 *   via defaultValue, <option selected> -> <select defaultValue>. The WhatsApp
 *   doodle background is applied with an inline style instead of a global CSS
 *   class so the component carries its own styling.
 */

type ContentEditorProps = {
  /** Called when the user leaves Content Mode (e.g. the "Developer Mode" toggle). */
  onClose?: () => void;
  /** Bot name shown in the breadcrumb and phone preview. */
  botName?: string;
};

// WhatsApp chat wallpaper (subtle doodle dots) — inlined so the component is
// fully self-contained and doesn't depend on a global stylesheet.
const whatsappBgPattern: React.CSSProperties = {
  backgroundColor: "#efeae2",
  backgroundImage:
    "radial-gradient(#d6cec4 0.75px, transparent 0.75px), radial-gradient(#d6cec4 0.75px, #efeae2 0.75px)",
  backgroundSize: "24px 24px",
  backgroundPosition: "0 0, 12px 12px",
};

export function ContentEditor({ onClose, botName = "Bot AI Check" }: ContentEditorProps) {
  return (
    <div className="h-full w-full flex flex-col font-sans text-slate-800 antialiased bg-slate-50 overflow-hidden select-none">
      {/* BEGIN: TopGlobalNavigationHeader */}
      <header className="bg-white border-b border-slate-200 z-30 shrink-0">
        {/* Level 1: System bar and primary breadcrumbs */}
        <div className="h-14 px-6 flex items-center justify-between border-b border-slate-100">
          {/* Left side: Brand, Back, and Breadcrumb */}
          <div className="flex items-center gap-3">
            {/* Back Arrow */}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
              title="Back to flows"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </button>
            {/* Logo */}
            <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
              <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white shadow-sm shadow-teal-600/30">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.49 3.53 1.35 5L2 22l5.22-1.31C8.63 21.49 10.28 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.57 0-3.05-.44-4.32-1.21l-.31-.19-3.21.8.84-3.12-.21-.33C4.01 14.73 3.6 13.4 3.6 12c0-4.63 3.77-8.4 8.4-8.4s8.4 3.77 8.4 8.4-3.77 8.4-8.4 8.4z" />
                </svg>
              </div>
              <span className="font-bold text-base tracking-tight text-slate-900">PingFlow</span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 tracking-wider">
                Cloud
              </span>
            </div>
            {/* Breadcrumb & Node status */}
            <nav className="flex items-center gap-2 text-sm text-slate-500 font-medium pl-1">
              <a className="hover:text-slate-700 transition" href="#">Workflows &amp; Bots</a>
              <span className="text-slate-300">/</span>
              <a className="hover:text-slate-700 transition" href="#">Flow Builder</a>
              <span className="text-slate-300">/</span>
              <span className="text-slate-900 font-semibold flex items-center gap-2">{botName}</span>
            </nav>
          </div>

          {/* Right side: Flow status & Publication actions */}
          <div className="flex items-center gap-3">
            {/* Live status */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium border border-slate-200/60">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Inactive</span>
            </div>
            {/* Auto-save notification */}
            <div className="flex items-center gap-1.5 text-xs text-teal-700 font-medium px-2 py-1">
              <svg className="w-3.5 h-3.5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
              </svg>
              <span>All changes saved</span>
            </div>
            <button className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition border border-transparent">
              Save Draft
            </button>
            <button className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg shadow-sm shadow-teal-600/25 transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
              Publish &amp; Activate
            </button>
          </div>
        </div>

        {/* Level 2: Mode Toggle & Contextual Lock Notification */}
        <div className="h-12 px-6 bg-slate-50/70 flex items-center justify-between">
          {/* Mode Segmented Control & Safeguard notice */}
          <div className="flex items-center gap-4">
            {/* Segmented Toggle — same order/mapping as the builder header:
                Developer Mode (inactive here, returns to the flow canvas) |
                Content Mode (active, this screen). */}
            <div className="inline-flex p-0.5 rounded-lg bg-slate-200/80 text-xs font-medium">
              <button
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-slate-600 hover:text-slate-900 transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
                <span>Developer Mode</span>
              </button>
              <button className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-teal-700 text-white shadow-sm font-semibold transition">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
                <span>Content Mode</span>
              </button>
            </div>
            {/* Lock Info Pill */}
            <div className="hidden md:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50/70 border border-teal-200/60 text-xs text-teal-800">
              <svg className="w-3.5 h-3.5 text-teal-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
              <span>
                <strong>Content only</strong> — flow logic, integrations and technical settings are protected in Developer Mode.
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg shadow-2xs hover:bg-slate-50 transition">
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
              <span>Preview</span>
            </button>
            <button className="inline-flex items-center gap-1.5 px-3.5 py-1 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-2xs transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
              <span>Save changes</span>
            </button>
          </div>
        </div>
      </header>
      {/* END: TopGlobalNavigationHeader */}

      {/* BEGIN: MainWorkspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* BEGIN: Column1LeftPane_ConversationContent */}
        <aside className="w-80 border-r border-slate-200 bg-white flex flex-col shrink-0">
          {/* Sidebar Title & Search */}
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">Conversation content</h2>
              <p className="text-xs text-slate-500 mt-0.5">Edit the messages, questions and labels used in your flow.</p>
            </div>
            {/* Search Input */}
            <div className="relative">
              <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
              <input
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition"
                placeholder="Search messages..."
                type="text"
              />
            </div>
          </div>

          {/* Step List Items */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {/* Step 1 (Active) */}
            <div className="group relative flex items-center gap-3 p-2.5 rounded-xl border border-teal-500/70 bg-teal-50/40 shadow-xs cursor-pointer transition">
              <span className="w-5 text-center text-xs font-semibold text-slate-400">1</span>
              <div className="w-8 h-8 rounded-lg bg-teal-100/80 text-teal-700 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-900 truncate">Welcome message</p>
                  <span className="text-[10px] font-medium text-teal-800 bg-teal-100/70 px-1.5 py-0.5 rounded">Message</span>
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">Hi there! Let&apos;s arrange your booking...</p>
              </div>
              <svg className="w-3.5 h-3.5 text-teal-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </div>

            {/* Step 2 */}
            <div className="group flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition">
              <span className="w-5 text-center text-xs font-semibold text-slate-400">2</span>
              <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 truncate group-hover:text-slate-900">Collect date preference</p>
                  <span className="text-[10px] font-medium text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">Question</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">Please enter your chosen date:</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </div>

            {/* Step 3 */}
            <div className="group flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition">
              <span className="w-5 text-center text-xs font-semibold text-slate-400">3</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M4 6h16M4 10h16M4 14h16M4 18h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 truncate group-hover:text-slate-900">Choose available slot</p>
                  <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">List</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">Select your preferred slot:</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </div>

            {/* Step 4 */}
            <div className="group flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition">
              <span className="w-5 text-center text-xs font-semibold text-slate-400">4</span>
              <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 truncate group-hover:text-slate-900">Slot unavailable</p>
                  <span className="text-[10px] font-medium text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">Message</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">Sorry, the selected slot is no longer...</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </div>

            {/* Step 5 */}
            <div className="group flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition">
              <span className="w-5 text-center text-xs font-semibold text-slate-400">5</span>
              <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 truncate group-hover:text-slate-900">Check availability</p>
                  <span className="text-[10px] font-medium text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">Message</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">Let me check the available slots for ...</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </div>

            {/* Step 6 */}
            <div className="group flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition">
              <span className="w-5 text-center text-xs font-semibold text-slate-400">6</span>
              <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 truncate group-hover:text-slate-900">Booking summary</p>
                  <span className="text-[10px] font-medium text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">Message</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">Here is your booking summary:</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </div>

            {/* Step 7 */}
            <div className="group flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition">
              <span className="w-5 text-center text-xs font-semibold text-slate-400">7</span>
              <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 truncate group-hover:text-slate-900">Booking confirmed</p>
                  <span className="text-[10px] font-medium text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">Message</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">Your booking has been confirmed! ...</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </div>

            {/* Step 8 */}
            <div className="group flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition">
              <span className="w-5 text-center text-xs font-semibold text-slate-400">8</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 truncate group-hover:text-slate-900">Fallback reply</p>
                  <span className="text-[10px] font-medium text-amber-800 bg-amber-100/70 px-1.5 py-0.5 rounded">Fallback</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">I&apos;m sorry, I didn&apos;t understand that. ...</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </div>
          </div>
        </aside>
        {/* END: Column1LeftPane_ConversationContent */}

        {/* BEGIN: Column2CenterPane_EditMessageForm */}
        <section className="flex-1 overflow-y-auto bg-white px-8 py-6 border-r border-slate-200 flex flex-col">
          <div className="max-w-2xl w-full mx-auto space-y-6">
            {/* Header & Pagination */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Edit message</h1>
                <p className="text-xs text-slate-500 mt-1">Update the content for this message. The flow structure and logic remain unchanged.</p>
              </div>
              {/* Step navigation */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Step 1 of 8</span>
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                  <button className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-white transition" disabled title="Previous step">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                    </svg>
                  </button>
                  <button className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white transition" title="Next step">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Node Identification Badge / Banner */}
            <div className="flex items-center gap-3 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80">
              <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-xs">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Welcome message</h3>
                <p className="text-xs text-slate-500 font-medium">Message • Sent to user</p>
              </div>
            </div>

            {/* Main Form Area */}
            <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
              {/* Message Body Input Field */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700" htmlFor="message-text">
                    Message text <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[11px] text-slate-400">43 / 4096 characters</span>
                </div>
                <div className="relative rounded-xl border border-slate-300 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500 transition shadow-2xs">
                  <textarea
                    className="w-full p-3.5 text-sm text-slate-800 bg-transparent border-0 rounded-xl resize-none focus:ring-0 leading-relaxed"
                    id="message-text"
                    placeholder="Type your WhatsApp message..."
                    rows={6}
                    defaultValue="Hi there! Let's arrange your booking details."
                  />
                  {/* Emoji & Formatting Helper Bar */}
                  <div className="flex items-center justify-between px-3.5 py-2 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
                    <div className="flex items-center gap-1">
                      <button className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 text-xs font-bold" title="Bold" type="button">B</button>
                      <button className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 text-xs italic font-serif" title="Italic" type="button">I</button>
                      <button className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 text-xs line-through" title="Strikethrough" type="button">S</button>
                    </div>
                    <button className="text-slate-400 hover:text-slate-600 transition p-1 rounded" title="Insert Emoji" type="button">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick replies / Buttons Section */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold text-slate-800">Quick replies / Buttons (optional)</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Add buttons to give users quick reply options. Leave empty if not needed.</p>
                </div>
                <div className="space-y-2.5">
                  {/* Button Item 1 */}
                  <div className="flex items-center gap-2 group">
                    <div className="cursor-grab text-slate-400 hover:text-slate-600 p-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm9-12a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                      </svg>
                    </div>
                    <input
                      className="flex-1 text-xs py-2 px-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition"
                      type="text"
                      defaultValue="Book Appointment"
                    />
                    <select
                      className="text-xs py-2 px-3 bg-white border border-slate-200 rounded-lg text-slate-700 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 pr-8"
                      defaultValue="Send Message"
                    >
                      <option>Send Message</option>
                      <option>Open URL</option>
                      <option>Call Phone</option>
                    </select>
                    <button className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition" title="Remove button" type="button">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                      </svg>
                    </button>
                  </div>

                  {/* Button Item 2 */}
                  <div className="flex items-center gap-2 group">
                    <div className="cursor-grab text-slate-400 hover:text-slate-600 p-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm9-12a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                      </svg>
                    </div>
                    <input
                      className="flex-1 text-xs py-2 px-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition"
                      type="text"
                      defaultValue="View Services"
                    />
                    <select
                      className="text-xs py-2 px-3 bg-white border border-slate-200 rounded-lg text-slate-700 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 pr-8"
                      defaultValue="Send Message"
                    >
                      <option>Send Message</option>
                      <option>Open URL</option>
                      <option>Call Phone</option>
                    </select>
                    <button className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition" title="Remove button" type="button">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Add Button Action */}
                <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/50 rounded-lg text-xs font-semibold text-slate-600 hover:text-teal-700 transition w-full justify-center" type="button">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  </svg>
                  <span>Add another button</span>
                </button>
              </div>

              {/* Bottom Guardrail Notice Banner */}
              <div className="mt-8 p-3.5 rounded-xl bg-teal-50/60 border border-teal-200/60 flex items-start gap-3">
                <div className="w-6 h-6 rounded-md bg-teal-100 flex items-center justify-center shrink-0 text-teal-700 mt-0.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  </svg>
                </div>
                <div className="space-y-0.5 text-xs text-slate-600">
                  <p className="font-bold text-teal-900">Content only — flow logic is protected</p>
                  <p className="leading-relaxed">
                    You can edit message content, questions and button labels. Node connections, conditions, integrations and other technical settings can only be modified in Developer Mode.
                  </p>
                </div>
              </div>
            </form>
          </div>
        </section>
        {/* END: Column2CenterPane_EditMessageForm */}

        {/* BEGIN: Column3RightPane_WhatsAppPreview */}
        <aside className="w-[440px] bg-slate-50 flex flex-col shrink-0 overflow-y-auto">
          {/* Preview Header Controls */}
          <div className="p-4 border-b border-slate-200 bg-white/70 backdrop-blur-sm flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">WhatsApp preview</h2>
              <p className="text-xs text-slate-400 mt-0.5">See how this message will appear to your users.</p>
            </div>
            {/* Device Selector Switcher */}
            <div className="relative">
              <select className="text-xs font-medium text-slate-700 bg-slate-100/90 hover:bg-slate-200/70 border-0 rounded-lg py-1.5 pl-2.5 pr-7 focus:ring-1 focus:ring-teal-500 cursor-pointer transition">
                <option>iPhone view</option>
                <option>Android view</option>
              </select>
            </div>
          </div>

          {/* Device Mockup Viewport Container */}
          <div className="flex-1 flex items-center justify-center p-6">
            {/* BEGIN: SmartphoneFrame */}
            <div className="w-[340px] h-[670px] bg-slate-900 rounded-[44px] shadow-phone ring-1 ring-slate-800/80 flex flex-col overflow-hidden relative">
              {/* Dynamic Island / Speaker Notch area */}
              <div className="h-6 w-full bg-slate-900 pt-2 px-6 flex items-center justify-between z-20 shrink-0 text-white select-none">
                <span className="text-[11px] font-semibold tracking-tight">9:41</span>
                <div className="w-18 h-3.5 bg-black rounded-full flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-slate-900/80 mr-1" />
                </div>
                <div className="flex items-center gap-1.5 text-white">
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                    <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.9-1.9C9.22 19.59 10.56 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9z" />
                  </svg>
                  <div className="w-4 h-2 border border-white rounded-[2px] p-[1px] flex items-center">
                    <div className="w-2.5 h-full bg-white rounded-[0.5px]" />
                  </div>
                </div>
              </div>

              {/* WhatsApp Chat Header inside Mobile screen */}
              <div className="bg-white px-3 py-2 flex items-center justify-between border-b border-slate-100 z-10 shrink-0">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-600 cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
                  </svg>
                  <div className="w-8 h-8 rounded-full bg-teal-600 text-white font-bold flex items-center justify-center text-xs shadow-2xs">
                    {botName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-900 leading-tight">{botName}</span>
                    <span className="text-[10px] text-slate-400 font-medium">Business Account</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-slate-600">
                  <svg className="w-4 h-4 cursor-pointer hover:text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  </svg>
                  <svg className="w-3.5 h-3.5 cursor-pointer hover:text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  </svg>
                  <svg className="w-3.5 h-3.5 cursor-pointer hover:text-slate-800" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                  </svg>
                </div>
              </div>

              {/* WhatsApp Chat History / Wallpaper viewport */}
              <div className="flex-1 p-3 flex flex-col justify-between overflow-y-auto" style={whatsappBgPattern}>
                <div className="space-y-3">
                  {/* Date separator */}
                  <div className="flex justify-center my-1">
                    <span className="text-[10px] font-medium text-slate-600 bg-white/80 backdrop-blur-sm px-2.5 py-0.5 rounded-md shadow-2xs">
                      Today
                    </span>
                  </div>

                  {/* Message Bubble */}
                  <div className="max-w-[85%] self-start flex flex-col">
                    <div className="bg-white rounded-xl rounded-tl-sm p-3 shadow-xs border border-slate-100 text-xs text-slate-900 leading-snug relative">
                      <p className="pr-8 text-slate-800">Hi there! Let&apos;s arrange your booking details.</p>
                      <div className="text-[9px] text-slate-400 text-right mt-1.5 flex items-center justify-end gap-1">
                        <span>9:41 AM</span>
                      </div>
                    </div>

                    {/* Interactive Quick Reply Buttons Attached to Message */}
                    <div className="mt-1 space-y-1">
                      <button className="w-full py-2 px-3 bg-white hover:bg-slate-50 text-sky-600 font-semibold text-xs rounded-xl shadow-xs border border-slate-200/80 flex items-center justify-center gap-1.5 transition">
                        <svg className="w-3.5 h-3.5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                        </svg>
                        <span>Book Appointment</span>
                      </button>
                      <button className="w-full py-2 px-3 bg-white hover:bg-slate-50 text-sky-600 font-semibold text-xs rounded-xl shadow-xs border border-slate-200/80 flex items-center justify-center gap-1.5 transition">
                        <svg className="w-3.5 h-3.5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M4 6h16M4 12h16m-7 6h7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                        </svg>
                        <span>View Services</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Chat Bottom Input Bar */}
                <div className="flex items-center gap-1.5 pt-2">
                  <div className="flex-1 bg-white rounded-full px-3 py-1.5 flex items-center gap-2 shadow-2xs border border-slate-200/70">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                    </svg>
                    <span className="text-xs text-slate-400 flex-1">Message</span>
                    <svg className="w-4 h-4 text-slate-400 rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                    </svg>
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                      <path d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                    </svg>
                  </div>
                  {/* Microphone Button */}
                  <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-teal-600/30">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Bottom Home Bar Indicator */}
              <div className="h-4 bg-slate-900 flex justify-center items-center shrink-0">
                <div className="w-24 h-1 bg-white/40 rounded-full" />
              </div>
            </div>
            {/* END: SmartphoneFrame */}
          </div>
        </aside>
        {/* END: Column3RightPane_WhatsAppPreview */}
      </main>
      {/* END: MainWorkspace */}
    </div>
  );
}

export default ContentEditor;
