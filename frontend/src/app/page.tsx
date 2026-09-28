"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";

// No landing page: "/" sends signed-in users to their chatbots and everyone
// else to the login / sign-up page. The token lives in localStorage, so this
// check has to run in the browser.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? "/chatbots" : "/login");
  }, [router]);

  // Brief spinner while redirecting (avoids a blank flash).
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <span
        className="w-8 h-8 rounded-full border-2 border-teal-600 border-t-transparent animate-spin"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
