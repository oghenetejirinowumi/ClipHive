"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useMotionBudget } from "@/components/effects/useMotion";
import { Segmented } from "@/components/ui";
import { cn, cssVars } from "@/lib/cn";
import { Bee } from "./Bee";

type Vision = "human" | "bee";

const BARS = 64;
// The three moments worth clipping, as bar index + what happened.
const PEAKS = [
  { at: 12, time: "02:14:09", what: "Clutch 1v4", lift: 0 },
  { at: 34, time: "05:41:30", what: "Rage quit", lift: 1 },
  { at: 52, time: "08:02:11", what: "Chat explodes", lift: 0 },
];

/** Same pseudo-random numbers on the server and the client. */
function noise(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Your eyes: ten hours that all look alike. Bee vision: the same audio, but the peaks stand out.
const HEIGHTS = Array.from({ length: BARS }, (_, i) => {
  const flat = 34 + noise(i) * 26;
  const near = PEAKS.reduce((m, p) => Math.max(m, 1 - Math.abs(i - p.at) / 3.2), 0);
  const bee = near > 0 ? Math.max(flat * 0.55, 42 + near * 56) : flat * 0.45;
  // Rounded so the server and the browser print the exact same style string.
  return { human: Math.round(flat * 10) / 10, bee: Math.round(bee * 10) / 10, hot: near > 0.6 };
});

/**
 * Bees see in ultraviolet: flowers carry nectar guides only they can see. The panel shows a
 * ten-hour stream "with your eyes", then switches to bee vision on its own the first time it
 * is seen: the panel goes ultraviolet, the peaks glow and a bee lands on each moment.
 */
export function BeeVision({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, rootMargin: "0px 0px -25% 0px" });
  const budget = useMotionBudget();
  const [vision, setVision] = useState<Vision>("human");
  const touched = useRef(false);

  useEffect(() => {
    if (!seen || touched.current) return;
    const t = window.setTimeout(() => !touched.current && setVision("bee"), budget === "off" ? 0 : 1100);
    return () => window.clearTimeout(t);
  }, [seen, budget]);

  const bee = vision === "bee";

  return (
    <div ref={ref} className={cn("space-y-6", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-lg text-ink-muted lg:text-xl">
          {bee ? "Bee vision: the moments worth clipping light up." : "To you, ten hours of stream look the same."}
        </p>
        <Segmented
          label="How you see the stream"
          value={vision}
          onChange={(v) => {
            touched.current = true;
            setVision(v);
          }}
          options={[
            { value: "human", label: "Your eyes", icon: "eye" },
            { value: "bee", label: "Bee vision", icon: "bee" },
          ]}
        />
      </div>

      <div data-vision={vision} className="uv-panel relative isolate overflow-hidden rounded-xl border border-line px-4 pt-28 pb-6 sm:px-8 sm:pt-32 lg:px-10">
        <div className="uv-wash" aria-hidden />

        {/* Moment pins: a hex marker with a bee, the timestamp and what happened. */}
        <div aria-hidden={!bee} className="absolute inset-x-4 top-4 h-24 sm:inset-x-8 lg:inset-x-10">
          {PEAKS.map((p, i) => (
            <div
              key={p.at}
              className="uv-pin absolute flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${((p.at + 0.5) / BARS) * 100}%`, top: p.lift ? 0 : 18, ...cssVars({ "--i": i }) }}
            >
              <Bee variant={i === 1 ? "worker" : "scout"} tone="inverse" size={30} flying={budget !== "off"} className="uv-pin-bee" />
              <span className="font-mono text-fine font-medium whitespace-nowrap text-on-brand tabular-nums">{p.time}</span>
              <span className="text-fine whitespace-nowrap text-on-brand/80">{p.what}</span>
            </div>
          ))}
        </div>

        <div className="flex h-36 items-end gap-[2px] sm:h-44 sm:gap-1" role="img" aria-label={bee ? `Stream audio with ${PEAKS.length} highlighted moments` : "Stream audio, ten hours, no moments marked"}>
          {HEIGHTS.map((b, i) => (
            <span
              key={i}
              className={cn("uv-bar min-w-0 flex-1 rounded-full", b.hot && "uv-bar-hot")}
              style={{ height: `${bee ? b.bee : b.human}%`, ...cssVars({ "--i": i }) }}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-between font-mono text-meta text-ink-faint uv-axis">
          <span>00:00</span>
          <span>10:00:00</span>
        </div>
      </div>
    </div>
  );
}
