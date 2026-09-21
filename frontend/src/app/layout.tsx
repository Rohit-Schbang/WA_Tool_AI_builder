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
      <body className="min-h-screen bg-base-200" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
