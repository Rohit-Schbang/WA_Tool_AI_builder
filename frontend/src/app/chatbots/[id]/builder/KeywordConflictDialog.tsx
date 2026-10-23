"use client";

import { useEffect } from "react";
import type { KeywordConflict } from "@/lib/keywords";

// Shown when a trigger keyword is already used by another journey on the same
// WhatsApp number. Nothing is saved until the user picks a unique keyword.
//
// Lifecycle rules (enforced by the backend too):
//   - Active AND inactive journeys keep their keywords (deactivating doesn't
//     free a keyword, so a paused journey can't silently lose its trigger).
//   - A keyword is freed by changing it in the other journey, or deleting that
//     journey.

export function KeywordConflictDialog({
  keyword,
  conflicts,
  phoneNumber,
  onChangeKeyword,
  onCancel,
}: {
  keyword: string;                 // what the user tried to use (as typed)
  conflicts: KeywordConflict[];
  phoneNumber?: string | null;
  onChangeKeyword: () => void;     // back to the input to type a different one
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const catchAll = conflicts.some((c) => c.catchAll);
  // One row per journey (a journey can hold several of the clashing keywords).
  const journeys = [...new Map(conflicts.map((c) => [c.chatbotId, c])).values()];

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kw-conflict-title"
        aria-describedby="kw-conflict-msg"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[480px] max-w-full bg-white rounded-2xl border border-slate-200 shadow-2xl p-5 flex flex-col gap-4 font-sans"
      >
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl border bg-amber-50 text-amber-700 border-amber-200 flex items-center justify-center shrink-0" aria-hidden="true">
            <i className="ph-bold ph-warning text-lg" />
          </span>
          <div className="min-w-0">
            <h2 id="kw-conflict-title" className="text-base font-bold text-slate-900">
              {catchAll ? "Another journey already answers any message" : "Trigger keyword already in use"}
            </h2>
            <p id="kw-conflict-msg" className="text-sm text-slate-600 mt-1">
              {catchAll
                ? "A journey without keywords starts on any message, and only one such journey is allowed per phone number. Add a trigger keyword to this journey, or manage the existing one first."
                : <>A journey with the trigger keyword <strong className="font-semibold text-slate-800">“{keyword}”</strong> already exists for this phone number{phoneNumber ? ` (${phoneNumber})` : ""}. Please choose a different keyword or manage the existing journey before proceeding.</>}
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {journeys.map((j) => {
            const held = conflicts.filter((c) => c.chatbotId === j.chatbotId && !c.catchAll).map((c) => c.keyword);
            return (
              <li key={j.chatbotId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-teal-700 flex items-center justify-center shrink-0" aria-hidden="true">
                  <i className="ph-bold ph-flow-arrow" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 truncate">{j.name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                      j.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"
                    }`}>
                      {j.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {held.length ? `Uses: ${held.map((k) => `“${k}”`).join(", ")}` : "Starts on any message"}
                  </div>
                </div>
                <a
                  href={`/chatbots/${j.chatbotId}/builder`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-teal-700 hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  View journey <i className="ph-bold ph-arrow-square-out text-[11px]" aria-hidden="true" />
                </a>
              </li>
            );
          })}
        </ul>

        <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <i className="ph-bold ph-info text-slate-400 mt-0.5" aria-hidden="true" />
          <span>
            Keywords stay reserved even while a journey is <strong>inactive</strong>, so deactivating it won’t free the keyword.
            To reuse it, change the keyword in that journey or delete that journey.
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 h-9 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="button" autoFocus onClick={onChangeKeyword} className="px-4 h-9 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 shadow-sm">
            {catchAll ? "Add a keyword" : "Change keyword"}
          </button>
        </div>
      </div>
    </div>
  );
}
