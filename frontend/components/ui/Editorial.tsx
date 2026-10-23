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

/** Label in a left rail, content on the right, opened by a hairline. Stacks on phones. */
export function EditorialSection({
  label,
  title,
  children,
  className,
}: {
  label: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
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
    <dl className={cn("grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {stats.map((s, i) => (
        <div key={i} className="flex flex-col-reverse gap-3 border-t border-line-strong pt-6">
          <dt className="text-lg text-ink-muted">{s.label}</dt>
          <dd className="font-display text-5xl font-semibold tracking-tight text-ink tabular-nums lg:text-6xl">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type TimelineItem = { marker: ReactNode; title?: ReactNode; body: ReactNode };

/** Oversized markers down the left, separated by hairlines; the last one is lit in brand. */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("divide-y divide-line border-y border-line", className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <li key={i} className="grid gap-3 py-7 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-baseline sm:gap-10 lg:py-9">
            <span className={cn("font-display text-5xl font-semibold tracking-tight lg:text-7xl", last ? "text-brand" : "text-ink")}>{item.marker}</span>
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

export type ToneStep = { eyebrow: ReactNode; title: ReactNode; body?: ReactNode };

// Deep → brand → soft → subtle: one hue stepping down in strength.
const STEPS = [
  "bg-brand-deep text-on-brand",
  "bg-brand text-on-brand",
  "bg-brand-soft text-ink",
  "bg-brand-subtle text-ink",
];

/** A row of tall tiles stepping down through the brand hue. Wraps to 2 or 1 columns. */
export function ToneSteps({ steps, className }: { steps: ToneStep[]; className?: string }) {
  return (
    <div className={cn("grid overflow-hidden rounded-lg sm:grid-cols-2 lg:grid-cols-4", className)}>
      {steps.map((s, i) => (
        <div key={i} className={cn("flex min-h-72 flex-col justify-between gap-10 p-8 lg:min-h-96 lg:p-10", STEPS[i % STEPS.length])}>
          <p className="font-mono text-meta tracking-[0.16em] uppercase opacity-80">{s.eyebrow}</p>
          <div>
            <p className="font-display text-3xl font-semibold tracking-tight lg:text-4xl">{s.title}</p>
            {s.body && <p className="mt-3 text-lg opacity-80">{s.body}</p>}
          </div>
        </div>
      ))}
    </div>
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
