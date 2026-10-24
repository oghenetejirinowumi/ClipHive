import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Bold italic emphasis inside a headline: "Know your app is <Em>down</Em>". */
export function Em({ children, className }: { children: ReactNode; className?: string }) {
  return <em className={cn("font-bold italic tracking-tight", className)}>{children}</em>;
}

/** `// HOW IT WORKS` style section marker. Uppercase, but never below the 15px floor. */
export function SectionLabel({ children, inverse, className }: { children: ReactNode; inverse?: boolean; className?: string }) {
  return (
    <p className={cn("font-mono text-meta font-medium tracking-[0.16em] uppercase", inverse ? "text-on-brand/75" : "text-ink-muted", className)}>
      <span aria-hidden>{"// "}</span>
      {children}
    </p>
  );
}

/**
 * A section opened by a hairline. With `label`, the label sits in a left rail and content on
 * the right. Without one, the heading is centred above full-width content. Use labels
 * sparingly: they mark a few key sections, not every block.
 */
export function EditorialSection({
  label,
  title,
  children,
  className,
}: {
  label?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  if (!label) {
    return (
      <section className={cn("border-t border-line pt-14 lg:pt-20", className)}>
        {title && (
          <h2 className="mx-auto max-w-4xl text-center font-display text-4xl leading-tight font-semibold tracking-tight text-balance text-ink lg:text-6xl">{title}</h2>
        )}
        {children && <div className={title ? "mt-12 lg:mt-16" : undefined}>{children}</div>}
      </section>
    );
  }
  return (
    <section className={cn("grid gap-8 border-t border-line pt-10 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-14 lg:pt-14", className)}>
      <SectionLabel className="lg:pt-3">{label}</SectionLabel>
      <div className="min-w-0">
        {title && <h2 className="max-w-4xl font-display text-4xl leading-tight font-semibold tracking-tight text-ink lg:text-6xl">{title}</h2>}
        {children && <div className={title ? "mt-12" : undefined}>{children}</div>}
      </div>
    </section>
  );
}

export type Stat = { value: ReactNode; label: ReactNode };

/** Big numbers in a row, each opened by a hairline. */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-5 gap-y-8 sm:gap-x-8 sm:gap-y-10 lg:grid-cols-4", className)}>
      {stats.map((s, i) => (
        <div key={i} className="flex min-w-0 flex-col-reverse gap-2 border-t border-line-strong pt-4 sm:gap-3 sm:pt-6">
          <dt className="text-base text-ink-muted sm:text-lg">{s.label}</dt>
          <dd className="font-display text-4xl font-semibold tracking-tight text-ink tabular-nums sm:text-5xl lg:text-6xl">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type TimelineItem = { marker: ReactNode; title?: ReactNode; body: ReactNode };

/** Oversized markers down the left, separated by hairlines; the last one is lit in brand. `compact` fits a side column. */
export function Timeline({ items, compact, className }: { items: TimelineItem[]; compact?: boolean; className?: string }) {
  return (
    <ol className={cn("divide-y divide-line border-y border-line", className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <li
            key={i}
            className={cn(
              "grid gap-3",
              compact ? "grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-6 py-5" : "py-7 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-baseline sm:gap-10 lg:py-9",
            )}
          >
            <span className={cn("font-display font-semibold tracking-tight", compact ? "text-4xl" : "text-5xl lg:text-7xl", last ? "text-brand" : "text-ink")}>
              {item.marker}
            </span>
            <span>
              {item.title && <span className="block font-display text-2xl font-semibold tracking-tight text-ink lg:text-3xl">{item.title}</span>}
              <span className="mt-2 block text-lg text-ink-muted lg:text-xl">{item.body}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A full-bleed brand block for one big statement. */
export function QuoteBanner({ quote, attribution, action, className }: { quote: ReactNode; attribution?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <figure className={cn("relative isolate overflow-hidden rounded-xl bg-brand p-10 text-on-brand shadow-glow lg:p-16", className)}>
      <blockquote className="max-w-5xl font-display text-3xl leading-snug font-semibold tracking-tight text-balance lg:text-5xl">{quote}</blockquote>
      {(attribution || action) && (
        <figcaption className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          {attribution && <span className="text-lg opacity-85">{attribution}</span>}
          {action}
        </figcaption>
      )}
    </figure>
  );
}
