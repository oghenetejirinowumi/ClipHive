"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreClips } from "@/components/projects/MoreClips";
import { Scrubber } from "@/components/studio/Scrubber";
import { Button, Icon, Segmented } from "@/components/ui";
import { api, ApiError, API_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatTime, type Layout, type StudioProject } from "@/lib/imports";

const POLL_MS = 3000;
const DEFAULT_LEN = 30;

type Props = {
  importId: number;
  /** Cut [start, end] of the video (HD for links) and put it at the end of the main track. */
  onAddRange(start: number, end: number, layout: Layout): Promise<void>;
  /** Put a clip this video already has on the timeline. */
  onAddClip(clipId: number): Promise<void>;
  onError(message: string): void;
};

/**
 * The imported video behind this edit (this used to be the Studio): its loudness over time,
 * the moments the AI found, and any range you pick, each one click from the timeline.
 */
export function MomentsTab({ importId, onAddRange, onAddClip, onError }: Props) {
  const [project, setProject] = useState<StudioProject | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, DEFAULT_LEN]);
  const [layout, setLayout] = useState<Layout>("fill");
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [retry, setRetry] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const picked = useRef(false);

  const load = useCallback(async () => {
    try {
      const p = await api<StudioProject>(`/api/studio/imports/${importId}`);
      setProject(p);
      setFailed(null);
      if (!picked.current) {
        picked.current = true;
        const best = [...p.moments].sort((a, b) => b.score - a.score)[0];
        const duration = p.job.duration_s ?? DEFAULT_LEN;
        setRange(best ? [best.start_s, best.end_s] : [0, Math.min(DEFAULT_LEN, duration)]);
      }
      return p;
    } catch (err) {
      setFailed(err instanceof ApiError ? err.message : "Couldn't open this video.");
      return null;
    }
  }, [importId]);

  // Links scrub a low-res preview fetched on request; keep checking until it's ready.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    async function tick(first: boolean) {
      const p = await load();
      if (stopped || !p || p.source_path || p.preview.status === "failed") return;
      if (first && p.preview.status === "none") await api(`/api/studio/imports/${importId}/preview`, { method: "POST" }).catch(() => {});
      timer = setTimeout(() => tick(false), POLL_MS);
    }
    tick(true);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [importId, load, retry]);

  async function retryPreview() {
    await api(`/api/studio/imports/${importId}/preview`, { method: "POST" }).catch(() => {});
    setRetry((n) => n + 1); // restart the polling below
  }

  function seek(t: number) {
    setCurrent(t);
    if (video.current) video.current.currentTime = t;
  }

  /** Play the picked range (from its start, or from where it was paused inside it). */
  function togglePlay() {
    const v = video.current;
    if (!v) return;
    if (!v.paused) return v.pause();
    const [s, e] = range;
    if (v.currentTime < s || v.currentTime >= e - 0.1) v.currentTime = s;
    v.play().catch(() => setPlaying(false));
  }

  function onTime(t: number) {
    setCurrent(t);
    if (video.current && !video.current.paused && t >= range[1]) video.current.pause(); // stop at the range's end
  }

  function choose(start: number, end: number) {
    setRange([start, end]);
    seek(start);
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      load(); // a new clip joins the list below
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't add that to the timeline.");
    } finally {
      setBusy(null);
    }
  }

  if (failed) return <p className="text-meta text-danger">{failed}</p>;
  if (!project) return <p className="text-meta text-ink-muted">Loading the video…</p>;

  const duration = project.job.duration_s ?? 0;
  const [start, end] = range;
  const isLink = project.job.source !== "upload";

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-meta font-semibold tracking-wide text-ink-muted uppercase">Pick a moment</h4>
        <div className="relative aspect-video overflow-hidden rounded-md bg-surface-sunken">
          {project.source_path ? (
            <>
              <video
                ref={video}
                src={`${API_URL}/${project.source_path}`}
                playsInline
                preload="metadata"
                onClick={togglePlay}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
                className="absolute inset-0 size-full cursor-pointer object-contain"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 p-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? "Pause" : "Play the picked part"}
                  className="pointer-events-auto grid size-11 place-items-center rounded-full bg-brand text-on-brand shadow-md transition-transform hover:scale-105"
                >
                  <Icon name={playing ? "pause" : "play"} className="size-5" />
                </button>
                <span className="rounded-full bg-surface/85 px-2.5 py-1 font-mono text-meta text-ink tabular-nums">{formatTime(current)}</span>
              </div>
            </>
          ) : (
            <p className="absolute inset-0 grid place-items-center p-3 text-center text-meta text-ink-muted">
              {project.preview.status === "failed"
                ? `Couldn't load a preview${project.preview.error ? `: ${project.preview.error}` : "."} You can still add the AI moments below.`
                : `Loading a preview to scrub… ${project.preview.progress}%`}
            </p>
          )}
          {!project.source_path && project.preview.status === "failed" && (
            <Button size="xs" variant="secondary" className="absolute bottom-2 left-1/2 -translate-x-1/2" onClick={retryPreview}>
              <Icon name="refresh" className="size-5" /> Try again
            </Button>
          )}
        </div>
        {duration > 0 && (
          <Scrubber
            duration={duration}
            energy={project.energy}
            moments={project.moments}
            current={current}
            start={start}
            end={end}
            onSeek={seek}
            onRangeChange={(s, e) => setRange([s, e])}
            maxTicks={4}
          />
        )}
        <p className="font-mono text-meta text-ink-muted">
          {formatTime(start)} – {formatTime(end)} · {(end - start).toFixed(1)}s
        </p>
        <div className="flex items-center gap-2">
          <Segmented compact label="Layout" value={layout} onChange={setLayout} options={[{ value: "fill", label: "Fill" }, { value: "blur", label: "Blur" }]} />
          <Button size="xs" className="flex-1" loading={busy === "range"} disabled={!!busy || end - start < 3} onClick={() => run("range", () => onAddRange(start, end, layout))}>
            <Icon name="plus" className="size-5" /> Add
          </Button>
        </div>
        <p className="text-meta text-ink-faint">
          Drag the band to choose, or tap a moment below. Switch any clip between Fill and Blur later in Properties. {isLink ? "Links fetch just that part in HD, which can take a minute." : ""} Each one is saved in your Hub too.
        </p>
      </section>

      {project.moments.length > 0 && (
        <section className="space-y-2 border-t border-line pt-4">
          <h4 className="text-meta font-semibold tracking-wide text-ink-muted uppercase">Moments the AI found</h4>
          <ul className="space-y-1">
            {[...project.moments].sort((a, b) => a.start_s - b.start_s).map((m) => {
              const key = `m${m.start_s}`;
              const active = Math.abs(m.start_s - start) < 0.05 && Math.abs(m.end_s - end) < 0.05;
              return (
                <li key={key} className={cn("flex items-center gap-2 rounded-md border p-2", active ? "border-brand bg-brand-subtle" : "border-line bg-paper")}>
                  <button type="button" onClick={() => choose(m.start_s, m.end_s)} className="min-w-0 flex-1 text-left">
                    <span className="block font-mono text-meta text-ink">
                      {formatTime(m.start_s)} – {formatTime(m.end_s)} <span className="text-ink-faint">· {Math.round(m.score)}</span>
                    </span>
                    {m.reason && <span className="block truncate text-meta text-ink-muted">{m.reason}</span>}
                  </button>
                  <Button size="xs" variant="secondary" loading={busy === key} disabled={!!busy} onClick={() => run(key, () => onAddRange(m.start_s, m.end_s, layout))}>
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2 border-t border-line pt-4">
        <h4 className="text-meta font-semibold tracking-wide text-ink-muted uppercase">Find more moments</h4>
        <MoreClips compact job={project.job} onFinished={() => load()} />
      </section>

      {project.clips.length > 0 && (
        <section className="space-y-2 border-t border-line pt-4">
          <h4 className="text-meta font-semibold tracking-wide text-ink-muted uppercase">Clips from this video</h4>
          <ul className="space-y-1">
            {project.clips.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-md border border-line bg-paper p-2">
                <button type="button" onClick={() => choose(c.start_s, c.end_s)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-meta text-ink">{c.title ?? `Clip ${c.id}`}</span>
                  <span className="block font-mono text-meta text-ink-faint">
                    {formatTime(c.start_s)} – {formatTime(c.end_s)}
                  </span>
                </button>
                <Button size="xs" variant="secondary" loading={busy === `c${c.id}`} disabled={!!busy} onClick={() => run(`c${c.id}`, () => onAddClip(c.id))}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
