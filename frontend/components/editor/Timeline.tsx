"use client";

import { useEffect, useRef, type DragEvent, type PointerEvent, type WheelEvent } from "react";
import { ASSET_DRAG_TYPE, SFX_DRAG_TYPE } from "@/components/editor/LibraryPanel";
import { Icon } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  assetOf, duration, EFFECTS, formatTime, move, snapPoints, trimEnd, trimStart, VIDEO_TRACKS,
  type Effect, type Item, type ItemKind, type Timeline as TimelineDoc,
} from "@/lib/editor";

const LANE_H = 48; // px; matches h-12
const SNAP_PX = 8;

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
  /** The latest previewed timeline, committed when the button comes up. */
  next: TimelineDoc;
  changed: boolean;
};

const DRAG_PX = 4; // a press that moves less than this is a click (select), never an edit

type Props = {
  className?: string;
  timeline: TimelineDoc;
  playhead: number;
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

export function Timeline({ className, timeline, playhead, selectedId, pxPerSec, onSelect, onSeek, onPreview, onCommit, onDropAsset, onDropSfx }: Props) {
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const endDrag = useRef<((commit: boolean) => void) | null>(null);
  // A drag outlives the render that started it: read these through a ref, not a stale closure.
  const live = useRef({ pxPerSec, playhead, onPreview, onCommit });
  live.current = { pxPerSec, playhead, onPreview, onCommit };
  useEffect(() => () => endDrag.current?.(false), []); // leaving mid-drag: drop it, unsaved
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

  /**
   * A drag is followed on the window, not on the clip: moving a clip to another track redraws it
   * in that lane as a new element, which used to lose the pointerup and leave the clip glued to
   * the mouse ("it moves whenever I click near it"). Only the left button drags.
   */
  function beginDrag(e: PointerEvent, kind: ItemKind, item: Item, mode: Drag["mode"]) {
    e.stopPropagation();
    // Touch: the first tap selects. Once selected, a drag moves or trims it; an unselected
    // item leaves the finger free to scroll the timeline.
    if (e.pointerType === "touch" && item.id !== selectedId) {
      onSelect(item.id);
      return;
    }
    onSelect(item.id);
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection or native drag while moving
    drag.current = { id: item.id, kind, mode, x0: e.clientX, y0: e.clientY, item, before: timeline, next: timeline, changed: false };
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.buttons === 0) return finish(true); // released somewhere we didn't hear about
      onDragMove(ev);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    function finish(commit: boolean) {
      endDrag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      const d = drag.current;
      drag.current = null;
      if (!d?.changed) return;
      if (commit) live.current.onCommit(d.next, d.before);
      else live.current.onPreview(d.before); // cancelled: put it back
    }
    endDrag.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  }

  function onDragMove(e: { clientX: number; clientY: number }) {
    const d = drag.current;
    if (!d) return;
    const { pxPerSec, playhead, onPreview } = live.current;
    const dt = (e.clientX - d.x0) / pxPerSec;
    if (!d.changed && Math.abs(e.clientX - d.x0) < DRAG_PX && Math.abs(e.clientY - d.y0) < DRAG_PX) return;
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
      const track = d.kind === "clips" ? (d.item as { track: number }).track - Math.round((e.clientY - d.y0) / LANE_H) : undefined;
      next = move(d.before, d.id, s, track);
    } else if (d.mode === "start") {
      next = trimStart(d.before, d.id, snap(start + dt, points));
    } else {
      next = trimEnd(d.before, d.id, snap(start + length + dt, points));
    }
    d.next = next;
    onPreview(next);
  }

  // Scrub: press on the ruler (or empty lane space) and drag to move the playhead.
  // On touch, a finger on a lane scrolls the timeline instead, and a tap there seeks.
  const scrubbing = useRef(false);
  const tap = useRef<{ x: number; y: number } | null>(null);
  const scrubProps = (ruler: boolean) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "touch" && !ruler) {
        tap.current = { x: e.clientX, y: e.clientY };
        return;
      }
      scrubbing.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      onSelect(null);
      onSeek(timeAt(e.clientX));
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (!scrubbing.current) return;
      if (e.buttons === 0) scrubbing.current = false; // the release went somewhere else
      else onSeek(timeAt(e.clientX));
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      scrubbing.current = false;
      const t = tap.current;
      tap.current = null;
      if (t && Math.abs(e.clientX - t.x) < 10 && Math.abs(e.clientY - t.y) < 10) {
        onSelect(null);
        onSeek(timeAt(e.clientX));
      }
    },
    onPointerCancel: () => {
      scrubbing.current = false;
      tap.current = null;
    },
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

  /** There are no scrollbars: a plain wheel scrolls the lanes, then the time sideways once
   * the lanes can't scroll any further that way. */
  function wheelSideways(e: WheelEvent<HTMLDivElement>) {
    if (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // already sideways
    const lanes = e.currentTarget.parentElement;
    const canScrollLanes = lanes && (e.deltaY < 0 ? lanes.scrollTop > 0 : lanes.scrollTop + lanes.clientHeight < lanes.scrollHeight - 1);
    if (!canScrollLanes) e.currentTarget.scrollLeft += e.deltaY;
  }

  const step = pxPerSec >= 80 ? 1 : pxPerSec >= 30 ? 5 : pxPerSec >= 12 ? 10 : 30;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  return (
    <div className={cn("flex min-w-0 select-none overflow-y-auto rounded-lg border border-line bg-surface", className)}>
      {/* Lane labels */}
      <div className="sticky left-0 h-fit w-11 shrink-0 border-r border-line sm:w-28">
        <div className="h-8 border-b border-line" />
        {LANES.map((lane) => (
          <div key={lane.key} title={lane.label} className="flex h-12 items-center justify-center gap-2 border-b border-line text-meta font-medium text-ink-muted last:border-b-0 sm:justify-start sm:px-3">
            <Icon name={lane.kind === "texts" ? "type" : lane.kind === "audio" ? "music" : lane.kind === "effects" ? "sparkles" : "film"} className="size-5 shrink-0" />
            <span className="truncate max-sm:sr-only">{lane.label}</span>
          </div>
        ))}
      </div>

      {/* Scrollable time area */}
      <div className="h-fit min-w-0 flex-1 overflow-x-auto" onWheel={wheelSideways}>
        <div ref={content} className="relative" style={{ width, minWidth: "100%" }}>
          <div className="relative h-8 cursor-col-resize touch-none border-b border-line bg-surface-sunken" {...scrubProps(true)}>
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
              <div key={lane.key} className="relative h-12 border-b border-line last:border-b-0" {...scrubProps(false)} {...dropProps(lane)}>
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
                      style={{ left: item.start * pxPerSec, width: Math.max(item.duration * pxPerSec, 8) }}
                      onPointerDown={(e) => beginDrag(e, lane.kind, item, "move")}
                      onKeyDown={(e) => e.key === "Enter" && onSelect(item.id)}
                    >
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize bg-brand-soft/60 hover:bg-brand max-lg:w-4"
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
                        className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize bg-brand-soft/60 hover:bg-brand max-lg:w-4"
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
