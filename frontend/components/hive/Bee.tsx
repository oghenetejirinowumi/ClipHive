import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

export type BeeVariant = "plain" | "scout" | "worker" | "honey" | "queen";

/**
 * A bee, facing right. Purely decorative (aria-hidden).
 * `tone="inverse"` is for the brand sky (light body, deep stripes, soft glow).
 * Wings flap only while `flying` is on; everything stops under reduced motion.
 * Each variant has its own accessory: radar pings (scout), pollen baskets (worker),
 * a honey drip (honey) and a crown (queen).
 */
export function Bee({
  variant = "plain",
  tone = "default",
  flying = true,
  size = 40,
  className,
  style,
}: {
  variant?: BeeVariant;
  tone?: "default" | "inverse";
  flying?: boolean;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const queen = variant === "queen";
  // The queen's abdomen is longer; everything else shares one body.
  const rx = queen ? 15 : 12.5;
  const cx = queen ? 22 : 23.5;
  return (
    <svg
      aria-hidden
      viewBox="0 0 64 56"
      width={size}
      height={(size * 56) / 64}
      className={cn("bee", tone === "inverse" && "bee-inverse", flying && "bee-flying", className)}
      style={style}
    >
      {variant === "scout" && (
        <g className="bee-ping">
          <path d="M52 18a10 10 0 0 1 0 16" />
          <path d="M56 13a17 17 0 0 1 0 26" />
        </g>
      )}

      {/* Back wing, then front wing; they flap from where they meet the body. */}
      <g className="bee-flap bee-flap-back">
        <ellipse className="bee-wing" cx="30" cy="13" rx="7" ry="11" transform="rotate(-24 30 13)" />
      </g>
      <g className="bee-flap">
        <ellipse className="bee-wing" cx="23" cy="14" rx="8" ry="12.5" transform="rotate(-38 23 14)" />
      </g>

      {/* Stinger */}
      <path className="bee-stripe-fill" d={`M${cx - rx + 1.5} 31 L${cx - rx - 5} 33 L${cx - rx + 1.5} 35.5 Z`} />

      {/* Abdomen with three stripes, kept inside the body outline. */}
      <ellipse className="bee-body" cx={cx} cy="33" rx={rx} ry="10" />
      <g className="bee-stripe-fill">
        <path d={stripe(cx, rx, -0.42)} />
        <path d={stripe(cx, rx, 0.02)} />
        <path d={stripe(cx, rx, 0.44)} />
      </g>

      {/* Head, eye and antennae */}
      <circle className="bee-body" cx="41" cy="30" r="7" />
      <circle className="bee-stripe-fill" cx="44" cy="28.5" r="1.9" />
      <path className="bee-line" d="M43 24c1-5 3-7 6-8M39.5 23.5c-.5-5 .5-8 2.5-10" />
      <circle className="bee-stripe-fill" cx="49" cy="16" r="1.5" />
      <circle className="bee-stripe-fill" cx="42" cy="13.5" r="1.5" />

      {/* Legs */}
      <path className="bee-line" d="M20 42.5l-2 5M26 43l-.5 5.5M32 42l1.5 5" />

      {variant === "worker" && (
        <g className="bee-pollen">
          <circle cx="17.5" cy="48" r="3" />
          <circle cx="25.5" cy="49.5" r="3" />
        </g>
      )}
      {variant === "honey" && <path className="bee-drip" d={`M${cx - rx + 4} 41c0 0-2.6 3.6-2.6 5.4a2.6 2.6 0 0 0 5.2 0c0-1.8-2.6-5.4-2.6-5.4z`} />}
      {queen && <path className="bee-crown" d="M35 22l1.5-7 3.2 4 2.3-5.5 2.3 5.5 3.2-4 1.5 7z" />}
    </svg>
  );
}

/** A vertical band at `at` (−1…1 across the abdomen) that stays inside its ellipse (cy 33, ry 10). */
function stripe(cx: number, rx: number, at: number) {
  const w = rx * 0.2;
  const x = cx + rx * at;
  // Half-height of the ellipse at the band's outer edge, so the corners never poke out.
  const edge = Math.max(Math.abs(at), Math.abs(at + 0.2));
  const h = 10 * Math.sqrt(1 - edge * edge) - 0.2;
  const r = (n: number) => n.toFixed(2);
  return `M${r(x)} ${r(33 - h)} Q${r(x - w * 0.35)} 33 ${r(x)} ${r(33 + h)} L${r(x + w)} ${r(33 + h)} Q${r(x + w * 0.65)} 33 ${r(x + w)} ${r(33 - h)} Z`;
}
