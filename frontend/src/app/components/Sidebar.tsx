"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import { useCurrentUser } from "@/lib/currentUser";
import { ThemeToggle } from "./ThemeToggle";

// The single, shared workspace sidebar used across all dashboard pages.
// - Collapsible to icons only. The state is saved in localStorage and applied
//   as `html.sidebar-collapsed`, which sets the --sidebar-w CSS variable that
//   pages use (.pl-sidebar) to offset their content. layout.tsx restores it
//   before first paint so there's no jump on load.
// - The highlighted item comes from the URL; `active` can override it.

export type SidebarItem = "workflows" | "broadcasts" | "contacts" | "analytics" | "templates" | "settings";

const COLLAPSE_KEY = "wa-sidebar";

interface NavEntry {
  key: SidebarItem;
  label: string;
  icon: string;
  href?: string;
  count?: number | null;
  disabledHint?: string;
}

function sectionFromPath(pathname: string | null): SidebarItem {
  if (!pathname) return "workflows";
  if (pathname.startsWith("/contacts")) return "contacts";
  if (pathname.startsWith("/broadcasts")) return "broadcasts";
  if (pathname.startsWith("/templates")) return "templates";
  if (pathname.startsWith("/settings")) return "settings";
  if (/^\/chatbots\/[^/]+\/analytics/.test(pathname)) return "analytics";
  return "workflows";
}

function botIdFromPath(pathname: string | null): string | null {
  const m = pathname?.match(/^\/chatbots\/([^/]+)\//);
  return m ? m[1] : null;
}

// Counts + connection status, shared across page navigations for 30s so
// moving between pages doesn't refetch every time.
interface SidebarData {
  bots: number | null;
  contacts: number | null;
  connection: { status: string; graphVersion: string | null } | null;
}
let cache: { at: number; admin: boolean; promise: Promise<SidebarData> } | null = null;

function loadSidebarData(admin: boolean): Promise<SidebarData> {
  if (cache && cache.admin === admin && Date.now() - cache.at < 30_000) return cache.promise;
  const count = (url: string) =>
    api.get(url).then((r) => (Array.isArray(r.data) ? r.data.length : null)).catch(() => null);
  // The WhatsApp connection is admin-only on the API, so members don't ask.
  const connection = admin
    ? Promise.all([
        api.get("/api/whatsapp/connection").then((r) => r.data?.status as string).catch((e) => (e?.response?.status === 404 ? "DISCONNECTED" : null)),
        api.get("/api/whatsapp/connection/meta-config").then((r) => (r.data?.graphVersion as string) ?? null).catch(() => null),
      ]).then(([status, graphVersion]) => (status ? { status, graphVersion } : null))
    : Promise.resolve(null);
  const promise = Promise.all([count("/api/chatbots"), count("/api/contacts"), connection]).then(
    ([bots, contacts, conn]) => ({ bots, contacts, connection: conn })
  );
  cache = { at: Date.now(), admin, promise };
  return promise;
}

export function Sidebar({ active }: { active?: SidebarItem }) {
  const pathname = usePathname();
  const router = useRouter();
  const fromPath = sectionFromPath(pathname);
  const current: SidebarItem =
    fromPath === "settings" || fromPath === "analytics" ? fromPath : active ?? fromPath;
  const currentBotId = botIdFromPath(pathname);

  const me = useCurrentUser();
  const isAdmin = me?.canAccessSettings === true;

  // Start from what layout.tsx already applied, so the first render matches.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(document.documentElement.classList.contains("sidebar-collapsed"));
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.classList.toggle("sidebar-collapsed", next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "collapsed" : "expanded");
    } catch {
      /* private mode: still works for this page */
    }
  }

  const [data, setData] = useState<SidebarData>({ bots: null, contacts: null, connection: null });
  useEffect(() => {
    if (!getToken() || me === undefined) return;
    let alive = true;
    loadSidebarData(isAdmin).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [me, isAdmin]);

  function logout() {
    clearToken();
    cache = null;
    router.push("/login");
  }

  const items: NavEntry[] = [
    { key: "workflows", label: "Workflows & Bots", icon: "account_tree", href: "/chatbots", count: data.bots },
    { key: "broadcasts", label: "Broadcasts", icon: "campaign", href: "/broadcasts" },
    { key: "contacts", label: "Contacts", icon: "group", href: "/contacts", count: data.contacts },
    {
      key: "analytics",
      label: "Analytics",
      icon: "analytics",
      href: currentBotId ? `/chatbots/${currentBotId}/analytics` : undefined,
      disabledHint: "Open a chatbot to see its analytics",
    },
    { key: "templates", label: "Templates", icon: "chat_bubble", href: "/templates" },
    ...(isAdmin ? [{ key: "settings" as const, label: "Settings", icon: "settings", href: "/settings" }] : []),
  ];

  const conn = data.connection;
  const connected = conn?.status === "CONNECTED";

  return (
    <aside
      className="w-sidebar fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 select-none"
      aria-label="Main navigation"
    >
      {/* Brand + collapse toggle */}
      <div className={`flex h-16 items-center border-b border-slate-100 dark:border-slate-800 ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
        {!collapsed && (
          <Link href="/chatbots" className="flex items-center gap-3 overflow-hidden min-w-0">
            <BrandMark />
            <div className="flex flex-col truncate">
              <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">Whatsflow</span>
              <span className="text-[8px] font-semibold tracking-wider text-emerald-600 dark:text-emerald-400 uppercase">WhatsApp Automation</span>
            </div>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition-colors"
        >
          <span className={`material-symbols-outlined text-[20px] transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} aria-hidden="true">
            keyboard_double_arrow_left
          </span>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 space-y-1.5">
        {!collapsed && (
          <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Workspace Menu</div>
        )}
        {items.map((item) => {
          const isActive = item.key === current;
          const base = `group relative flex items-center rounded-lg py-2.5 text-sm transition-colors ${collapsed ? "justify-center px-0" : "gap-3 px-3"}`;
          const tone = isActive
            ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 font-semibold shadow-sm shadow-emerald-900/5"
            : "text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100";
          const iconTone = isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200";
          const inner = (
            <>
              <span className={`material-symbols-outlined text-[20px] shrink-0 ${iconTone}`} aria-hidden="true">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && typeof item.count === "number" && (
                <span
                  className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    isActive ? "bg-emerald-200/60 dark:bg-emerald-800/60 text-emerald-800 dark:text-emerald-100" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {item.count.toLocaleString()}
                </span>
              )}
              {/* Collapsed: a small dot shows there's a count. */}
              {collapsed && typeof item.count === "number" && item.count > 0 && (
                <span className="absolute top-1.5 right-3 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              )}
            </>
          );

          if (item.href) {
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? `${item.label}${typeof item.count === "number" ? ` (${item.count})` : ""}` : undefined}
                className={`${base} ${tone} focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500`}
              >
                {inner}
              </Link>
            );
          }
          return (
            <span
              key={item.key}
              role="link"
              aria-disabled="true"
              aria-label={collapsed ? item.label : undefined}
              title={item.disabledHint}
              className={`${base} ${tone} opacity-50 cursor-not-allowed`}
            >
              {inner}
            </span>
          );
        })}
      </nav>

      {/* Footer: connection status, theme, log out */}
      <div className="border-t border-slate-200/80 dark:border-slate-800 p-3 space-y-1 bg-slate-50/50 dark:bg-slate-900">
        {conn && !collapsed && (
          <Link
            href="/settings"
            className={`mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium ${
              connected
                ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                : "bg-amber-500/10 text-amber-800 dark:text-amber-200"
            }`}
            title="WhatsApp Settings"
          >
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} aria-hidden="true" />
              {connected ? "Meta API Connected" : conn.status === "ERROR" ? "Meta API Error" : "Meta API Not Connected"}
            </span>
            {conn.graphVersion && <span className="font-mono text-[10px] font-semibold opacity-80">{conn.graphVersion}</span>}
          </Link>
        )}
        {conn && collapsed && (
          <Link href="/settings" className="flex justify-center py-2" title={connected ? "Meta API Connected" : "Meta API not connected"} aria-label={connected ? "Meta API Connected" : "Meta API not connected"}>
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
          </Link>
        )}

        <div className={`flex items-center px-1 py-1 ${collapsed ? "justify-center" : "justify-between"}`}>
          {!collapsed && <span className="pl-2 text-xs font-medium text-slate-500 dark:text-slate-400">Appearance</span>}
          <ThemeToggle />
        </div>

        <button
          type="button"
          onClick={logout}
          aria-label={collapsed ? "Log out" : undefined}
          title={collapsed ? "Log out" : undefined}
          className={`flex w-full items-center rounded-lg py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 transition-colors ${collapsed ? "justify-center" : "gap-3 px-3"}`}
        >
          <span className="material-symbols-outlined text-[20px] shrink-0 text-rose-500" aria-hidden="true">logout</span>
          {!collapsed && <span className="truncate">Log out</span>}
        </button>
      </div>
    </aside>
  );
}

function BrandMark() {
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-700 to-teal-500 text-white shadow-sm shadow-emerald-500/30" aria-hidden="true">
      <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2.5 21.5l4.472-.924A9.956 9.956 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 01-4.275-1.229l-.307-.184-2.653.548.56-2.585-.201-.32A7.956 7.956 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z" />
        <path d="M11 7h2v6h-2zm0 8h2v2h-2z" />
      </svg>
    </div>
  );
}
