"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./Icon";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; icon?: IconName };

/**
 * Pill toggle for 2–4 mutually exclusive views (platform, preview mode…). The brand pill
 * slides under the active option. Arrow keys move between options (radiogroup pattern).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("relative inline-grid rounded-full border border-line bg-surface-sunken p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-full bg-brand shadow-glow transition-transform duration-(--motion-base) ease-soft"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-base font-medium whitespace-nowrap transition-colors duration-(--motion-fast)",
              active ? "text-on-brand" : "text-ink-muted hover:text-ink",
            )}
          >
            {o.icon && <Icon name={o.icon} className="size-5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
