"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass, Icon, Panel, StatusBadge } from "@/components/ui";
import { api, API_URL } from "@/lib/api";
import { ACTIVE_STATUSES, formatTime, projectTitle, SOURCE_LABEL, STEP_LABEL, type ImportJob } from "@/lib/imports";

/** The latest few imports as compact rows; each opens in the studio (or shows its progress). */
export function RecentProjects({ limit = 4 }: { limit?: number }) {
  const [jobs, setJobs] = useState<ImportJob[] | null>(null);

  useEffect(() => {
    api<ImportJob[]>("/api/imports")
      .then((all) => setJobs(all.slice(0, limit)))
      .catch(() => setJobs([]));
  }, [limit]);

  if (jobs === null) return <p className="text-lg text-ink-muted">Loading projects…</p>;

  if (jobs.length === 0) {
    return (
      <Panel tone="sunken" padding="lg" className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-2xl font-semibold tracking-tight text-ink">No projects yet</p>
          <p className="mt-1 text-lg text-ink-muted">Paste a link or upload a video and ClipHive cuts it into clips.</p>
        </div>
        <Link href="/create" className={buttonClass()}>
          <Icon name="plus" className="size-5" /> Start a project
        </Link>
      </Panel>
    );
  }

  return (
    <ul className="divide-y divide-line border-y border-line">
      {jobs.map((job) => {
        const active = ACTIVE_STATUSES.has(job.status);
        return (
          <li key={job.id} className="flex items-center gap-5 py-5">
            <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-brand-deep sm:w-44">
              {job.thumbnail_path && (
                // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host
                <img src={`${API_URL}/${job.thumbnail_path}`} alt="" className="size-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-xl font-semibold tracking-tight text-ink">{projectTitle(job)}</p>
              <p className="mt-1 text-base text-ink-muted">
                {SOURCE_LABEL[job.source]} · {formatTime(job.duration_s)} ·{" "}
                {active ? `${STEP_LABEL[job.status]} ${job.progress}%` : job.status === "done" ? `${job.clip_ids.length} clips` : "Failed"}
              </p>
            </div>
            {job.status === "done" ? (
              <Link href={`/studio/${job.id}`} className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}>
                <Icon name="film" className="size-5" /> <span className="hidden sm:inline">Open in studio</span>
              </Link>
            ) : (
              <StatusBadge status={job.status === "failed" ? "failed" : "processing"} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
