"use client";

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { Layout } from "@/lib/imports";
import { Icon } from "@/components/ui/Icon";

const CSS_FILTERS: Record<string, string> = {
  none: "none",
  vibrant: "contrast(1.15) saturate(1.35) brightness(1.02)",
  warm: "sepia(0.2) saturate(1.15) hue-rotate(-10deg)",
  cool: "saturate(1.05) hue-rotate(10deg)",
  dramatic: "grayscale(1) contrast(1.25) brightness(0.96)",
};

/**
 * Live 9:16 preview of the source video's current frame in the chosen layout:
 * fill = cropped to cover; blur = whole frame centred over a blurred copy of itself.
 * Also previews active color filters and lets creators drag to position captions.
 */
export function LayoutPreview({
  video,
  layout,
  colorFilter = "none",
  showCaptions = false,
  captionText = "BRO YOU CANNOT MISS THAT!",
  captionPosition = 68,
  onCaptionPositionChange,
}: {
  video: RefObject<HTMLVideoElement | null>;
  layout: Layout;
  colorFilter?: string;
  showCaptions?: boolean;
  captionText?: string;
  captionPosition?: number;
  onCaptionPositionChange?: (pos: number) => void;
}) {
  const fg = useRef<HTMLCanvasElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;

    const draw = () => {
      if (!v.videoWidth) return;
      for (const canvas of [fg.current, bg.current]) {
        if (!canvas) continue;
        const w = Math.round(v.videoWidth / 2);
        const h = Math.round(v.videoHeight / 2);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        canvas.getContext("2d")?.drawImage(v, 0, 0, w, h);
      }
    };
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => cancelAnimationFrame(raf);

    v.addEventListener("loadeddata", draw);
    v.addEventListener("seeked", draw);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    draw();
    if (!v.paused) onPlay();
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("loadeddata", draw);
      v.removeEventListener("seeked", draw);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [video, layout]);

  const filterStyle = { filter: CSS_FILTERS[colorFilter] || "none" };

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!onCaptionPositionChange) return;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientY);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!isDragging) return;
    updateFromPointer(e.clientY);
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }

  function updateFromPointer(clientY: number) {
    if (!containerRef.current || !onCaptionPositionChange) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const pct = Math.round((relativeY / rect.height) * 100);
    const clamped = Math.max(12, Math.min(86, pct));
    onCaptionPositionChange(clamped);
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="group relative mx-auto aspect-[9/16] w-full max-w-[18rem] overflow-hidden rounded-[1.8rem] border-[5px] border-brand-deep bg-brand-deep shadow-glow-strong select-none"
    >
      <div className="absolute inset-0 size-full transition-[filter] duration-(--motion-fast)" style={filterStyle}>
        {layout === "blur" ? (
          <>
            <canvas ref={bg} aria-hidden className="absolute inset-0 size-full scale-110 object-cover blur-xl brightness-75 saturate-125" />
            <canvas ref={fg} aria-label="Blur layout preview" className="absolute inset-0 size-full object-contain" />
          </>
        ) : (
          <canvas ref={fg} aria-label="Fill layout preview" className="absolute inset-0 size-full object-cover" />
        )}
      </div>

      {/* Platform UI Safe Zone Overlay */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 border-t border-dashed border-white/20 px-3 pt-1.5 pb-2">
        <p aria-hidden className="text-center font-mono text-meta tracking-wider text-white/40 uppercase">Platform UI Zone</p>
      </div>

      {/* Draggable Caption Position Box */}
      {showCaptions && (
        <div
          onPointerDown={handlePointerDown}
          className="absolute inset-x-3 z-20 -translate-y-1/2 cursor-grab active:cursor-grabbing"
          style={{ top: `${captionPosition}%` }}
        >
          <div className="relative mx-auto w-fit max-w-[90%] rounded-lg border border-dashed border-brand/80 bg-brand-deep/85 px-3 py-1.5 shadow-lg backdrop-blur-xs transition-shadow hover:shadow-brand/30">
            <div className="flex items-center justify-center gap-1.5">
              <Icon name="captions" className="size-5 text-brand" />
              <p className="font-display text-meta font-bold tracking-wide text-white uppercase drop-shadow-sm line-clamp-1">
                {captionText}
              </p>
            </div>
            <div className="mt-0.5 flex items-center justify-center gap-1">
              <span aria-hidden className="rounded bg-brand/30 px-1 py-0.2 font-mono text-meta font-semibold text-brand-strong">
                {captionPosition}%
              </span>
              <span aria-hidden className="text-meta text-white/50">drag to move</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
