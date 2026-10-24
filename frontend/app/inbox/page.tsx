"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipDialog, ClipDialogActions, ClipShelves, ClipTile, ClipToolbar, matchesQuery, shelvesBy } from "@/components/clips";
import { Bee, BeeLoader, BeeSwarm, HoneycombLattice } from "@/components/hive";
import { Badge, Button, buttonClass, Em, Icon, Notice, Panel, Segmented, SkyHeader } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatSlot, PLATFORM_LABEL, tzOffsetMinutes, type InboxClip, type PostPlatform, type ScheduledPost } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { formatTime, type Layout } from "@/lib/imports";
import { usePersistentState } from "@/lib/usePersistentState";

const QUICK_REASONS = ["Not funny", "Needs context", "Too long", "Boring", "Wrong moment"];
const PLATFORMS: PostPlatform[] = ["tiktok", "youtube", "instagram"];
const POLL_MS = 10_000;

type GroupBy = "source" | "topic" | "all";
const GROUP_OPTIONS = [
  { value: "source" as const, label: "Video" },
  { value: "topic" as const, label: "Topic" },
  { value: "all" as const, label: "All" },
];

type Done = { kind: "approved" | "rejected"; clip: InboxClip; posts?: ScheduledPost[] };

/**
 * Every clip's video in one grid; tap one to open it in a popup (a bottom sheet on phones)
 * with its details, the Blur / Fill switch and the approve / reject actions.
 * The open clip is tracked by id, so clips arriving from the poll never change what's open.
 */
export default function InboxPage() {
  const [clips, setClips] = useState<InboxClip[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [platforms, setPlatforms] = usePersistentState<PostPlatform[]>("ch_inbox_platforms", ["tiktok", "youtube"]);
  const [last, setLast] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = usePersistentState<GroupBy>("ch_inbox_group", "source");

  const load = useCallback(async () => {
    try {
      setClips(await api<InboxClip[]>("/api/inbox"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the inbox.");
      setClips((prev) => prev ?? []);
    }
  }, []);

  // New clips arrive while the agents work. Only poll while the tab is visible.
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), POLL_MS);
    const onVisible = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Search, then split into shelves; the popup's prev / next follow the order shown.
  const shelves = useMemo(() => {
    const found = (clips ?? []).filter((c) => matchesQuery(c, query));
    if (groupBy === "all") return found.length ? [{ key: "all", label: "All clips", items: found }] : [];
    if (groupBy === "topic") return shelvesBy(found, (c) => c.context_json?.game_or_topic, "Other topics");
    return shelvesBy(found, (c) => c.source_title, "Other clips");
  }, [clips, query, groupBy]);
  const ordered = useMemo(() => shelves.flatMap((s) => s.items), [shelves]);

  const openIndex = ordered.findIndex((c) => c.id === openId);
  const open = openIndex >= 0 ? ordered[openIndex] : (clips?.find((c) => c.id === openId) ?? null);

  /** Take a reviewed clip out; the popup moves on to the next clip, or closes after the last. */
  function done(result: Done) {
    const i = ordered.findIndex((c) => c.id === result.clip.id);
    const rest = ordered.filter((c) => c.id !== result.clip.id);
    setClips((prev) => prev?.filter((c) => c.id !== result.clip.id) ?? prev);
    setOpenId(rest[Math.min(Math.max(i, 0), rest.length - 1)]?.id ?? null);
    setLast(result);
  }

  async function undo() {
    if (!last) return;
    const id = last.clip.id;
    setLast(null);
    await api(`/api/inbox/${id}/restore`, { method: "POST" }).catch(() => undefined);
    await load();
  }

  const replace = (clip: InboxClip) => setClips((prev) => prev?.map((c) => (c.id === clip.id ? clip : c)) ?? prev);
  const count = clips?.length;

  const feedback = last && (
    <div
      role="status"
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-4 py-2 text-base font-medium",
        last.kind === "approved" ? "bg-success-subtle text-success" : "bg-brand-subtle text-brand-strong",
      )}
    >
      <span className="min-w-0">
        {last.kind === "approved"
          ? `Approved. ${(last.posts ?? []).map((p) => `${PLATFORM_LABEL[p.platform]} ${formatSlot(p.scheduled_for)}`).join(" · ")}`
          : "Rejected. The bees will learn from it."}
      </span>
      <button type="button" onClick={undo} className="inline-flex min-h-11 shrink-0 items-center font-semibold underline underline-offset-4">
        Undo
      </button>
    </div>
  );

  return (
    <div className="space-y-8 lg:space-y-10">
      <SkyHeader
        eyebrow="Approval inbox"
        title={
          <>
            <Em>{count ?? "…"}</Em> clip{count === 1 ? "" : "s"} to review
          </>
        }
        description="Tap a clip to watch it, then approve or reject."
        decoration={
          <>
            <HoneycombLattice tone="inverse" fade="right" />
            <BeeSwarm count={5} tone="inverse" interactive pollen className="-z-10" />
          </>
        }
      />

      {error && (
        <Notice tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      {!open && feedback}

      {clips === null ? (
        <BeeLoader label="Loading clips…" />
      ) : clips.length === 0 ? (
        <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-14 text-center">
          <Bee variant="honey" size={64} className="bee-hover" />
          <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">Inbox zero</p>
          <p className="mt-2 text-lg text-ink-muted">New clips show up here when the bees finish.</p>
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
        <div className="space-y-6">
          <ClipToolbar query={query} onQuery={setQuery} groupBy={groupBy} onGroupBy={setGroupBy} groupOptions={GROUP_OPTIONS} />
          <ClipShelves
            shelves={shelves}
            query={query}
            onClearQuery={() => setQuery("")}
            renderTile={(clip) => (
              <ClipTile title={clip.title} filePath={clip.file_path} durationS={clip.duration_s} label={clip.layout} onOpen={() => setOpenId(clip.id)} />
            )}
          />
        </div>
      )}

      {open && clips && (
        <InboxClipDialog
          clip={open}
          position={Math.max(openIndex, 0) + 1}
          total={ordered.length || clips.length}
          platforms={platforms}
          onTogglePlatform={(p) => setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))}
          onPrev={openIndex > 0 ? () => setOpenId(ordered[openIndex - 1].id) : undefined}
          onNext={openIndex >= 0 && openIndex < ordered.length - 1 ? () => setOpenId(ordered[openIndex + 1].id) : undefined}
          onClose={() => setOpenId(null)}
          onDone={done}
          onReplace={replace}
          feedback={feedback}
        />
      )}
    </div>
  );
}

/** One clip's popup: details, the Blur / Fill switch and the approve / reject actions. */
function InboxClipDialog({
  clip,
  position,
  total,
  platforms,
  onTogglePlatform,
  onPrev,
  onNext,
  onClose,
  onDone,
  onReplace,
  feedback,
}: {
  clip: InboxClip;
  position: number;
  total: number;
  platforms: PostPlatform[];
  onTogglePlatform: (p: PostPlatform) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onDone: (result: Done) => void;
  onReplace: (clip: InboxClip) => void;
  feedback: React.ReactNode;
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [recutting, setRecutting] = useState<Layout | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Moving to another clip resets the per-clip state.
  useEffect(() => {
    setRejecting(false);
    setReason("");
    setError(null);
  }, [clip.id]);

  async function approve() {
    if (!platforms.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const posts = await api<ScheduledPost[]>(`/api/inbox/${clip.id}/approve`, {
        method: "POST",
        body: { platforms, tz_offset_minutes: tzOffsetMinutes() },
      });
      onDone({ kind: "approved", clip, posts });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve that clip.");
    } finally {
      setBusy(false);
    }
  }

  async function reject(why: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/inbox/${clip.id}/reject`, { method: "POST", body: { reason: why.trim() || null } });
      onDone({ kind: "rejected", clip });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reject that clip.");
    } finally {
      setBusy(false);
    }
  }

  /** Re-cut the clip in the other layout (takes a few seconds; the old cut plays until then). */
  async function switchLayout(layout: Layout) {
    if (layout === clip.layout || recutting) return;
    setRecutting(layout);
    setError(null);
    try {
      const updated = await api<{ file_path: string | null; layout: Layout }>(`/api/studio/clips/${clip.id}/layout`, { method: "POST", body: { layout } });
      onReplace({ ...clip, file_path: updated.file_path, layout: updated.layout });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change the layout.");
    } finally {
      setRecutting(null);
    }
  }

  // Keyboard inside the popup: A approve · R reject · E edit. (ClipDialog handles J/K.)
  const keys = useRef({ approve });
  keys.current = { approve };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, video, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "a") keys.current.approve();
      else if (key === "r") setRejecting(true);
      else if (key === "e") router.push(`/editor?clip=${clip.id}`);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, clip.id]);

  return (
    <ClipDialog
      title={clip.title}
      filePath={clip.file_path}
      position={position}
      total={total}
      onPrev={onPrev}
      onNext={onNext}
      onClose={onClose}
      videoOverlay={
        recutting && (
          <div className="absolute inset-0 grid place-items-center bg-brand-deep/70 text-center text-base font-medium text-on-brand">
            <span className="flex flex-col items-center gap-3">
              <Bee tone="inverse" size={40} className="bee-hover" />
              Re-cutting as {recutting}…
            </span>
          </div>
        )
      }
    >
            <div>
              <h2 className="line-clamp-3 font-display text-2xl leading-snug font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">{clip.title || "Untitled clip"}</h2>
              <p className="mt-1 truncate text-base text-ink-muted tabular-nums">
                {Math.round(clip.duration_s)}s at {formatTime(clip.start_s)}
                {clip.source_title && ` · ${clip.source_title}`}
              </p>
            </div>

            {clip.layout && (
              <div className="space-y-2">
                <Segmented
                  label="Layout"
                  value={recutting ?? clip.layout}
                  onChange={switchLayout}
                  options={[
                    { value: "blur", label: "Blur" },
                    { value: "fill", label: "Fill" },
                  ]}
                />
                <p className="text-meta text-ink-muted">{(recutting ?? clip.layout) === "blur" ? "Whole frame, blurred backdrop." : "Cropped to fill the screen."}</p>
              </div>
            )}

            {clip.reason && (
              <p className="flex gap-2 rounded-md bg-brand-subtle px-4 py-3 text-base text-brand-strong">
                <Icon name="bee" className="mt-0.5 size-5 shrink-0" />
                <span>
                  <span className="font-semibold">Why: </span>
                  {clip.reason}
                </span>
              </p>
            )}

            {(clip.context_json?.suggested_style || clip.context_json?.game_or_topic || clip.hashtags.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {clip.context_json?.suggested_style && <Badge size="sm">{clip.context_json.suggested_style} captions</Badge>}
                {clip.context_json?.game_or_topic && <Badge size="sm">{clip.context_json.game_or_topic}</Badge>}
                {clip.hashtags.slice(0, 4).map((t) => (
                  <Badge key={t} tone="brand" size="sm">
                    {t}
                  </Badge>
                ))}
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="text-base font-medium text-ink">Post to</legend>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const on = platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onTogglePlatform(p)}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-base font-medium transition-colors duration-(--motion-fast)",
                        on ? "border-brand bg-brand-subtle text-brand-strong" : "border-line-strong text-ink-muted hover:text-ink",
                      )}
                    >
                      {on && <Icon name="check" className="size-5" />}
                      {PLATFORM_LABEL[p]}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {error && <p className="rounded-md bg-danger-subtle px-4 py-2 text-base font-medium text-danger">{error}</p>}
            {feedback}

            {rejecting ? (
              <form
                className="mt-auto space-y-3 border-t border-line pt-4 pb-4 sm:pb-0"
                onSubmit={(e) => {
                  e.preventDefault();
                  reject(reason);
                }}
              >
                <label htmlFor="reject-reason" className="block text-base font-medium text-ink">
                  Why not? (optional)
                </label>
                <div className="flex flex-wrap gap-2">
                  {QUICK_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={busy}
                      onClick={() => reject(r)}
                      className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-base text-ink hover:border-brand disabled:opacity-50"
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <input
                  id="reject-reason"
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault(); // close the reason box, not the popup
                      setRejecting(false);
                    }
                  }}
                  placeholder="Or type a reason and press Enter"
                  className="block h-12 w-full rounded-md border border-line-strong bg-surface px-4 text-lg text-ink focus:border-brand focus:shadow-ring focus-visible:outline-none"
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="secondary" loading={busy}>
                    Reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <ClipDialogActions>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                  <Button size="sm" loading={busy} disabled={!platforms.length || !!recutting} onClick={approve}>
                    <Icon name="check" className="size-5" /> Approve
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>
                    <Icon name="x" className="size-5" /> Reject
                  </Button>
                  <Link href={`/editor?clip=${clip.id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    <Icon name="film" className="size-5" /> Edit
                  </Link>
                </div>
                {!platforms.length && <p className="mt-2 text-meta text-ink-muted">Pick a platform to approve.</p>}
                <p className="mt-3 hidden text-meta text-ink-faint lg:block">
                  <kbd className="font-mono font-semibold text-ink-muted">A</kbd> approve · <kbd className="font-mono font-semibold text-ink-muted">R</kbd> reject ·{" "}
                  <kbd className="font-mono font-semibold text-ink-muted">E</kbd> edit · <kbd className="font-mono font-semibold text-ink-muted">J</kbd>/
                  <kbd className="font-mono font-semibold text-ink-muted">K</kbd> move · <kbd className="font-mono font-semibold text-ink-muted">Esc</kbd> close
                </p>
              </ClipDialogActions>
            )}
    </ClipDialog>
  );
}
