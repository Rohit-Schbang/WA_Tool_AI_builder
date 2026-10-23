import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";
import { DialogHost } from "./components/Dialog";

export const metadata = {
  title: "Whatsflow",
  description: "WhatsApp automation and chatbot builder",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // data-theme uses our custom branded "wa" theme from tailwind.config.ts.
  return (
    <html lang="en" data-theme="wa" suppressHydrationWarning>
      <head>
        {/* No-flash theme bootstrap: apply the saved/system theme BEFORE first
            paint so the page never flashes the wrong colors. Mirrors the logic
            in src/lib/theme.ts (kept inline + dependency-free on purpose).
            next/script with beforeInteractive runs it before hydration without
            React 19's "script tag inside a component" warning. */}
        <Script
          id="pf-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='pf-theme';var s=localStorage.getItem(k);var d=s==='dark'||(!s&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d){r.classList.add('dark');r.setAttribute('data-theme','dark');}else{r.classList.remove('dark');r.setAttribute('data-theme','wa');}}catch(e){}})();`,
          }}
        />
        {/* Ask the Dark Reader extension to leave this app alone. Without this,
            Dark Reader injects data-darkreader-* attributes and inline styles
            into the DOM (e.g. React Flow's <Background/> SVG) after the server
            render but before hydration, causing a hydration-mismatch error and
            repainting our light UI (black input text on dark backgrounds). */}
        <meta name="darkreader-lock" />
        {/* Fonts used by the Whatsflow "Sky & Peach" auth pages (login/register). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        {/* Phosphor icons — used by the flow builder palette/toolbar. */}
        <link
          rel="stylesheet"
          type="text/css"
          href="https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/regular/style.css"
        />
        <link
          rel="stylesheet"
          type="text/css"
          href="https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/bold/style.css"
        />
      </head>
      <body className="min-h-screen bg-base-200 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors" suppressHydrationWarning>
        {children}
        {/* Styled replacement for window.alert/confirm/prompt (see components/Dialog.tsx). */}
        <DialogHost />
      </body>
    </html>
  );
}
