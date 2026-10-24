"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * useState that survives reloads via localStorage (panel sizes, collapsed sidebar...).
 * Storage can be blocked or empty (private windows, cleared data): it then just behaves like
 * plain state. The stored value is read after mount, so server and first client render match.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Blocked or corrupt storage: keep the default.
    }
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Not persisted this time; the UI still updates.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}
