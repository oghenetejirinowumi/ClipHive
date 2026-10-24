import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A 9:16 phone canvas. Always dark (it stands in for video), in both themes. Children fill the
 * screen; the bottom strip marks the area TikTok/Reels UI covers. A size container, so
 * captions inside can use cqw units. Never taller than the screen, so it's seen whole on phones.
 */
export function PhoneFrame({ children, overlay, className }: { children: ReactNode; overlay?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "@container relative mx-auto aspect-[9/16] w-full max-w-[min(24rem,max(14rem,calc((100dvh-13rem)*0.5625)))] overflow-hidden rounded-[2.4rem] border-[6px] border-brand-deep bg-brand-deep shadow-glow-strong",
        className,
      )}
    >
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,color-mix(in_oklab,var(--brand)_45%,transparent),transparent_70%)]" />
      <div aria-hidden className="absolute top-3 left-1/2 z-20 h-6 w-28 -translate-x-1/2 rounded-full bg-brand-deep" />
      <div className="absolute inset-0 z-10">{children}</div>
      {overlay ?? (
        <div aria-hidden className="absolute inset-x-0 bottom-0 z-20 border-t border-dashed border-on-brand/25 px-6 pt-3 pb-5">
          <p className="text-center font-mono text-fine tracking-[0.14em] text-on-brand/55 uppercase">Platform UI zone</p>
        </div>
      )}
    </div>
  );
}
