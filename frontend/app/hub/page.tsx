"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ThumbnailEditor, type Thumbnail } from "@/components/hub/ThumbnailEditor";
import { ClipDialog, ClipDialogActions, ClipShelves, ClipTile, ClipToolbar, matchesQuery, shelvesBy } from "@/components/clips";
import { StarButton } from "@/components/projects/StarButton";
import { Badge, Button, buttonClass, Em, Icon, Notice, Panel, SectionLabel, SkyHeader, StatusBadge } from "@/components/ui";
import { api, API_URL, ApiError } from "@/lib/api";
import { formatSlot, PLATFORM_LABEL, tzOffsetMinutes, type ScheduledPost } from "@/lib/agents";
import { usePersistentState } from "@/lib/usePersistentState";

type Clip = {
  id: number;
  title?: string | null;
  file_path?: string | null;
  duration_s: number;
  highlight_score?: number | null;
  hashtags?: string[];
  context_json?: {
    game_or_topic?: string;
    summary?: string;
    event_type?: string;
    agent_reason?: string;
    highlight_reason?: string;
    thumbnail?: Thumbnail;
  } | null;
  transcript_json?: Array<{ word: string; start: number; end: number }> | null;
  status: string;
  starred?: boolean;
  review_status: "pending" | "approved" | "rejected";
  created_at: string;
};

type GroupBy = "status" | "topic" | "all";
const GROUP_OPTIONS = [
  { value: "status" as const, label: "Status" },
  { value: "topic" as const, label: "Topic" },
  { value: "all" as const, label: "All" },
];
const STATUS_ORDER = ["Starred", "Ready to post", "Scheduled", "To review", "Not captioned", "Burning captions", "Posted", "Failed"];

/** Where a clip stands, for the library's status shelves. */
function statusOf(clip: Clip, posts: ScheduledPost[]): string {
  if (posts.some((p) => p.status === "queued" || p.status === "ready" || p.status === "posting")) return "Scheduled";
  if (posts.some((p) => p.status === "posted")) return "Posted";
  if (clip.review_status === "pending") return "To review";
  if (clip.status === "failed") return "Failed";
  if (clip.status === "captioning") return "Burning captions";
  if (clip.starred) return "Starred";
  return clip.status === "ready" ? "Ready to post" : "Not captioned";
}

const mediaUrl = (path: string | null | undefined) => (path ? `${API_URL}/${path}` : null);

export default function HubPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [busy, setBusy] = useState<number | string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "brand" | "danger"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = usePersistentState<GroupBy>("ch_hub_group", "status");

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api<Clip[]>("/api/clips", { auth: false }), api<ScheduledPost[]>("/api/posts")]);
      setClips(c.filter((x) => x.review_status !== "rejected"));
      setPosts(p);
    } catch (err) {
      console.warn("Could not load the hub:", err);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // captions finish burning and posts come due in the background
    return () => clearInterval(t);
  }, [load]);

  async function schedule(clip: Clip) {
    setBusy(clip.id);
    try {
      const created = await api<ScheduledPost[]>(`/api/inbox/${clip.id}/approve`, { method: "POST", body: { tz_offset_minutes: tzOffsetMinutes() } });
      setMessage({ tone: "success", text: `Scheduled: ${created.map((p) => `${PLATFORM_LABEL[p.platform]} ${formatSlot(p.scheduled_for)}`).join(", ")}.` });
      load();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't schedule that clip." });
    } finally {
      setBusy(null);
    }
  }

  async function markPosted(post: ScheduledPost) {
    setBusy(`post-${post.id}`);
    try {
      await api(`/api/posts/${post.id}/mark-posted`, { method: "POST" });
      load();
    } finally {
      setBusy(null);
    }
  }

  async function cancel(post: ScheduledPost) {
    setBusy(`post-${post.id}`);
    try {
      await api(`/api/posts/${post.id}`, { method: "DELETE" });
      load();
    } finally {
      setBusy(null);
    }
  }

  async function copyCaption(post: ScheduledPost) {
    try {
      await navigator.clipboard.writeText(post.caption_text ?? "");
      setMessage({ tone: "brand", text: `Caption copied for ${PLATFORM_LABEL[post.platform]}.` });
    } catch {
      setMessage({ tone: "danger", text: "Couldn't copy. Select the caption text instead." });
    }
  }

  const upcoming = posts.filter((p) => p.status === "queued" || p.status === "ready");
  const postsByClip = new Map<number, ScheduledPost[]>();
  posts.forEach((p) => postsByClip.set(p.clip_id, [...(postsByClip.get(p.clip_id) ?? []), p]));

  // Search, then split into shelves; the popup's prev / next follow the order shown.
  const shelves = useMemo(() => {
    const byClip = new Map<number, ScheduledPost[]>();
    posts.forEach((p) => byClip.set(p.clip_id, [...(byClip.get(p.clip_id) ?? []), p]));
    const found = clips.filter((c) => matchesQuery(c, query));
    if (groupBy === "all") return found.length ? [{ key: "all", label: "All clips", items: found }] : [];
    if (groupBy === "topic") return shelvesBy(found, (c) => c.context_json?.game_or_topic, "Other topics");
    return shelvesBy(found, (c) => statusOf(c, byClip.get(c.id) ?? []), "Other", STATUS_ORDER);
  }, [clips, posts, query, groupBy]);
  const ordered = shelves.flatMap((sh) => sh.items);
  const dueNow = upcoming.filter((p) => p.status === "ready").length;
  // Tracked by id, so the 15s refresh never changes which clip is open.
  const openIndex = ordered.findIndex((c) => c.id === openId);
  const open = openIndex >= 0 ? ordered[openIndex] : (clips.find((c) => c.id === openId) ?? null);

  return (
    <div className="space-y-10 sm:space-y-12">
      <SkyHeader
        eyebrow="Distribution hub"
        title={
          <>
            Ready to <Em>post</Em>
          </>
        }
        description="The Publisher agent schedules every clip you approve. When a slot comes up, download the clip, copy its caption and post it."
      />

      {message && (
        <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      {/* Posting schedule */}
      <section className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <SectionLabel>Posting schedule</SectionLabel>
          <Badge tone={dueNow ? "success" : "neutral"} size="md">
            {upcoming.length} upcoming{dueNow ? ` · ${dueNow} due now` : ""}
          </Badge>
        </div>
        {upcoming.length === 0 ? (
          <Panel tone="sunken" padding="md" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-lg text-ink-muted">Nothing scheduled. Approve clips in your inbox and the Publisher picks the slots.</p>
            <Link href="/inbox" className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}>
              <Icon name="inbox" className="size-5" /> Open inbox
            </Link>
          </Panel>
        ) : (
          <ul className="rail rail-wide sm:divide-y sm:divide-line sm:border-y sm:border-line">
            {upcoming.map((p) => {
              const file = mediaUrl(p.clip_file_path);
              const burning = p.clip_status === "captioning" || p.clip_status === "processing";
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 shadow-glow sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0 sm:py-5 sm:shadow-none lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-display text-xl font-semibold tracking-tight text-ink tabular-nums">{formatSlot(p.scheduled_for)}</span>
                      <Badge tone="brand" size="sm">
                        {PLATFORM_LABEL[p.platform]}
                      </Badge>
                      <StatusBadge status={p.status} label={p.status === "ready" ? "Time to post" : undefined} />
                      {burning && <StatusBadge status="captioning" label="Burning captions" />}
                    </div>
                    <p className="mt-1 truncate text-lg text-ink">{p.clip_title}</p>
                    {p.schedule_reason && <p className="text-base text-ink-muted">{p.schedule_reason}</p>}
                  </div>
                  <div className="mt-auto flex shrink-0 flex-wrap gap-2 lg:mt-0">
                    {file && (
                      <a href={file} download target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                        <Icon name="download" className="size-5" /> Download
                      </a>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => copyCaption(p)}>
                      <Icon name="copy" className="size-5" /> Caption
                    </Button>
                    <Button size="sm" loading={busy === `post-${p.id}`} onClick={() => markPosted(p)}>
                      <Icon name="check" className="size-5" /> Posted
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => cancel(p)} aria-label="Unschedule">
                      <Icon name="x" className="size-5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {clips.length > 0 && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center gap-4">
            <SectionLabel>Your clips</SectionLabel>
            <Badge tone="neutral" size="md">
              {clips.length} total · {clips.filter((c) => c.status === "ready").length} captioned
            </Badge>
          </div>
          <ClipToolbar query={query} onQuery={setQuery} groupBy={groupBy} onGroupBy={setGroupBy} groupOptions={GROUP_OPTIONS} />
          <ClipShelves
            shelves={shelves}
            query={query}
            onClearQuery={() => setQuery("")}
            renderTile={(clip) => (
              <ClipTile
                title={clip.title}
                filePath={clip.file_path}
                durationS={clip.duration_s}
                label={tileLabel(clip, postsByClip.get(clip.id) ?? [])}
                onOpen={() => setOpenId(clip.id)}
              />
            )}
          />
        </section>
      )}

      {clips.length === 0 && (
        <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-16 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-brand-subtle text-brand-strong">
            <Icon name="grid" />
          </span>
          <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No clips yet</p>
          <p className="mt-2 max-w-xl text-lg text-ink-muted">Start a project or add your channel, and the agents will fill this up.</p>
          <Button href="/create" className="mt-8">
            Start a project <Icon name="arrowRight" className="size-5" />
          </Button>
        </Panel>
      )}

      {open && (
        <HubClipDialog
          clip={open}
          posts={(postsByClip.get(open.id) ?? []).filter((p) => p.status !== "failed")}
          position={Math.max(openIndex, 0) + 1}
          total={ordered.length || clips.length}
          busy={busy === open.id}
          onPrev={openIndex > 0 ? () => setOpenId(ordered[openIndex - 1].id) : undefined}
          onNext={openIndex >= 0 && openIndex < ordered.length - 1 ? () => setOpenId(ordered[openIndex + 1].id) : undefined}
          onClose={() => setOpenId(null)}
          onSchedule={() => schedule(open)}
          onStar={(starred) => setClips((prev) => prev.map((c) => (c.id === open.id ? { ...c, starred } : c)))}
          onClip={(updated) => setClips((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))}
        />
      )}
    </div>
  );
}

/** The tile's corner label: where the clip stands. */
function tileLabel(clip: Clip, posts: ScheduledPost[]): React.ReactNode {
  const star = clip.starred ? <Icon name="star" aria-hidden className="size-3.5" fill="currentColor" /> : null;
  let text: string;
  if (posts.some((p) => p.status === "posted")) text = "Posted";
  else if (posts.some((p) => p.status === "queued" || p.status === "ready")) text = "Scheduled";
  else if (clip.review_status === "pending") text = "To review";
  else text = clip.status === "ready" ? "Ready" : clip.status;
  return (
    <>
      {star}
      {text}
    </>
  );
}

/** One clip's popup: why it was picked, its tags and posts, and download / schedule / edit. */
function HubClipDialog({
  clip,
  posts,
  position,
  total,
  busy,
  onPrev,
  onNext,
  onClose,
  onSchedule,
  onStar,
  onClip,
}: {
  clip: Clip;
  posts: ScheduledPost[];
  position: number;
  total: number;
  busy: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onSchedule: () => void;
  onStar: (starred: boolean) => void;
  /** The clip changed on the server (a new thumbnail). */
  onClip: (updated: Clip) => void;
}) {
  const videoSrc = mediaUrl(clip.file_path);
  const why = clip.context_json?.agent_reason || clip.context_json?.highlight_reason;
  const scheduled = posts.some((p) => p.status === "queued" || p.status === "ready");

  return (
    <ClipDialog title={clip.title} filePath={clip.file_path} position={position} total={total} onPrev={onPrev} onNext={onNext} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="line-clamp-3 font-display text-2xl leading-snug font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">{clip.title || "Untitled clip"}</h2>
          <p className="mt-1 truncate text-base text-ink-muted tabular-nums">
            Clip #{clip.id} · {Math.round(clip.duration_s)}s
            {clip.highlight_score ? ` · Hook ${Math.round(clip.highlight_score)}/100` : ""}
          </p>
        </div>
        <StarButton key={clip.id} clipId={clip.id} starred={Boolean(clip.starred)} onChange={(r) => onStar(r.starred)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={clip.review_status === "pending" ? "pending" : clip.status} />
        {clip.context_json?.game_or_topic && (
          <Badge tone="brand" size="sm">
            {clip.context_json.game_or_topic}
          </Badge>
        )}
      </div>

      {why && (
        <p className="flex gap-2 rounded-md bg-brand-subtle px-4 py-3 text-base text-brand-strong">
          <Icon name="bot" className="mt-0.5 size-5 shrink-0" />
          <span>
            <span className="font-semibold">Why: </span>
            {why}
          </span>
        </p>
      )}

      {clip.context_json?.summary && <p className="text-base text-ink-muted">{clip.context_json.summary}</p>}

      {(clip.hashtags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(clip.hashtags ?? []).map((tag) => (
            <Badge key={tag} tone="brand" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {posts.length > 0 && (
        <div className="space-y-2">
          <p className="text-base font-medium text-ink">Posts</p>
          <ul className="space-y-1 text-base text-ink-muted">
            {posts.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <Icon name={p.status === "posted" ? "check" : "clock"} className="size-5 shrink-0" />
                {PLATFORM_LABEL[p.platform]} · {p.status === "posted" ? "posted" : formatSlot(p.scheduled_for)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Spoken Transcript */}
      <div className="space-y-2 rounded-lg border border-line bg-surface-sunken p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
            <Icon name="captions" className="size-5 text-brand" /> Spoken Dialogue
          </p>
          <Link href={`/captions?clip=${clip.id}`} className={buttonClass({ variant: "ghost", size: "xs" })}>
            <Icon name="sparkles" className="size-5" /> Style & Burn
          </Link>
        </div>
        <p className="text-base text-ink leading-relaxed font-normal">
          {clip.transcript_json && clip.transcript_json.length > 0
            ? `“${clip.transcript_json.map((w) => w.word).join(" ")}”`
            : "No speech saved yet. Open in Caption Studio to auto-transcribe with Whisper."}
        </p>
      </div>

      <ThumbnailEditor<Clip>
        key={`${clip.id}:${clip.context_json?.thumbnail?.path ?? "none"}`}
        clipId={clip.id}
        thumbnail={clip.context_json?.thumbnail}
        onClip={onClip}
      />

      <ClipDialogActions>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2">
          {scheduled ? (
            <span className={buttonClass({ variant: "secondary", size: "sm", className: "pointer-events-none" })}>
              <Icon name="clock" className="size-5" /> Scheduled
            </span>
          ) : (
            <Button size="sm" loading={busy} onClick={onSchedule}>
              <Icon name="send" className="size-5" /> Schedule
            </Button>
          )}
          <Link href={`/captions?clip=${clip.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
            <Icon name="captions" className="size-5" /> Captions
          </Link>
          {videoSrc ? (
            <a href={videoSrc} download={`clip_${clip.id}.mp4`} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
              <Icon name="download" className="size-5" /> Download
            </a>
          ) : (
            <span />
          )}
          <Link href={`/editor?clip=${clip.id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
            <Icon name="film" className="size-5" /> Edit
          </Link>
        </div>
        <p className="mt-3 hidden text-meta text-ink-faint lg:block">
          <kbd className="font-mono font-semibold text-ink-muted">J</kbd>/<kbd className="font-mono font-semibold text-ink-muted">K</kbd> move ·{" "}
          <kbd className="font-mono font-semibold text-ink-muted">Esc</kbd> close
        </p>
      </ClipDialogActions>
    </ClipDialog>
  );
}
