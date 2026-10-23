"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Badge, Button, buttonClass, Em, Icon, Notice, Panel, SkyHeader } from "@/components/ui";
import { api, ApiError, API_URL } from "@/lib/api";
import { formatTime, projectTitle, SOURCE_LABEL, type ImportJob } from "@/lib/imports";

/** Project picker. `/studio?clip=ID` (from the Hub) jumps straight to that clip's project. */
function StudioIndex() {
  const router = useRouter();
  const clipId = useSearchParams().get("clip");
  const [jobs, setJobs] = useState<ImportJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clipId) {
      api<{ job_id: number }>(`/api/studio/clips/${clipId}/project`)
        .then(({ job_id }) => router.replace(`/studio/${job_id}`))
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't find that clip's project."));
    }
    api<ImportJob[]>("/api/imports")
      .then((all) => setJobs(all.filter((j) => j.status === "done")))
      .catch(() => setJobs([]));
  }, [clipId, router]);

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Clipping studio"
        title={
          <>
            Pick the moment <Em>yourself</Em>
          </>
        }
        description="Scrub any video you've imported, mark the exact start and end, choose the layout and captions, and cut it."
        actions={
          <Button href="/create" variant="inverse" size="lg">
            <Icon name="plus" /> Import a video
          </Button>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {jobs === null ? (
        <p className="text-center text-xl text-ink-muted">Loading projects…</p>
      ) : jobs.length === 0 ? (
        <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-14 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-brand-subtle text-brand-strong">
            <Icon name="film" />
          </span>
          <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">Nothing to edit yet</p>
          <p className="mt-2 text-lg text-ink-muted">Import a link or upload a video first. It shows up here once it&apos;s processed.</p>
          <Button href="/create" className="mt-8">
            Go to Create <Icon name="arrowRight" className="size-5" />
          </Button>
        </Panel>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Panel padding="none" className="flex h-full flex-col overflow-hidden">
                <div className="relative aspect-video bg-brand-deep">
                  {job.thumbnail_path && (
                    // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host
                    <img src={`${API_URL}/${job.thumbnail_path}`} alt="" className="size-full object-cover" />
                  )}
                  <span className="absolute top-3 left-3 rounded-full bg-brand-deep/85 px-3 py-1 text-meta font-semibold text-on-brand tabular-nums">{formatTime(job.duration_s)}</span>
                </div>
                <div className="flex flex-1 flex-col gap-4 p-6">
                  <p className="line-clamp-2 font-display text-xl leading-snug font-semibold tracking-tight text-ink">{projectTitle(job)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="neutral">{SOURCE_LABEL[job.source]}</Badge>
                    <Badge tone="brand">
                      {job.clip_ids.length} clip{job.clip_ids.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <Link href={`/studio/${job.id}`} className={buttonClass({ className: "mt-auto" })}>
                    Open in studio <Icon name="arrowRight" className="size-5" />
                  </Link>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StudioIndexPage() {
  return (
    <Suspense fallback={<p className="py-20 text-center text-xl text-ink-muted">Loading…</p>}>
      <StudioIndex />
    </Suspense>
  );
}
