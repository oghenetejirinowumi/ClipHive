"use client";

import { useEffect, useState } from "react";
import { Button, Icon, Notice, Segmented } from "@/components/ui";
import { timeAgo } from "@/lib/agents";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/imports";
import type { Platform } from "./ChannelSearch";

/** GET /api/streamers/{id}/videos */
type ChannelVideo = {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  duration_s: number | null;
  published_at: string | null;
};

type Tab = "streams" | "videos";

const COUNTS = [3, 5, 8] as const;
const LENGTHS = [15, 30, 60] as const;

type Props = {
  streamer: { id: number; platform: Platform; username: string };
  /** An import started for the picked video. */
  onClipped(jobId: number, title: string): void;
  onClose(): void;
};

/**
 * Choose which of a channel's videos to clip, instead of only its newest. Opens inline under
 * the channel row: a grid of recent VODs (YouTube: past streams or uploads), then clip settings.
 */
export function VideoPicker({ streamer, onClipped, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("streams");
  const [videos, setVideos] = useState<ChannelVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ChannelVideo | null>(null);
  const [count, setCount] = useState<string>("5");
  const [seconds, setSeconds] = useState<string>("30");
  const [submitting, setSubmitting] = useState(false);
  const youtube = streamer.platform === "youtube";

  useEffect(() => {
    let cancelled = false;
    setVideos(null);
    setError(null);
    setPicked(null);
    const query = youtube ? `?tab=${tab}` : "";
    api<ChannelVideo[]>(`/api/streamers/${streamer.id}/videos${query}`)
      .then((rows) => !cancelled && setVideos(rows))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load this channel's videos."));
    return () => {
      cancelled = true;
    };
  }, [streamer.id, tab, youtube]);

  async function clip() {
    if (!picked) return;
    setSubmitting(true);
    setError(null);
    try {
      const job = await api<{ id: number }>(`/api/streamers/${streamer.id}/clip-video`, {
        method: "POST",
        body: { url: picked.url, title: picked.title, clip_count: Number(count), clip_seconds: Number(seconds) },
      });
      onClipped(job.id, picked.title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start clipping that video.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 space-y-5 rounded-3xl border border-line bg-surface-sunken p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-xl font-semibold tracking-tight text-ink">Pick a video from {streamer.username}</p>
        <div className="flex items-center gap-2">
          {youtube && (
            <Segmented
              label="Which videos"
              compact
              value={tab}
              onChange={setTab}
              options={[
                { value: "streams", label: "Past streams" },
                { value: "videos", label: "Videos" },
              ]}
            />
          )}
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close the video picker">
            <Icon name="x" className="size-5" />
          </Button>
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {!videos && !error && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading videos">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="aspect-video animate-pulse rounded-2xl bg-line" />
          ))}
        </ul>
      )}

      {videos && videos.length === 0 && <p className="text-base text-ink-muted">No videos found on this tab.</p>}

      {videos && videos.length > 0 && (
        <ul className="grid max-h-[28rem] gap-4 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {videos.map((v) => {
            const selected = picked?.id === v.id;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setPicked(selected ? null : v)}
                  aria-pressed={selected}
                  className={cn(
                    "group w-full overflow-hidden rounded-2xl border-2 bg-surface text-left transition",
                    selected ? "border-brand" : "border-transparent hover:border-line-strong",
                  )}
                >
                  <div className="relative aspect-video overflow-hidden bg-brand-deep">
                    {v.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- platform CDN thumbnails
                      <img src={v.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <div className="grid size-full place-items-center text-on-brand/50">
                        <Icon name="film" className="size-8" />
                      </div>
                    )}
                    {v.duration_s ? (
                      <span className="absolute right-2 bottom-2 rounded-full bg-brand-deep/85 px-2 py-0.5 text-meta font-semibold text-on-brand tabular-nums">{formatTime(v.duration_s)}</span>
                    ) : null}
                    {selected && (
                      <span className="absolute left-2 top-2 grid size-8 place-items-center rounded-full bg-brand text-on-brand">
                        <Icon name="check" className="size-5" />
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 text-base font-medium text-ink">{v.title}</p>
                    {v.published_at && <p className="mt-1 text-meta text-ink-muted">{timeAgo(v.published_at)}</p>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picked && (
        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <p className="text-meta font-medium text-ink-muted">Clips</p>
              <Segmented label="Number of clips" compact value={count} onChange={setCount} options={COUNTS.map((n) => ({ value: String(n), label: String(n) }))} />
            </div>
            <div className="space-y-1">
              <p className="text-meta font-medium text-ink-muted">Length</p>
              <Segmented label="Clip length" compact value={seconds} onChange={setSeconds} options={LENGTHS.map((n) => ({ value: String(n), label: `${n}s` }))} />
            </div>
          </div>
          <Button loading={submitting} onClick={clip}>
            <Icon name="scissors" className="size-5" /> Clip this video
          </Button>
        </div>
      )}
    </div>
  );
}
