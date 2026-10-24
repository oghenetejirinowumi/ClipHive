import { cn } from "@/lib/cn";
import { Bee } from "./Bee";

/** A bee looping a little figure-eight while something loads. */
export function BeeLoader({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-4 text-lg text-ink-muted", className)}>
      <span aria-hidden className="bee-loader">
        <span className="bee-loader-path">
          <Bee size={30} />
        </span>
      </span>
      {label}
    </div>
  );
}

/** A bee asleep in its cell, for empty states. */
export function SleepingBee({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("sleeping-bee", className)}>
      <Bee size={64} flying={false} />
      <span className="sleeping-z sleeping-z-1">z</span>
      <span className="sleeping-z sleeping-z-2">z</span>
      <span className="sleeping-z sleeping-z-3">Z</span>
    </span>
  );
}
