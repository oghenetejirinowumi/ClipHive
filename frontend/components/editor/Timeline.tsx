"use client";

import { useEffect, useRef, type DragEvent, type PointerEvent } from "react";
import { ASSET_DRAG_TYPE, SFX_DRAG_TYPE } from "@/components/editor/LibraryPanel";
import { Icon } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  assetOf, duration, EFFECTS, formatTime, move, snapPoints, trimEnd, trimStart, VIDEO_TRACKS,
  type Effect, type Item, type ItemKind, type Timeline as TimelineDoc,
} from "@/lib/editor";

const LANE_H = 48; // px; matches h-12
const LANE_H_COMPACT = 40; // px; matches h-10 (phones)
const SNAP_PX = 8;
const TAP_SLOP = 8; // px a finger may wander and still count as a tap

/** sfx: the audio lanes split in two, sound effects (is_sfx) in their own lane under the music. */
type Lane = { key: string; label: string; kind: ItemKind; track?: number; sfx?: boolean };
const LANES: Lane[] = [
  ...Array.from({ length: VIDEO_TRACKS }, (_, i) => VIDEO_TRACKS - 1 - i).map((track) => ({ key: `v${track}`, label: `Video ${track + 1}`, kind: "clips" as const, track })),
  { key: "text", label: "Text", kind: "texts" },
  { key: "audio", label: "Audio", kind: "audio", sfx: false },
  { key: "sfx", label: "SFX", kind: "audio", sfx: true },
  { key: "effects", label: "Effects", kind: "effects" },
];

type Drag = {
  id: string;
  kind: ItemKind;
  mode: "move" | "start" | "end";
  x0: number;
  y0: number;
  item: Item;
  before: TimelineDoc;
  changed: boolean;
};

type Props = {
  className?: string;
  /** Phones: shorter lanes, icon-only lane labels. */
  compact?: boolean;
  timeline: TimelineDoc;
  playhead: number;
  /** While playing, the view follows the playhead. */
  playing?: boolean;
  selectedId: string | null;
  pxPerSec: number;
  onSelect(id: string | null): void;
  onSeek(t: number): void;
  /** Live update while dragging (not saved, no undo step). */
  onPreview(next: TimelineDoc): void;
  /** Drag finished: save it as one undo step back to `before`. */
  onCommit(next: TimelineDoc, before: TimelineDoc): void;
  /** A media tile was dropped on a lane: video track number, or undefined for the audio lane. */
  onDropAsset?(assetId: string, at: number, track: number | undefined): void;
  /** A sound effect from the library was dropped on the SFX lane; `at` is where its hit lands. */
  onDropSfx?(name: string, at: number): void;
};

/**
 * Touch: a swipe scrolls the timeline. Tap a clip to select it, then drag it (or its edges) to
 * move or trim; tap empty lane space to move the playhead, or drag along the ruler to scrub.
 * Mouse: press and drag anything straight away.
 */
export function Timeline({ className, compact, timeline, playhead, playing, selectedId, pxPerSec, onSelect, onSeek, onPreview, onCommit, onDropAsset, onDropSfx }: Props) {
  const content = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const tap = useRef<{ x: number; y: number; id: string | null } | null>(null);
  const laneH = compact ? LANE_H_COMPACT : LANE_H;
  const total = Math.max(duration(timeline) + 10, 30);
  const width = total * pxPerSec;

  const timeAt = (clientX: number) => {
    const box = content.current!.getBoundingClientRect();
    return Math.max(0, (clientX - box.left) / pxPerSec);
  };

  function snap(t: number, points: number[]): number {
    const near = points.reduce((best, p) => (Math.abs(p - t) < Math.abs(best - t) ? p : best), Infinity);
    return Math.abs(near - t) * pxPerSec <= SNAP_PX ? near : t;
  }

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!playing || !el) return;
    const x = playhead * pxPerSec;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - 24);
  }, [playhead, playing, pxPerSec]);

  function beginDrag(e: PointerEvent, kind: ItemKind, item: Item, mode: Drag["mode"]) {
    e.stopPropagation();
    // A finger on a clip that isn't selected yet may be starting a swipe: select it on tap only.
    if (e.pointerType === "touch" && item.id !== selectedId) {
      tap.current = { x: e.clientX, y: e.clientY, id: item.id };
      return;
    }
    onSelect(item.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: item.id, kind, mode, x0: e.clientX, y0: e.clientY, item, before: timeline, changed: false };
  }

  function onDragMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dt = (e.clientX - d.x0) / pxPerSec;
    if (!d.changed && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
    d.changed = true;
    const points = snapPoints(d.before, d.id, playhead);
    const { start, duration: length } = d.item;
    let next = d.before;
    if (d.mode === "move") {
      let s = start + dt;
      const snappedStart = snap(s, points);
      const snappedEnd = snap(s + length, points);
      if (snappedStart !== s) s = snappedStart;
      else if (snappedEnd !== s + length) s = snappedEnd - length;
      const track = d.kind === "clips" ? (d.item as { track: number }).track - Math.round((e.clientY - d.y0) / laneH) : undefined;
      next = move(d.before, d.id, s, track);
    } else if (d.mode === "start") {
      next = trimStart(d.before, d.id, snap(start + dt, points));
    } else {
      next = trimEnd(d.before, d.id, snap(start + length + dt, points));
    }
    onPreview(next);
  }

  function endDrag(e: PointerEvent) {
    const t = tap.current;
    tap.current = null;
    if (t && Math.abs(e.clientX - t.x) < TAP_SLOP && Math.abs(e.clientY - t.y) < TAP_SLOP) {
      e.stopPropagation();
      if (t.id) onSelect(t.id);
      else {
        onSelect(null);
        onSeek(timeAt(e.clientX));
      }
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d.changed) onCommit(timeline, d.before);
  }

  /** The browser took the gesture over (a scroll): drop the drag and put the item back. */
  function cancelDrag() {
    tap.current = null;
    scrubbing.current = false;
    const d = drag.current;
    drag.current = null;
    if (d?.changed) onPreview(d.before);
  }

  // Scrub: press on the ruler (or, with a mouse, empty lane space) and drag to move the playhead.
  // On a touchscreen empty lane space only seeks on a tap, so swiping still scrolls.
  const scrubbing = useRef(false);
  const scrub = (lane: boolean) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (lane && e.pointerType === "touch") {
        tap.current = { x: e.clientX, y: e.clientY, id: null };
        return;
      }
      scrubbing.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      onSelect(null);
      onSeek(timeAt(e.clientX));
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => scrubbing.current && onSeek(timeAt(e.clientX)),
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      scrubbing.current = false;
      endDrag(e);
    },
    onPointerCancel: cancelDrag,
  });

  const sfxDropProps = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer.types.includes(SFX_DRAG_TYPE)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      const name = e.dataTransfer.getData(SFX_DRAG_TYPE);
      if (!name || !onDropSfx) return;
      e.preventDefault();
      onDropSfx(name, timeAt(e.clientX));
    },
  };

  const dropProps = (lane: Lane) =>
    lane.sfx
      ? sfxDropProps
      : lane.kind === "texts" || lane.kind === "effects" || !onDropAsset
      ? {}
      : {
          onDragOver: (e: DragEvent<HTMLDivElement>) => {
            if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          },
          onDrop: (e: DragEvent<HTMLDivElement>) => {
            const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
            if (!assetId) return;
            e.preventDefault();
            onDropAsset(assetId, timeAt(e.clientX), lane.kind === "clips" ? lane.track : undefined);
          },
        };

  const step = pxPerSec >= 80 ? 1 : pxPerSec >= 30 ? 5 : pxPerSec >= 12 ? 10 : 30;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  return (
    <div
      className={cn(
        "flex min-w-0 overflow-y-auto overscroll-contain bg-surface select-none",
        compact ? "border-t border-line" : "rounded-lg border border-line",
        className,
      )}
    >
      {/* Lane labels (icons only on phones) */}
      <div className={cn("sticky left-0 h-fit shrink-0 border-r border-line", compact ? "w-11" : "w-28")}>
        <div className={cn("border-b border-line", compact ? "h-7" : "h-8")} />
        {LANES.map((lane) => (
          <div
            key={lane.key}
            title={lane.label}
            className={cn(
              "flex items-center gap-2 border-b border-line text-meta font-medium text-ink-muted last:border-b-0",
              compact ? "h-10 justify-center" : "h-12 px-3",
            )}
          >
            <Icon name={lane.kind === "texts" ? "type" : lane.kind === "audio" ? (lane.sfx ? "sparkles" : "music") : lane.kind === "effects" ? "sparkles" : "film"} className="size-5 shrink-0" />
            <span className={compact ? "sr-only" : "truncate"}>{lane.label}</span>
          </div>
        ))}
      </div>

      {/* Scrollable time area */}
      <div ref={scroller} className="h-fit min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
        <div ref={content} className="relative" style={{ width, minWidth: "100%" }}>
          <div className={cn("relative cursor-col-resize touch-none border-b border-line bg-surface-sunken", compact ? "h-7" : "h-8")} {...scrub(false)}>
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 h-full border-l border-line-strong pl-1 text-meta text-ink-faint" style={{ left: t * pxPerSec }}>
                {formatTime(t)}
              </span>
            ))}
          </div>

          {LANES.map((lane) => {
            const items = (
              lane.kind === "clips"
                ? timeline.clips.filter((c) => c.track === lane.track)
                : lane.kind === "audio"
                  ? timeline.audio.filter((a) => !!a.is_sfx === lane.sfx)
                  : (timeline[lane.kind] ?? [])
            ) as Item[];
            return (
              <div key={lane.key} className={cn("relative border-b border-line last:border-b-0", compact ? "h-10" : "h-12")} {...scrub(true)} {...dropProps(lane)}>
                {items.map((item) => {
                  const selected = item.id === selectedId;
                  const label =
                    lane.kind === "texts"
                      ? (item as { text: string }).text
                      : lane.kind === "effects"
                      ? `${EFFECTS[(item as Effect).kind]?.label ?? "Effect"}${(item as Effect).auto ? " · auto" : ""}`
                      : lane.sfx
                      ? (assetOf(timeline, (item as { asset_id: string }).asset_id)?.name.replace(/^SFX · /, "") ?? "Sound effect")
                      : (assetOf(timeline, (item as { asset_id: string }).asset_id)?.name ?? "Missing media");
                  const speed = lane.kind === "clips" ? (item as { speed: number }).speed : 1;
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      aria-label={`${label}, ${formatTime(item.start, true)} to ${formatTime(item.start + item.duration, true)}`}
                      className={cn(
                        "absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded-md border text-meta active:cursor-grabbing",
                        lane.kind === "clips" && "border-brand-soft bg-brand-subtle text-brand-strong",
                        lane.kind === "texts" && "border-line-strong bg-paper text-ink",
                        lane.kind === "audio" && !lane.sfx && "border-line-strong bg-surface-sunken text-ink-muted",
                        lane.sfx && "border-brand-soft bg-surface-sunken text-ink",
                        lane.kind === "effects" && "border-brand-soft bg-paper text-brand-strong",
                        lane.kind === "effects" && (item as Effect).auto && "border-dashed",
                        selected && "z-10 touch-none ring-2 ring-brand",
                      )}
                      style={{ left: item.start * pxPerSec, width: Math.max(item.duration * pxPerSec, compact ? 16 : 8) }}
                      onPointerDown={(e) => beginDrag(e, lane.kind, item, "move")}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={cancelDrag}
                      onKeyDown={(e) => e.key === "Enter" && onSelect(item.id)}
                    >
                      <span
                        aria-hidden
                        className={cn("absolute inset-y-0 left-0 cursor-ew-resize bg-brand-soft/60 hover:bg-brand", selected && compact ? "w-4 bg-brand" : "w-2.5")}
                        onPointerDown={(e) => beginDrag(e, lane.kind, item, "start")}
                      />
                      <span className="flex min-w-0 items-baseline gap-2 truncate px-4">
                        <span className="truncate font-medium">
                          {label}
                          {speed !== 1 && ` · ${speed}×`}
                        </span>
                        {item.duration * pxPerSec > 160 && (
                          <span className="shrink-0 font-mono text-fine opacity-70">
                            {formatTime(item.start)}–{formatTime(item.start + item.duration)} · {item.duration.toFixed(1)}s
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden
                        className={cn("absolute inset-y-0 right-0 cursor-ew-resize bg-brand-soft/60 hover:bg-brand", selected && compact ? "w-4 bg-brand" : "w-2.5")}
                        onPointerDown={(e) => beginDrag(e, lane.kind, item, "end")}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Playhead */}
          <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-brand" style={{ left: playhead * pxPerSec }}>
            <span aria-hidden className="absolute -top-0.5 -left-1.5 size-3.5 rounded-full bg-brand" />
          </div>
        </div>
      </div>
    </div>
  );
}
