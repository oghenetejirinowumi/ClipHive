"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Layout } from "@/lib/imports";

/**
 * Live 9:16 preview of the source video's current frame in the chosen layout:
 * fill = cropped to cover; blur = whole frame centred over a blurred copy of itself.
 * Mirrors the ffmpeg filters in backend/app/services/clip/cutter.py.
 */
export function LayoutPreview({ video, layout }: { video: RefObject<HTMLVideoElement | null>; layout: Layout }) {
  const fg = useRef<HTMLCanvasElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;

    const draw = () => {
      if (!v.videoWidth) return;
      for (const canvas of [fg.current, bg.current]) {
        if (!canvas) continue;
        // Half-resolution is plenty for a preview and keeps playback smooth.
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

  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[18rem] overflow-hidden rounded-[1.8rem] border-[5px] border-brand-deep bg-brand-deep shadow-glow-strong">
      {layout === "blur" ? (
        <>
          <canvas ref={bg} aria-hidden className="absolute inset-0 size-full scale-110 object-cover blur-xl brightness-75 saturate-125" />
          <canvas ref={fg} aria-label="Blur layout preview" className="absolute inset-0 size-full object-contain" />
        </>
      ) : (
        <canvas ref={fg} aria-label="Fill layout preview" className="absolute inset-0 size-full object-cover" />
      )}
    </div>
  );
}
