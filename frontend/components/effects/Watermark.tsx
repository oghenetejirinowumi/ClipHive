import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Oversized, barely-there brand wordmark for showcase backdrops. Size it via className. */
export function Watermark({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span aria-hidden className={cn("pointer-events-none select-none font-display font-bold leading-none tracking-tighter text-brand/10", className)}>
      {children}
    </span>
  );
}
