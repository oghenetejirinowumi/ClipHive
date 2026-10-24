"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { AgentFeed } from "@/components/agents/AgentFeed";
import { CommandBar } from "@/components/agents/CommandBar";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Badge, Button, Em, Icon, Notice, Panel, SectionLabel, Segmented, SkyHeader } from "@/components/ui";
import { api, ApiError, apiUrl, GENERIC_ERROR, userMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ACTIVE_STATUSES as ACTIVE, SOURCE_LABEL, type ImportJob, type Layout } from "@/lib/imports";
import { getToken } from "@/lib/session";
import { shrinkForUpload } from "@/lib/shrinkVideo";

// Mirrors backend services/ingest/sources.py, for instant feedback while typing.
function detect(url: string): "twitch" | "kick" | "youtube" | "instagram" | null {
  const host = url
    .trim()
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .toLowerCase()
    .replace(/^(www\.|m\.)/, "");
  if (/(^|\.)twitch\.tv$/.test(host)) return "twitch";
  if (/(^|\.)kick\.com$/.test(host)) return "kick";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "youtube";
  if (/(^|\.)(instagram\.com|instagr\.am)$/.test(host)) return "instagram";
  return null;
}

/** Upload with real progress (fetch can't report upload progress). */
function uploadWithProgress(file: File, clipCount: number, clipSeconds: number, layout: Layout, onProgress: (f: number) => void): Promise<ImportJob> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("clip_count", String(clipCount));
    form.append("clip_seconds", String(clipSeconds));
    form.append("layout", layout);
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
      else reject(new ApiError(xhr.status, userMessage(xhr.status, typeof data.detail === "string" ? data.detail : null)));
    };
    xhr.onerror = () => reject(new ApiError(0, GENERIC_ERROR));
    xhr.send(form);
  });
}

export default function CreatePage() {
  const [url, setUrl] = useState("");
  const [clipCount, setClipCount] = useState<"3" | "5" | "10" | "20">("5");
  const [clipSeconds, setClipSeconds] = useState<"15" | "30" | "60">("30");
  const [layout, setLayout] = useState<Layout>("blur");
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  // Shrinking a big phone video to 1080p before it goes up (null when not doing it).
  const [preparing, setPreparing] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const platform = detect(url);

  const load = useCallback(async () => {
    try {
      setJobs(await api<ImportJob[]>("/api/imports"));
    } catch {
      // Offline for a moment: keep what we have; the submit path shows the error.
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
      setError("Instagram links aren't supported. This box takes Twitch, Kick and YouTube.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const job = await api<ImportJob>("/api/imports/link", {
        method: "POST",
        body: {
          url: url.trim(),
          clip_count: Number(clipCount),
          clip_seconds: Number(clipSeconds),
          layout,
        },
      });
      setJobs((prev) => [job, ...prev]);
      setUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteProject(job: ImportJob, withClips: boolean) {
    try {
      await api(`/api/imports/${job.id}${withClips ? "?clips=true" : ""}`, {
        method: "DELETE",
      });
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that project.");
    }
  }

  async function retryProject(job: ImportJob) {
    try {
      // Re-runs in place, reusing whatever the failed attempt already downloaded.
      const fresh = await api<ImportJob>(`/api/imports/${job.id}/retry`, {
        method: "POST",
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? fresh : j)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't retry that project.");
    }
  }

  async function submitFile(original: File) {
    setError(null);
    setPreparing(0);
    setUploadProgress(0);
    try {
      // 4K phone video is shrunk to 1080p on the device first: a fraction of the upload, and
      // much faster for the server to cut. Falls back to the original when it can't.
      const file = await shrinkForUpload(original, setPreparing);
      setPreparing(null);
      const job = await uploadWithProgress(file, Number(clipCount), Number(clipSeconds), layout, setUploadProgress);
      setJobs((prev) => [job, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setPreparing(null);
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
        <form onSubmit={submitLink} className="space-y-3" data-tour="create-link">
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
                className={cn(
                  "block h-16 w-full rounded-full border border-line-strong bg-surface pl-14 text-lg text-ink transition-[border-color,box-shadow] duration-(--motion-fast) placeholder:text-ink-faint hover:border-ink-faint focus:border-brand focus:shadow-ring focus-visible:outline-none",
                  platform ? "pr-36" : "pr-6",
                )}
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
            <p className="text-base text-ink-muted">Looks like Instagram. Only Twitch, Kick and YouTube links can be turned into clips.</p>
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
          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => e.target.files?.[0] && submitFile(e.target.files[0])}
          />
          {uploading ? (
            <>
              <p className="font-display text-2xl font-semibold tracking-tight text-ink">
                {preparing !== null ? `Preparing video… ${Math.round(preparing * 100)}%` : `Uploading… ${Math.round((uploadProgress ?? 0) * 100)}%`}
              </p>
              <div className="h-3 w-full max-w-md overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-(--motion-fast)"
                  style={{ width: `${(preparing ?? uploadProgress ?? 0) * 100}%` }}
                />
              </div>
              {preparing !== null && <p className="text-base text-ink-muted">Shrinking it to 1080p so it uploads faster.</p>}
            </>
          ) : (
            <>
              <span className="grid size-14 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                <Icon name="upload" />
              </span>
              <p className="font-display text-2xl font-semibold tracking-tight text-ink">Choose a video or drag it here</p>
              <p className="text-base text-ink-muted">MP4, MOV or WEBM · from your computer or camera roll · up to 8 GB</p>
            </>
          )}
        </label>

        {/* 3. Options */}
        <div className="flex flex-wrap items-end gap-x-10 gap-y-6 border-t border-line pt-8">
          <div className="space-y-2">
            <p className="text-lg font-medium text-ink">How many clips</p>
            <Segmented label="How many clips" value={clipCount} onChange={setClipCount} options={[{ value: "3", label: "3" }, { value: "5", label: "5" }, { value: "10", label: "10" }, { value: "20", label: "20" }]} />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-medium text-ink">Clip length</p>
            <Segmented
              label="Clip length"
              value={clipSeconds}
              onChange={setClipSeconds}
              options={[
                { value: "15", label: "15s" },
                { value: "30", label: "30s" },
                { value: "60", label: "60s" },
              ]}
            />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-medium text-ink">Layout</p>
            <Segmented
              label="Layout"
              value={layout}
              onChange={setLayout}
              options={[
                { value: "blur", label: "Blur" },
                { value: "fill", label: "Fill" },
              ]}
            />
          </div>
          <p className="max-w-md text-base text-ink-muted">
            {layout === "fill" ? "Fill zooms in so the frame covers the screen." : "Blur keeps the whole frame, with a blurred copy above and below."} We analyse the whole video, however
            long. To clip a stream while it&apos;s live, add the channel on the Streamers page.
          </p>
        </div>

        {error && (
          <Notice tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}
      </Panel>

      <Panel padding="lg" className="space-y-5">
        <div>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">Or just tell the agents</h2>
          <p className="mt-2 text-lg text-ink-muted">Say what you want in your own words. The agents find your latest stream and plan the clips; you confirm before anything runs.</p>
        </div>
        <div data-tour="create-command">
          <CommandBar onStarted={(job) => setJobs((prev) => [job, ...prev])} />
        </div>
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
                <ProjectCard job={job} onDelete={deleteProject} onRetry={retryProject}>
                  {(job.status === "analyzing" || job.status === "cutting") && <AgentFeed importJobId={job.id} compact />}
                  {job.status === "done" && <WhyTheseClips jobId={job.id} />}
                </ProjectCard>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Finished projects keep the agent's reasoning one click away. */
function WhyTheseClips({ jobId }: { jobId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-2 text-base font-medium text-brand hover:text-brand-strong"
      >
        <Icon name="bot" className="size-5" />
        {open ? "Hide the agent's decisions" : "Why these clips?"}
      </button>
      {open && <AgentFeed importJobId={jobId} compact className="mt-3" />}
    </div>
  );
}
