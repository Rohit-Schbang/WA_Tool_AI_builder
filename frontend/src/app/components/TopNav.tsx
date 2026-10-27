"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment } from "react";
import { clearToken } from "@/lib/auth";
import { useCurrentUser } from "@/lib/currentUser";

export interface Crumb {
  label: string;
  href?: string;
}

// The one top navbar used on every dashboard page (the builder canvas has its
// own toolbar). Left: "Workspace › …" breadcrumb + Cloud API badge. Right:
// optional page actions, then the signed-in user and Log out.
// It's sticky, so it works both in normal-scrolling pages and in full-height
// flex layouts.
export function TopNav({ crumbs, actions }: { crumbs: Crumb[]; actions?: React.ReactNode }) {
  const router = useRouter();
  const me = useCurrentUser();
  const initials = (me?.name || me?.email || "?")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 h-16 shrink-0 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-6 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 min-w-0">
          <span className="shrink-0">Workspace</span>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${c.label}-${i}`}>
                <span className="material-symbols-outlined text-[16px] text-slate-400 shrink-0" aria-hidden="true">chevron_right</span>
                {c.href && !last ? (
                  <Link href={c.href} className="truncate hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
                    {c.label}
                  </Link>
                ) : (
                  <span className={`truncate ${last ? "text-slate-900 dark:text-slate-100 font-semibold" : ""}`} aria-current={last ? "page" : undefined}>
                    {c.label}
                  </span>
                )}
              </Fragment>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {actions}
        {me && (
          <div className="hidden md:flex items-center gap-3" title={me.email}>
            <div className="relative">
              <div className="h-9 w-9 rounded-full bg-slate-800 dark:bg-slate-700 text-white flex items-center justify-center font-semibold text-xs tracking-wider ring-2 ring-emerald-500/30" aria-hidden="true">
                {initials}
              </div>
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" aria-hidden="true" />
            </div>
            <div className="hidden lg:flex flex-col text-left leading-tight">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{me.name || me.email}</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{me.canAccessSettings ? "Workspace Admin" : "Member"}</span>
            </div>
          </div>
        )}
        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">logout</span>
          Log out
        </button>
      </div>
    </header>
  );
}
