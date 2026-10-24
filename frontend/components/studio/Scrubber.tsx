"use client";

import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { formatTime, type Moment } from "@/lib/imports";

const MIN_LEN = 3;
const MAX_LEN = 180;
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];

type Drag = { kind: "start" | "end" | "range"; offset: number } | null;

/**
 * Timeline for picking a clip: audio energy as a waveform, auto-detected moments as bands,
 * a draggable in/out range, and a playhead. Click the track to seek.
 */
export function Scrubber({
  duration,
  energy,
  moments,
  current,
  start,
  end,
  onSeek,
  onRangeChange,
  maxTicks = 8,
}: {
  duration: number;
  energy: number[];
  moments: Moment[];
  current: number;
  start: number;
  end: number;
  onSeek: (t: number) => void;
  onRangeChange: (start: number, end: number) => void;
  /** Time labels under the track; fewer for a narrow panel. */
  maxTicks?: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(null);
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), duration) / duration) * 100}%`;

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = track.current!.getBoundingClientRect();
      return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * duration;
    },
    [duration],
  );

  const setRange = useCallback(
    (s: number, e: number) => {
      const len = Math.min(Math.max(e - s, MIN_LEN), Math.min(MAX_LEN, duration));
      const ns = Math.min(Math.max(s, 0), duration - len);
      onRangeChange(Math.round(ns * 10) / 10, Math.round((ns + len) * 10) / 10);
    },
    [duration, onRangeChange],
  );

  function beginDrag(kind: NonNullable<Drag>["kind"]) {
    return (e: PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind, offset: timeAt(e.clientX) - start };
    };
  }

  function onMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const t = timeAt(e.clientX);
    if (d.kind === "start") setRange(Math.min(t, end - MIN_LEN), end);
    else if (d.kind === "end") setRange(start, Math.max(t, start + MIN_LEN));
    else setRange(t - d.offset, t - d.offset + (end - start));
  }

  const endDrag = () => {
    drag.current = null;
  };

  function onHandleKey(which: "start" | "end") {
    return (e: KeyboardEvent<HTMLButtonElement>) => {
      const step = (e.shiftKey ? 5 : 0.5) * (e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0);
      if (!step) return;
      e.preventDefault();
      if (which === "start") setRange(Math.min(start + step, end - MIN_LEN), end);
      else setRange(start, Math.max(end + step, start + MIN_LEN));
    };
  }

  const ticks = useMemo(() => {
    const step = TICK_STEPS.find((s) => duration / s <= maxTicks) ?? 3600;
    return Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
  }, [duration, maxTicks]);

  const bars = useMemo(() => {
    const n = energy.length || 1;
    return energy.map((v, i) => `M${i + 0.15} ${50 - (6 + v * 44)}h0.7v${2 * (6 + v * 44)}h-0.7z`).join("") || `M0 49h${n}v2h-${n}z`;
  }, [energy]);
  const viewW = energy.length || 1;

  const waveform = (className: string) => (
    <svg aria-hidden viewBox={`0 0 ${viewW} 100`} preserveAspectRatio="none" className={cn("absolute inset-0 size-full", className)}>
      <path d={bars} fill="currentColor" />
    </svg>
  );

  const selLeft = (start / duration) * 100;
  const selWidth = ((end - start) / duration) * 100;

  return (
    <div className="space-y-3 select-none">
      <div
        ref={track}
        onPointerDown={(e) => onSeek(timeAt(e.clientX))}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-32 cursor-pointer touch-none overflow-hidden rounded-lg border border-line bg-surface-sunken"
      >
        {/* Waveform, dimmed outside the selection */}
        {waveform("text-line-strong")}

        {/* Auto-detected moments */}
        {moments.map((m, i) => (
          <span key={i} aria-hidden className="absolute top-0 h-2 rounded-b-full bg-brand/45" style={{ left: pct(m.start_s), width: `${((m.end_s - m.start_s) / duration) * 100}%` }} />
        ))}

        {/* Selected range: lit waveform + draggable body */}
        <div
          onPointerDown={beginDrag("range")}
          className="absolute inset-y-0 cursor-grab overflow-hidden border-y-2 border-brand bg-brand/15 active:cursor-grabbing"
          style={{ left: `${selLeft}%`, width: `${selWidth}%` }}
        >
          <div className="absolute inset-y-0" style={{ left: `${(-selLeft / selWidth) * 100}%`, width: `${(100 / selWidth) * 100}%` }}>
            {waveform("text-brand")}
          </div>
        </div>

        {/* In / out handles: 44px hit area, slim visible bar */}
        {(["start", "end"] as const).map((which) => {
          const t = which === "start" ? start : end;
          return (
            <button
              key={which}
              type="button"
              role="slider"
              aria-label={which === "start" ? "Clip start" : "Clip end"}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(t * 10) / 10}
              aria-valuetext={formatTime(t, true)}
              onPointerDown={beginDrag(which)}
              onKeyDown={onHandleKey(which)}
              className="group absolute inset-y-0 z-10 w-11 -translate-x-1/2 cursor-ew-resize touch-none"
              style={{ left: pct(t) }}
            >
              <span className="absolute inset-y-0 left-1/2 w-2 -translate-x-1/2 rounded-full bg-brand shadow-glow transition-[width] group-hover:w-2.5" />
              <span className="absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-brand/80" />
            </button>
          );
        })}

        {/* Playhead */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-ink" style={{ left: pct(current) }}>
          <span aria-hidden className="absolute -top-0.5 left-1/2 size-3 -translate-x-1/2 rounded-full bg-ink" />
        </span>
      </div>

      {/* Ruler */}
      <div aria-hidden className="relative h-6 font-mono text-meta text-ink-muted tabular-nums">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: pct(t) }}>
            {formatTime(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
