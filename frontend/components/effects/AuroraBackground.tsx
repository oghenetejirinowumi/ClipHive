"use client";

import { useRef } from "react";
import { cn, cssVars } from "@/lib/cn";
import { pausedAttr, useInView, useMotionBudget } from "./useMotion";

// All blobs are tints of the single brand hue.
const BLOBS = [
  { x: "-12%", y: "-24%", size: "62%", blob: "var(--brand)", dx: "8%", dy: "6%", dur: "22s", delay: "0s" },
  { x: "46%", y: "4%", size: "56%", blob: "var(--brand-soft)", dx: "-10%", dy: "8%", dur: "26s", delay: "-6s" },
  { x: "8%", y: "48%", size: "52%", blob: "var(--brand-strong)", dx: "6%", dy: "-10%", dur: "30s", delay: "-12s" },
  { x: "58%", y: "56%", size: "46%", blob: "var(--brand)", dx: "-6%", dy: "-6%", dur: "24s", delay: "-3s" },
];

/**
 * Slow drifting brand-tinted light, absolutely positioned to fill its parent.
 * Give the parent `relative isolate overflow-hidden`.
 */
export function AuroraBackground({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const budget = useMotionBudget();
  const inView = useInView(ref);
  const blobs = budget === "full" ? BLOBS : BLOBS.slice(0, 2);

  return (
    <div ref={ref} aria-hidden data-fx-paused={pausedAttr(inView, budget)} className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}>
      {blobs.map((b, i) => (
        <span
          key={i}
          className="fx-blob"
          style={cssVars({ "--x": b.x, "--y": b.y, "--size": b.size, "--blob": b.blob, "--dx": b.dx, "--dy": b.dy, "--dur": b.dur, "--delay": b.delay })}
        />
      ))}
    </div>
  );
}
