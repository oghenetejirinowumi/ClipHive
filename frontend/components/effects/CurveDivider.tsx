import { cn } from "@/lib/cn";

/** Soft curved section edge. Colour comes from `text-*` (e.g. `text-surface-sunken`). */
export function CurveDivider({ flip = false, height = 64, className }: { flip?: boolean; height?: number; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 1440 80" preserveAspectRatio="none" className={cn("block w-full", flip && "rotate-180", className)} style={{ height }}>
      <path d="M0 80C360 0 1080 0 1440 80Z" fill="currentColor" />
    </svg>
  );
}
