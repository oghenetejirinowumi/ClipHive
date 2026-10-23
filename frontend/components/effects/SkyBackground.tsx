"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";
import { pausedAttr, useInView, useMotionBudget } from "./useMotion";

/**
 * Night-to-day brand sky: deep at the top, glowing brand in the middle, dissolving into the
 * page at the bottom, with slow drifting cloud bands. Put `text-on-brand` content in the top
 * two-thirds. Parent needs `relative isolate overflow-hidden`.
 */
export function SkyBackground({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const budget = useMotionBudget();
  const inView = useInView(ref);

  return (
    <div ref={ref} aria-hidden data-fx-paused={pausedAttr(inView, budget)} className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}>
      <div className="fx-sky-base" />
      <div className="fx-sky-cloud fx-sky-cloud-1" />
      {budget === "full" && <div className="fx-sky-cloud fx-sky-cloud-2" />}
      <div className="fx-sky-cloud fx-sky-cloud-3" />
    </div>
  );
}
