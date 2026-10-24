"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { ClipDialog, ClipDialogActions, ClipTile } from "@/components/clips";
import { MoreClips } from "@/components/projects/MoreClips";
import { StarButton } from "@/components/projects/StarButton";
import { ClipEditorModal } from "@/components/studio/ClipEditorModal";
import { LayoutPreview } from "@/components/studio/LayoutPreview";
import { Scrubber } from "@/components/studio/Scrubber";
import { SocialTrendsPanel } from "@/components/studio/SocialTrendsPanel";
import { Badge, Button, buttonClass, Em, Field, Icon, Notice, Panel, SectionLabel, Segmented, Select, StatusBadge } from "@/components/ui";
import { api, ApiError, API_URL, GENERIC_ERROR, friendly } from "@/lib/api";
import {
  FILTER_OPTIONS,
  formatTime,
  LAYOUT_LABEL,
  projectTitle,
  SOURCE_LABEL,
  SPEED_OPTIONS,
  type ImportJob,
  type Layout,
  type StudioClip,
  type StudioProject,
} from "@/lib/imports";

type CaptionStyle = { id: number; name: string };
type Message = { tone: "brand" | "success" | "danger"; text: string } | null;

const LENGTHS = ["15", "30", "60"] as const;

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);

  const [project, setProject] = useState<StudioProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [styles, setStyles] = useState<CaptionStyle[]>([]);

  const [current, setCurrent] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(30);
  const [layout, setLayout] = useState<Layout>("fill");
  const [speed, setSpeed] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(1.0);
  const [colorFilter, setColorFilter] = useState<string>("none");
  const [captionPosition, setCaptionPosition] = useState<number>(68);
  const [captions, setCaptions] = useState<"burn" | "none">("none");
  const [styleId, setStyleId] = useState<number | null>(null);

  const [creating, setCreating] = useState(false);
  const [busyClip, setBusyClip] = useState<number | null>(null);
  const [editingClip, setEditingClip] = useState<StudioClip | null>(null);
  const [trendsClip, setTrendsClip] = useState<StudioClip | null>(null);
  const [openClipId, setOpenClipId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const duration = project?.job.duration_s ?? 0;

  const load = useCallback(async () => {
    try {
      const p = await api<StudioProject>(`/api/studio/imports/${id}`);
      setProject(p);
      return p;
    } catch (err) {
      setLoadError(errorText(err, GENERIC_ERROR));
      return null;
    }
  }, [id]);

  useEffect(() => {
    load().then((p) => {
      if (!p) return;
      setLayout(p.job.layout ?? "fill");
      const first = p.moments[0];
      const len = Math.min(p.job.clip_seconds || 30, p.job.duration_s ?? 30);
      setStart(first ? first.start_s : 0);
      setEnd(first ? first.end_s : len);
    });
    api<CaptionStyle[]>("/api/styles", { auth: false })
      .then((s) => {
        setStyles(s);
        setStyleId(s[0]?.id ?? null);
      })
      .catch(() => {});
  }, [load]);

  // Link projects scrub a low-res preview: start fetching it on open, then poll until it's ready.
  const previewStatus = project?.preview.status;
  const hasVideo = Boolean(project?.source_path);
  useEffect(() => {
    if (!project || hasVideo) return;
    if (previewStatus === "none") {
      api(`/api/studio/imports/${project.job.id}/preview`, { method: "POST" }).then(load).catch(() => {});
      return;
    }
    if (previewStatus !== "fetching") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [project, hasVideo, previewStatus, load]);

  const onMoreFinished = useCallback(
    async (added: number, job: ImportJob) => {
      await load();
      if (added > 0) setMessage({ tone: "success", text: `Added ${added} new clip${added === 1 ? "" : "s"}, all from moments you didn't have yet.` });
      else if (job.status === "done" && !job.error) setMessage({ tone: "brand", text: "No fresh moments left at that length. Try a shorter clip length." });
    },
    [load],
  );

  async function retryPreview() {
    if (!project) return;
    await api(`/api/studio/imports/${project.job.id}/preview`, { method: "POST" }).catch(() => {});
    await load();
  }

  const seek = useCallback((t: number) => {
    if (video.current) video.current.currentTime = t;
    setCurrent(t);
  }, []);

  const setRange = useCallback((s: number, e: number) => {
    setStart(s);
    setEnd(e);
  }, []);

  // I / O set the in and out points at the playhead (when not typing in a field).
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey) return;
      const t = video.current?.currentTime ?? 0;
      if (e.key === "i" || e.key === "I") setStart(Math.min(t, end - 3));
      if (e.key === "o" || e.key === "O") setEnd(Math.max(t, start + 3));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, end]);

  function playSelection() {
    const v = video.current;
    if (!v) return;
    stopAt.current = end;
    v.currentTime = start;
    v.play();
  }

  function onTimeUpdate() {
    const v = video.current;
    if (!v) return;
    setCurrent(v.currentTime);
    if (stopAt.current !== null && v.currentTime >= stopAt.current) {
      v.pause();
      stopAt.current = null;
    }
  }

  function setLength(seconds: number) {
    const len = Math.min(seconds, duration);
    const s = Math.min(start, Math.max(0, duration - len));
    setRange(s, s + len);
  }

  function changeSpeed(newSpeed: number) {
    setSpeed(newSpeed);
    if (video.current) {
      video.current.playbackRate = newSpeed;
    }
  }

  function nudgeStart(delta: number) {
    const next = Math.max(0, Math.min(end - 3, Math.round((start + delta) * 10) / 10));
    setRange(next, end);
    seek(next);
  }

  function nudgeEnd(delta: number) {
    const next = Math.min(duration, Math.max(start + 3, Math.round((end + delta) * 10) / 10));
    setRange(start, next);
    seek(next);
  }

  async function burn(clip: StudioClip, style: number, positionY?: number | null) {
    await api(`/api/clips/${clip.id}/caption`, {
      method: "POST",
      body: {
        style_id: style,
        caption_mode: "burned",
        position_y: positionY ?? captionPosition,
      },
      auth: false,
    });
  }

  async function createClip() {
    if (!project) return;
    setCreating(true);
    setMessage({ tone: "brand", text: project.job.source === "upload" ? "Cutting your clip with speed and styling…" : "Fetching this range in HD and cutting it (can take a minute)…" });
    try {
      const clip = await api<StudioClip>(`/api/studio/imports/${project.job.id}/clips`, {
        method: "POST",
        body: {
          start_s: start,
          end_s: end,
          layout,
          speed,
          volume,
          color_filter: colorFilter,
          caption_position_y: captions === "burn" ? captionPosition : null,
        },
      });
      if (captions === "burn" && styleId) {
        setMessage({ tone: "brand", text: "Clip cut. Burning captions (transcribing can take a minute)…" });
        try {
          await burn(clip, styleId, captionPosition);
          setMessage({ tone: "success", text: `Clip created with ${styles.find((s) => s.id === styleId)?.name ?? ""} captions at ${captionPosition}% position.` });
        } catch {
          setMessage({ tone: "danger", text: "Clip created, but adding captions didn't work. Try again from the clip below." });
        }
      } else {
        setMessage({ tone: "success", text: `Clip created (${speed !== 1 ? `${speed}x speed, ` : ""}${colorFilter !== "none" ? `${colorFilter} filter` : "clean"}).` });
      }
      await load();
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err, "Couldn't cut that clip.") });
    } finally {
      setCreating(false);
    }
  }

  async function handleEditClip(
    clip: StudioClip,
    params: {
      speed: number;
      volume: number;
      color_filter: string;
      layout: Layout;
      caption_position_y: number;
      style_id?: number | null;
    },
  ) {
    setBusyClip(clip.id);
    setMessage({ tone: "brand", text: "Recutting clip with speed and styling adjustments…" });
    try {
      await api(`/api/studio/clips/${clip.id}/edit`, {
        method: "POST",
        body: {
          speed: params.speed,
          volume: params.volume,
          color_filter: params.color_filter,
          layout: params.layout,
          caption_position_y: params.caption_position_y,
          style_id: params.style_id,
        },
      });
      setMessage({ tone: "success", text: "Clip updated with new speed, audio, color grading, and caption position." });
      await load();
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err, "Couldn't update this clip.") });
    } finally {
      setBusyClip(null);
    }
  }

  async function clipAction(clip: StudioClip, action: "fill" | "blur" | "remove" | "burn") {
    setBusyClip(clip.id);
    try {
      if (action === "remove") {
        await api(`/api/studio/clips/${clip.id}/remove-captions`, { method: "POST" });
        setMessage({ tone: "success", text: "Captions removed. The clean clip is ready to post." });
      } else if (action === "burn") {
        if (!styleId) throw new ApiError(0, "Pick a caption style first");
        setMessage({ tone: "brand", text: "Burning captions (transcribing can take a minute)…" });
        await burn(clip, styleId);
        setMessage({ tone: "success", text: "Captions burned in." });
      } else {
        await api(`/api/studio/clips/${clip.id}/layout`, { method: "POST", body: { layout: action } });
        setMessage({
          tone: "success",
          text: clip.captioned ? `Switched to ${LAYOUT_LABEL[action]}. Burn captions again to add them to the new cut.` : `Switched to ${LAYOUT_LABEL[action]}.`,
        });
      }
      await load();
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err, "That didn't work.") });
    } finally {
      setBusyClip(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-8">
        <Link href="/studio" className={buttonClass({ variant: "ghost", size: "sm" })}>
          <Icon name="arrowRight" className="size-5 rotate-180" /> All projects
        </Link>
        <Notice tone="danger">{loadError}</Notice>
      </div>
    );
  }

  if (!project) {
    return <p className="py-20 text-center text-xl text-ink-muted">Opening the studio…</p>;
  }

  const length = end - start;
  const openClipIndex = project.clips.findIndex((c) => c.id === openClipId);
  const openClip = openClipIndex >= 0 ? project.clips[openClipIndex] : null;

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* Header: calm on purpose, the workspace is the focus */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <Link href="/studio" className="inline-flex min-h-11 items-center gap-2 text-lg font-medium text-ink-muted hover:text-ink">
            <Icon name="arrowRight" className="size-5 rotate-180" /> All projects
          </Link>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-balance [overflow-wrap:anywhere] text-ink sm:text-4xl lg:text-5xl">
            <Em>Studio</Em> · {projectTitle(project.job)}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral" size="md">
            {SOURCE_LABEL[project.job.source]}
          </Badge>
          <Badge tone="neutral" size="md">
            {formatTime(duration)} long
          </Badge>
        </div>
      </header>

      {message && (
        <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Source + timeline */}
        <section className="min-w-0 space-y-6">
          {project.source_path ? (
            <video
              ref={video}
              src={`${API_URL}/${project.source_path}`}
              controls
              playsInline
              preload="auto"
              onTimeUpdate={onTimeUpdate}
              onSeeked={onTimeUpdate}
              className="aspect-video w-full rounded-xl bg-brand-deep object-contain shadow-glow"
            />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-xl bg-brand-deep p-8 text-center shadow-glow" aria-live="polite">
              {project.preview.status === "failed" ? (
                <div className="space-y-4">
                  <p className="text-xl text-on-brand">{project.preview.error || "Couldn't fetch a preview."}</p>
                  <Button variant="inverse" onClick={retryPreview}>
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="w-full max-w-md space-y-4">
                  <p className="font-display text-2xl font-semibold tracking-tight text-on-brand">Preparing a quick preview… {project.preview.progress}%</p>
                  <div className="h-2.5 overflow-hidden rounded-full bg-on-brand/15">
                    <div className="h-full rounded-full bg-on-brand transition-[width] duration-(--motion-base)" style={{ width: `${Math.max(4, project.preview.progress)}%` }} />
                  </div>
                  <p className="text-lg text-on-brand/80">A small low-res copy for scrubbing. Your clips are still cut in HD. You can pick a suggested moment or drag on the timeline now.</p>
                </div>
              )}
            </div>
          )}

          {project.moments.length > 0 && (
            <div className="space-y-3">
              <p className="text-lg font-medium text-ink">Suggested moments</p>
              <div className="rail-chips flex flex-wrap gap-2">
                {project.moments.map((m, i) => {
                  const active = Math.abs(m.start_s - start) < 0.5 && Math.abs(m.end_s - end) < 0.5;
                  return (
                    <Button
                      key={i}
                      variant={active ? "primary" : "secondary"}
                      size="sm"
                      title={`Moment strength ${Math.round(m.score)}/100`}
                      onClick={() => {
                        setRange(m.start_s, m.end_s);
                        seek(m.start_s);
                      }}
                    >
                      {formatTime(m.start_s)}–{formatTime(m.end_s)}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <Scrubber duration={duration} energy={project.energy} moments={project.moments} current={current} start={start} end={end} onSeek={seek} onRangeChange={setRange} />

          <div className="flex flex-wrap items-center gap-3 max-sm:[&>button]:flex-1">
            <Button onClick={playSelection}>
              <Icon name="play" className="size-5" /> Play selection
            </Button>
            <Button variant="secondary" onClick={() => setStart(Math.min(current, end - 3))} title="Shortcut: I">
              Set start <kbd className="font-mono text-meta text-ink-muted">I</kbd>
            </Button>
            <Button variant="secondary" onClick={() => setEnd(Math.max(current, start + 3))} title="Shortcut: O">
              Set end <kbd className="font-mono text-meta text-ink-muted">O</kbd>
            </Button>
            <Segmented
              label="Clip length"
              value={(LENGTHS.find((l) => Math.abs(Number(l) - length) < 0.5) ?? "") as (typeof LENGTHS)[number]}
              onChange={(v) => setLength(Number(v))}
              options={LENGTHS.map((l) => ({ value: l, label: `${l}s` }))}
            />
          </div>

          {/* Fine-tune Trim Nudge Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken p-3 text-meta">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">Fine-tune start:</span>
              <div className="inline-flex items-center rounded border border-line bg-surface">
                <button type="button" onClick={() => nudgeStart(-1)} className="min-h-11 px-2.5 font-mono font-bold text-ink-muted hover:text-ink">-1s</button>
                <button type="button" onClick={() => nudgeStart(-0.1)} className="min-h-11 border-l border-line px-2.5 font-mono text-ink-muted hover:text-ink">-0.1s</button>
                <button type="button" onClick={() => nudgeStart(0.1)} className="min-h-11 border-l border-line px-2.5 font-mono text-ink-muted hover:text-ink">+0.1s</button>
                <button type="button" onClick={() => nudgeStart(1)} className="min-h-11 border-l border-line px-2.5 font-mono font-bold text-ink-muted hover:text-ink">+1s</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">Fine-tune end:</span>
              <div className="inline-flex items-center rounded border border-line bg-surface">
                <button type="button" onClick={() => nudgeEnd(-1)} className="min-h-11 px-2.5 font-mono font-bold text-ink-muted hover:text-ink">-1s</button>
                <button type="button" onClick={() => nudgeEnd(-0.1)} className="min-h-11 border-l border-line px-2.5 font-mono text-ink-muted hover:text-ink">-0.1s</button>
                <button type="button" onClick={() => nudgeEnd(0.1)} className="min-h-11 border-l border-line px-2.5 font-mono text-ink-muted hover:text-ink">+0.1s</button>
                <button type="button" onClick={() => nudgeEnd(1)} className="min-h-11 border-l border-line px-2.5 font-mono font-bold text-ink-muted hover:text-ink">+1s</button>
              </div>
            </div>
            <p className="font-mono text-meta text-ink tabular-nums">
              {formatTime(start, true)} → {formatTime(end, true)} <span className="text-ink-muted">({length.toFixed(1)}s)</span>
            </p>
          </div>
        </section>

        {/* Output options & Creative Editing Controls */}
        <aside className="space-y-6 xl:sticky xl:top-10 xl:self-start">
          <Panel padding="sm" className="space-y-6">
            <LayoutPreview
              video={video}
              layout={layout}
              colorFilter={colorFilter}
              showCaptions={captions === "burn"}
              captionPosition={captionPosition}
              onCaptionPositionChange={setCaptionPosition}
            />

            {/* Layout */}
            <div className="space-y-2">
              <p className="text-lg font-medium text-ink">Layout</p>
              <Segmented
                label="Layout"
                value={layout}
                onChange={setLayout}
                className="w-full"
                options={[
                  { value: "fill", label: "Fill" },
                  { value: "blur", label: "Blur" },
                ]}
              />
              <p className="text-base text-ink-muted">{layout === "fill" ? "Zoomed to fill 9:16." : "Whole frame, blurred backdrop."}</p>
            </div>

            {/* Video Speed */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-lg font-medium text-ink">Speed</p>
                <span className="font-mono text-meta font-semibold text-brand-strong">{speed}x</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => changeSpeed(s)}
                    className={`min-h-11 rounded-md text-center font-mono text-meta font-semibold transition-colors ${
                      speed === s ? "bg-brand text-on-brand shadow-sm" : "border border-line bg-surface text-ink hover:border-brand/40"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <p className="text-fine text-ink-muted">
                {speed < 1 ? "Slow-mo: dramatizes reactions." : speed > 1 ? "Speed up: rapid TikTok pacing." : "Normal playback speed."}
              </p>
            </div>

            {/* Color Grade Styling */}
            <div className="space-y-2">
              <p className="text-lg font-medium text-ink">Color Grade</p>
              <div className="rail-chips flex flex-wrap gap-1.5">
                {FILTER_OPTIONS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setColorFilter(f.value)}
                    className={`min-h-11 rounded-full px-4 text-meta font-medium transition-colors ${
                      colorFilter === f.value ? "bg-brand text-on-brand shadow-sm" : "border border-line bg-surface text-ink hover:border-brand/40"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Audio Volume */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-lg font-medium text-ink">Audio Level</p>
                <span className="font-mono text-meta font-semibold text-brand-strong">
                  {volume === 0 ? "Muted" : `${Math.round(volume * 100)}%`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: "Mute", val: 0.0 },
                  { label: "100%", val: 1.0 },
                  { label: "+50%", val: 1.5 },
                  { label: "+100%", val: 2.0 },
                ].map((v) => (
                  <button
                    key={v.val}
                    type="button"
                    onClick={() => setVolume(v.val)}
                    className={`min-h-11 rounded-md text-center text-meta font-medium transition-colors ${
                      volume === v.val ? "bg-brand text-on-brand shadow-sm" : "border border-line bg-surface text-ink hover:border-brand/40"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Captions & Position */}
            <div className="space-y-3">
              <p className="text-lg font-medium text-ink">Captions</p>
              <Segmented
                label="Captions"
                value={captions}
                onChange={setCaptions}
                className="w-full"
                options={[
                  { value: "burn", label: "Burn in" },
                  { value: "none", label: "None" },
                ]}
              />
              {captions === "burn" ? (
                <div className="space-y-3 rounded-lg border border-line bg-surface-sunken p-3">
                  {styles.length > 0 && (
                    <Field label="Style">
                      <Select value={styleId ?? ""} onChange={(e) => setStyleId(Number(e.target.value))}>
                        {styles.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-meta font-medium text-ink">Caption Position</span>
                      <span className="font-mono text-meta font-semibold text-brand-strong">{captionPosition}% from top</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: "Top", pos: 20 },
                        { label: "Center", pos: 50 },
                        { label: "Bottom", pos: 68 },
                      ].map((p) => (
                        <button
                          key={p.pos}
                          type="button"
                          onClick={() => setCaptionPosition(p.pos)}
                          className={`min-h-11 rounded-md text-meta font-medium transition-colors ${
                            captionPosition === p.pos ? "bg-brand text-on-brand shadow-sm" : "border border-line bg-surface text-ink hover:border-brand/40"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      min={12}
                      max={86}
                      value={captionPosition}
                      onChange={(e) => setCaptionPosition(Number(e.target.value))}
                      aria-label="Caption position"
                      className="h-11 w-full accent-brand"
                    />
                    <p className="text-meta text-ink-muted">Drag directly on the phone preview above to position.</p>
                  </div>
                </div>
              ) : (
                <p className="text-base text-ink-muted">Clean clip, so the platform can add its own captions.</p>
              )}
            </div>

            <Button size="lg" className="w-full" loading={creating} disabled={creating || length < 3} onClick={createClip}>
              <Icon name="sparkles" /> Create clip
            </Button>
          </Panel>
        </aside>
      </div>

      {/* Clips from this video */}
      <section className="space-y-6">
        <div className="flex items-center gap-4">
          <SectionLabel>Clips from this video</SectionLabel>
          <Badge tone="neutral" size="md">
            {project.clips.length}
          </Badge>
        </div>
        {project.job.error && <Notice tone="brand">{friendly(project.job.error)}</Notice>}
        <MoreClips job={project.job} onFinished={onMoreFinished} />
        {project.clips.length === 0 ? (
          <Panel tone="sunken" padding="lg" className="text-center">
            <p className="text-lg text-ink-muted">Pick a range on the timeline and create your first clip.</p>
          </Panel>
        ) : (
          <ul className="rail rail-media grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
            {project.clips.map((clip) => (
              <li key={clip.id} className="min-w-0">
                <ClipTile
                  title={clip.title || `Clip ${formatTime(clip.start_s)}–${formatTime(clip.end_s)}`}
                  filePath={clip.file_path}
                  durationS={clip.end_s - clip.start_s}
                  label={
                    <>
                      {clip.starred && <Icon name="star" aria-hidden className="size-3.5" fill="currentColor" />}
                      {clip.status === "ready" ? LAYOUT_LABEL[clip.layout] : clip.status}
                    </>
                  }
                  onOpen={() => setOpenClipId(clip.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {openClip && (
        <ClipDialog
          title={openClip.title}
          filePath={openClip.file_path}
          position={openClipIndex + 1}
          total={project.clips.length}
          onPrev={openClipIndex > 0 ? () => setOpenClipId(project.clips[openClipIndex - 1].id) : undefined}
          onNext={openClipIndex < project.clips.length - 1 ? () => setOpenClipId(project.clips[openClipIndex + 1].id) : undefined}
          onClose={() => setOpenClipId(null)}
          videoOverlay={
            <StarButton
              key={openClip.id}
              clipId={openClip.id}
              starred={openClip.starred}
              onChange={(r) => setProject((p) => (p ? { ...p, clips: p.clips.map((c) => (c.id === r.id ? { ...c, starred: r.starred } : c)) } : p))}
              className="absolute top-3 right-3"
            />
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-base whitespace-nowrap text-ink-muted tabular-nums">
              {formatTime(openClip.start_s)}–{formatTime(openClip.end_s)} · {(openClip.end_s - openClip.start_s).toFixed(0)}s
            </span>
            <StatusBadge status={openClip.status} />
          </div>
          {message && (
            <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
              {message.text}
            </Notice>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="brand">{LAYOUT_LABEL[openClip.layout]}</Badge>
            <Badge tone="neutral">{openClip.captioned ? "Captions burned" : "No captions"}</Badge>
            {openClip.speed && openClip.speed !== 1.0 && <Badge tone="brand">{openClip.speed}x speed</Badge>}
            {openClip.color_filter && openClip.color_filter !== "none" && <Badge tone="neutral">{openClip.color_filter}</Badge>}
            {openClip.caption_position_y && <Badge tone="neutral">Pos: {openClip.caption_position_y}%</Badge>}
          </div>
          {openClip.error && <p className="text-base text-danger">{friendly(openClip.error)}</p>}
          {openClip.transcript_json && openClip.transcript_json.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-line bg-surface-sunken p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-meta font-semibold text-ink">
                  <Icon name="captions" className="size-5 text-brand" /> Spoken Dialogue:
                </span>
                <Link href={`/captions?clip=${openClip.id}`} className={buttonClass({ variant: "ghost", size: "xs" })}>
                  <Icon name="sparkles" className="size-5" /> Caption Studio
                </Link>
              </div>
              <p className="text-meta text-ink leading-relaxed">
                “{openClip.transcript_json.map((w) => w.word).join(" ")}”
              </p>
            </div>
          )}
          <Segmented
            label={`Layout for clip ${openClip.id}`}
            value={openClip.layout}
            onChange={(v) => v !== openClip.layout && clipAction(openClip, v)}
            className="w-full"
            options={[
              { value: "fill", label: "Fill" },
              { value: "blur", label: "Blur" },
            ]}
          />
          <ClipDialogActions>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpenClipId(null);
                  setEditingClip(openClip);
                }}
              >
                <Icon name="sparkles" className="size-5" /> Edit & Polish
              </Button>
              {openClip.captioned ? (
                <Button variant="secondary" size="sm" loading={busyClip === openClip.id} onClick={() => clipAction(openClip, "remove")}>
                  <Icon name="x" className="size-5" /> Remove captions
                </Button>
              ) : (
                <Button variant="secondary" size="sm" loading={busyClip === openClip.id} disabled={!styleId} onClick={() => clipAction(openClip, "burn")}>
                  <Icon name="captions" className="size-5" /> Burn captions
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpenClipId(null);
                  setTrendsClip(openClip);
                }}
              >
                <Icon name="trending" className="size-5" /> Hashtags
              </Button>
              {openClip.file_path ? (
                <a href={`${API_URL}/${openClip.file_path}`} download target="_blank" rel="noopener noreferrer" className={buttonClass({ size: "sm" })}>
                  <Icon name="download" className="size-5" /> Download
                </a>
              ) : (
                <span />
              )}
            </div>
          </ClipDialogActions>
        </ClipDialog>
      )}

      {/* Editing Polish Modal */}
      {editingClip && (
        <ClipEditorModal
          clip={editingClip}
          styles={styles}
          onSave={(params) => handleEditClip(editingClip, params)}
          onClose={() => setEditingClip(null)}
        />
      )}

      {trendsClip && (
        <SocialTrendsPanel
          key={trendsClip.id}
          clipId={trendsClip.id}
          clipLabel={`Clip ${formatTime(trendsClip.start_s)}–${formatTime(trendsClip.end_s)}`}
          onClose={() => setTrendsClip(null)}
        />
      )}
    </div>
  );
}
