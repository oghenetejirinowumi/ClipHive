"use client";

import { useRef } from "react";
import { useInView } from "@/components/effects/useMotion";
import { API_URL } from "@/lib/api";

/**
 * A clip in a grid: its first frame (loaded once near the screen), duration and a corner label.
 * Hovering plays a silent preview on desktop; a click opens the clip.
 */
export function ClipTile({
  title,
  filePath,
  durationS,
  label,
  onOpen,
}: {
  title: string | null | undefined;
  filePath: string | null | undefined;
  durationS: number;
  /** Shown in the top-right corner (layout, status…). */
  label?: React.ReactNode;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const near = useInView(ref, { once: true, rootMargin: "300px" });
  // #t= makes phones paint a frame instead of a black box.
  const src = filePath && near ? `${API_URL}/${filePath}#t=0.5` : undefined;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      onMouseEnter={() => video.current?.play().catch(() => undefined)}
      onMouseLeave={() => video.current?.pause()}
      className="tactile group relative block aspect-[9/16] w-full overflow-hidden rounded-lg bg-brand-deep text-left shadow-glow"
      aria-label={`Open ${title || "untitled clip"}`}
    >
      {src ? (
        <video ref={video} src={src} muted playsInline loop preload="metadata" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-base text-on-brand/70">{filePath ? "" : "Rendering…"}</span>
      )}
      <span className="absolute top-2 left-2 rounded-full bg-brand-deep/85 px-2.5 py-0.5 text-fine font-semibold text-on-brand tabular-nums">
        {Math.round(durationS)}s
      </span>
      {label && (
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-brand-deep/85 px-2.5 py-0.5 text-fine font-semibold text-on-brand capitalize">
          {label}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-brand-deep via-brand-deep/70 to-transparent px-3 pt-10 pb-3">
        <span className="line-clamp-2 text-base leading-snug font-semibold text-on-brand [overflow-wrap:anywhere]">{title || "Untitled clip"}</span>
      </span>
    </button>
  );
}
