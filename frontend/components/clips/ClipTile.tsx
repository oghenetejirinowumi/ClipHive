"use client";

import { useRef, type ReactNode } from "react";
import { useInView } from "@/components/effects/useMotion";
import { Icon, type IconName } from "@/components/ui";
import { API_URL } from "@/lib/api";

const BADGE = "inline-flex items-center gap-1 rounded-full bg-brand-deep/85 px-2.5 py-0.5 text-fine font-semibold text-on-brand";

/**
 * The library's tile: a 9:16 card the media fills, two corner badges and the title on a fade at
 * the bottom. A tap opens the item's details. Used for clips, projects and edits alike, so
 * every list in the app looks the same. Videos load their first frame once near the screen and
 * play silently on hover (desktop).
 */
export function MediaTile({
  title,
  video,
  image,
  placeholder,
  placeholderIcon = "film",
  topLeft,
  topRight,
  subtitle,
  progress,
  onOpen,
}: {
  title: string;
  /** Public "storage/..." path of a video. */
  video?: string | null;
  /** Public "storage/..." path (or full URL) of an image. */
  image?: string | null;
  /** Shown when there's no media, e.g. "Rendering…". */
  placeholder?: ReactNode;
  placeholderIcon?: IconName;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** A short line under the title (status, length…). */
  subtitle?: ReactNode;
  /** 0–100: a thin progress bar along the bottom while something runs. */
  progress?: number | null;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const near = useInView(ref, { once: true, rootMargin: "300px" });
  const url = (path: string) => (/^https?:/.test(path) ? path : `${API_URL}/${path}`);
  // #t= makes phones paint a frame instead of a black box.
  const videoSrc = video && near ? `${url(video)}#t=0.5` : undefined;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      onMouseEnter={() => player.current?.play().catch(() => undefined)}
      onMouseLeave={() => player.current?.pause()}
      className="tactile group relative block aspect-[9/16] w-full overflow-hidden rounded-lg bg-brand-deep text-left shadow-glow"
      aria-label={`Open ${title}`}
    >
      {videoSrc ? (
        <video ref={player} src={videoSrc} muted playsInline loop preload="metadata" className="size-full object-cover" />
      ) : image && near ? (
        // eslint-disable-next-line @next/next/no-img-element -- media comes from the API host
        <img src={url(image)} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center px-4 text-center text-base text-on-brand/70">
          {placeholder ?? (video || image ? "" : <Icon name={placeholderIcon} className="size-8 text-on-brand/40" />)}
        </span>
      )}
      {topLeft != null && <span className={`absolute top-2 left-2 tabular-nums ${BADGE}`}>{topLeft}</span>}
      {topRight != null && <span className={`absolute top-2 right-2 capitalize ${BADGE}`}>{topRight}</span>}
      <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-brand-deep via-brand-deep/70 to-transparent px-3 pt-10 pb-3">
        <span className="line-clamp-2 text-base leading-snug font-semibold text-on-brand [overflow-wrap:anywhere]">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-meta text-on-brand/75">{subtitle}</span>}
      </span>
      {progress != null && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1.5 bg-brand-deep">
          <span className="block h-full bg-brand transition-[width] duration-(--motion-base)" style={{ width: `${Math.max(4, progress)}%` }} />
        </span>
      )}
    </button>
  );
}

/** A clip in a grid: its first frame, duration and a corner label (layout, status…). */
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
  label?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <MediaTile
      title={title || "Untitled clip"}
      video={filePath}
      placeholder={filePath ? undefined : "Rendering…"}
      topLeft={`${Math.round(durationS)}s`}
      topRight={label}
      onOpen={onOpen}
    />
  );
}
