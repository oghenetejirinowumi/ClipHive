/** Shared types + helpers for import projects (backend app/schemas/import_job.py). */

export type Layout = "fill" | "blur";

export type ImportJob = {
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
  layout: Layout;
  status: "queued" | "downloading" | "analyzing" | "cutting" | "done" | "failed";
  progress: number;
  detail: string | null; // current step, e.g. "Fetching 5 clips in HD · 42%"
  error: string | null;
  created_at: string;
};

export type StudioClip = {
  id: number;
  title: string | null;
  start_s: number;
  end_s: number;
  status: string;
  file_path: string | null;
  clean_path: string | null;
  captioned: boolean;
  caption_style_id: number | null;
  layout: Layout;
  speed?: number;
  volume?: number;
  color_filter?: string;
  caption_position_y?: number | null;
  highlight_score: number | null;
  starred: boolean;
  transcript_json?: Array<{ word: string; start: number; end: number; confidence?: number }> | null;
  error: string | null; // e.g. why burning captions failed (the clean clip is still ready)
};

export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const FILTER_OPTIONS = [
  { value: "none", label: "Natural" },
  { value: "vibrant", label: "Vibrant" },
  { value: "warm", label: "Warm" },
  { value: "cool", label: "Cool" },
  { value: "dramatic", label: "Dramatic B&W" },
] as const;

export type Moment = { start_s: number; end_s: number; score: number; reason?: string | null };

export type PreviewState = { status: "none" | "fetching" | "ready" | "failed"; progress: number; error: string | null };

export type StudioProject = {
  job: ImportJob;
  /** Video to scrub: the upload, or a link's low-res preview once fetched (null until then). */
  source_path: string | null;
  preview: PreviewState;
  energy: number[];
  moments: Moment[];
  clips: StudioClip[];
};

export const SOURCE_LABEL: Record<ImportJob["source"], string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube", upload: "Upload" };

export const STEP_LABEL: Record<ImportJob["status"], string> = {
  queued: "Waiting for a worker",
  downloading: "Downloading",
  analyzing: "Agent is reviewing the moments",
  cutting: "Cutting and packaging clips",
  done: "Done",
  failed: "Failed",
};

export const LAYOUT_LABEL: Record<Layout, string> = { fill: "Fill", blur: "Blur" };

export const ACTIVE_STATUSES = new Set<ImportJob["status"]>(["queued", "downloading", "analyzing", "cutting"]);

export const projectTitle = (job: ImportJob) => job.title || job.original_filename || job.url || "Untitled project";

/** 83 → "1:23", 3723 → "1:02:03". */
export function formatTime(s: number | null | undefined, withTenths = false): string {
  if (s == null || Number.isNaN(s)) return "--:--";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secStr = withTenths ? sec.toFixed(1).padStart(4, "0") : String(Math.floor(sec)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${secStr}` : `${m}:${secStr}`;
}
