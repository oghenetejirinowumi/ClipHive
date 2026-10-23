"use client";

import { useEffect, useState } from "react";
import { Button, Icon, Panel, Segmented } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { ACTIVE_STATUSES, type ImportJob } from "@/lib/imports";

const COUNTS = ["3", "5", "10"] as const;
const LENGTHS = ["15", "30", "60"] as const;

type Taste = { starred: number; learning: boolean };

/**
 * Ask a finished project for another batch. The backend skips every moment the project's clips
 * already cover, so each new clip is different, and leans toward the kind of moments starred.
 */
export function MoreClips({ job, onFinished }: { job: ImportJob; onFinished: (added: number, job: ImportJob) => void }) {
  const [count, setCount] = useState<(typeof COUNTS)[number]>("5");
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(
    (LENGTHS.find((l) => Number(l) === job.clip_seconds) ?? "30") as (typeof LENGTHS)[number],
  );
  const [running, setRunning] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taste, setTaste] = useState<Taste | null>(null);

  useEffect(() => {
    api<Taste>("/api/studio/taste").then(setTaste).catch(() => {});
  }, []);

  // Follow the batch until the project is done again.
  useEffect(() => {
    if (!running) return;
    const before = job.clip_ids.length;
    const t = setInterval(async () => {
      try {
        const now = await api<ImportJob>(`/api/imports/${job.id}`);
        if (ACTIVE_STATUSES.has(now.status)) return setRunning(now);
        clearInterval(t);
        setRunning(null);
        if (now.status === "failed" || (now.error && now.clip_ids.length === before)) setError(now.error || "Couldn't find more clips.");
        onFinished(now.clip_ids.length - before, now);
      } catch {
        /* keep polling through a blip */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [running, job.id, job.clip_ids.length, onFinished]);

  async function start() {
    setError(null);
    try {
      setRunning(await api<ImportJob>(`/api/imports/${job.id}/more`, { method: "POST", body: { count: Number(count), clip_seconds: Number(length) } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start a new batch.");
    }
  }

  return (
    <Panel tone="sunken" padding="md" className="space-y-5">
      <div className="min-w-0 space-y-1">
        <p className="font-display text-2xl font-semibold tracking-tight text-ink">Generate more clips</p>
        <p className="text-lg text-ink-muted" aria-live="polite">
          {running
            ? `${running.detail || "Working"}…`
            : error
              ? error
              : taste?.learning
                ? `New moments only, leaning toward the ${taste.starred} clip${taste.starred === 1 ? "" : "s"} you starred.`
                : "New moments only, never one you already have. Star clips you love and the next picks lean that way."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="How many" value={count} onChange={setCount} options={COUNTS.map((c) => ({ value: c, label: `${c} clips` }))} />
        <Segmented label="Clip length" value={length} onChange={setLength} options={LENGTHS.map((l) => ({ value: l, label: `${l}s` }))} />
        <Button loading={Boolean(running)} disabled={Boolean(running)} onClick={start}>
          <Icon name="sparkles" className="size-5" /> Generate
        </Button>
      </div>
    </Panel>
  );
}
