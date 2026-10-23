"use client";

import { useId, useState, type MouseEvent } from "react";
import { cn, cssVars } from "@/lib/cn";
import { useThemeMode } from "@/lib/theme-mode";

const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];
const STARS = [
  { x: 6, y: 8, s: 1 },
  { x: 25.5, y: 6, s: 0.75 },
  { x: 26, y: 25, s: 0.6 },
];
const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const distance = 38 + (i % 3) * 10;
  return { bx: Math.cos(angle) * distance, by: Math.sin(angle) * distance, delay: (i % 4) * 18 };
});

// A four-point sparkle centred on (x, y).
const sparkle = (x: number, y: number, s: number) =>
  `M${x} ${y - 2.6 * s}Q${x + 0.5 * s} ${y - 0.5 * s} ${x + 2.6 * s} ${y}Q${x + 0.5 * s} ${y + 0.5 * s} ${x} ${y + 2.6 * s}Q${x - 0.5 * s} ${y + 0.5 * s} ${x - 2.6 * s} ${y}Q${x - 0.5 * s} ${y - 0.5 * s} ${x} ${y - 2.6 * s}Z`;

/**
 * "Eclipse" theme switch. Light: a sun with rays. Dark: the moon's shadow slides across,
 * leaving a glowing crescent and twinkling stars. Each press fires a stardust burst, and the
 * new theme spreads across the page from the button (see lib/theme-mode.tsx).
 */
export function ThemeSwitch({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const { mode, toggle } = useThemeMode();
  const [burst, setBurst] = useState(0);
  const maskId = `eclipse-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const dark = mode === "dark";

  function onClick(e: MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setBurst((n) => n + 1);
    navigator.vibrate?.(8);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      data-mode={mode}
      onClick={onClick}
      className={cn("eclipse tactile relative grid shrink-0 place-items-center rounded-full", size === "lg" ? "size-16" : "size-14", className)}
    >
      <span aria-hidden className="eclipse-corona" />
      <svg aria-hidden viewBox="0 0 32 32" className="eclipse-art relative size-8">
        <defs>
          <mask id={maskId}>
            <rect width="32" height="32" fill="white" />
            <circle className="eclipse-shadow" cx="16" cy="16" r="7.4" fill="black" />
          </mask>
        </defs>
        <g className="eclipse-rays">
          {RAYS.map((a) => (
            <line key={a} x1="16" y1="2.8" x2="16" y2="6.2" transform={`rotate(${a} 16 16)`} />
          ))}
        </g>
        <circle className="eclipse-body" cx="16" cy="16" r="6" mask={`url(#${maskId})`} />
        <g className="eclipse-stars">
          {STARS.map((s, i) => (
            <path key={i} d={sparkle(s.x, s.y, s.s)} style={cssVars({ "--i": i })} />
          ))}
        </g>
      </svg>
      {/* Remounted on every press so the burst replays. */}
      <span key={burst} aria-hidden className="eclipse-burst">
        {burst > 0 && (
          <>
            <span className="eclipse-shockwave" />
            {PARTICLES.map((p, i) => (
              <span key={i} className="eclipse-particle" style={cssVars({ "--bx": `${p.bx}px`, "--by": `${p.by}px`, "--bd": `${p.delay}ms` })} />
            ))}
          </>
        )}
      </span>
    </button>
  );
}
