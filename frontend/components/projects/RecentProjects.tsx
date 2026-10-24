"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClass, Icon, Panel, StatusBadge } from "@/components/ui";
import { api, API_URL, friendly } from "@/lib/api";
import { ACTIVE_STATUSES, formatTime, projectTitle, SOURCE_LABEL, STEP_LABEL, type ImportJob } from "@/lib/imports";

/** The latest few imports as compact rows; each opens in the editor, shows its progress, or
 * explains why it failed with Retry / Delete. */
export function RecentProjects({ limit = 4 }: { limit?: number }) {
  const [jobs, setJobs] = useState<ImportJob[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<ImportJob[]>("/api/imports")
        .then((all) => {
          if (!alive) return;
          const shown = all.slice(0, limit);
          setJobs(shown);
          // Keep running projects' progress live.
          if (shown.some((j) => ACTIVE_STATUSES.has(j.status))) timer.current = setTimeout(load, 3000);
        })
        .catch(() => alive && setJobs((prev) => prev ?? []));
    load();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [limit, busy]);

  async function run(job: ImportJob, kind: "retry" | "delete") {
    setBusy(job.id);
    setActionError(null);
    try {
      if (kind === "retry") await api(`/api/imports/${job.id}/retry`, { method: "POST" });
      else await api(`/api/imports/${job.id}`, { method: "DELETE" });
    } catch {
      setActionError(kind === "retry" ? "Couldn't retry that project." : "Couldn't delete that project.");
    } finally {
      setConfirming(null);
      setBusy(null); // reloads the list
    }
  }

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
    <>
      {actionError && <p className="mb-3 text-base text-danger">{actionError}</p>}
      {/* Phones: a sideways row of cards. sm+: compact rows. */}
      <ul className="rail sm:divide-y sm:divide-line sm:border-y sm:border-line">
        {jobs.map((job) => {
          const active = ACTIVE_STATUSES.has(job.status);
          const failed = job.status === "failed";
          return (
            <li
              key={job.id}
              className="flex flex-col items-stretch gap-4 rounded-lg border border-line bg-surface p-4 shadow-glow sm:flex-row sm:items-center sm:gap-5 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0 sm:py-5 sm:shadow-none"
            >
              <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-md bg-brand-deep sm:w-44">
                {job.thumbnail_path && (
                  // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host
                  <img src={`${API_URL}/${job.thumbnail_path}`} alt="" className="size-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xl font-semibold tracking-tight text-ink">{projectTitle(job)}</p>
                <p className="mt-1 text-base text-ink-muted">
                  {SOURCE_LABEL[job.source]} · {formatTime(job.duration_s)} ·{" "}
                  {active ? job.detail || `${STEP_LABEL[job.status]} ${job.progress}%` : job.status === "done" ? `${job.clip_ids.length} clips` : "Failed"}
                </p>
                {failed && job.error && <p className="mt-1 text-base text-danger">{friendly(job.error)}</p>}
              </div>
              {job.status === "done" ? (
                <Link
                  href={`/editor/open?import=${job.id}`}
                  className={buttonClass({
                    variant: "secondary",
                    size: "sm",
                    className: "shrink-0",
                  })}
                >
                  <Icon name="scissors" className="size-5" /> <span className="hidden sm:inline">Open in editor</span>
                </Link>
              ) : failed ? (
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  {confirming === job.id ? (
                    <>
                      <Button variant="danger" size="sm" loading={busy === job.id} onClick={() => run(job, "delete")}>
                        Delete
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="secondary" size="sm" loading={busy === job.id} onClick={() => run(job, "retry")}>
                        Retry
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(job.id)} aria-label="Delete project">
                        <Icon name="x" className="size-5" />
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <StatusBadge status="processing" />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
