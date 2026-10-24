"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { DetailSheet, MediaTile } from "@/components/clips";
import { Badge, Button, buttonClass, Em, Field, Icon, Input, Notice, Panel, SectionLabel, SkyHeader, type IconName } from "@/components/ui";
import { timeAgo } from "@/lib/agents";
import { api, ApiError, API_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatTime, type Aspect, type Project, type ProjectSummary } from "@/lib/editor";
import type { ImportJob } from "@/lib/imports";

type LibraryClip = { id: number; title: string | null; file_path: string | null; duration_s: number };
type Start = "blank" | "clip" | "import";
/** The list card: the summary plus what GET /api/editor/projects adds for it. */
type EditCard = ProjectSummary & {
  aspect?: Aspect;
  duration?: number;
  cover?: string | null;
  cover_kind?: "video" | "image" | null;
  clips?: number;
  texts?: number;
  render_path?: string | null;
};

const SHAPES: { value: Aspect; label: string; hint: string }[] = [
  { value: "9:16", label: "9:16", hint: "TikTok · Reels · Shorts" },
  { value: "16:9", label: "16:9", hint: "YouTube" },
  { value: "1:1", label: "1:1", hint: "Square" },
  { value: "4:5", label: "4:5", hint: "Feed post" },
];

const STARTS: { value: Start; label: string; hint: string; icon: IconName }[] = [
  { value: "blank", label: "Blank", hint: "An empty timeline", icon: "plus" },
  { value: "clip", label: "A clip", hint: "One of your clips", icon: "film" },
  { value: "import", label: "Full video", hint: "A whole import", icon: "upload" },
];

/** "9:16" → CSS aspect-ratio "9 / 16". */
const ratio = (a: string) => a.replace(":", " / ");
const isTall = (a: string) => {
  const [w, h] = a.split(":").map(Number);
  return h >= w;
};

/** Project list + new project. `/editor?clip=ID` opens a new edit of that clip straight away. */
function EditorIndex() {
  const router = useRouter();
  const clipParam = useSearchParams().get("clip");
  const [projects, setProjects] = useState<EditCard[] | null>(null);
  const [clips, setClips] = useState<LibraryClip[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [title, setTitle] = useState("");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [start, setStart] = useState<Start>("blank");
  const [sourceId, setSourceId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const open = projects?.find((p) => p.id === openId) ?? null;
  const openedFromClip = useRef(false);

  async function create(body: Record<string, unknown>) {
    setCreating(true);
    setError(null);
    try {
      const p = await api<Project>("/api/editor/projects", { method: "POST", body });
      router.push(`/editor/${p.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the project.");
      setCreating(false);
    }
  }

  useEffect(() => {
    if (clipParam && !openedFromClip.current) {
      openedFromClip.current = true;
      create({ title: "Clip edit", aspect: "9:16", clip_id: Number(clipParam) });
      return;
    }
    api<EditCard[]>("/api/editor/projects").then(setProjects).catch(() => setProjects([]));
    api<LibraryClip[]>("/api/clips").then((all) => setClips(all.filter((c) => c.file_path))).catch(() => {});
    api<ImportJob[]>("/api/imports").then((all) => setImports(all.filter((j) => j.status === "done"))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipParam]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (start !== "blank" && !sourceId) return setError(start === "clip" ? "Pick a clip to start from." : "Pick a video to start from.");
    const body: Record<string, unknown> = { title: title.trim() || "Untitled edit", aspect };
    if (start === "clip") body.clip_id = Number(sourceId);
    if (start === "import") body.import_id = Number(sourceId);
    create(body);
  }

  async function removeProject(id: number) {
    try {
      await api(`/api/editor/projects/${id}`, { method: "DELETE" });
      setProjects((all) => all?.filter((p) => p.id !== id) ?? all);
      setOpenId(null);
    } catch {
      setError("Couldn't delete that project.");
      setOpenId(null);
    }
  }

  return (
    <div className="space-y-10 sm:space-y-12">
      <SkyHeader
        eyebrow="Video editor"
        title={
          <>
            Edit it <Em>your way</Em>
          </>
        }
        description="Cut, trim, add text, music and captions on a real timeline, or just tell the AI what you want and fine-tune it by hand."
      />

      {error && (
        <Notice tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-12">
        <section className="min-w-0 space-y-5 lg:col-span-7">
          <div className="flex items-center gap-3">
            <SectionLabel>Your edits</SectionLabel>
            {projects && projects.length > 0 && <Badge tone="neutral">{projects.length}</Badge>}
          </div>
          {projects === null ? (
            <p className="text-lg text-ink-muted">Loading…</p>
          ) : projects.length === 0 ? (
            <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-14 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                <Icon name="scissors" />
              </span>
              <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No edits yet</p>
              <p className="mt-2 text-lg text-ink-muted">Start one from a clip, a full video or a blank timeline.</p>
            </Panel>
          ) : (
            <ul className="rail rail-media grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
              {projects.map((p) => (
                <li key={p.id} className="min-w-0">
                  <MediaTile
                    title={p.title}
                    video={p.cover_kind === "video" ? p.cover : null}
                    image={p.cover_kind === "image" ? p.cover : null}
                    placeholderIcon="scissors"
                    topLeft={p.aspect ?? "9:16"}
                    topRight={p.render_status === "done" ? "Exported" : p.render_status === "rendering" ? "Exporting" : undefined}
                    subtitle={`${contents(p)} · ${timeAgo(p.updated_at ?? p.created_at)}`}
                    onOpen={() => setOpenId(p.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          {open && <EditDialog key={open.id} project={open} onClose={() => setOpenId(null)} onDelete={() => removeProject(open.id)} />}
        </section>

        {/* min-w-0: without it the clip strip's full width stretches this column off-screen instead of scrolling */}
        <aside className="min-w-0 lg:col-span-5">
          <Panel padding="lg" className="lg:sticky lg:top-8">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">New edit</h2>
            <form onSubmit={submit} className="mt-6 space-y-7">
              <Field label="Name">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled edit" maxLength={200} />
              </Field>

              <fieldset className="space-y-3">
                <legend className="mb-3 text-lg font-medium text-ink">Shape</legend>
                <div className="grid grid-cols-4 gap-2">
                  {SHAPES.map((s) => {
                    const on = aspect === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setAspect(s.value)}
                        title={s.hint}
                        className={cn(
                          "tactile flex flex-col items-center gap-2 rounded-lg border px-1 pt-3 pb-2",
                          on ? "border-brand bg-brand-subtle text-brand-strong" : "border-line bg-surface text-ink-muted hover:border-brand-soft",
                        )}
                      >
                        <span className="grid h-11 w-full place-items-center">
                          <span
                            aria-hidden
                            className={cn("block rounded-sm border-2", on ? "border-brand bg-brand/20" : "border-line-strong", isTall(s.value) ? "h-full" : "w-3/5")}
                            style={{ aspectRatio: ratio(s.value) }}
                          />
                        </span>
                        <span className="text-meta font-semibold">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-meta text-ink-muted">{SHAPES.find((s) => s.value === aspect)?.hint}</p>
              </fieldset>

              {/* A fieldset is min-content wide by default; min-w-0 lets the clip strip scroll inside it */}
              <fieldset className="min-w-0 space-y-3">
                <legend className="mb-3 text-lg font-medium text-ink">Start from</legend>
                <div className="grid grid-cols-3 gap-2">
                  {STARTS.map((s) => {
                    const on = start === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setStart(s.value);
                          setSourceId("");
                        }}
                        className={cn(
                          "tactile flex flex-col items-start gap-2 rounded-lg border p-3 text-left",
                          on ? "border-brand bg-brand-subtle" : "border-line bg-surface hover:border-brand-soft",
                        )}
                      >
                        <span className={cn("grid size-10 place-items-center rounded-full", on ? "bg-brand text-on-brand" : "bg-surface-sunken text-ink-muted")}>
                          <Icon name={s.icon} className="size-5" />
                        </span>
                        <span>
                          <span className="block font-semibold text-ink">{s.label}</span>
                          <span className="block text-meta leading-snug text-ink-muted">{s.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {start === "clip" && (
                  <SourcePicker
                    empty="No clips yet. Make some on the Create page."
                    items={clips.map((c) => ({
                      id: String(c.id),
                      label: c.title || `Clip ${c.id}`,
                      meta: formatTime(c.duration_s),
                      media: c.file_path ? `${API_URL}/${c.file_path}#t=0.5` : null,
                      kind: "video" as const,
                    }))}
                    tall
                    value={sourceId}
                    onChange={setSourceId}
                  />
                )}
                {start === "import" && (
                  <SourcePicker
                    empty="No finished imports yet."
                    items={imports.map((j) => ({
                      id: String(j.id),
                      label: j.title ?? j.original_filename ?? `Import ${j.id}`,
                      meta: j.duration_s ? formatTime(j.duration_s) : "",
                      media: j.thumbnail_path ? `${API_URL}/${j.thumbnail_path}` : null,
                      kind: "image" as const,
                    }))}
                    value={sourceId}
                    onChange={setSourceId}
                  />
                )}
              </fieldset>

              <Button type="submit" size="lg" className="w-full" loading={creating}>
                <Icon name="scissors" /> Open the editor
              </Button>
            </form>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** "0:32 · 3 clips · 2 texts", or "Empty". */
function contents(p: EditCard): string {
  return [
    p.duration ? formatTime(p.duration) : "Empty",
    p.clips ? `${p.clips} clip${p.clips === 1 ? "" : "s"}` : null,
    p.texts ? `${p.texts} text${p.texts === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** An edit's details: its cover, what's in it, and Open / Download / Delete. */
function EditDialog({ project: p, onClose, onDelete }: { project: EditCard; onClose: () => void; onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cover = p.cover ? `${API_URL}/${p.cover}` : null;
  return (
    <DetailSheet
      label="Edit"
      title={p.title}
      onClose={onClose}
      media={
        <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-brand-deep shadow-glow">
          {cover && p.cover_kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- media comes from the API host
            <img src={cover} alt="" className="size-full object-cover" />
          ) : cover ? (
            <video src={`${cover}#t=0.5`} muted playsInline autoPlay loop preload="metadata" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-on-brand/40">
              <Icon name="scissors" className="size-8" />
            </span>
          )}
          <span className="absolute top-2 left-2 rounded-full bg-brand-deep/85 px-2.5 py-0.5 text-fine font-semibold text-on-brand">{p.aspect ?? "9:16"}</span>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge tone="neutral">{contents(p)}</Badge>
        {p.render_status === "done" && <Badge tone="success">Exported</Badge>}
        {p.render_status === "rendering" && <Badge tone="warning">Exporting</Badge>}
      </div>
      <p className="text-base text-ink-muted">
        Edited {timeAgo(p.updated_at ?? p.created_at)} · {p.revision} save{p.revision === 1 ? "" : "s"}
      </p>
      {confirming ? (
        <div className="space-y-3 rounded-md border border-danger/30 bg-danger-subtle p-4">
          <p className="text-base font-medium text-ink">Delete this edit? Exports already in your Hub stay.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={async () => {
                setDeleting(true);
                await onDelete();
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-auto grid gap-2 border-t border-line pt-4 sm:flex sm:flex-wrap">
          <Link href={`/editor/${p.id}`} className={buttonClass({ size: "sm" })}>
            <Icon name="scissors" className="size-5" /> Open in editor
          </Link>
          {p.render_path && (
            <a href={`${API_URL}/${p.render_path}`} download className={buttonClass({ variant: "secondary", size: "sm" })}>
              <Icon name="download" className="size-5" /> Download MP4
            </a>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            <Icon name="trash" className="size-5" /> Delete
          </Button>
        </div>
      )}
    </DetailSheet>
  );
}

/** Pick the clip or video to start from: a sideways row of thumbnails. */
function SourcePicker({
  items,
  value,
  onChange,
  empty,
  tall,
}: {
  items: { id: string; label: string; meta: string; media: string | null; kind: "video" | "image" }[];
  value: string;
  onChange: (id: string) => void;
  empty: string;
  tall?: boolean;
}) {
  if (items.length === 0) return <p className="rounded-md bg-surface-sunken px-4 py-3 text-base text-ink-muted">{empty}</p>;
  return (
    <div role="radiogroup" aria-label="Start from" className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-2 [scrollbar-width:thin]">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? "" : it.id)}
            className={cn("group shrink-0 text-left", tall ? "w-24" : "w-40")}
          >
            <span
              className={cn(
                "relative block overflow-hidden rounded-md bg-brand-deep ring-2 transition-shadow",
                tall ? "aspect-[9/16]" : "aspect-video",
                on ? "ring-brand" : "ring-transparent group-hover:ring-brand-soft",
              )}
            >
              {it.media &&
                (it.kind === "video" ? (
                  <video src={it.media} muted playsInline preload="metadata" className="pointer-events-none size-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- media comes from the API host
                  <img src={it.media} alt="" loading="lazy" className="size-full object-cover" />
                ))}
              {on && (
                <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-brand text-on-brand">
                  <Icon name="check" aria-hidden className="size-4" />
                </span>
              )}
              {it.meta && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-brand-deep/85 px-2 text-fine font-semibold text-on-brand tabular-nums">{it.meta}</span>}
            </span>
            <span className={cn("mt-1 line-clamp-2 text-meta leading-snug", on ? "font-semibold text-ink" : "text-ink-muted")}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function EditorIndexPage() {
  return (
    <Suspense>
      <EditorIndex />
    </Suspense>
  );
}
