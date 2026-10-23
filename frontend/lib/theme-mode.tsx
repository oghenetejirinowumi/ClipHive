"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "ch_theme";

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme.
 * Stored choice wins; otherwise follow the OS.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})()`;

type Origin = { x: number; y: number };

type ThemeModeValue = {
  mode: ThemeMode;
  /** Switch theme. With an origin, the new theme spreads out from that point. */
  setMode: (next: ThemeMode, origin?: Origin) => void;
  toggle: (origin?: Origin) => void;
};

const ThemeModeContext = createContext<ThemeModeValue | null>(null);

const REVEAL_MS = 820;

function readStored(): ThemeMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("light");

  useEffect(() => {
    setModeState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

    // Follow the OS live, until the user has picked a side.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStored()) return;
      const next = mq.matches ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      setModeState(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setMode = useCallback((next: ThemeMode, origin?: Origin) => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = next;
      flushSync(() => setModeState(next));
    };
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return apply();

    // No View Transitions (older Firefox/Safari): a soft cross-fade of colours instead.
    if (!document.startViewTransition || !origin) {
      root.classList.add("theme-fading");
      apply();
      window.setTimeout(() => root.classList.remove("theme-fading"), 450);
      return;
    }

    // The new theme grows out of the switch as a circle until it covers the screen.
    const { x, y } = origin;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    // Scopes the "old page recedes" animation in globals.css to theme switches only.
    root.dataset.themeSwitching = next;
    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: REVEAL_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {});
    transition.finished.finally(() => delete root.dataset.themeSwitching);
  }, []);

  const toggle = useCallback((origin?: Origin) => setMode(mode === "dark" ? "light" : "dark", origin), [mode, setMode]);

  const value = useMemo(() => ({ mode, setMode, toggle }), [mode, setMode, toggle]);
  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode(): ThemeModeValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode must be used inside <ThemeModeProvider>");
  return ctx;
}
