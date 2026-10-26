"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getToken } from "@/lib/auth";
import { useCurrentUser } from "@/lib/currentUser";

// Protected wrapper for Settings. Children render only for users the backend
// marks `canAccessSettings` (SETTINGS_ADMIN_EMAILS). This is the UI layer; the
// connection API also returns 403 for anyone else, so hiding isn't the only
// protection.
export function SettingsGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useCurrentUser();

  useEffect(() => {
    if (!getToken()) router.push("/login");
  }, [router]);

  if (user === undefined) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f8f9ff] dark:bg-slate-950" role="status" aria-live="polite">
        <span className="text-sm text-slate-500 dark:text-slate-400">Checking access…</span>
      </div>
    );
  }

  if (!user?.canAccessSettings) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f8f9ff] dark:bg-slate-950 px-6">
        <div role="alert" className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center shadow-sm">
          <span className="material-symbols-outlined text-[40px] text-rose-500" aria-hidden="true">lock</span>
          <h1 className="mt-3 text-lg font-bold text-slate-900 dark:text-slate-100">You don&apos;t have access to Settings</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {user
              ? `Signed in as ${user.email}. Ask an admin if you need access.`
              : "We couldn't confirm your access. The server may be waking up, so try again in a moment."}
          </p>
          <Link
            href="/chatbots"
            className="mt-6 inline-flex items-center justify-center h-10 px-4 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Back to Workflows &amp; Bots
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
