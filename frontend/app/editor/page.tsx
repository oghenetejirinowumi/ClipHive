"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Badge, Button, Em, Field, Icon, Input, Notice, Panel, SectionLabel, Segmented, SkyHeader } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Aspect, Project, ProjectSummary } from "@/lib/editor";
import type { ImportJob } from "@/lib/imports";

type LibraryClip = { id: number; title: string | null; file_path: string | null; duration_s: number };
type Start = "blank" | "clip" | "import";

/** Project list + new project. `/editor?clip=ID` opens a new edit of that clip straight away. */
function EditorIndex() {
  const router = useRouter();
  const clipParam = useSearchParams().get("clip");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [clips, setClips] = useState<LibraryClip[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [title, setTitle] = useState("");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [start, setStart] = useState<Start>("blank");
  const [sourceId, setSourceId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    api<ProjectSummary[]>("/api/editor/projects").then(setProjects).catch(() => setProjects([]));
    api<LibraryClip[]>("/api/clips").then((all) => setClips(all.filter((c) => c.file_path))).catch(() => {});
    api<ImportJob[]>("/api/imports").then((all) => setImports(all.filter((j) => j.status === "done"))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipParam]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { title: title.trim() || "Untitled edit", aspect };
    if (start === "clip" && sourceId) body.clip_id = Number(sourceId);
    if (start === "import" && sourceId) body.import_id = Number(sourceId);
    create(body);
  }

  async function removeProject(id: number) {
    try {
      await api(`/api/editor/projects/${id}`, { method: "DELETE" });
      setProjects((all) => all?.filter((p) => p.id !== id) ?? all);
    } catch {
      setError("Couldn't delete that project.");
    }
  }

  const control = "h-14 w-full rounded-md border border-line-strong bg-surface px-4 text-lg text-ink focus:border-brand focus:outline-none";

  return (
    <div className="space-y-12">
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
        <section className="space-y-6 lg:col-span-7">
          <SectionLabel>Your edits</SectionLabel>
          {projects === null ? (
            <p className="text-lg text-ink-muted">Loading…</p>
          ) : projects.length === 0 ? (
            <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-14 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                <Icon name="scissors" />
              </span>
              <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No edits yet</p>
              <p className="mt-2 text-lg text-ink-muted">Start one on the right.</p>
            </Panel>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 py-5">
                  <button type="button" onClick={() => router.push(`/editor/${p.id}`)} className="min-w-0 text-left">
                    <p className="truncate font-display text-2xl font-semibold tracking-tight text-ink hover:underline">{p.title}</p>
                    <p className="mt-1 text-base text-ink-muted">
                      Edited {new Date(p.updated_at ?? p.created_at).toLocaleString()} · {p.revision} saves
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.render_status === "done" && <Badge tone="success">Exported</Badge>}
                    {p.render_status === "rendering" && <Badge tone="warning">Exporting</Badge>}
                    <Button size="sm" variant="secondary" href={`/editor/${p.id}`}>
                      Open
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeProject(p.id)} aria-label={`Delete ${p.title}`}>
                      <Icon name="trash" className="size-5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-5">
          <Panel padding="lg">
            <h3 className="font-display text-3xl font-semibold tracking-tight text-ink">New edit</h3>
            <form onSubmit={submit} className="mt-8 space-y-6">
              <Field label="Name">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled edit" maxLength={200} />
              </Field>
              <div className="space-y-2">
                <p className="text-lg font-medium text-ink">Shape</p>
                <Segmented
                  label="Shape"
                  value={aspect}
                  onChange={setAspect}
                  className="w-full"
                  options={[
                    { value: "9:16", label: "9:16" },
                    { value: "16:9", label: "16:9" },
                    { value: "1:1", label: "1:1" },
                    { value: "4:5", label: "4:5" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <p className="text-lg font-medium text-ink">Start from</p>
                <Segmented
                  label="Start from"
                  value={start}
                  onChange={(v) => {
                    setStart(v);
                    setSourceId("");
                  }}
                  className="w-full"
                  options={[
                    { value: "blank", label: "Blank" },
                    { value: "clip", label: "A clip" },
                    { value: "import", label: "Full video" },
                  ]}
                />
              </div>
              {start !== "blank" && (
                <select className={control} value={sourceId} onChange={(e) => setSourceId(e.target.value)} required aria-label="Source video">
                  <option value="">Choose…</option>
                  {start === "clip"
                    ? clips.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title ?? `Clip ${c.id}`}
                        </option>
                      ))
                    : imports.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.title ?? j.original_filename ?? `Import ${j.id}`}
                        </option>
                      ))}
                </select>
              )}
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

export default function EditorIndexPage() {
  return (
    <Suspense>
      <EditorIndex />
    </Suspense>
  );
}
