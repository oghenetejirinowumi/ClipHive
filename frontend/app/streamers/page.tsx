"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { AgentFeed } from "@/components/agents/AgentFeed";
import { ChannelSearch } from "@/components/streamers/ChannelSearch";
import { VideoPicker } from "@/components/streamers/VideoPicker";
import { Bee, BeeSwarm, Flower, HoneycombLattice } from "@/components/hive";
import { Badge, Button, buttonClass, ChannelAvatar, Em, Field, Icon, Notice, Panel, SectionLabel, Segmented, SkyHeader } from "@/components/ui";
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

/** A row-sized version of a backend error; the full text goes in the tooltip. */
function shortError(msg: string): string {
  const until = msg.match(/pausing YouTube requests until (\d{1,2}:\d{2})/);
  if (until) return `YouTube paused until ${until[1]}`;
  if (/slow down|not a bot|too many requests/i.test(msg)) return "YouTube is rate-limiting this network";
  return msg;
}

function statusLine(s: Streamer): { text: string; tone: "ok" | "idle" | "error" | "paused"; full?: string } {
  if (!s.is_active) return { text: "Paused", tone: "paused" };
  if (s.recording) return { text: "Recording the stream · clips arrive as it goes", tone: "ok" };
  if (s.last_check_error) return { text: `Last check failed · ${friendly(shortError(s.last_check_error))}`, tone: "error", full: friendly(s.last_check_error) };
  if (!s.last_checked_at) return { text: "Not checked yet", tone: "idle" };
  return { text: `Checked ${timeAgo(s.last_checked_at)}`, tone: "ok" };
}

export default function StreamersPage() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "brand"; text: string; jobId?: number | null } | null>(null);
  const [checking, setChecking] = useState<number | "all" | null>(null);
  /** Channel whose video picker is open. */
  const [pickerFor, setPickerFor] = useState<number | null>(null);
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

  return (
    <div className="space-y-12">
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
      />

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

      <div className="grid gap-10 lg:grid-cols-12">
        <section className="space-y-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <SectionLabel>Channels</SectionLabel>
              <Badge tone="brand" size="md">
                {Object.values(statuses).filter((st) => st.live).length} live · {active} watched
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {lastChecked && <span className="text-base text-ink-muted">Live status {ago(lastChecked)}</span>}
              <Button variant="ghost" size="sm" loading={liveChecking} disabled={liveChecking || streamers.length === 0} onClick={() => loadStatus(true)}>
                Refresh
              </Button>
              <Button variant="secondary" size="sm" loading={checking === "all"} disabled={!active || checking !== null} onClick={checkAll}>
                <Icon name="refresh" className="size-5" /> Check all now
              </Button>
            </div>
          </div>

          {streamers.length > 0 ? (
            <ul className="divide-y divide-line border-y border-line">
              {streamers.map((s) => {
                const live = statuses[s.id];
                const isLive = live?.live === true;
                const st = statusLine(s);
                return (
                  <li key={s.id} className="py-6">
                  {/* Actions sit under the details (lined up with the text), so the status line keeps the row's full width. */}
                  <div className="flex flex-col gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-5">
                      <ChannelAvatar
                        src={avatars[s.id]}
                        name={s.username}
                        size={56}
                        live={isLive}
                        paused={!s.is_active}
                        recording={s.recording}
                        busy={checking === s.id || (checking === "all" && s.is_active)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="truncate font-display text-2xl font-semibold tracking-tight text-ink">{s.username}</span>
                          <Badge tone="neutral">{PLATFORM_LABEL[s.platform] ?? s.platform}</Badge>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-x-2 text-base" aria-live="polite">
                          {/* status dot (decorative: the text next to it carries the state) */}
                          <span aria-hidden className={cn("size-3 shrink-0 rounded-full", !live ? "animate-pulse bg-ink-faint" : isLive ? "bg-success" : live.live === null ? "bg-warning" : "bg-ink-faint")} />
                          {!live ? (
                            <span className="text-ink-muted">Checking…</span>
                          ) : isLive ? (
                            <span className="font-medium text-success">
                              Live now{live.viewers != null && ` · ${compact(live.viewers)} watching`}
                              {live.category && ` · ${live.category}`}
                            </span>
                          ) : live.live === null ? (
                            <span className="min-w-0 truncate text-warning" title={live.error ? friendly(live.error) : undefined}>
                              Couldn&apos;t check{live.error ? ` · ${friendly(shortError(live.error))}` : ""}
                            </span>
                          ) : (
                            <span className="text-ink-muted">Offline</span>
                          )}
                        </div>
                        {isLive && live.title && <p className="mt-1 line-clamp-1 text-base text-ink-muted">{live.title}</p>}
                        <p title={st.full} className={cn("mt-1 truncate text-base", st.tone === "error" ? "text-danger" : s.recording ? "font-medium text-warning" : "text-ink-muted")}>
                          {s.recording ? st.text : `Scout: ${st.text}`}
                        </p>
                        {s.last_seen_video_title && (
                          <p className="truncate text-base text-ink-muted">
                            Latest:{" "}
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
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:pl-[76px]">
                      {s.recording ? (
                        <Button variant="secondary" size="sm" loading={recordingBusy === s.id} onClick={() => setRecording(s, false)}>
                          <Icon name="x" className="size-5" /> Stop recording
                        </Button>
                      ) : (
                        isLive &&
                        s.is_active && (
                          <Button size="sm" loading={recordingBusy === s.id} disabled={recordingBusy !== null} onClick={() => setRecording(s, true)}>
                            <Icon name="radio" className="size-5" /> Record now
                          </Button>
                        )
                      )}
                      {isLive && (
                        <a href={live.url} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                          <Icon name="play" className="size-5" /> Watch
                        </a>
                      )}
                      <Button size="sm" loading={checking === s.id} disabled={!s.is_active || (checking !== null && checking !== s.id)} onClick={() => checkNow(s)}>
                        <Icon name="search" className="size-5" /> Check now
                      </Button>
                      <Button
                        variant={pickerFor === s.id ? "primary" : "secondary"}
                        size="sm"
                        aria-expanded={pickerFor === s.id}
                        onClick={() => setPickerFor(pickerFor === s.id ? null : s.id)}
                      >
                        <Icon name="film" className="size-5" /> Pick video
                      </Button>
                      <Button variant="ghost" size="sm" disabled={isPending} onClick={() => togglePaused(s)} aria-label={s.is_active ? `Pause ${s.username}` : `Resume ${s.username}`}>
                        <Icon name={s.is_active ? "pause" : "play"} className="size-5" />
                      </Button>
                      <Button variant="ghost" size="sm" disabled={isPending || s.recording} onClick={() => handleDeleteStreamer(s.id)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                  {pickerFor === s.id && (
                    <VideoPicker
                      streamer={s}
                      onClose={() => setPickerFor(null)}
                      onClipped={(jobId, title) => {
                        setPickerFor(null);
                        setMessage({ tone: "success", text: `Clipping "${title}" now.`, jobId });
                      }}
                    />
                  )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-14 text-center">
              <Flower state="bud" size={72} scout="hover" />
              <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No channels yet</p>
              <p className="mt-2 text-lg text-ink-muted">Add one and the Scout starts watching it.</p>
            </Panel>
          )}
        </section>

        <aside className="space-y-8 lg:col-span-5">
          <Panel padding="lg" data-tour="add-channel">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">Add a channel</h2>
            <p className="mt-2 text-lg text-ink-muted">The first check clips its newest VOD, then every new one. Use “Pick video” to clip any other.</p>

            <form onSubmit={handleAddStreamer} className="mt-8 space-y-6">
              <div className="space-y-2">
                <p className="text-lg font-medium text-ink">Platform</p>
                <Segmented
                  label="Platform"
                  value={platform}
                  onChange={setPlatform}
                  className="w-full"
                  options={[
                    { value: "twitch", label: "Twitch" },
                    { value: "kick", label: "Kick" },
                    { value: "youtube", label: "YouTube" },
                  ]}
                />
              </div>

              <Field label="Channel" hint="Start typing a name and pick the channel from the list, or type the exact username.">
                <ChannelSearch
                  platform={platform}
                  value={username}
                  onChange={setUsername}
                  watched={new Set(streamers.filter((s) => s.platform === platform).map((s) => s.username.toLowerCase()))}
                  placeholder={platform === "youtube" ? "Search YouTube, e.g. mkbhd" : platform === "kick" ? "Search Kick, e.g. adinross" : "Search Twitch, e.g. kaicenat"}
                />
              </Field>

              <Button type="submit" size="lg" className="w-full" loading={isPending}>
                <Icon name="radio" />
                Add channel
              </Button>
            </form>
          </Panel>

          <Panel padding="md" className="space-y-4">
            <h2 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-tight text-ink">
              <Bee variant="scout" size={40} className="bee-hover" /> Scout&apos;s last check
            </h2>
            {scoutRunId ? <AgentFeed runId={scoutRunId} compact /> : <p className="text-base text-ink-muted">No checks yet. Press “Check now” on a channel.</p>}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
