import { cn } from "@/lib/cn";
import { Bee } from "./Bee";

export type FlowerState = "bloom" | "bud" | "wilt";

const PETALS = [0, 60, 120, 180, 240, 300];

/**
 * A channel as a flower the Scout forages from: in full bloom while live, a closed bud while
 * offline, wilted while paused. `scout` puts a Scout bee on it: hovering while `"hover"`,
 * circling it while `"busy"` (checking or recording). Decorative; the state is always also
 * written in text next to it.
 */
export function Flower({
  state,
  letter,
  scout,
  size = 56,
  className,
}: {
  state: FlowerState;
  /** The channel's initial, shown in the flower's heart. */
  letter?: string;
  scout?: "hover" | "busy";
  size?: number;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("flower", `flower-${state}`, className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} className="flower-art">
        <g className="flower-petals">
          {PETALS.map((a, i) => (
            // Rotation lives on the group so CSS can scale the petal itself from its base.
            <g key={a} transform={`rotate(${a} 32 32)`}>
              <ellipse cx="32" cy="15" rx="8.5" ry="13" className="flower-petal" style={{ transitionDelay: `${i * 40}ms`, animationDelay: `${i * 40}ms` }} />
            </g>
          ))}
        </g>
        <circle cx="32" cy="32" r="12" className="flower-heart" />
        {letter && (
          <text x="32" y="37.5" textAnchor="middle" className="flower-letter">
            {letter.toUpperCase()}
          </text>
        )}
      </svg>
      {scout && (
        <span className={cn("flower-scout", scout === "busy" && "flower-scout-busy")}>
          <Bee variant="scout" size={Math.round(size * 0.5)} />
        </span>
      )}
    </span>
  );
}
