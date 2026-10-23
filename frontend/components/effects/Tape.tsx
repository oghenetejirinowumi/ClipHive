"use client";

import { useRef } from "react";
import { cn, cssVars } from "@/lib/cn";
import { pausedAttr, useInView, useMotionBudget } from "./useMotion";

/**
 * A slightly tilted brand-coloured strip of words scrolling sideways.
 * The wrapper clips the overflow so the tilt never causes horizontal page scroll.
 */
export function Tape({ items, seconds = 40, tilt = -2, className }: { items: string[]; seconds?: number; tilt?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const budget = useMotionBudget();
  const inView = useInView(ref);

  const run = (hidden?: boolean) => (
    <div aria-hidden={hidden} className="flex shrink-0 items-center">
      {items.map((item, i) => (
        <span key={i} className="flex items-center whitespace-nowrap">
          <span className="px-8">{item}</span>
          <span aria-hidden className="size-3 rounded-full bg-on-brand/60" />
        </span>
      ))}
    </div>
  );

  return (
    <div ref={ref} className={cn("overflow-hidden py-8", className)} data-fx-paused={pausedAttr(inView, budget)}>
      <div className="-mx-8 bg-brand py-5 text-lg font-semibold tracking-widest lg:text-xl text-on-brand uppercase shadow-glow" style={{ rotate: `${tilt}deg` }}>
        <div className="fx-marquee-track" style={cssVars({ "--duration": `${seconds}s` })}>
          {run()}
          {run(true)}
        </div>
      </div>
    </div>
  );
}
