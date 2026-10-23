"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { AgentFeed } from "@/components/agents/AgentFeed";
import { Badge, Button, Em, Field, Icon, Input, Notice, Panel, SectionLabel, Segmented, SkyHeader } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
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
};

type CheckResult = { streamer_id: number; status: "new_vod" | "no_change" | "first_seen" | "error"; message: string; import_job_id: number | null };

const PLATFORM_LABEL: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

function statusLine(s: Streamer): { text: string; tone: "ok" | "idle" | "error" | "paused" } {
  if (!s.is_active) return { text: "Paused", tone: "paused" };
  if (s.last_check_error) return { text: `Last check failed: ${s.last_check_error}`, tone: "error" };
  if (!s.last_checked_at) return { text: "Not checked yet", tone: "idle" };
  return { text: `Checked ${timeAgo(s.last_checked_at)}`, tone: "ok" };
}

export default function StreamersPage() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "brand"; text: string; jobId?: number | null } | null>(null);
  const [checking, setChecking] = useState<number | "all" | null>(null);
  const [scoutRunId, setScoutRunId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

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
      setMessage({ tone: r.status === "error" ? "danger" : r.status === "new_vod" ? "success" : "brand", text: `${s.username}: ${r.message}`, jobId: r.import_job_id });
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : "Check failed." });
    } finally {
      setChecking(null);
      load();
      loadLatestScout();
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
        description="The Scout checks these channels for finished streams. When a new VOD appears, it starts clipping it on its own, and the clips land in your inbox."
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
                {active} watched
              </Badge>
            </div>
            <Button variant="secondary" size="sm" loading={checking === "all"} disabled={!active || checking !== null} onClick={checkAll}>
              <Icon name="refresh" className="size-5" /> Check all now
            </Button>
          </div>

          {streamers.length > 0 ? (
            <ul className="divide-y divide-line border-y border-line">
              {streamers.map((s) => {
                const st = statusLine(s);
                return (
                  <li key={s.id} className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-5">
                      <span className={cn("grid size-14 shrink-0 place-items-center rounded-full font-display text-2xl font-semibold uppercase", s.is_active ? "bg-brand-subtle text-brand-strong" : "bg-surface-sunken text-ink-faint")}>
                        {s.username.charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="truncate font-display text-2xl font-semibold tracking-tight text-ink">{s.username}</span>
                          <Badge tone="neutral">{PLATFORM_LABEL[s.platform] ?? s.platform}</Badge>
                        </div>
                        <p className={cn("mt-1 text-base", st.tone === "error" ? "text-danger" : st.tone === "ok" ? "text-ink" : "text-ink-muted")}>{st.text}</p>
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

                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" loading={checking === s.id} disabled={!s.is_active || (checking !== null && checking !== s.id)} onClick={() => checkNow(s)}>
                        <Icon name="search" className="size-5" /> Check now
                      </Button>
                      <Button variant="ghost" size="sm" disabled={isPending} onClick={() => togglePaused(s)} aria-label={s.is_active ? `Pause ${s.username}` : `Resume ${s.username}`}>
                        <Icon name={s.is_active ? "pause" : "play"} className="size-5" />
                      </Button>
                      <Button variant="ghost" size="sm" disabled={isPending} onClick={() => handleDeleteStreamer(s.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Panel tone="sunken" padding="lg" className="flex flex-col items-center py-14 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                <Icon name="radio" />
              </span>
              <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No channels yet</p>
              <p className="mt-2 text-lg text-ink-muted">Add a channel on the right and the Scout starts watching.</p>
            </Panel>
          )}
        </section>

        <aside className="space-y-8 lg:col-span-5">
          <Panel padding="lg">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">Add a channel</h2>
            <p className="mt-2 text-lg text-ink-muted">Your own channel is best. The first check clips its newest VOD; after that, every new one.</p>

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

              <Field label="Channel username" hint={platform === "youtube" ? "The @handle, e.g. mkbhd" : "e.g. tarik, kaicenat, shroud"}>
                <Input type="text" placeholder="Enter channel name" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </Field>

              <Button type="submit" size="lg" className="w-full" loading={isPending}>
                <Icon name="radio" />
                Start watching
              </Button>
            </form>
          </Panel>

          <Panel padding="md" className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">Scout&apos;s last check</h2>
            {scoutRunId ? <AgentFeed runId={scoutRunId} compact /> : <p className="text-base text-ink-muted">No checks yet. Press “Check now” on a channel.</p>}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
