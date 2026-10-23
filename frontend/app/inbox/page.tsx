"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, buttonClass, Checkbox, Em, Icon, Notice, Panel, SectionLabel, SkyHeader } from "@/components/ui";
import { api, API_URL, ApiError } from "@/lib/api";
import { formatSlot, PLATFORM_LABEL, tzOffsetMinutes, type InboxClip, type PostPlatform, type ScheduledPost } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/imports";

const QUICK_REASONS = ["Not funny", "Needs context", "Too long", "Boring", "Wrong moment"];
const PLATFORMS: PostPlatform[] = ["tiktok", "youtube", "instagram"];

type Done = { kind: "approved" | "rejected"; clip: InboxClip; posts?: ScheduledPost[] };

export default function InboxPage() {
  const router = useRouter();
  const [clips, setClips] = useState<InboxClip[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [platforms, setPlatforms] = useState<PostPlatform[]>(["tiktok", "youtube"]);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [last, setLast] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClips(await api<InboxClip[]>("/api/inbox"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the inbox.");
      setClips([]);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // new clips arrive while agents work
    return () => clearInterval(t);
  }, [load]);

  const remove = (id: number) => {
    setClips((prev) => {
      const next = prev ? prev.filter((c) => c.id !== id) : prev;
      setSelected((i) => Math.max(0, Math.min(i, (next?.length ?? 1) - 1)));
      return next;
    });
  };

  async function approve(clip: InboxClip) {
    if (!platforms.length) {
      setError("Pick at least one platform to schedule on.");
      return;
    }
    setBusy(clip.id);
    setError(null);
    try {
      const posts = await api<ScheduledPost[]>(`/api/inbox/${clip.id}/approve`, {
        method: "POST",
        body: { platforms, tz_offset_minutes: tzOffsetMinutes() },
      });
      setLast({ kind: "approved", clip, posts });
      remove(clip.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve that clip.");
    } finally {
      setBusy(null);
    }
  }

  async function reject(clip: InboxClip, why: string) {
    setBusy(clip.id);
    setError(null);
    try {
      await api(`/api/inbox/${clip.id}/reject`, { method: "POST", body: { reason: why.trim() || null } });
      setLast({ kind: "rejected", clip });
      setRejecting(null);
      setReason("");
      remove(clip.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reject that clip.");
    } finally {
      setBusy(null);
    }
  }

  async function undo() {
    if (!last) return;
    await api(`/api/inbox/${last.clip.id}/restore`, { method: "POST" }).catch(() => undefined);
    setLast(null);
    load();
  }

  // Keyboard: A approve · R reject · E edit · J/K or arrows to move.
  const approveRef = useRef(approve);
  approveRef.current = approve;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const clip = clips?.[selected];
      if (!clip) return;
      const key = e.key.toLowerCase();
      if (key === "a") approveRef.current(clip);
      else if (key === "r") setRejecting(clip.id);
      else if (key === "e") router.push(`/studio?clip=${clip.id}`);
      else if (key === "j" || key === "arrowright" || key === "arrowdown") setSelected((i) => Math.min((clips?.length ?? 1) - 1, i + 1));
      else if (key === "k" || key === "arrowleft" || key === "arrowup") setSelected((i) => Math.max(0, i - 1));
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clips, selected, router]);

  const togglePlatform = (p: PostPlatform) => setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Approval inbox"
        title={
          <>
            Your agents made <Em>{clips?.length ?? "…"}</Em> clip{clips?.length === 1 ? "" : "s"}
          </>
        }
        description="Nothing posts without you. Approve a clip and the Publisher burns its captions and schedules it; reject it and the agents learn from your reason."
      />

      <Panel padding="md" className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <p className="text-lg font-medium text-ink">Schedule approved clips on</p>
          <div className="flex flex-wrap gap-x-6">
            {PLATFORMS.map((p) => (
              <Checkbox key={p} label={PLATFORM_LABEL[p]} checked={platforms.includes(p)} onChange={() => togglePlatform(p)} />
            ))}
          </div>
        </div>
        <p className="text-base text-ink-muted">
          Keys: <kbd className="font-mono font-semibold text-ink">A</kbd> approve · <kbd className="font-mono font-semibold text-ink">R</kbd> reject ·{" "}
          <kbd className="font-mono font-semibold text-ink">E</kbd> edit · <kbd className="font-mono font-semibold text-ink">J</kbd>/<kbd className="font-mono font-semibold text-ink">K</kbd> move
        </p>
      </Panel>

      {last && (
        <Notice tone={last.kind === "approved" ? "success" : "brand"} onDismiss={() => setLast(null)}>
          {last.kind === "approved" ? (
            <>
              Approved “{last.clip.title}”. Scheduled{" "}
              {(last.posts ?? []).map((p) => `${PLATFORM_LABEL[p.platform]} ${formatSlot(p.scheduled_for)}`).join(", ") || "nothing"}; captions are burning.{" "}
            </>
          ) : (
            <>Rejected “{last.clip.title}”. The agents will take that into account. </>
          )}
          <button type="button" onClick={undo} className="ml-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
            Undo
          </button>
        </Notice>
      )}
      {error && (
        <Notice tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}

      {clips === null ? (
        <p className="text-lg text-ink-muted">Loading your inbox…</p>
      ) : clips.length === 0 ? (
        <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-16 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-success-subtle text-success">
            <Icon name="check" />
          </span>
          <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">Inbox zero</p>
          <p className="mt-2 max-w-xl text-lg text-ink-muted">New clips land here when the Producer finishes. Paste a link, ask the agents, or let the Scout find your next stream.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/create" className={buttonClass()}>
              <Icon name="plus" className="size-5" /> Start a project
            </Link>
            <Link href="/hub" className={buttonClass({ variant: "secondary" })}>
              See the schedule
            </Link>
          </div>
        </Panel>
      ) : (
        <section className="space-y-6">
          <SectionLabel>Waiting for you</SectionLabel>
          <ul className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
            {clips.map((clip, i) => {
              const active = i === selected;
              return (
                <li key={clip.id}>
                  <Panel
                    as="article"
                    padding="none"
                    onClick={() => setSelected(i)}
                    aria-current={active || undefined}
                    className={cn("flex h-full flex-col overflow-hidden transition-shadow duration-(--motion-fast)", active && "shadow-ring")}
                  >
                    <div className="relative aspect-[9/16] max-h-[28rem] w-full bg-brand-deep">
                      {clip.file_path && <video src={`${API_URL}/${clip.file_path}`} controls playsInline preload="metadata" className="size-full object-contain" />}
                      <span className="absolute top-3 left-3 rounded-full bg-brand-deep/85 px-3 py-1 text-meta font-semibold text-on-brand tabular-nums">
                        {formatTime(clip.start_s)} · {Math.round(clip.duration_s)}s
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col gap-4 p-6">
                      <div>
                        <h2 className="font-display text-2xl leading-snug font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">{clip.title || "Untitled clip"}</h2>
                        {clip.source_title && <p className="mt-1 truncate text-base text-ink-muted">From {clip.source_title}</p>}
                      </div>

                      {clip.reason && (
                        <p className="flex gap-2 rounded-md bg-brand-subtle px-4 py-3 text-base text-brand-strong">
                          <Icon name="bot" className="mt-0.5 size-5 shrink-0" />
                          <span>
                            <span className="font-semibold">Why: </span>
                            {clip.reason}
                          </span>
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {clip.context_json?.suggested_style && <Badge size="sm">{clip.context_json.suggested_style} captions</Badge>}
                        {clip.context_json?.game_or_topic && <Badge size="sm">{clip.context_json.game_or_topic}</Badge>}
                        {clip.hashtags.slice(0, 4).map((t) => (
                          <Badge key={t} tone="brand" size="sm">
                            {t}
                          </Badge>
                        ))}
                      </div>

                      {rejecting === clip.id ? (
                        <form
                          className="mt-auto space-y-3 border-t border-line pt-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            reject(clip, reason);
                          }}
                        >
                          <label htmlFor={`reason-${clip.id}`} className="block text-base font-medium text-ink">
                            Why not? (optional, it teaches the agents)
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {QUICK_REASONS.map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => reject(clip, r)}
                                className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-base text-ink hover:border-brand"
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                          <input
                            id={`reason-${clip.id}`}
                            autoFocus
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            onKeyDown={(e) => e.key === "Escape" && setRejecting(null)}
                            placeholder="Or type a reason and press Enter"
                            className="block h-12 w-full rounded-md border border-line-strong bg-surface px-4 text-base text-ink focus:border-brand focus:shadow-ring focus-visible:outline-none"
                          />
                          <div className="flex gap-2">
                            <Button type="submit" size="sm" variant="secondary" loading={busy === clip.id}>
                              Reject
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                              Cancel
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-4">
                          <Button size="sm" loading={busy === clip.id} onClick={() => approve(clip)}>
                            <Icon name="check" className="size-5" /> Approve
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setRejecting(clip.id)}>
                            <Icon name="x" className="size-5" /> Reject
                          </Button>
                          <Link href={`/studio?clip=${clip.id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                            <Icon name="film" className="size-5" /> Edit
                          </Link>
                        </div>
                      )}
                    </div>
                  </Panel>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
