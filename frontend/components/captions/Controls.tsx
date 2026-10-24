"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Labelled slider with its value shown. */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  hint,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-base font-medium text-ink">
          {label}
        </label>
        <span className="text-base text-ink-muted tabular-nums">
          {Number.isInteger(step) ? value : value.toFixed(1)}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full cursor-pointer accent-brand"
      />
      {hint && <p className="text-meta text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Colour swatch + hex input, with an optional opacity slider. */
export function ColorField({
  label,
  value,
  onChange,
  opacity,
  onOpacity,
}: {
  label: ReactNode;
  value: string;
  onChange: (hex: string) => void;
  opacity?: number;
  onOpacity?: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-base font-medium text-ink">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          aria-label={`${typeof label === "string" ? label : "Colour"} picker`}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="size-12 shrink-0 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
        />
        <input
          id={id}
          // Free typing; a valid #RRGGBB is applied as you type, and the field re-syncs
          // whenever the colour changes elsewhere (e.g. the swatch).
          key={value}
          defaultValue={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toUpperCase());
          }}
          maxLength={7}
          spellCheck={false}
          className="h-12 w-28 rounded-md border border-line-strong bg-surface px-3 font-mono text-base text-ink uppercase focus:border-brand focus:shadow-ring focus-visible:outline-none"
        />
        {onOpacity && opacity !== undefined && (
          <input
            type="range"
            aria-label={`${typeof label === "string" ? label : "Colour"} opacity`}
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => onOpacity(Number(e.target.value))}
            className="h-11 min-w-0 flex-1 cursor-pointer accent-brand"
          />
        )}
        {onOpacity && opacity !== undefined && <span className="w-12 text-right text-base text-ink-muted tabular-nums">{opacity}%</span>}
      </div>
    </div>
  );
}

/** On/off switch with a label and optional hint. */
export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-base font-medium text-ink">{label}</span>
        {hint && <span className="block text-meta text-ink-muted">{hint}</span>}
      </span>
      <span className="relative mt-1 inline-flex shrink-0">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className={cn("h-7 w-12 rounded-full transition-colors duration-(--motion-fast)", checked ? "bg-brand" : "bg-line-strong")} />
        <span
          aria-hidden
          className={cn("absolute top-1 left-1 size-5 rounded-full bg-surface shadow-glow transition-transform duration-(--motion-fast)", checked && "translate-x-5")}
        />
        <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full peer-focus-visible:shadow-ring" />
      </span>
    </label>
  );
}

/** A titled group of controls inside the editor. */
export function EditorSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-5 border-t border-line pt-6 first:border-t-0 first:pt-0", className)}>
      <h3 className="font-display text-xl font-semibold tracking-tight text-ink">{title}</h3>
      {children}
    </section>
  );
}
