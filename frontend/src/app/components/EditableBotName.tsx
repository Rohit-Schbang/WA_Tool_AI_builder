"use client";

import { api } from "@/lib/api";
import { useEffect, useRef, useState } from "react";

// A bot name that can be renamed in place, used everywhere a bot name shows.
//  - Double-click (or F2 / Enter when focused) -> edit
//  - Enter or blur -> save (PATCH /api/chatbots/:id), Esc -> cancel
//  - Optional single-click action (e.g. open the builder). Single clicks are
//    delayed briefly so a double-click doesn't also trigger navigation.
export function EditableBotName({
  botId,
  name,
  onRenamed,
  onClick,
  className = "",
  inputClassName = "",
  as: Tag = "span",
}: {
  botId: string;
  name: string;
  onRenamed?: (name: string) => void;
  onClick?: () => void;
  className?: string;
  inputClassName?: string;
  as?: "span" | "h1" | "h2";
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [current, setCurrent] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setCurrent(name); if (!editing) setValue(name); }, [name, editing]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);

  function startEdit() {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    setValue(current);
    setError("");
    setEditing(true);
  }

  function handleClick() {
    if (!onClick) return;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => { clickTimer.current = null; onClick(); }, 230);
  }

  async function commit() {
    const next = value.trim();
    if (!next || next === current) { setEditing(false); setValue(current); return; }
    setSaving(true);
    try {
      await api.patch(`/api/chatbots/${botId}`, { name: next });
      setCurrent(next);
      onRenamed?.(next);
      setEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Rename failed");
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex flex-col">
        <input
          ref={inputRef}
          value={value}
          maxLength={100}
          disabled={saving}
          aria-label="Bot name"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); setValue(current); setError(""); }
          }}
          className={`px-1.5 py-0.5 rounded-md border border-teal-500 bg-white text-slate-900 outline-none ring-2 ring-teal-500/20 min-w-[8rem] ${inputClassName}`}
        />
        {error && <span role="alert" className="text-[11px] text-rose-600 mt-0.5">{error}</span>}
      </span>
    );
  }

  return (
    <Tag
      tabIndex={0}
      role={onClick ? "link" : undefined}
      title={onClick ? "Click to open · double-click to rename" : "Double-click to rename"}
      onClick={handleClick}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(); }}
      onKeyDown={(e) => {
        if (e.key === "F2") { e.preventDefault(); startEdit(); }
        if (e.key === "Enter" && onClick) { e.preventDefault(); onClick(); }
      }}
      className={`cursor-pointer select-none rounded hover:underline decoration-dotted underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${className}`}
    >
      {current}
    </Tag>
  );
}
