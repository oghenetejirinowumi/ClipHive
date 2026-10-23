/** Types + helpers for the agents API (backend app/api/agents.py and app/api/inbox.py). */

export type AgentKind = "scout" | "producer" | "publisher" | "command";

export type AgentRun = {
  id: number;
  kind: AgentKind;
  import_job_id: number | null;
  status: "running" | "done" | "failed";
  goal: string | null;
  summary: string | null;
  model: string | null;
  started_at: string;
  finished_at: string | null;
};

export type AgentEventType = "thought" | "tool_call" | "decision" | "error" | "done";

export type AgentEvent = {
  id: number;
  run_id: number;
  seq: number;
  type: AgentEventType;
  title: string;
  detail: { verdict?: "kept" | "rejected"; [key: string]: unknown } | null;
  created_at: string;
};

export type AppNotification = {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export type Profile = { summary: string; feedback_count: number; updated_at: string | null };

export type AgentStats = {
  producer_runs: number;
  clips_kept: number;
  moments_rejected: number;
  awaiting_review: number;
  posts_scheduled: number;
  channels_watched: number;
};

export type InboxClip = {
  id: number;
  title: string | null;
  hashtags: string[];
  file_path: string | null;
  duration_s: number;
  start_s: number;
  end_s: number;
  status: string;
  review_status: "pending" | "approved" | "rejected";
  highlight_score: number | null;
  caption_style_id: number | null;
  context_json: { game_or_topic?: string; suggested_style?: string; style_rationale?: string; summary?: string } | null;
  created_at: string;
  reason: string | null;
  source_title: string | null;
  import_job_id: number | null;
};

export type PostPlatform = "tiktok" | "youtube" | "instagram" | "x";

export type ScheduledPost = {
  id: number;
  clip_id: number;
  platform: PostPlatform;
  status: "queued" | "ready" | "posting" | "posted" | "failed";
  scheduled_for: string | null;
  caption_text: string | null;
  schedule_reason: string | null;
  posted_at: string | null;
  created_at: string;
  clip_title: string | null;
  clip_file_path: string | null;
  clip_status: string | null;
};

export type CommandPlan = {
  text: string;
  url: string | null;
  source_title: string | null;
  streamer: string | null;
  clip_count: number;
  clip_seconds: number;
  mood: string | null;
  platform: string;
  style: string | null;
  layout: "fill" | "blur";
  summary: string;
  error: string | null;
};

export const AGENT_LABEL: Record<AgentKind, string> = {
  scout: "Scout",
  producer: "Producer",
  publisher: "Publisher",
  command: "Planner",
};

export const AGENT_ROLE: Record<AgentKind, string> = {
  scout: "Watches your channels for new VODs",
  producer: "Picks, cuts and packages moments",
  publisher: "Captions and schedules approved clips",
  command: "Turns your request into a plan",
};

export const PLATFORM_LABEL: Record<PostPlatform, string> = {
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
  instagram: "Instagram Reels",
  x: "X",
};

/** Minutes east of UTC for this browser (Lagos = 60), as the Publisher expects. */
export const tzOffsetMinutes = () => -new Date().getTimezoneOffset();

/** "Fri 24 Oct, 19:00" in the viewer's local time. */
export function formatSlot(iso: string | null): string {
  if (!iso) return "Not scheduled";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "just now", "5 min ago", "3 h ago", or a date. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
