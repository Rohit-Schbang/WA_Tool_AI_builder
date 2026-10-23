"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { ThemeToggle } from "./ThemeToggle";

// The single, shared workspace sidebar used across all dashboard pages.
// The highlighted item is derived from the current URL so it's always
// correct. `active` can still be passed to override that (e.g. to keep a
// per-chatbot sub-page grouped under "Workflows & Bots"). It fetches the
// first chatbot id itself so the (per-chatbot) Settings link works
// everywhere without each page passing it in.

export type SidebarItem = "workflows" | "broadcasts" | "contacts" | "analytics" | "templates" | "settings";

interface NavEntry {
  key: SidebarItem;
  label: string;
  icon: string;
  href?: string;
}

// Map a URL path to the sidebar section it belongs to. Per-chatbot pages
// (builder / conversation / analytics / settings) all live under the
// "Workflows & Bots" section.
function sectionFromPath(pathname: string | null): SidebarItem {
  if (!pathname) return "workflows";
  if (pathname.startsWith("/contacts")) return "contacts";
  if (pathname.startsWith("/broadcasts")) return "broadcasts";
  if (pathname.startsWith("/templates")) return "templates";
  // Per-bot sub-pages that have their own sidebar entry.
  if (/^\/chatbots\/[^/]+\/settings/.test(pathname)) return "settings";
  if (/^\/chatbots\/[^/]+\/analytics/.test(pathname)) return "analytics";
  // Everything else under /chatbots (list, builder, conversations) is "workflows".
  return "workflows";
}

// The bot id in the current URL (/chatbots/<id>/...), if any.
function botIdFromPath(pathname: string | null): string | null {
  const m = pathname?.match(/^\/chatbots\/([^/]+)\//);
  return m ? m[1] : null;
}

export function Sidebar({ active }: { active?: SidebarItem }) {
  const pathname = usePathname();
  // URL wins over the `active` prop so per-bot Settings/Analytics pages always
  // highlight the right item even if a page passes a stale `active`.
  const fromPath = sectionFromPath(pathname);
  const current: SidebarItem =
    fromPath === "settings" || fromPath === "analytics" ? fromPath : active ?? fromPath;
  const currentBotId = botIdFromPath(pathname);
  const [firstBotId, setFirstBotId] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api
      .get("/api/chatbots")
      .then((res) => {
        const bots = res.data;
        if (Array.isArray(bots) && bots.length > 0) setFirstBotId(bots[0].id);
      })
      .catch(() => {});
  }, []);

  const items: NavEntry[] = [
    { key: "workflows", label: "Workflows & Bots", icon: "account_tree", href: "/chatbots" },
    { key: "broadcasts", label: "Broadcasts", icon: "campaign", href: "/broadcasts" },
    { key: "contacts", label: "Contacts", icon: "group", href: "/contacts" },
    { key: "analytics", label: "Analytics", icon: "analytics" },
    { key: "templates", label: "Templates", icon: "chat_bubble", href: "/templates" },
    { key: "settings", label: "Settings", icon: "settings" },
  ];

  function renderItem(item: NavEntry) {
    const isActive = item.key === current;
    const base =
      "group flex items-center gap-3 px-3 py-2.5 rounded-lg font-label-lg text-label-lg transition-all";
    const activeCls = "bg-primary-container text-on-primary-container dark:bg-teal-600 dark:text-white font-semibold shadow-sm";
    const idleCls = "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100";

    // Settings is per-chatbot: the bot you're currently on, else the newest
    // bot, else disabled.
    let href = item.href;
    const botId = currentBotId ?? firstBotId;
    if (item.key === "settings") href = botId ? `/chatbots/${botId}/settings` : undefined;
    if (item.key === "analytics" && currentBotId) href = `/chatbots/${currentBotId}/analytics`;

    const inner = (
      <>
        <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
        <span>{item.label}</span>
      </>
    );

    if (href) {
      return (
        <Link key={item.key} href={href} className={`${base} ${isActive ? activeCls : idleCls}`}>
          {inner}
        </Link>
      );
    }

    // No destination (placeholder sections, or Settings with no bot yet).
    const disabled = item.key === "settings";
    return (
      <a
        key={item.key}
        href="#"
        aria-disabled={disabled}
        title={disabled ? "Create a chatbot first" : undefined}
        className={`${base} ${isActive ? activeCls : idleCls} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        onClick={disabled ? (e) => e.preventDefault() : undefined}
      >
        {inner}
      </a>
    );
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-72 bg-surface-container-lowest dark:bg-slate-900 dark:border-r dark:border-slate-800 shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-50 flex flex-col justify-between transition-colors">
      <div className="flex flex-col">
        <div className="h-16 px-space-lg flex items-center gap-space-sm">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-on-primary shrink-0">
            <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              bolt
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-headline-sm text-headline-sm text-on-surface dark:text-slate-100 tracking-tight leading-none">Whatsflow</span>
            <span className="font-label-sm text-label-sm text-on-surface-variant dark:text-slate-400 leading-tight mt-0.5">
              WhatsApp Automation
            </span>
          </div>
        </div>
        <div className="px-space-md py-space-xs">
          <p className="px-space-sm pb-space-xs font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
            Workspace Menu
          </p>
          <nav className="flex flex-col gap-1">{items.map(renderItem)}</nav>
        </div>
      </div>

      {/* Footer — appearance toggle */}
      <div className="px-space-lg py-space-md border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between">
        <span className="font-label-sm text-label-sm text-on-surface-variant dark:text-slate-400">Appearance</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
