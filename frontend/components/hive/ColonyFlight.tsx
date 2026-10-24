"use client";

import { useRef, type ReactNode } from "react";
import { pausedAttr, useInView, useMotionBudget } from "@/components/effects/useMotion";
import { AGENT_LABEL, BEE_SPECIES, type AgentKind } from "@/lib/agents";
import { cn, cssVars } from "@/lib/cn";
import { Bee, type BeeVariant } from "./Bee";

export const BEE_VARIANT: Record<AgentKind, BeeVariant> = {
  scout: "scout",
  producer: "worker",
  publisher: "honey",
  command: "queen",
};

/** A hexagonal frame (pointy-top) for a bee or an icon. `glow` makes it pulse softly. */
export function HexBadge({ children, size = "md", glow, className }: { children: ReactNode; size?: "sm" | "md" | "lg"; glow?: boolean; className?: string }) {
  return (
    <span className={cn("hex-badge", `hex-badge-${size}`, glow && "hex-badge-glow", className)}>
      <span className="hex-badge-inner">{children}</span>
    </span>
  );
}

const STATIONS: { kind: AgentKind; verb: string; body: string }[] = [
  {
    kind: "command",
    verb: "Command",
    body: "Tell her what you want (“3 funny clips from last night for Shorts”) and she turns it into a plan for the colony.",
  },
  {
    kind: "scout",
    verb: "Forage",
    body: "Watches your Twitch, Kick and YouTube channels and flies home the moment a new VOD lands.",
  },
  {
    kind: "producer",
    verb: "Harvest",
    body: "Listens to every hour, turns down weak moments with a reason, and cuts the keepers to 9:16.",
  },
  {
    kind: "publisher",
    verb: "Pollinate",
    body: "Burns in your caption style and schedules each clip across TikTok, Shorts and Reels.",
  },
];

/**
 * The four bees as stations on one flight: a dotted waggle path joins them, with a speck of
 * pollen travelling along it. Across the page on desktop; down the left edge on phones,
 * where each station is a row (badge left, words right).
 */
export function ColonyFlight({ className }: { className?: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const budget = useMotionBudget();
  const inView = useInView(ref);
  const seen = useInView(ref, { once: true, rootMargin: "0px 0px -15% 0px" });

  return (
    <div className={cn("relative", className)} data-fx-paused={pausedAttr(inView, budget)}>
      {/* Desktop: a waving path through the badge centres. */}
      <svg aria-hidden viewBox="0 0 1200 120" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 hidden h-[6.93rem] w-full lg:block">
        <path pathLength={100} className="flight-path" d="M150 60 C 250 0, 350 120, 450 60 S 650 0, 750 60 S 950 120, 1050 60" />
        {budget !== "off" && <path pathLength={100} className="fx-flow-pulse" d="M150 60 C 250 0, 350 120, 450 60 S 650 0, 750 60 S 950 120, 1050 60" />}
      </svg>
      {/* Phones and tablets: the same flight, top to bottom, behind the badges. */}
      <svg aria-hidden viewBox="0 0 60 1000" preserveAspectRatio="none" className="pointer-events-none absolute top-10 bottom-10 left-0 w-[3.75rem] lg:hidden">
        <path pathLength={100} className="flight-path" d="M30 0 C 0 125, 60 250, 30 333 S 0 541, 30 666 S 60 875, 30 1000" />
        {budget !== "off" && <path pathLength={100} className="fx-flow-pulse" d="M30 0 C 0 125, 60 250, 30 333 S 0 541, 30 666 S 60 875, 30 1000" />}
      </svg>

      <ol ref={ref} className="relative grid gap-10 lg:grid-cols-4 lg:gap-8">
        {STATIONS.map((s, i) => (
          <li
            key={s.kind}
            className={cn("station grid grid-cols-[3.75rem_minmax(0,1fr)] items-start gap-5 lg:flex lg:flex-col lg:items-center lg:text-center", seen && "station-in")}
            style={cssVars({ "--i": i })}
          >
            <HexBadge size="md" className="mx-auto lg:mx-0">
              <Bee variant={BEE_VARIANT[s.kind]} size={44} flying={budget !== "off" && inView} className="bee-hover" />
            </HexBadge>
            <div className="min-w-0 lg:mt-3">
              <p className="font-mono text-meta font-medium tracking-[0.16em] text-brand uppercase">
                {String(i + 1).padStart(2, "0")} · {s.verb}
              </p>
              <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink lg:text-3xl">{AGENT_LABEL[s.kind]}</h3>
              <p className="text-meta font-medium text-ink-faint">{BEE_SPECIES[s.kind]}</p>
              <p className="mt-3 text-lg text-ink-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
