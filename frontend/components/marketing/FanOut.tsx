"use client";

import { useRef } from "react";
import { pausedAttr, useInView, useMotionBudget } from "@/components/effects/useMotion";
import { Icon } from "@/components/ui";
import { cssVars } from "@/lib/cn";

const SOURCES = ["Twitch", "Kick", "YouTube"];
const DESTINATIONS = ["TikTok", "YouTube Shorts", "Instagram Reels", "X"];

// Column geometry, as % of the diagram width (grid 1fr | 1.1fr | 1fr, cards 85% of their column).
const SRC_EDGE = 32.3;
const HUB_IN = 38.5;
const HUB_OUT = 61.5;
const DST_EDGE = 67.7;
// Equal-height items under justify-around sit at (i + 0.5) / n of the height.
const rowY = (i: number, n: number) => ((i + 0.5) / n) * 100;

function Node({ role, name }: { role: string; name: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-6 py-5 shadow-glow">
      <p className="font-mono text-meta tracking-[0.14em] text-ink-muted uppercase">{role}</p>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">{name}</p>
    </div>
  );
}

function Hub() {
  return (
    <div className="relative rounded-xl bg-brand px-8 py-10 text-center text-on-brand shadow-glow-strong">
      <span aria-hidden className="absolute -inset-3 -z-10 animate-pulse rounded-[2.2rem] motion-reduce:animate-none bg-brand/25" />
      <span className="mx-auto grid size-16 place-items-center rounded-lg bg-on-brand text-brand">
        <Icon name="play" className="size-7" />
      </span>
      <p className="mt-5 font-display text-3xl font-semibold tracking-tight">ClipHive</p>
      <p className="mt-2 text-lg text-on-brand/85">One stream in, many clips, styles and posts out.</p>
      <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-on-brand/15 px-4 py-2 text-base font-medium">
        <Icon name="download" className="size-5" />
        Download always available
      </p>
    </div>
  );
}

/** Every source feeds every destination through ClipHive. Pulses travel the lines (paused offscreen / reduced motion). */
export function FanOut() {
  const ref = useRef<HTMLDivElement>(null);
  const budget = useMotionBudget();
  const inView = useInView(ref);

  return (
    <div ref={ref} data-fx-paused={pausedAttr(inView, budget)}>
      {/* Desktop: three columns with connecting curves */}
      <div className="relative hidden h-[36rem] grid-cols-[1fr_1.1fr_1fr] lg:grid">
        <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
          {SOURCES.map((_, i) => {
            const y = rowY(i, SOURCES.length);
            const d = `M ${SRC_EDGE} ${y} C ${SRC_EDGE + 4} ${y}, ${HUB_IN - 4} 50, ${HUB_IN} 50`;
            return (
              <g key={`s${i}`}>
                <path d={d} className="fx-flow-base" vectorEffect="non-scaling-stroke" />
                <path d={d} pathLength={100} className="fx-flow-pulse" vectorEffect="non-scaling-stroke" style={cssVars({ "--d": `${i * 0.45}s` })} />
              </g>
            );
          })}
          {DESTINATIONS.map((_, i) => {
            const y = rowY(i, DESTINATIONS.length);
            const d = `M ${HUB_OUT} 50 C ${HUB_OUT + 4} 50, ${DST_EDGE - 4} ${y}, ${DST_EDGE} ${y}`;
            return (
              <g key={`d${i}`}>
                <path d={d} className="fx-flow-base" vectorEffect="non-scaling-stroke" />
                <path d={d} pathLength={100} className="fx-flow-pulse" vectorEffect="non-scaling-stroke" style={cssVars({ "--d": `${1.4 + i * 0.35}s` })} />
              </g>
            );
          })}
        </svg>

        <ul className="flex flex-col justify-around">
          {SOURCES.map((s) => (
            <li key={s} className="ml-auto w-[85%]">
              <Node role="Source" name={s} />
            </li>
          ))}
        </ul>
        <div className="grid place-items-center">
          <div className="w-[70%]">
            <Hub />
          </div>
        </div>
        <ul className="flex flex-col justify-around">
          {DESTINATIONS.map((d) => (
            <li key={d} className="mr-auto w-[85%]">
              <Node role="Destination" name={d} />
            </li>
          ))}
        </ul>
      </div>

      {/* Phones / tablets: stacked, sources → hub → destinations */}
      <div className="space-y-6 lg:hidden">
        <ul className="grid grid-cols-3 gap-3">
          {SOURCES.map((s) => (
            <li key={s}>
              <Node role="Source" name={s} />
            </li>
          ))}
        </ul>
        <Icon name="chevronDown" className="mx-auto size-8 text-brand" />
        <Hub />
        <Icon name="chevronDown" className="mx-auto size-8 text-brand" />
        <ul className="grid grid-cols-2 gap-3">
          {DESTINATIONS.map((d) => (
            <li key={d}>
              <Node role="Destination" name={d} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
