"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StarButton } from "@/components/projects/StarButton";
import { Badge, Button, buttonClass, Em, Icon, Notice, Panel, SectionLabel, SkyHeader, StatusBadge } from "@/components/ui";
import { api, API_URL, ApiError } from "@/lib/api";
import { formatSlot, PLATFORM_LABEL, tzOffsetMinutes, type ScheduledPost } from "@/lib/agents";

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
  } | null;
  status: string;
  starred?: boolean;
  review_status: "pending" | "approved" | "rejected";
  created_at: string;
};

const mediaUrl = (path: string | null | undefined) => (path ? `${API_URL}/${path}` : null);

export default function HubPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [busy, setBusy] = useState<number | string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "brand" | "danger"; text: string } | null>(null);

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
  const dueNow = upcoming.filter((p) => p.status === "ready").length;

  return (
    <div className="space-y-12">
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
          <ul className="divide-y divide-line border-y border-line">
            {upcoming.map((p) => {
              const file = mediaUrl(p.clip_file_path);
              const burning = p.clip_status === "captioning" || p.clip_status === "processing";
              return (
                <li key={p.id} className="flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:justify-between">
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
                  <div className="flex shrink-0 flex-wrap gap-2">
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
        <div className="flex flex-wrap items-center gap-4">
          <SectionLabel>Your clips</SectionLabel>
          <Badge tone="neutral" size="md">
            {clips.length} total · {clips.filter((c) => c.status === "ready").length} captioned
          </Badge>
        </div>
      )}

      <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
        {clips.map((clip) => {
          const videoSrc = mediaUrl(clip.file_path);
          const why = clip.context_json?.agent_reason || clip.context_json?.highlight_reason;
          const clipPosts = (postsByClip.get(clip.id) ?? []).filter((p) => p.status !== "failed");
          return (
            <Panel key={clip.id} as="article" padding="none" className="flex flex-col overflow-hidden">
              <div className="relative aspect-[9/16] w-full bg-brand-deep">
                {videoSrc && <video src={videoSrc} controls playsInline preload="metadata" className="size-full object-cover" />}
                <StarButton clipId={clip.id} starred={Boolean(clip.starred)} className="absolute top-3 right-3" />
                {clip.highlight_score ? (
                  <span className="absolute top-4 left-4 rounded-full bg-brand-deep/80 px-3 py-1 text-meta font-semibold text-on-brand tabular-nums">
                    Hook {Math.round(clip.highlight_score)}/100
                  </span>
                ) : null}
              </div>

              <div className="flex flex-1 flex-col gap-5 p-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-meta tracking-[0.12em] text-ink-muted uppercase">Clip #{clip.id}</span>
                    {clip.context_json?.game_or_topic && (
                      <Badge tone="brand" size="sm">
                        {clip.context_json.game_or_topic}
                      </Badge>
                    )}
                  </div>
                  <StatusBadge status={clip.review_status === "pending" ? "pending" : clip.status} />
                </div>

                <div className="flex-1">
                  <h3 className="font-display text-2xl leading-snug font-semibold tracking-tight text-ink">{clip.title || "Untitled clip"}</h3>
                  {why && (
                    <p className="mt-3 flex gap-2 text-base text-ink-muted">
                      <Icon name="bot" className="mt-0.5 size-5 shrink-0 text-brand" />
                      {why}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(clip.hashtags ?? []).map((tag) => (
                      <Badge key={tag} tone="brand">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                {clipPosts.length > 0 && (
                  <ul className="space-y-1 text-base text-ink-muted">
                    {clipPosts.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <Icon name={p.status === "posted" ? "check" : "clock"} className="size-5 shrink-0" />
                        {PLATFORM_LABEL[p.platform]} · {p.status === "posted" ? "posted" : formatSlot(p.scheduled_for)}
                      </li>
                    ))}
                  </ul>
                )}

                <Link href={`/studio?clip=${clip.id}`} className={buttonClass({ variant: "ghost", size: "sm", className: "justify-start px-0" })}>
                  <Icon name="film" className="size-5" /> Edit in studio
                </Link>

                <div className="grid grid-cols-2 gap-3 border-t border-line pt-6">
                  {videoSrc ? (
                    <a href={videoSrc} download={`clip_${clip.id}.mp4`} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                      <Icon name="download" className="size-5" />
                      Download
                    </a>
                  ) : (
                    <span />
                  )}
                  {clipPosts.some((p) => p.status === "queued" || p.status === "ready") ? (
                    <span className={buttonClass({ variant: "ghost", size: "sm", className: "pointer-events-none" })}>
                      <Icon name="clock" className="size-5" /> Scheduled
                    </span>
                  ) : (
                    <Button size="sm" loading={busy === clip.id} onClick={() => schedule(clip)}>
                      <Icon name="send" className="size-5" />
                      Schedule
                    </Button>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

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
    </div>
  );
}
