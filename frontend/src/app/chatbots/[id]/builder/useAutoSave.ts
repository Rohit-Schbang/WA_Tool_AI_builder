"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

// #11 — Auto-save.
//   - localStorage: written immediately (debounced) on every change, so an
//     accidental refresh/close never loses work.
//   - DB sync: every SYNC_INTERVAL_MS, but only when the definition actually
//     changed since the last successful sync (change-detection). On failure we
//     keep the local draft and retry on the next tick.
//
// The "definition" is whatever the builder serialises (nodes/edges/variables/
// apiConfigs). We treat it as an opaque JSON object and compare by stringify.

const SYNC_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 600;

export type SyncStatus = "idle" | "local" | "syncing" | "synced" | "error";

export function localDraftKey(chatbotId: string) {
  return `wa-draft-${chatbotId}`;
}

// Read a locally-saved draft (if any) for this chatbot.
export function readLocalDraft(chatbotId: string): { definition: any; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(localDraftKey(chatbotId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearLocalDraft(chatbotId: string) {
  try { localStorage.removeItem(localDraftKey(chatbotId)); } catch { /* ignore */ }
}

export function useAutoSave(
  chatbotId: string,
  // A function returning the current definition to persist. Kept as a ref-like
  // callback so the hook always reads the latest builder state.
  getDefinition: () => any,
  // Whether the builder has finished its initial load (don't autosave the
  // empty initial state before the draft loads in).
  ready: boolean
) {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Snapshot (stringified) of what's currently persisted in the DB, so we can
  // detect real changes and skip no-op syncs.
  const lastSyncedJson = useRef<string>("");
  // Latest local (unsynced) definition string.
  const pendingJson = useRef<string>("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Call this to prime the baseline right after the server draft loads, so the
  // first 30s tick doesn't re-push an unchanged definition.
  const primeBaseline = useCallback((definition: any) => {
    const json = JSON.stringify(definition);
    lastSyncedJson.current = json;
    pendingJson.current = json;
    setStatus("synced");
  }, []);

  // Immediately push to the DB (used on manual Save / unmount). Returns success.
  const syncNow = useCallback(async (): Promise<boolean> => {
    const definition = getDefinition();
    const json = JSON.stringify(definition);
    if (json === lastSyncedJson.current) {
      setStatus("synced");
      return true;
    }
    setStatus("syncing");
    try {
      await api.put(`/api/chatbots/${chatbotId}/workflow/draft`, { definition });
      lastSyncedJson.current = json;
      setLastSyncedAt(Date.now());
      clearLocalDraft(chatbotId); // synced — local backup no longer needed
      setStatus("synced");
      return true;
    } catch {
      setStatus("error"); // keep local draft; will retry next tick
      return false;
    }
  }, [chatbotId, getDefinition]);

  // --- localStorage: debounced immediate save on any change ---
  const touch = useCallback(() => {
    if (!ready) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const definition = getDefinition();
      const json = JSON.stringify(definition);
      pendingJson.current = json;
      if (json !== lastSyncedJson.current) {
        try {
          localStorage.setItem(
            localDraftKey(chatbotId),
            JSON.stringify({ definition, savedAt: Date.now() })
          );
        } catch { /* quota/private mode — ignore */ }
        setStatus((s) => (s === "syncing" ? s : "local"));
      }
    }, DEBOUNCE_MS);
  }, [chatbotId, getDefinition, ready]);

  // --- DB sync every 30s (change-detected) ---
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      const json = JSON.stringify(getDefinition());
      if (json !== lastSyncedJson.current) syncNow();
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(t);
  }, [ready, getDefinition, syncNow]);

  // --- Best-effort save when leaving the page ---
  useEffect(() => {
    if (!ready) return;
    const handler = () => {
      const definition = getDefinition();
      const json = JSON.stringify(definition);
      if (json !== lastSyncedJson.current) {
        try {
          localStorage.setItem(
            localDraftKey(chatbotId),
            JSON.stringify({ definition, savedAt: Date.now() })
          );
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [ready, chatbotId, getDefinition]);

  return { status, lastSyncedAt, touch, syncNow, primeBaseline };
}
