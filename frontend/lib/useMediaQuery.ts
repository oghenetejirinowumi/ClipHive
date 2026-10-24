"use client";

import { useSyncExternalStore } from "react";

/**
 * True while the CSS media query matches. The server (and the first client render) assume
 * `serverDefault`, then it follows the real window.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}

/** Tailwind's `lg` breakpoint: the desktop layout. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
