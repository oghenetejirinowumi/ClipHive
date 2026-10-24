import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

/** Shared look for every text-like control: 56px tall, 1rem+ text (no iOS zoom), brand focus glow. */
export const inputClass =
  "block h-14 w-full rounded-md border border-line-strong bg-surface px-5 text-lg text-ink transition-[border-color,box-shadow] duration-(--motion-fast) placeholder:text-ink-faint hover:border-ink-faint focus:border-brand focus:shadow-ring focus-visible:outline-none aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50";

/** Dense tool UIs (the editor): 44px tall, 1rem+ text, same border and focus glow. */
export const compactInputClass = cn(inputClass, "h-11 px-3 text-base");

type Compact = { compact?: boolean };

/** Plain input. Wrap in <Field label=…> to get a label, hint and error wired up. */
export function Input({ className, compact, ...rest }: InputHTMLAttributes<HTMLInputElement> & Compact) {
  return <input className={cn(compact ? compactInputClass : inputClass, className)} {...rest} />;
}

export function Select({ className, children, compact, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Compact) {
  return (
    <div className="relative">
      <select className={cn(compact ? compactInputClass : inputClass, "cursor-pointer appearance-none", compact ? "pr-10" : "pr-14", className)} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" className={cn("pointer-events-none absolute top-1/2 size-5 -translate-y-1/2 text-ink-muted", compact ? "right-3" : "right-5")} />
    </div>
  );
}

/** Checkbox whose whole label is the (≥ 48px tall, 44px compact) hit area. */
export function Checkbox({ label, className, compact, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & Compact & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-3 text-ink", compact ? "min-h-11 text-base" : "min-h-12 text-lg", className)}>
      <input type="checkbox" className={cn("cursor-pointer accent-brand", compact ? "size-5" : "size-6")} {...rest} />
      {label}
    </label>
  );
}
