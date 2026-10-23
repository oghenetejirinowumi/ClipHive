import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

/** Shared look for every text-like control: 56px tall, 1rem+ text (no iOS zoom), brand focus glow. */
export const inputClass =
  "block h-14 w-full rounded-md border border-line-strong bg-surface px-5 text-lg text-ink transition-[border-color,box-shadow] duration-(--motion-fast) placeholder:text-ink-faint hover:border-ink-faint focus:border-brand focus:shadow-ring focus-visible:outline-none aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50";

/** Plain input. Wrap in <Field label=…> to get a label, hint and error wired up. */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(inputClass, "cursor-pointer appearance-none pr-14", className)} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute top-1/2 right-5 size-5 -translate-y-1/2 text-ink-muted" />
    </div>
  );
}

/** Checkbox whose whole label is the (≥ 48px tall) hit area. */
export function Checkbox({ label, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex min-h-12 cursor-pointer items-center gap-3 text-lg text-ink", className)}>
      <input type="checkbox" className="size-6 cursor-pointer accent-brand" {...rest} />
      {label}
    </label>
  );
}
