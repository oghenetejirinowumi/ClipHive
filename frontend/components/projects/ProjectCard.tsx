"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, buttonClass, Icon, Panel } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { ACTIVE_STATUSES, formatTime, projectTitle, SOURCE_LABEL, STEP_LABEL, type ImportJob } from "@/lib/imports";

/**
 * One import project: thumbnail, live progress with the current step, and actions:
 * review in the inbox and open in the editor (done), retry (failed link), cancel (running) and delete
 * (with or without its clips). `children` sits under the progress, e.g. the agent's live feed.
 */
export function ProjectCard({
  job,
  onDelete,
  onRetry,
  children,
}: {
  job: ImportJob;
  onDelete: (job: ImportJob, withClips: boolean) => Promise<void>;
  onRetry: (job: ImportJob) => Promise<void>;
  children?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"delete" | "retry" | null>(null);
  const active = ACTIVE_STATUSES.has(job.status);
  const clipCount = job.clip_ids.length;

  async function act(kind: "delete" | "retry", fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

  return (
    <Panel padding="none" className="flex h-full flex-col overflow-hidden">
      <div className="relative aspect-video shrink-0 overflow-hidden bg-brand-deep">
        {job.thumbnail_path ? (
          // Absolute so a non-16:9 thumbnail (Twitch's are letterboxed) can't stretch the box; it's cropped to fill.
          // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host
          <img src={`${API_URL}/${job.thumbnail_path}`} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-on-brand/50">
            <Icon name="film" className="size-10" />
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-brand-deep/85 px-3 py-1 text-meta font-semibold text-on-brand tabular-nums">
          {formatTime(job.duration_s)}
        </span>
        <span className="absolute top-3 right-3 rounded-full bg-brand-deep/85 px-3 py-1 text-meta font-semibold text-on-brand">{SOURCE_LABEL[job.source]}</span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6">
        <p className="line-clamp-2 font-display text-xl leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] text-ink">{projectTitle(job)}</p>

        {active && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-base">
              <span className="font-medium text-brand">{STEP_LABEL[job.status]}</span>
              <span className="text-ink-muted tabular-nums">{job.progress}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-brand transition-[width] duration-(--motion-base)" style={{ width: `${Math.max(4, job.progress)}%` }} />
            </div>
            {job.detail && <p className="text-base text-ink-muted">{job.detail}</p>}
          </div>
        )}

        {job.status === "failed" && <p className="text-base text-danger">{job.error || "This project failed."}</p>}
        {job.status === "done" && job.error && <p className="text-base text-ink-muted">{job.error}</p>}

        {children}

        {confirming ? (
          <div className="mt-auto space-y-3 rounded-md border border-danger/30 bg-danger-subtle p-4">
            <p className="text-base font-medium text-ink">{active ? "Cancel and delete this project?" : "Delete this project?"}</p>
            <div className="grid gap-2">
              <Button variant="danger" size="sm" loading={busy === "delete"} onClick={() => act("delete", () => onDelete(job, false))}>
                {clipCount ? "Delete, keep clips in the Hub" : "Delete project"}
              </Button>
              {clipCount > 0 && (
                <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => act("delete", () => onDelete(job, true))}>
                  Delete project and its {clipCount} clip{clipCount === 1 ? "" : "s"}
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-base text-ink-muted">
              {job.status === "done" ? `${clipCount} clip${clipCount === 1 ? "" : "s"} · ${job.clip_seconds}s each` : `${job.clip_count} × ${job.clip_seconds}s requested`}
            </span>
            <div className="flex flex-wrap gap-2">
              {job.status === "done" && (
                <>
                  <Link href="/inbox" className={buttonClass({ size: "sm" })}>
                    <Icon name="inbox" className="size-5" /> Review
                  </Link>
                  <Link href={`/editor/open?import=${job.id}`} className={buttonClass({ variant: "secondary", size: "sm" })} aria-label="Open in the editor" title="Open in the editor">
                    <Icon name="scissors" className="size-5" />
                  </Link>
                </>
              )}
              {job.status === "failed" && job.url && (
                <Button variant="secondary" size="sm" loading={busy === "retry"} onClick={() => act("retry", () => onRetry(job))}>
                  Retry
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={active ? "Cancel project" : "Delete project"}>
                <Icon name="x" className="size-5" /> {active ? "Cancel" : "Delete"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
