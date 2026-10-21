"use client";

import { useEffect, useRef, useState } from "react";

// App-wide replacement for window.alert / confirm / prompt — styled popups
// that match the app instead of the browser's native boxes.
//
//   await dialog.alert("Saved");
//   if (!(await dialog.confirm({ title: "Delete bot?", danger: true }))) return;
//   const v = await dialog.prompt({ title: "Rename", fields: [{ name: "name", label: "Name", value }] });
//
// Works from anywhere (event handlers, callbacks) — <DialogHost/> is mounted
// once in the root layout and renders whatever is queued.

type Tone = "info" | "success" | "warning" | "danger";

export interface PromptField {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "tel" | "email";
  hint?: string;
}

interface BaseOpts {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
}
export interface ConfirmOpts extends BaseOpts { danger?: boolean }
export interface PromptOpts extends BaseOpts { fields: PromptField[] }

type Request =
  | { id: number; kind: "alert"; opts: BaseOpts; resolve: (v: void) => void }
  | { id: number; kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { id: number; kind: "prompt"; opts: PromptOpts; resolve: (v: Record<string, string> | null) => void };

let queue: Request[] = [];
let nextId = 1;
const subscribers = new Set<(q: Request[]) => void>();
const publish = () => subscribers.forEach((fn) => fn([...queue]));

function enqueue<T>(build: (resolve: (v: T) => void, id: number) => Request): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = nextId++;
    queue.push(build(resolve, id));
    publish();
  });
}

const asOpts = <T extends BaseOpts>(o: string | T): T => (typeof o === "string" ? ({ message: o } as T) : o);

export const dialog = {
  alert: (o: string | BaseOpts) =>
    enqueue<void>((resolve, id) => ({ id, kind: "alert", opts: asOpts(o), resolve })),
  confirm: (o: string | ConfirmOpts) =>
    enqueue<boolean>((resolve, id) => ({ id, kind: "confirm", opts: asOpts(o), resolve })),
  prompt: (o: PromptOpts) =>
    enqueue<Record<string, string> | null>((resolve, id) => ({ id, kind: "prompt", opts: o, resolve })),
};

function close(id: number) {
  queue = queue.filter((r) => r.id !== id);
  publish();
}

const TONE: Record<Tone, { icon: string; ring: string }> = {
  info: { icon: "ph-info", ring: "bg-teal-50 text-teal-700 border-teal-200" },
  success: { icon: "ph-check-circle", ring: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  warning: { icon: "ph-warning", ring: "bg-amber-50 text-amber-700 border-amber-200" },
  danger: { icon: "ph-warning-octagon", ring: "bg-rose-50 text-rose-700 border-rose-200" },
};

export function DialogHost() {
  const [items, setItems] = useState<Request[]>([]);
  useEffect(() => {
    subscribers.add(setItems);
    return () => { subscribers.delete(setItems); };
  }, []);
  const current = items[0];
  if (!current) return null;
  return <DialogView key={current.id} req={current} />;
}

function DialogView({ req }: { req: Request }) {
  const opts = req.opts as ConfirmOpts & PromptOpts;
  const tone: Tone = opts.tone ?? (opts.danger ? "danger" : req.kind === "alert" ? "info" : req.kind === "prompt" ? "info" : "warning");
  const t = TONE[tone];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((req.kind === "prompt" ? opts.fields : []).map((f) => [f.name, f.value ?? ""]))
  );
  const [error, setError] = useState("");
  const primaryRef = useRef<HTMLButtonElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    (req.kind === "prompt" ? firstInputRef.current : primaryRef.current)?.focus();
    return () => restoreFocus.current?.focus?.();
  }, [req.kind]);

  const cancel = () => {
    close(req.id);
    if (req.kind === "alert") req.resolve();
    else if (req.kind === "confirm") req.resolve(false);
    else req.resolve(null);
  };
  const accept = () => {
    if (req.kind === "prompt") {
      const missing = opts.fields.find((f) => f.required && !values[f.name]?.trim());
      if (missing) { setError(`${missing.label} is required.`); return; }
      close(req.id);
      req.resolve(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])));
      return;
    }
    close(req.id);
    if (req.kind === "alert") req.resolve();
    else req.resolve(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title = opts.title ?? (req.kind === "alert" ? "Heads up" : req.kind === "confirm" ? "Are you sure?" : "Enter details");
  const confirmText = opts.confirmText ?? (req.kind === "alert" ? "OK" : req.kind === "prompt" ? "Save" : opts.danger ? "Delete" : "Continue");

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={cancel}>
      <form
        role={req.kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby={opts.message ? "app-dialog-msg" : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); accept(); }}
        className="w-[420px] max-w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-5 flex flex-col gap-4 font-sans"
      >
        <div className="flex items-start gap-3">
          <span className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${t.ring}`} aria-hidden="true">
            <i className={`ph-bold ${t.icon} text-lg`} />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 id="app-dialog-title" className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
            {opts.message && (
              <p id="app-dialog-msg" className="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-line">{opts.message}</p>
            )}
          </div>
        </div>

        {req.kind === "prompt" && (
          <div className="flex flex-col gap-3">
            {opts.fields.map((f, i) => (
              <label key={f.name} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{f.label}</span>
                <input
                  ref={i === 0 ? firstInputRef : undefined}
                  type={f.type ?? "text"}
                  value={values[f.name] ?? ""}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  onChange={(e) => { setValues((v) => ({ ...v, [f.name]: e.target.value })); setError(""); }}
                  className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                />
                {f.hint && <span className="text-[11px] text-slate-400">{f.hint}</span>}
              </label>
            ))}
            {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          {req.kind !== "alert" && (
            <button type="button" onClick={cancel} className="px-4 h-9 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              {opts.cancelText ?? "Cancel"}
            </button>
          )}
          <button
            ref={primaryRef}
            type="submit"
            className={`px-4 h-9 rounded-lg text-sm font-semibold text-white shadow-sm ${
              opts.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-teal-700 hover:bg-teal-800"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}
