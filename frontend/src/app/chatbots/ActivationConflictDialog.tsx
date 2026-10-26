"use client";

import { useEffect } from "react";
import type { KeywordConflict } from "@/lib/keywords";

// Shown when a journey is switched ON but another ACTIVE journey on the same
// WhatsApp number answers to the same trigger keyword. Two active journeys
// sharing a keyword would make it unclear which one should reply, so the
// journey isn't activated until the user picks an option.

export function ActivationConflictDialog({
  journeyName,
  conflicts,
  busy,
  onDeactivateOthers,
  onEditKeywords,
  onCancel,
}: {
  journeyName: string;               // the journey being switched on
  conflicts: KeywordConflict[];
  busy?: boolean;
  onDeactivateOthers: () => void;    // switch the other journey(s) off, then activate this one
  onEditKeywords: () => void;        // open this journey's builder to change its keywords
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const journeys = [...new Map(conflicts.map((c) => [c.chatbotId, c])).values()];
  const label = (c: KeywordConflict) => (c.catchAll ? "any message (no keywords)" : `“${c.keyword}”`);
  const othersText = journeys.length === 1 ? `“${journeys[0].name}”` : `these ${journeys.length} journeys`;

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => !busy && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="act-conflict-title"
        aria-describedby="act-conflict-msg"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[500px] max-w-full bg-surface-container-lowest rounded-2xl shadow-2xl p-space-lg flex flex-col gap-space-md"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0" aria-hidden="true">
            <span className="material-symbols-outlined text-[22px]">warning</span>
          </div>
          <div className="min-w-0">
            <h2 id="act-conflict-title" className="font-headline-sm text-headline-sm text-on-surface font-bold">
              Can’t activate “{journeyName}” yet
            </h2>
            <p id="act-conflict-msg" className="font-body-sm text-body-sm text-on-surface-variant mt-1">
              Another <strong>active</strong> journey on this phone number uses the same trigger keyword. If both were on,
              it wouldn’t be clear which journey should reply. Choose what to do.
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {journeys.map((j) => {
            const shared = conflicts.filter((c) => c.chatbotId === j.chatbotId);
            return (
              <li key={j.chatbotId} className="rounded-xl bg-surface-container-low p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary-fixed/30 text-primary flex items-center justify-center shrink-0" aria-hidden="true">
                  <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-label-md text-label-md text-on-surface font-semibold truncate">{j.name}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Active
                    </span>
                  </div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant truncate">
                    Shared: {shared.map(label).join(", ")}
                  </div>
                </div>
                <a
                  href={`/chatbots/${j.chatbotId}/builder`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-label-md text-label-md text-primary font-semibold hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  View <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                </a>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onDeactivateOthers}
            disabled={busy}
            className="w-full h-11 px-4 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-primary-container shadow-sm disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">{busy ? "progress_activity" : "swap_horiz"}</span>
            {busy ? "Switching…" : `Deactivate ${othersText} and activate this one`}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEditKeywords}
              disabled={busy}
              className="flex-1 h-10 px-4 rounded-xl bg-surface-container-high hover:bg-surface-container text-on-surface font-label-md text-label-md font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span> Change keywords
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex-1 h-10 px-4 rounded-xl font-label-md text-label-md font-semibold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
