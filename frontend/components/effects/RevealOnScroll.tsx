"use client";

import { useRef, type ReactNode } from "react";
import { cn, cssVars } from "@/lib/cn";
import { useInView, useMotionBudget } from "./useMotion";

/** Fades + rises its children in the first time they scroll into view. */
export function RevealOnScroll({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, rootMargin: "0px 0px -10% 0px" });
  const budget = useMotionBudget();

  return (
    <div ref={ref} data-revealed={inView || budget === "off" ? "" : undefined} className={cn("fx-reveal", className)} style={cssVars({ "--delay": `${delay}ms` })}>
      {children}
    </div>
  );
}
