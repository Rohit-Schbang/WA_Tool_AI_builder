"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

// Import a journey JSON as a NEW chatbot. The file is checked here for quick
// feedback, then validated again on the server (which is the source of truth)
// and saved as a DRAFT — nothing is published.

const MAX_BYTES = 5_000_000;
const SAMPLE_URL = "/samples/sample-journey.json";

interface Summary {
  nodes: number;
  edges: number;
  variables: number;
}

// Same shapes the server accepts: the export envelope, or a bare definition.
function readJourney(data: any): { summary: Summary; name: string | null } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const def = data.definition && typeof data.definition === "object" ? data.definition : Array.isArray(data.nodes) ? data : null;
  if (!def || !Array.isArray(def.nodes)) return null;
  const len = (v: any) => (Array.isArray(v) ? v.length : 0);
  return {
    summary: { nodes: len(def.nodes), edges: len(def.edges), variables: len(def.variables) },
    name: typeof data.chatbot?.name === "string" ? data.chatbot.name : null,
  };
}

export function ImportJourneyDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (botId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [botName, setBotName] = useState("");
  const [error, setError] = useState("");
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  // Imported, but with things to fix before publishing.
  const [done, setDone] = useState<{ botId: string; warnings: string[] } | null>(null);

  function reset() {
    setDragging(false);
    setFileName(null);
    setData(null);
    setSummary(null);
    setBotName("");
    setError("");
    setServerErrors([]);
    setImporting(false);
    setDone(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    if (importing) return;
    reset();
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function loadFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setServerErrors([]);
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
      setError("Please choose a .json file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`This file is ${(file.size / 1_000_000).toFixed(1)} MB; the limit is 5 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: any;
      try {
        parsed = JSON.parse(String(reader.result ?? ""));
      } catch {
        setError("This file isn't valid JSON. Check it in a JSON validator, or start from the sample file.");
        return;
      }
      const found = readJourney(parsed);
      if (!found) {
        setError("This doesn't look like a journey — no \"nodes\" were found. See the sample file for the expected structure.");
        return;
      }
      setFileName(file.name);
      setData(parsed);
      setSummary(found.summary);
      setBotName(found.name ?? file.name.replace(/\.json$/i, "").replace(/[-_]+/g, " ").trim());
    };
    reader.onerror = () => setError("Couldn't read this file.");
    reader.readAsText(file);
  }

  function clearFile() {
    setFileName(null);
    setData(null);
    setSummary(null);
    setServerErrors([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleImport() {
    if (!data || importing) return;
    setImporting(true);
    setError("");
    setServerErrors([]);
    try {
      const res = await api.post("/api/chatbots/import", { name: botName.trim() || undefined, data });
      const botId: string = res.data?.bot?.id;
      const warnings: string[] = res.data?.warnings ?? [];
      if (!botId) throw new Error("no bot id");
      if (warnings.length) {
        setDone({ botId, warnings });
        setImporting(false);
      } else {
        reset();
        onImported(botId);
      }
    } catch (err: any) {
      setImporting(false);
      const errs: string[] = err?.response?.data?.errors ?? [];
      if (errs.length) setServerErrors(errs);
      else setError(err?.response?.data?.error ?? "Import failed. Please try again.");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[520px] max-w-full max-h-[90vh] overflow-y-auto bg-surface-container-lowest rounded-2xl shadow-2xl p-space-lg flex flex-col gap-space-md"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-fixed/30 text-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[22px]">upload_file</span>
            </div>
            <div>
              <h2 id="import-title" className="font-headline-sm text-headline-sm text-on-surface font-bold">Import a journey</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                Creates a new chatbot from a JSON file. It's saved as a draft — nothing is published.
              </p>
            </div>
          </div>
          <button onClick={close} disabled={importing} className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50" aria-label="Close">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {done ? (
          // Imported with publish warnings
          <>
            <div className="p-3 rounded-xl bg-primary-fixed/20 text-on-surface flex items-start gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span>
              <div className="font-body-sm text-body-sm">
                <div className="font-semibold">Journey imported.</div>
                Fix {done.warnings.length === 1 ? "this item" : `these ${done.warnings.length} items`} in the builder before publishing:
              </div>
            </div>
            <ul className="max-h-48 overflow-y-auto flex flex-col gap-1.5 font-body-sm text-body-sm text-on-surface-variant">
              {done.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-[16px] text-amber-600 mt-0.5">warning</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button
                onClick={() => { const id = done.botId; reset(); onImported(id); }}
                className="h-10 px-5 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold inline-flex items-center gap-1.5 hover:bg-primary-container shadow-sm"
              >
                Open in builder
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Drop zone / chosen file */}
            {!summary ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); loadFile(e.dataTransfer.files?.[0]); }}
                className={`w-full rounded-2xl border-2 border-dashed px-6 py-10 flex flex-col items-center justify-center gap-2 text-center transition-all ${
                  dragging ? "border-primary bg-primary-fixed/20" : "border-outline-variant bg-surface-container-low hover:border-primary hover:bg-primary-fixed/10"
                }`}
              >
                <span className="material-symbols-outlined text-primary text-[36px]">cloud_upload</span>
                <span className="font-label-lg text-label-lg text-on-surface font-semibold">
                  {dragging ? "Drop the file to upload" : "Drag & drop your JSON file here"}
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  or <span className="text-primary font-semibold underline">browse</span> · .json, up to 5 MB
                </span>
              </button>
            ) : (
              <div className="rounded-2xl bg-surface-container-low p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface-container-high text-primary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[22px]">data_object</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-label-md text-label-md text-on-surface font-semibold truncate">{fileName}</div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant">
                    {summary.nodes} nodes · {summary.edges} connections · {summary.variables} variables
                  </div>
                </div>
                <button onClick={clearFile} disabled={importing} className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50" aria-label="Remove file">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            )}
            <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />

            {/* Sample file */}
            <div className="flex items-start gap-2 font-body-sm text-body-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-[18px] text-primary">description</span>
              <span>
                Not sure how the file should look?{" "}
                <a href={SAMPLE_URL} download="sample-journey.json" className="text-primary font-semibold underline hover:opacity-80">
                  Download the sample journey
                </a>
                {" "}— a working salon-booking flow that uses every block type.
              </span>
            </div>

            {summary && (
              <label className="flex flex-col gap-1.5">
                <span className="font-label-md text-label-md text-on-surface font-semibold">Chatbot name</span>
                <input
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  maxLength={100}
                  placeholder="Imported journey"
                  className="h-11 px-4 rounded-xl bg-surface-container-low text-on-surface font-body-md text-body-md placeholder:text-on-surface-variant/60 focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            )}

            {error && (
              <div role="alert" className="p-3 rounded-xl bg-error-container text-on-error-container font-body-sm text-body-sm">{error}</div>
            )}
            {serverErrors.length > 0 && (
              <div role="alert" className="p-3 rounded-xl bg-error-container text-on-error-container font-body-sm text-body-sm">
                <div className="font-semibold mb-1">This file can't be imported:</div>
                <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">
                  {serverErrors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={close} disabled={importing} className="h-10 px-4 rounded-xl font-label-lg text-label-lg font-semibold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!summary || importing}
                className="h-10 px-5 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold inline-flex items-center gap-1.5 hover:bg-primary-container shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
              >
                <span className="material-symbols-outlined text-[18px]">{importing ? "progress_activity" : "upload"}</span>
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
