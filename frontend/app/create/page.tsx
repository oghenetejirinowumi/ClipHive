"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Badge, Button, buttonClass, Em, Icon, Notice, Panel, SectionLabel, Segmented, SkyHeader } from "@/components/ui";
import { api, ApiError, API_URL, apiUrl } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getToken } from "@/lib/session";

type ImportJob = {
  id: number;
  source: "twitch" | "kick" | "youtube" | "upload";
  url: string | null;
  original_filename: string | null;
  title: string | null;
  duration_s: number | null;
  thumbnail_path: string | null;
  clip_count: number;
  clip_seconds: number;
  clip_ids: number[];
  status: "queued" | "downloading" | "analyzing" | "cutting" | "done" | "failed";
  progress: number;
  error: string | null;
  created_at: string;
};

const SOURCE_LABEL: Record<ImportJob["source"], string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube", upload: "Upload" };

const STEP_LABEL: Record<ImportJob["status"], string> = {
  queued: "Waiting for a worker",
  downloading: "Downloading",
  analyzing: "Finding the best moments",
  cutting: "Cutting 9:16 clips",
  done: "Done",
  failed: "Failed",
};

// Mirrors backend services/ingest/sources.py, for instant feedback while typing.
function detect(url: string): "twitch" | "kick" | "youtube" | "instagram" | null {
  const host = url.trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase().replace(/^(www\.|m\.)/, "");
  if (/(^|\.)twitch\.tv$/.test(host)) return "twitch";
  if (/(^|\.)kick\.com$/.test(host)) return "kick";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "youtube";
  if (/(^|\.)(instagram\.com|instagr\.am)$/.test(host)) return "instagram";
  return null;
}

const formatTime = (s: number | null) => {
  if (!s) return "--:--";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
};

const ACTIVE = new Set<ImportJob["status"]>(["queued", "downloading", "analyzing", "cutting"]);

/** Upload with real progress (fetch can't report upload progress). */
function uploadWithProgress(file: File, clipCount: number, clipSeconds: number, onProgress: (f: number) => void): Promise<ImportJob> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("clip_count", String(clipCount));
    form.append("clip_seconds", String(clipSeconds));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/api/imports/upload"));
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { detail?: unknown } & Partial<ImportJob> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as ImportJob);
      else reject(new ApiError(xhr.status, typeof data.detail === "string" ? data.detail : "Upload failed."));
    };
    xhr.onerror = () => reject(new ApiError(0, "Couldn't reach the server. Is the backend running?"));
    xhr.send(form);
  });
}

export default function CreatePage() {
  const [url, setUrl] = useState("");
  const [clipCount, setClipCount] = useState<"3" | "5" | "8">("5");
  const [clipSeconds, setClipSeconds] = useState<"15" | "30" | "60">("30");
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const platform = detect(url);

  const load = useCallback(async () => {
    try {
      setJobs(await api<ImportJob[]>("/api/imports"));
    } catch {
      // Backend offline: keep what we have; the submit path shows the real error.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is still processing.
  const anyActive = jobs.some((j) => ACTIVE.has(j.status));
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  async function submitLink(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    if (platform === "instagram") {
      setError("Instagram links go in the IG downloader. This box takes Twitch, Kick and YouTube.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const job = await api<ImportJob>("/api/imports/link", {
        method: "POST",
        body: { url: url.trim(), clip_count: Number(clipCount), clip_seconds: Number(clipSeconds) },
      });
      setJobs((prev) => [job, ...prev]);
      setUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Is the backend running?");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFile(file: File) {
    setError(null);
    setUploadProgress(0);
    try {
      const job = await uploadWithProgress(file, Number(clipCount), Number(clipSeconds), setUploadProgress);
      setJobs((prev) => [job, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) submitFile(file);
  }

  const uploading = uploadProgress !== null;

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="New project"
        title={
          <>
            One link, <Em>many clips</Em>
          </>
        }
        description="Paste a Twitch, Kick or YouTube link, or upload a video from your camera roll. ClipHive finds the best moments and cuts each one to 9:16."
      />

      <Panel padding="lg" className="space-y-8">
        {/* 1. Link */}
        <form onSubmit={submitLink} className="space-y-3">
          <label htmlFor="source-url" className="block text-lg font-medium text-ink">
            Video link
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Icon name="link" className="pointer-events-none absolute top-1/2 left-5 size-6 -translate-y-1/2 text-ink-faint" />
              <input
                id="source-url"
                type="text"
                inputMode="url"
                autoComplete="off"
                placeholder="Paste a Twitch, Kick or YouTube link"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={cn("block h-16 w-full rounded-full border border-line-strong bg-surface pl-14 text-lg text-ink transition-[border-color,box-shadow] duration-(--motion-fast) placeholder:text-ink-faint hover:border-ink-faint focus:border-brand focus:shadow-ring focus-visible:outline-none", platform ? "pr-36" : "pr-6")}
              />
              {platform && (
                <span className="absolute top-1/2 right-4 -translate-y-1/2">
                  <Badge tone={platform === "instagram" ? "warning" : "brand"}>{platform === "instagram" ? "Instagram" : SOURCE_LABEL[platform]}</Badge>
                </span>
              )}
            </div>
            <Button type="submit" size="lg" loading={submitting} disabled={!url.trim() || uploading}>
              <Icon name="sparkles" />
              Get clips
            </Button>
          </div>
          {platform === "instagram" && (
            <p className="text-base text-ink-muted">
              Looks like Instagram.{" "}
              <Link href="/download" className="inline-flex min-h-11 items-center font-medium text-brand hover:text-brand-strong">
                Open the IG downloader
              </Link>
            </p>
          )}
        </form>

        <div className="flex items-center gap-4 text-lg text-ink-faint">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        {/* 2. Upload (on phones, accept="video/*" opens the camera roll) */}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors duration-(--motion-fast)",
            dragging ? "border-brand bg-brand-subtle" : "border-line-strong bg-surface-sunken hover:border-brand",
            uploading && "pointer-events-none",
          )}
        >
          <input ref={fileInput} type="file" accept="video/*" className="sr-only" disabled={uploading} onChange={(e) => e.target.files?.[0] && submitFile(e.target.files[0])} />
          {uploading ? (
            <>
              <p className="font-display text-2xl font-semibold tracking-tight text-ink">Uploading… {Math.round((uploadProgress ?? 0) * 100)}%</p>
              <div className="h-3 w-full max-w-md overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-brand transition-[width] duration-(--motion-fast)" style={{ width: `${(uploadProgress ?? 0) * 100}%` }} />
              </div>
            </>
          ) : (
            <>
              <span className="grid size-14 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                <Icon name="upload" />
              </span>
              <p className="font-display text-2xl font-semibold tracking-tight text-ink">Choose a video or drag it here</p>
              <p className="text-base text-ink-muted">MP4, MOV or WEBM · from your computer or camera roll · up to 1 GB</p>
            </>
          )}
        </label>

        {/* 3. Options */}
        <div className="flex flex-wrap items-end gap-x-10 gap-y-6 border-t border-line pt-8">
          <div className="space-y-2">
            <p className="text-lg font-medium text-ink">How many clips</p>
            <Segmented label="How many clips" value={clipCount} onChange={setClipCount} options={[{ value: "3", label: "3" }, { value: "5", label: "5" }, { value: "8", label: "8" }]} />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-medium text-ink">Clip length</p>
            <Segmented label="Clip length" value={clipSeconds} onChange={setClipSeconds} options={[{ value: "15", label: "15s" }, { value: "30", label: "30s" }, { value: "60", label: "60s" }]} />
          </div>
          <p className="max-w-md text-base text-ink-muted">We analyse the first 30 minutes. Live streams are clipped from the VOD once they end.</p>
        </div>

        {error && (
          <Notice tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}
      </Panel>

      {/* Projects */}
      <section className="space-y-6">
        <div className="flex items-center gap-4">
          <SectionLabel>Your projects</SectionLabel>
          <Badge tone="neutral" size="md">
            {jobs.length} total
          </Badge>
        </div>

        {jobs.length === 0 ? (
          <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-14 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-brand-subtle text-brand-strong">
              <Icon name="film" />
            </span>
            <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No projects yet</p>
            <p className="mt-2 text-lg text-ink-muted">Paste a link or drop a video above. Each project turns into a batch of clips.</p>
          </Panel>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <Panel padding="none" className="flex h-full flex-col overflow-hidden">
                  <div className="relative aspect-video bg-brand-deep">
                    {job.thumbnail_path ? (
                      // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host
                      <img src={`${API_URL}/${job.thumbnail_path}`} alt="" className="size-full object-cover" />
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
                    <p className="line-clamp-2 font-display text-xl leading-snug font-semibold tracking-tight text-ink">
                      {job.title || job.original_filename || job.url || "Untitled project"}
                    </p>

                    {ACTIVE.has(job.status) && (
                      <div className="space-y-2" aria-live="polite">
                        <div className="flex items-center justify-between text-base">
                          <span className="font-medium text-brand">{STEP_LABEL[job.status]}</span>
                          <span className="text-ink-muted tabular-nums">{job.progress}%</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
                          <div className="h-full rounded-full bg-brand transition-[width] duration-(--motion-base)" style={{ width: `${Math.max(4, job.progress)}%` }} />
                        </div>
                      </div>
                    )}

                    {job.status === "failed" && <p className="text-base text-danger">{job.error || "This project failed."}</p>}

                    <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
                      <span className="text-base text-ink-muted">
                        {job.status === "done"
                          ? `${job.clip_ids.length} clip${job.clip_ids.length === 1 ? "" : "s"} · ${job.clip_seconds}s each`
                          : `${job.clip_count} × ${job.clip_seconds}s requested`}
                      </span>
                      {job.status === "done" && (
                        <Link href="/hub" className={buttonClass({ variant: "secondary", size: "sm" })}>
                          Open in hub <Icon name="arrowRight" className="size-5" />
                        </Link>
                      )}
                    </div>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
