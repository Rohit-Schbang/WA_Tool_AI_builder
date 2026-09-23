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
      </head>
      <body className="min-h-screen bg-base-200" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
