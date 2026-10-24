import { cn } from "@/lib/cn";

/**
 * Honey running over the top edge of a card, with a few drips that slowly stretch and let go.
 * Absolutely positioned along the top of a `relative` parent; decorative.
 */
export function HoneyDrip({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 300 40" preserveAspectRatio="none" className={cn("honey-drip pointer-events-none absolute inset-x-0 top-0 h-8 w-full", className)}>
      <path
        className="honey-drip-band"
        d="M0 0H300V8C285 8 282 16 276 16S268 8 255 8 236 22 228 22 220 8 205 8 160 9 150 9 128 26 120 26 112 9 100 9 64 10 56 10 44 18 38 18 32 9 20 9 6 8 0 8Z"
      />
      <ellipse className="honey-drop-fall" cx="228" cy="24" rx="3.2" ry="4" style={{ animationDelay: "0.4s" }} />
      <ellipse className="honey-drop-fall" cx="120" cy="28" rx="3.6" ry="4.4" style={{ animationDelay: "2.1s" }} />
      <ellipse className="honey-drop-fall" cx="38" cy="20" rx="2.8" ry="3.6" style={{ animationDelay: "3.6s" }} />
    </svg>
  );
}
