import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "WA AI Tool",
  description: "Workflow automation engine with a WhatsApp adapter",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // data-theme uses our custom branded "wa" theme from tailwind.config.ts.
  return (
    <html lang="en" data-theme="wa" suppressHydrationWarning>
      <head>
        {/* Ask the Dark Reader extension to leave this app alone. Without this,
            Dark Reader injects data-darkreader-* attributes and inline styles
            into the DOM (e.g. React Flow's <Background/> SVG) after the server
            render but before hydration, causing a hydration-mismatch error and
            repainting our light UI (black input text on dark backgrounds). */}
        <meta name="darkreader-lock" />
        {/* Fonts used by the PingFlow "Sky & Peach" auth pages (login/register). */}
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
      <body className="min-h-screen bg-base-200" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
