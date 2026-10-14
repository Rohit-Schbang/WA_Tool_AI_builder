"use client";

// Lightweight theme (light/dark) management — no external dependency.
//
// How it works:
//   - The chosen theme is stored in localStorage under "pf-theme".
//   - "dark" adds a `dark` class to <html> (drives Tailwind `dark:` variants)
//     and sets data-theme="dark"; "light" removes the class and sets the
//     branded "wa" daisyUI theme.
//   - An inline script in the root layout applies the stored/system theme
//     BEFORE first paint so there's no flash of the wrong theme.
//   - useTheme() is a tiny React hook for the toggle button.

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "pf-theme";

// Apply a theme to the document (class + data-theme). Safe to call anywhere.
export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.setAttribute("data-theme", "dark");
  } else {
    root.classList.remove("dark");
    root.setAttribute("data-theme", "wa");
  }
}

// Resolve the initial theme: explicit saved choice wins, else the OS setting.
export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  // On mount, read the already-applied theme (the no-flash script set the class)
  // so the toggle reflects reality.
  useEffect(() => {
    const current: Theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setThemeState(current);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return { theme, setTheme, toggle };
}
