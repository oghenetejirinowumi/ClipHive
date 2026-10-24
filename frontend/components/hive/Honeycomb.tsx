"use client";

import { useEffect, useId, useRef, useState } from "react";
import { pausedAttr, useInView, useMotionBudget } from "@/components/effects/useMotion";
import { cn, cssVars } from "@/lib/cn";

const SQRT3 = Math.sqrt(3);

/** Points of a pointy-top hexagon of radius r centred on (cx, cy). */
export function hexPoints(r: number, cx = 0, cy = 0): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

/** React ids contain characters that break `url(#…)`; keep letters and digits only. */
function useSvgId(prefix: string) {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

// Cells that glint now and then, as [column, row] in the lattice. Low columns first so
// phones see a few too.
const GLINTS: [number, number, number][] = [
  [1, 1, 0],
  [3, 2, 1.8],
  [6, 0, 3.1],
  [2, 4, 4.4],
  [8, 3, 0.9],
  [12, 1, 2.6],
  [15, 4, 3.9],
  [19, 2, 1.2],
  [23, 0, 5.2],
  [27, 3, 2.1],
  [31, 1, 4.7],
  [10, 5, 5.8],
];

/**
 * A faint honeycomb lattice that fills its parent, fading out towards one edge, with a few
 * cells glinting in turn. Decorative; give the parent `relative isolate overflow-hidden`.
 */
export function HoneycombLattice({
  r = 22,
  tone = "default",
  fade = "bottom",
  className,
}: {
  r?: number;
  tone?: "default" | "inverse";
  /** Which edge the comb grows from; the opposite side fades away. */
  fade?: "bottom" | "top" | "right" | "radial";
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const id = useSvgId("comb");
  const budget = useMotionBudget();
  const inView = useInView(ref);
  const w = SQRT3 * r;
  const h = 3 * r;
  // One tile: a full hexagon plus the shared wall below it; tiled, that draws the whole comb.
  const tile = `M${w / 2} 0 L${w} ${r / 2} L${w} ${r * 1.5} L${w / 2} ${r * 2} L0 ${r * 1.5} L0 ${r / 2} Z M${w / 2} ${r * 2} L${w / 2} ${r * 3}`;

  return (
    <svg
      ref={ref}
      aria-hidden
      data-fx-paused={pausedAttr(inView, budget)}
      className={cn("hex-lattice pointer-events-none absolute inset-0 -z-10 h-full w-full", `hex-fade-${fade}`, tone === "inverse" && "hex-lattice-inverse", className)}
    >
      <defs>
        <pattern id={id} width={w} height={h} patternUnits="userSpaceOnUse">
          <path d={tile} className="hex-lattice-line" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      {budget !== "off" &&
        GLINTS.map(([col, row, delay], i) => {
          // Rows alternate between the hexagon in the tile and the ones offset half a cell.
          const odd = row % 2 === 1;
          const cx = odd ? col * w : col * w + w / 2;
          const cy = odd ? Math.floor(row / 2) * h + 2.5 * r : (row / 2) * h + r;
          return <polygon key={i} points={hexPoints(r - 3, cx, cy)} className="hex-glint" style={cssVars({ "--delay": `${delay}s` })} />;
        })}
    </svg>
  );
}

type Cell = { cx: number; cy: number; order: number; star: boolean };

function combLayout(count: number, cols: number, r: number) {
  const w = SQRT3 * r;
  const rowStep = 1.5 * r;
  const rows = Math.ceil(count / cols);
  const cells: Omit<Cell, "order" | "star">[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    cells.push({ cx: w / 2 + col * w + (row % 2 ? w / 2 : 0), cy: r + row * rowStep });
  }
  const width = cols * w + w / 2;
  const height = 2 * r + (rows - 1) * rowStep;
  // Fill from the middle of the comb outwards, the way a colony builds.
  const mx = width / 2;
  const my = height / 2;
  const byDistance = cells.map((c, i) => ({ i, d: Math.hypot(c.cx - mx, (c.cy - my) * 1.3) })).sort((a, b) => a.d - b.d);
  const order = new Array<number>(count);
  byDistance.forEach((b, k) => (order[b.i] = k));
  return {
    width,
    height,
    cells: cells.map((c, i) => ({ ...c, order: order[i], star: i % 7 === 3 })),
  };
}

/**
 * A comb of `count` cells that fill with honey one by one, from the middle out, the first time
 * it scrolls into view; each finished cell shows a play mark (one cell = one clip). A counter
 * underneath counts the clips as they fill. Phones get a narrower comb with bigger cells.
 */
export function CombFill({
  count = 24,
  cols = 8,
  mobileCount = 20,
  mobileCols = 4,
  className,
}: {
  count?: number;
  cols?: number;
  mobileCount?: number;
  mobileCols?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const filled = useInView(ref, { once: true, rootMargin: "0px 0px -20% 0px" });
  const budget = useMotionBudget();
  const live = filled || budget === "off";
  const [shown, setShown] = useState(0);
  const STEP = 70;

  // Count clips up in time with the cells (the larger comb sets the pace).
  useEffect(() => {
    if (!live) return;
    if (budget === "off") {
      setShown(count);
      return;
    }
    let k = 0;
    const t = window.setInterval(() => {
      k += 1;
      setShown(k);
      if (k >= count) window.clearInterval(t);
    }, STEP);
    return () => window.clearInterval(t);
  }, [live, budget, count]);

  return (
    <div ref={ref} className={className}>
      <Comb count={mobileCount} cols={mobileCols} live={live} step={STEP} className="sm:hidden" />
      <Comb count={count} cols={cols} live={live} step={STEP} className="hidden sm:block" />
      <p className="mt-8 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-2 text-center font-display text-3xl font-semibold tracking-tight text-ink lg:text-4xl">
        <span>1 stream</span>
        <span aria-hidden className="text-brand">
          →
        </span>
        <span className="tabular-nums">
          <span aria-hidden>{shown}</span>
          <span className="sr-only">{count}</span> clips
        </span>
      </p>
    </div>
  );
}

function Comb({ count, cols, live, step, className }: { count: number; cols: number; live: boolean; step: number; className?: string }) {
  const r = 40;
  const id = useSvgId("cell");
  const { width, height, cells } = combLayout(count, cols, r);
  const pad = 6;
  return (
    <svg
      aria-hidden
      viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`}
      data-filled={live ? "" : undefined}
      className={cn("comb mx-auto h-auto w-full", className)}
      style={{ maxWidth: cols * 110 }}
    >
      <defs>
        <clipPath id={id}>
          <polygon points={hexPoints(r - 4)} />
        </clipPath>
      </defs>
      {cells.map((c, i) => (
        <g key={i} transform={`translate(${c.cx.toFixed(2)} ${c.cy.toFixed(2)})`} style={cssVars({ "--d": `${c.order * step}ms` })}>
          <polygon points={hexPoints(r - 4)} className="comb-cell" />
          <g clipPath={`url(#${id})`}>
            <g className="comb-pour">
              <rect x={-r} y={-r} width={r * 2} height={r * 2} className="comb-honey" />
              <rect x={-r} y={-r} width={r * 2} height={r * 0.7} className="comb-sheen" />
            </g>
          </g>
          <path d="M-7 -10 L11 0 L-7 10 Z" className={cn("comb-play", c.star && "comb-play-star")} />
          {c.star && <polygon points={hexPoints(r - 1)} className="comb-star" />}
        </g>
      ))}
    </svg>
  );
}
