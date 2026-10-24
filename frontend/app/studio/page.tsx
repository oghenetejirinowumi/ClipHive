"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProjectDialog, ProjectTile } from "@/components/projects/ProjectCard";
import { Button, Em, Icon, Notice, Panel, SkyHeader } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { ImportJob } from "@/lib/imports";

/** Project picker. `/studio?clip=ID` (from the Hub) jumps straight to that clip's project. */
function StudioIndex() {
  const router = useRouter();
  const clipId = useSearchParams().get("clip");
  const [jobs, setJobs] = useState<ImportJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const open = jobs?.find((j) => j.id === openId) ?? null;

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
    <div className="space-y-10 sm:space-y-12">
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
        <ul className="rail rail-media grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
          {jobs.map((job) => (
            <li key={job.id} className="min-w-0">
              <ProjectTile job={job} onOpen={() => setOpenId(job.id)} />
            </li>
          ))}
        </ul>
      )}
      {open && <ProjectDialog key={open.id} job={open} onClose={() => setOpenId(null)} />}
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
