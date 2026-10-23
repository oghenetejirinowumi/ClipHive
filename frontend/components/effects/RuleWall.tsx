import type { ReactNode } from "react";
import { cn, cssVars } from "@/lib/cn";
import { RevealOnScroll } from "./RevealOnScroll";

const TILTS = [-2, 1.5, -1, 2.5, -1.5, 1];

export type Rule = { title: ReactNode; body?: ReactNode };

/** A wall of tilted "sticker" cards that straighten on hover. */
export function RuleWall({ rules, className }: { rules: Rule[]; className?: string }) {
  return (
    <div className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {rules.map((rule, i) => (
        <RevealOnScroll key={i} delay={i * 70}>
          <div
            className="tactile h-full rounded-lg border border-line bg-surface p-8 shadow-glow lg:p-10 rotate-(--tilt) hover:rotate-0"
            style={cssVars({ "--tilt": `${TILTS[i % TILTS.length]}deg` })}
          >
            <p className="font-display text-2xl font-semibold tracking-tight text-ink lg:text-3xl">{rule.title}</p>
            {rule.body && <p className="mt-3 text-lg text-ink-muted lg:text-xl">{rule.body}</p>}
          </div>
        </RevealOnScroll>
      ))}
    </div>
  );
}
