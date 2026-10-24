"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { AgentFeed } from "@/components/agents/AgentFeed";
import { Bee, BeeSwarm, Flower, HoneycombLattice } from "@/components/hive";
import { Badge, Button, buttonClass, ChannelAvatar, Em, Field, Icon, Input, Notice, Panel, SectionLabel, Segmented, SkyHeader } from "@/components/ui";
import { api, ApiError, friendly } from "@/lib/api";
import { timeAgo, type AgentRun } from "@/lib/agents";
import { cn } from "@/lib/cn";

type Platform = "twitch" | "kick" | "youtube";

type Streamer = {
  id: number;
  user_id: number;
  platform: Platform;
  username: string;
  is_active: boolean;
  created_at: string;
  last_checked_at: string | null;
  last_seen_video_title: string | null;
  last_seen_video_url: string | null;
  last_check_error: string | null;
  /** Recording the live broadcast right now (stream monitor); clips arrive as it goes. */
  recording: boolean;
};

type CheckResult = { streamer_id: number; status: "new_vod" | "no_change" | "first_seen" | "error"; message: string; import_job_id: number | null };

const PLATFORM_LABEL: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

/** GET /api/streamers/status: checked against the platform, never guessed. */
type LiveStatus = {
  streamer_id: number;
  live: boolean | null; // null = couldn't tell
  url: string;
  title: string | null;
  viewers: number | null;
  category: string | null;
  error: string | null;
  checked_at: string;
};

const POLL_MS = 60_000;

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 10 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

function statusLine(s: Streamer): { text: string; tone: "ok" | "idle" | "error" | "paused" } {
  if (!s.is_active) return { text: "Paused", tone: "paused" };
  if (s.recording) return { text: "Recording the stream · clips arrive as it goes", tone: "ok" };
  if (s.last_check_error) return { text: `Last check failed: ${friendly(s.last_check_error)}`, tone: "error" };
  if (!s.last_checked_at) return { text: "Not checked yet", tone: "idle" };
  return { text: `Checked ${timeAgo(s.last_checked_at)}`, tone: "ok" };
}

export default function StreamersPage() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "brand"; text: string; jobId?: number | null } | null>(null);
  const [checking, setChecking] = useState<number | "all" | null>(null);
  const [recordingBusy, setRecordingBusy] = useState<number | null>(null);
  const [scoutRunId, setScoutRunId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [statuses, setStatuses] = useState<Record<number, LiveStatus>>({});
  const [liveChecking, setLiveChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [, tick] = useState(0); // re-render so "checked 20s ago" stays current
  // Profile pictures from each platform, by streamer id (missing = show the initial).
  const [avatars, setAvatars] = useState<Record<number, string | null>>({});

  const loadAvatars = useCallback(async () => {
    try {
      const list = await api<{ streamer_id: number; avatar_url: string | null }[]>("/api/streamers/avatars");
      setAvatars(Object.fromEntries(list.map((a) => [a.streamer_id, a.avatar_url])));
    } catch (err) {
      console.warn("Could not load channel pictures:", err);
    }
  }, []);

  useEffect(() => {
    loadAvatars();
  }, [loadAvatars]);

  const loadStatus = useCallback(async (refresh = false) => {
    setLiveChecking(true);
    try {
      const list = await api<LiveStatus[]>(`/api/streamers/status${refresh ? "?refresh=true" : ""}`, { auth: false });
      setStatuses(Object.fromEntries(list.map((st) => [st.streamer_id, st])));
      setLastChecked(new Date().toISOString());
    } catch (err) {
      console.warn("Could not check live status:", err);
    } finally {
      setLiveChecking(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const poll = setInterval(() => loadStatus(), POLL_MS);
    const clock = setInterval(() => tick((n) => n + 1), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [loadStatus]);

  const load = useCallback(async () => {
    try {
      setStreamers(await api<Streamer[]>("/api/streamers", { auth: false }));
    } catch (err) {
      console.warn("Could not load streamers:", err);
    }
  }, []);

  const loadLatestScout = useCallback(async () => {
    try {
      const [run] = await api<AgentRun[]>("/api/agents/runs?kind=scout&limit=1");
      setScoutRunId(run?.id ?? null);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    loadLatestScout();
  }, [load, loadLatestScout]);

  function handleAddStreamer(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    startTransition(async () => {
      try {
        const created = await api<Streamer>("/api/streamers", {
          method: "POST",
          body: { platform, username: username.trim().replace(/^@/, "") },
          auth: false,
        });
        setStreamers((prev) => (prev.some((s) => s.id === created.id) ? prev : [...prev, created]));
        setUsername("");
        setMessage({ tone: "success", text: `Watching ${created.username} on ${PLATFORM_LABEL[created.platform]}. Press “Check now” to clip their latest VOD.` });
        loadStatus();
        loadAvatars();
      } catch {
        setMessage({ tone: "danger", text: "Failed to add that channel." });
      }
    });
  }

  function handleDeleteStreamer(id: number) {
    startTransition(async () => {
      try {
        await api(`/api/streamers/${id}`, { method: "DELETE", auth: false });
        setStreamers((prev) => prev.filter((s) => s.id !== id));
      } catch {
        setMessage({ tone: "danger", text: "Failed to remove that channel." });
      }
    });
  }

  function togglePaused(s: Streamer) {
    startTransition(async () => {
      try {
        const updated = await api<Streamer>(`/api/streamers/${s.id}`, { method: "PATCH", body: { is_active: !s.is_active }, auth: false });
        setStreamers((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
      } catch {
        setMessage({ tone: "danger", text: "Couldn't update that channel." });
      }
    });
  }

  async function checkNow(s: Streamer) {
    setChecking(s.id);
    setMessage(null);
    try {
      const r = await api<CheckResult>(`/api/streamers/${s.id}/check-now`, { method: "POST", auth: false });
      setMessage({ tone: r.status === "error" ? "danger" : r.status === "new_vod" ? "success" : "brand", text: `${s.username}: ${r.status === "error" ? friendly(r.message) : r.message}`, jobId: r.import_job_id });
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : "Check failed." });
    } finally {
      setChecking(null);
      load();
      loadLatestScout();
    }
  }

  /** Record the live broadcast start to finish, or stop (what was recorded is still clipped). */
  async function setRecording(s: Streamer, on: boolean) {
    setRecordingBusy(s.id);
    setMessage(null);
    try {
      await api(`/api/streamers/${s.id}/${on ? "record" : "stop"}`, { method: "POST" });
      setStreamers((prev) => prev.map((x) => (x.id === s.id ? { ...x, recording: on } : x)));
      setMessage({
        tone: "success",
        text: on
          ? `Recording ${s.username} until the stream ends. New clips land in the Hub every few minutes.`
          : `Stopped recording ${s.username}. The part already recorded is still being clipped.`,
      });
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : on ? "Couldn't start the recording." : "Couldn't stop the recording." });
      load();
    } finally {
      setRecordingBusy(null);
    }
  }

  async function checkAll() {
    setChecking("all");
    setMessage(null);
    try {
      const { results } = await api<{ results: CheckResult[] }>("/api/agents/scout/run", { method: "POST" });
      const found = results.filter((r) => r.status === "new_vod").length;
      setMessage({ tone: found ? "success" : "brand", text: found ? `Found ${found} new VOD${found === 1 ? "" : "s"}. Clipping now.` : `Checked ${results.length} channels. Nothing new.` });
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : "Scout run failed." });
    } finally {
      setChecking(null);
      load();
      loadLatestScout();
    }
  }

  const active = streamers.filter((s) => s.is_active).length;
  const liveCount = streamers.filter((s) => statuses[s.id]?.live === true).length;
  const recordingCount = streamers.filter((s) => s.recording).length;
  const liveNow = streamers.filter((s) => statuses[s.id]?.live === true || s.recording);
  const others = streamers.filter((s) => !liveNow.includes(s));

  const card = (s: Streamer) => (
    <ChannelCard
      streamer={s}
      live={statuses[s.id]}
      avatar={avatars[s.id]}
      checking={checking === s.id || (checking === "all" && s.is_active)}
      checkDisabled={!s.is_active || (checking !== null && checking !== s.id)}
      recordingBusy={recordingBusy === s.id}
      recordDisabled={recordingBusy !== null}
      pending={isPending}
      onCheck={() => checkNow(s)}
      onRecord={(on) => setRecording(s, on)}
      onTogglePaused={() => togglePaused(s)}
      onRemove={() => handleDeleteStreamer(s.id)}
    />
  );

  return (
    <div className="space-y-10 sm:space-y-12">
      <SkyHeader
        eyebrow="Scout agent"
        title={
          <>
            Channels we&apos;re <Em>watching</Em>
          </>
        }
        description="Live streams can be recorded and clipped as they go. New VODs are clipped automatically and land in your inbox."
        decoration={
          <>
            <HoneycombLattice tone="inverse" fade="right" />
            <BeeSwarm count={4} tone="inverse" interactive pollen className="-z-10" />
          </>
        }
        actions={
          <>
            <HeaderStat value={liveCount} label="live now" dot={liveCount > 0 ? "live" : undefined} />
            <HeaderStat value={active} label={`watched${streamers.length > active ? ` · ${streamers.length - active} paused` : ""}`} />
            {recordingCount > 0 && <HeaderStat value={recordingCount} label="recording" dot="recording" />}
          </>
        }
      />

      {/* Add a channel: one bar, so the channels get the page. */}
      <Panel padding="sm" data-tour="add-channel">
        <form onSubmit={handleAddStreamer} className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="space-y-2">
            <p className="text-lg font-medium text-ink">Platform</p>
            <Segmented
              label="Platform"
              value={platform}
              onChange={setPlatform}
              className="w-full lg:w-auto"
              options={[
                { value: "twitch", label: "Twitch" },
                { value: "kick", label: "Kick" },
                { value: "youtube", label: "YouTube" },
              ]}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Field label="Channel" hint={platform === "youtube" ? "The @handle, e.g. mkbhd" : "e.g. tarik, kaicenat, shroud"}>
              <Input type="text" placeholder="Channel username" value={username} onChange={(e) => setUsername(e.target.value)} required autoCapitalize="none" autoCorrect="off" />
            </Field>
          </div>
          <Button type="submit" size="md" loading={isPending} className="lg:mt-[2.25rem]">
            <Icon name="plus" className="size-5" />
            Add channel
          </Button>
        </form>
      </Panel>

      {message && (
        <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
          {message.jobId ? (
            <Link href="/create" className="ml-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              Watch it work
            </Link>
          ) : null}
        </Notice>
      )}

      {liveNow.length > 0 && (
        <section className="space-y-5">
          <div className="flex items-center gap-3">
            <span aria-hidden className="relative flex size-3">
              <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
              <span aria-hidden className="relative size-3 rounded-full bg-success" />
            </span>
            <SectionLabel>Live now</SectionLabel>
          </div>
          <ul className="rail grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {liveNow.map((s) => (
              <li key={s.id} className="min-w-0">
                {card(s)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SectionLabel>{liveNow.length ? "Offline" : "Channels"}</SectionLabel>
            <Badge tone="neutral">{others.length}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastChecked && <span className="text-meta text-ink-muted">Live status {ago(lastChecked)}</span>}
            <Button variant="ghost" size="xs" loading={liveChecking} disabled={liveChecking || streamers.length === 0} onClick={() => loadStatus(true)} aria-label="Refresh live status" title="Refresh live status">
              <Icon name="refresh" className="size-5" />
            </Button>
            <Button variant="secondary" size="xs" loading={checking === "all"} disabled={!active || checking !== null} onClick={checkAll}>
              <Icon name="search" className="size-5" /> Check all for VODs
            </Button>
          </div>
        </div>

        {streamers.length === 0 ? (
          <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-14 text-center">
            <Flower state="bud" size={72} scout="hover" />
            <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No channels yet</p>
            <p className="mt-2 text-lg text-ink-muted">Add one above and the Scout starts watching it.</p>
          </Panel>
        ) : others.length === 0 ? (
          <p className="text-base text-ink-muted">Every channel you watch is live right now.</p>
        ) : (
          <ul className="rail grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {others.map((s) => (
              <li key={s.id} className="min-w-0">
                {card(s)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="group rounded-lg border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3">
          <span className="flex items-center gap-3 font-display text-xl font-semibold tracking-tight text-ink">
            <Bee variant="scout" size={32} className="bee-hover" /> Scout&apos;s last check
          </span>
          <Icon name="chevronDown" className="size-5 text-ink-faint transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line px-5 py-5">
          {scoutRunId ? <AgentFeed runId={scoutRunId} compact /> : <p className="text-base text-ink-muted">No checks yet. Press “Check now” on a channel.</p>}
        </div>
      </details>
    </div>
  );
}

/** A number on the sky header: "2 live now". */
function HeaderStat({ value, label, dot }: { value: number; label: string; dot?: "live" | "recording" }) {
  return (
    <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-on-brand/30 bg-on-brand/10 px-4 text-base text-on-brand">
      {dot && <span aria-hidden className={cn("size-2.5 rounded-full", dot === "live" ? "bg-success" : "bg-danger")} />}
      <span className="font-display text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-on-brand/80">{label}</span>
    </span>
  );
}

/** One watched channel: who, whether they're live, what the Scout last did, and the actions. */
function ChannelCard({
  streamer: s,
  live,
  avatar,
  checking,
  checkDisabled,
  recordingBusy,
  recordDisabled,
  pending,
  onCheck,
  onRecord,
  onTogglePaused,
  onRemove,
}: {
  streamer: Streamer;
  live: LiveStatus | undefined;
  avatar: string | null | undefined;
  checking: boolean;
  checkDisabled: boolean;
  recordingBusy: boolean;
  recordDisabled: boolean;
  pending: boolean;
  onCheck: () => void;
  onRecord: (on: boolean) => void;
  onTogglePaused: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isLive = live?.live === true;
  const st = statusLine(s);

  return (
    <article
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-lg border bg-surface shadow-glow",
        s.recording ? "border-danger/50" : isLive ? "border-success/50" : "border-line",
        !s.is_active && "opacity-80",
      )}
    >
      {/* Top band: the live broadcast, or a quiet strip. */}
      <div className={cn("relative h-14", isLive ? "bg-success-subtle" : "bg-surface-sunken")}>
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <Button variant="ghost" size="xs" disabled={pending} onClick={onTogglePaused} aria-label={s.is_active ? `Pause ${s.username}` : `Resume ${s.username}`} title={s.is_active ? "Pause watching" : "Resume watching"}>
            <Icon name={s.is_active ? "pause" : "play"} className="size-5" />
          </Button>
          <Button variant="ghost" size="xs" disabled={pending || s.recording} onClick={() => setConfirming(true)} aria-label={`Remove ${s.username}`} title="Stop watching this channel">
            <Icon name="trash" className="size-5" />
          </Button>
        </div>
      </div>

      <div className="relative -mt-9 flex flex-1 flex-col gap-4 px-5 pb-5">
        <div className="flex items-end gap-4">
          <ChannelAvatar src={avatar} name={s.username} size={64} live={isLive} paused={!s.is_active} recording={s.recording} busy={checking} />
          <div className="min-w-0 pb-1 pr-24">
            <p className="truncate font-display text-xl font-semibold tracking-tight text-ink">{s.username}</p>
            <p className="text-meta text-ink-muted">{PLATFORM_LABEL[s.platform] ?? s.platform}</p>
          </div>
        </div>

        <div className="space-y-1.5" aria-live="polite">
          <p className="flex items-start gap-2 text-base">
            <span aria-hidden className={cn("mt-2 size-2.5 shrink-0 rounded-full", !live ? "animate-pulse bg-ink-faint" : isLive ? "bg-success" : live.live === null ? "bg-warning" : "bg-ink-faint")} />
            {!live ? (
              <span className="text-ink-muted">Checking…</span>
            ) : isLive ? (
              <span className="font-medium text-success">
                Live{live.viewers != null && ` · ${compact(live.viewers)} watching`}
                {live.category && ` · ${live.category}`}
              </span>
            ) : live.live === null ? (
              <span className="text-warning">Couldn&apos;t check{live.error ? ` · ${friendly(live.error)}` : ""}</span>
            ) : (
              <span className="text-ink-muted">Offline</span>
            )}
          </p>
          {isLive && live.title && <p className="line-clamp-2 text-base text-ink">{live.title}</p>}
          <p className={cn("text-meta", st.tone === "error" ? "text-danger" : s.recording ? "font-medium text-danger" : "text-ink-muted")}>
            {s.recording ? st.text : `Scout: ${st.text}`}
          </p>
          {s.last_seen_video_title && (
            <p className="truncate text-meta text-ink-muted">
              Latest VOD:{" "}
              {s.last_seen_video_url ? (
                <a href={s.last_seen_video_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-strong">
                  {s.last_seen_video_title}
                </a>
              ) : (
                s.last_seen_video_title
              )}
            </p>
          )}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-4">
          {s.recording ? (
            <Button variant="danger" size="xs" loading={recordingBusy} onClick={() => onRecord(false)}>
              <Icon name="x" className="size-5" /> Stop recording
            </Button>
          ) : (
            isLive &&
            s.is_active && (
              <Button size="xs" loading={recordingBusy} disabled={recordDisabled} onClick={() => onRecord(true)}>
                <Icon name="radio" className="size-5" /> Record now
              </Button>
            )
          )}
          {isLive && (
            <a href={live.url} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "xs" })}>
              <Icon name="play" className="size-5" /> Watch
            </a>
          )}
          <Button variant={isLive ? "ghost" : "secondary"} size="xs" loading={checking} disabled={checkDisabled} onClick={onCheck}>
            <Icon name="search" className="size-5" /> Check for VODs
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface/95 p-5 text-center">
          <p className="font-semibold text-ink">Stop watching {s.username}?</p>
          <p className="text-meta text-ink-muted">Clips already made stay in your Hub.</p>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" onClick={onRemove}>
              Remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
