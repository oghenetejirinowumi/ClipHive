"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionBudget } from "@/components/effects/useMotion";
import { AGENT_LABEL, timeAgo, type AgentRun } from "@/lib/agents";
import { cn, cssVars } from "@/lib/cn";
import { Bee } from "./Bee";
import { BEE_VARIANT } from "./ColonyFlight";

// Cell size: 60px wide keeps every cell a comfortable tap target on a phone.
const CELL_W = 60;
const CELL_H = CELL_W * (2 / Math.sqrt(3));
const GAP = 6;

const STATUS_WORD = { running: "working now", done: "done", failed: "failed" } as const;

/**
 * Recent bee jobs as a live honeycomb, newest first. Working cells glow with a bee inside,
 * finished cells are filled, failed ones are cracked. Tapping a cell calls `onPick`.
 * Columns follow the available width, so the comb reflows from a phone to a desktop.
 */
export function HiveComb({ runs, activeId, onPick, max = 30 }: { runs: AgentRun[]; activeId: number | null; onPick: (run: AgentRun) => void; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const budget = useMotionBudget();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const shown = runs.slice(0, max);
  const step = CELL_W + GAP;
  // Odd rows shift half a cell right, so leave room for that.
  const cols = Math.max(3, Math.floor((width - step / 2 + GAP) / step));
  const rows = Math.ceil(shown.length / cols);
  const rowStep = CELL_H * 0.75 + GAP * 0.85;
  const height = rows ? CELL_H + (rows - 1) * rowStep : 0;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 &&
        shown.map((run, i) => {
          const row = Math.floor(i / cols);
          const col = i % cols;
          const running = run.status === "running";
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onPick(run)}
              aria-label={`${AGENT_LABEL[run.kind]}, ${STATUS_WORD[run.status]}, ${timeAgo(run.started_at)}`}
              aria-pressed={activeId === run.id}
              title={`${AGENT_LABEL[run.kind]} · ${STATUS_WORD[run.status]}`}
              className={cn("comb-run tactile", `comb-run-${run.status}`, activeId === run.id && "comb-run-active")}
              style={{
                width: CELL_W,
                height: CELL_H,
                left: col * step + (row % 2 ? step / 2 : 0),
                top: row * rowStep,
                ...cssVars({ "--i": i }),
              }}
            >
              <span className="comb-run-face">
                {running ? (
                  <Bee variant={BEE_VARIANT[run.kind]} size={34} tone="inverse" flying={budget !== "off"} />
                ) : run.status === "failed" ? (
                  <svg aria-hidden viewBox="0 0 24 24" width={22} height={22} className="comb-crack">
                    <path d="M12 3l-2 6 4 3-3 4 2 5" />
                  </svg>
                ) : (
                  <Bee variant={BEE_VARIANT[run.kind]} size={28} flying={false} className="comb-run-bee" />
                )}
              </span>
            </button>
          );
        })}
    </div>
  );
}

/** Legend for the comb's three cell states. */
export function CombLegend() {
  const items = [
    { cls: "comb-key-running", label: "Working" },
    { cls: "comb-key-done", label: "Done" },
    { cls: "comb-key-failed", label: "Failed" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-meta text-ink-muted">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <span aria-hidden className={cn("comb-key", it.cls)} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
