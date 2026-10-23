"use client";

import { useRef, type ReactNode } from "react";
import { cn, cssVars } from "@/lib/cn";
import { pausedAttr, useInView, useMotionBudget } from "./useMotion";

const TILTS = [-3, 2, -1.5, 3, -2.5, 1.5];

/** A loose cluster of gently floating pill chips. */
export function FeatureCloud({ items, className }: { items: ReactNode[]; className?: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const budget = useMotionBudget();
  const inView = useInView(ref);

  return (
    <ul ref={ref} data-fx-paused={pausedAttr(inView, budget)} className={cn("flex flex-wrap justify-center gap-3", className)}>
      {items.map((item, i) => (
        <li
          key={i}
          // On "lite" devices only every other chip floats.
          className={cn(
            // Floor: ≥ 1rem text, ≥ 40px tall. Make it min-h-11 if a chip ever becomes clickable.
            "inline-flex min-h-12 items-center rounded-full border border-line bg-surface px-6 py-2.5 text-lg font-medium text-ink shadow-glow",
            (budget === "full" || i % 2 === 0) && "fx-float",
          )}
          style={cssVars({ "--delay": `${-i * 0.9}s`, "--tilt": `${TILTS[i % TILTS.length]}deg` })}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
