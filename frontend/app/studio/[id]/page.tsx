"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { MoreClips } from "@/components/projects/MoreClips";
import { StarButton } from "@/components/projects/StarButton";
import { LayoutPreview } from "@/components/studio/LayoutPreview";
import { Scrubber } from "@/components/studio/Scrubber";
import { SocialTrendsPanel } from "@/components/studio/SocialTrendsPanel";
import { Badge, Button, buttonClass, Em, Field, Icon, Notice, Panel, SectionLabel, Segmented, Select, StatusBadge } from "@/components/ui";
import { api, ApiError, API_URL } from "@/lib/api";
import { formatTime, LAYOUT_LABEL, projectTitle, SOURCE_LABEL, type ImportJob, type Layout, type StudioClip, type StudioProject } from "@/lib/imports";

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
  const [captions, setCaptions] = useState<"burn" | "none">("none");
  const [styleId, setStyleId] = useState<number | null>(null);

  const [creating, setCreating] = useState(false);
  const [busyClip, setBusyClip] = useState<number | null>(null);
  const [trendsClip, setTrendsClip] = useState<StudioClip | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const duration = project?.job.duration_s ?? 0;

  const load = useCallback(async () => {
    try {
      const p = await api<StudioProject>(`/api/studio/imports/${id}`);
      setProject(p);
      return p;
    } catch (err) {
      setLoadError(errorText(err, "Couldn't open this project. Is the backend running?"));
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

  async function burn(clip: StudioClip, style: number) {
    await api(`/api/clips/${clip.id}/caption`, { method: "POST", body: { style_id: style, caption_mode: "burned" }, auth: false });
  }

  async function createClip() {
    if (!project) return;
    setCreating(true);
    setMessage({ tone: "brand", text: project.job.source === "upload" ? "Cutting your clip…" : "Fetching this range in HD and cutting it (can take a minute)…" });
    try {
      const clip = await api<StudioClip>(`/api/studio/imports/${project.job.id}/clips`, { method: "POST", body: { start_s: start, end_s: end, layout } });
      if (captions === "burn" && styleId) {
        setMessage({ tone: "brand", text: "Clip cut. Burning captions (transcribing can take a minute)…" });
        try {
          await burn(clip, styleId);
          setMessage({ tone: "success", text: `Clip created with ${styles.find((s) => s.id === styleId)?.name ?? ""} captions.` });
        } catch (err) {
          setMessage({ tone: "danger", text: `Clip created, but captions failed: ${errorText(err, "caption service unavailable")}. You can retry from the clip below.` });
        }
      } else {
        setMessage({ tone: "success", text: "Clip created without captions." });
      }
      await load();
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err, "Couldn't cut that clip.") });
    } finally {
      setCreating(false);
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

  return (
    <div className="space-y-10">
      {/* Header: calm on purpose, the workspace is the focus */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <Link href="/studio" className="inline-flex min-h-11 items-center gap-2 text-lg font-medium text-ink-muted hover:text-ink">
            <Icon name="arrowRight" className="size-5 rotate-180" /> All projects
          </Link>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-balance text-ink lg:text-5xl">
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
              <div className="flex flex-wrap gap-2">
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

          <div className="flex flex-wrap items-center gap-3">
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
          <p className="font-mono text-lg text-ink tabular-nums">
            {formatTime(start, true)} → {formatTime(end, true)} <span className="text-ink-muted">· {length.toFixed(1)}s</span>
          </p>
        </section>

        {/* Output options */}
        <aside className="space-y-6 xl:sticky xl:top-10 xl:self-start">
          <Panel padding="sm" className="space-y-6">
            <LayoutPreview video={video} layout={layout} />

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
              <p className="text-base text-ink-muted">{layout === "fill" ? "Zoomed to fill the screen." : "Whole frame, blurred top and bottom."}</p>
            </div>

            <div className="space-y-2">
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
                styles.length > 0 && (
                  <Field label="Style">
                    <Select value={styleId ?? ""} onChange={(e) => setStyleId(Number(e.target.value))}>
                      {styles.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )
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
        {project.job.error && <Notice tone="brand">{project.job.error}</Notice>}
        <MoreClips job={project.job} onFinished={onMoreFinished} />
        {project.clips.length === 0 ? (
          <Panel tone="sunken" padding="lg" className="text-center">
            <p className="text-lg text-ink-muted">Pick a range on the timeline and create your first clip.</p>
          </Panel>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-6">
            {/* Columns come from the space actually available (not the window width), so a card never gets squeezed. */}
            {project.clips.map((clip) => (
              <li key={clip.id}>
                <Panel padding="none" className="flex h-full flex-col overflow-hidden">
                  <div className="relative">
                    {clip.file_path && <video key={clip.file_path} src={`${API_URL}/${clip.file_path}`} controls playsInline preload="metadata" className="aspect-[9/16] w-full bg-brand-deep object-cover" />}
                    <StarButton clipId={clip.id} starred={clip.starred} className="absolute top-3 right-3" />
                  </div>
                  <div className="flex flex-1 flex-col gap-4 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-meta whitespace-nowrap text-ink-muted tabular-nums">
                        {formatTime(clip.start_s)}–{formatTime(clip.end_s)}
                      </span>
                      <StatusBadge status={clip.status} />
                    </div>
                    <Badge tone="neutral" className="self-start">
                      {clip.captioned ? "Captions burned" : "No captions"}
                    </Badge>
                    {clip.error && <p className="text-base text-danger">{clip.error}</p>}
                    <Segmented
                      label={`Layout for clip ${clip.id}`}
                      value={clip.layout}
                      onChange={(v) => v !== clip.layout && clipAction(clip, v)}
                      className="w-full"
                      options={[
                        { value: "fill", label: "Fill" },
                        { value: "blur", label: "Blur" },
                      ]}
                    />
                    <div className="mt-auto grid gap-2">
                      {clip.captioned ? (
                        <Button variant="secondary" size="sm" loading={busyClip === clip.id} onClick={() => clipAction(clip, "remove")}>
                          <Icon name="x" className="size-5" /> Remove captions
                        </Button>
                      ) : (
                        <Button variant="secondary" size="sm" loading={busyClip === clip.id} disabled={!styleId} onClick={() => clipAction(clip, "burn")}>
                          <Icon name="captions" className="size-5" /> Burn captions
                        </Button>
                      )}
                      <Button variant={trendsClip?.id === clip.id ? "primary" : "secondary"} size="sm" onClick={() => setTrendsClip(clip)}>
                        <Icon name="trending" className="size-5" /> Hashtags & captions
                      </Button>
                      {clip.file_path && (
                        <a href={`${API_URL}/${clip.file_path}`} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "ghost", size: "sm" })}>
                          <Icon name="download" className="size-5" /> Download
                        </a>
                      )}
                    </div>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        )}
      </section>

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
