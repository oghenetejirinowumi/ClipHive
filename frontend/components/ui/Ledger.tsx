import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type LedgerItem = { label: ReactNode; value: ReactNode; hint?: ReactNode };

/** Quiet label → value rows separated by hairlines. For details, settings, summaries. */
export function Ledger({ items, className }: { items: LedgerItem[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((item, i) => (
        <div key={i} className="flex items-baseline justify-between gap-8 py-5">
          <dt className="text-lg text-ink-muted">
            {item.label}
            {item.hint && <span className="mt-0.5 block text-base text-ink-faint">{item.hint}</span>}
          </dt>
          {/* Values are never smaller than their labels. */}
          <dd className="text-right text-lg font-medium tabular-nums text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
