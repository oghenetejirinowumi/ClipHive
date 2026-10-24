"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DetailSheet, MediaTile } from "@/components/clips";
import { Button, buttonClass, Icon } from "@/components/ui";
import { API_URL, friendly } from "@/lib/api";
import { ACTIVE_STATUSES, formatTime, projectTitle, SOURCE_LABEL, STEP_LABEL, type ImportJob } from "@/lib/imports";

/** One line on where a project stands: progress, failure or its clips. */
function statusLine(job: ImportJob): string {
  if (ACTIVE_STATUSES.has(job.status)) return `${STEP_LABEL[job.status]} ${job.progress}%`;
  if (job.status === "failed") return "Failed";
  const n = job.clip_ids.length;
  return `${n} clip${n === 1 ? "" : "s"} · ${job.clip_seconds}s each`;
}

/** A project in a list, as a library tile: thumbnail, length, source, title and status. */
export function ProjectTile({ job, onOpen }: { job: ImportJob; onOpen: () => void }) {
  const active = ACTIVE_STATUSES.has(job.status);
  return (
    <MediaTile
      title={projectTitle(job)}
      image={job.thumbnail_path}
      placeholder={active ? `${STEP_LABEL[job.status]}…` : undefined}
      topLeft={formatTime(job.duration_s)}
      topRight={job.status === "failed" ? "Failed" : SOURCE_LABEL[job.source]}
      subtitle={statusLine(job)}
      progress={active ? job.progress : null}
      onOpen={onOpen}
    />
  );
}

/**
 * A project's details in a popup (a bottom sheet on phones): live progress with the current step,
 * and actions: review in the inbox, open in editor and open in studio (done), retry (failed link), cancel
 * (running) and delete (with or without its clips). `children` sits under the progress, e.g. the
 * agent's live feed. Without onDelete / onRetry those actions are hidden.
 */
export function ProjectDialog({
  job,
  onClose,
  onDelete,
  onRetry,
  children,
}: {
  job: ImportJob;
  onClose: () => void;
  onDelete?: (job: ImportJob, withClips: boolean) => Promise<void>;
  onRetry?: (job: ImportJob) => Promise<void>;
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
    <DetailSheet
      label="Project"
      title={projectTitle(job)}
      onClose={onClose}
      media={
        <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-brand-deep shadow-glow">
          {job.thumbnail_path ? (
            // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host
            <img src={`${API_URL}/${job.thumbnail_path}`} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-on-brand/40">
              <Icon name="film" className="size-8" />
            </span>
          )}
          <span className="absolute top-2 left-2 rounded-full bg-brand-deep/85 px-2.5 py-0.5 text-fine font-semibold text-on-brand tabular-nums">{formatTime(job.duration_s)}</span>
          <span className="absolute top-2 right-2 rounded-full bg-brand-deep/85 px-2.5 py-0.5 text-fine font-semibold text-on-brand">{SOURCE_LABEL[job.source]}</span>
        </div>
      }
    >
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

          {job.status === "failed" && <p className="text-base text-danger">{friendly(job.error)}</p>}
          {job.status === "done" && job.error && <p className="text-base text-ink-muted">{friendly(job.error)}</p>}

          <p className="text-base text-ink-muted">
            {job.status === "done" ? `${clipCount} clip${clipCount === 1 ? "" : "s"} · ${job.clip_seconds}s each` : `${job.clip_count} × ${job.clip_seconds}s requested`}
          </p>

          {children}

          {confirming && onDelete ? (
            <div className="space-y-3 rounded-md border border-danger/30 bg-danger-subtle p-4">
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
            <div className="grid gap-2 border-t border-line pt-4 sm:flex sm:flex-wrap">
              {job.status === "done" && (
                <>
                  <Link href={`/studio/${job.id}`} className={buttonClass({ size: "sm" })}>
                    <Icon name="film" className="size-5" /> Open in studio
                  </Link>
                  <Link href={`/editor/open?import=${job.id}`} className={buttonClass({ variant: "secondary", size: "sm" })} aria-label="Open in the editor" title="Open in the editor">
                    <Icon name="scissors" className="size-5" /> Open in editor
                  </Link>
                  <Link href="/inbox" className={buttonClass({ variant: "ghost", size: "sm" })}>
                    <Icon name="inbox" className="size-5" /> Review clips
                  </Link>
                </>
              )}
              {job.status === "failed" && job.url && onRetry && (
                <Button variant="secondary" size="sm" loading={busy === "retry"} onClick={() => act("retry", () => onRetry(job))}>
                  <Icon name="refresh" className="size-5" /> Retry
                </Button>
              )}
              {onDelete && (
                <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                  <Icon name={active ? "x" : "trash"} className="size-5" /> {active ? "Cancel project" : "Delete project"}
                </Button>
              )}
            </div>
          )}
    </DetailSheet>
  );
}
