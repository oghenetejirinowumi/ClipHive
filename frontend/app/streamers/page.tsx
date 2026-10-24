"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Badge, Button, Em, Field, Icon, Input, Notice, Panel, SectionLabel, Segmented, SkyHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

type Platform = "twitch" | "kick" | "youtube";

type Streamer = {
  id: number;
  user_id: number;
  platform: Platform;
  username: string;
  is_active: boolean;
  created_at: string;
  is_live: boolean;
  live_title: string | null;
  last_checked_at: string | null;
  check_error: string | null;
  recording: boolean;
  channel_url: string;
};

const PLATFORM_LABEL: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

const REFRESH_MS = 15_000;

type Tone = "live" | "busy" | "idle" | "error";

const DOT: Record<Tone, string> = { live: "bg-success", busy: "animate-pulse bg-warning", error: "bg-danger", idle: "bg-ink-faint" };
const LABEL: Record<Tone, string> = { live: "font-medium text-success", busy: "font-medium text-warning", error: "text-danger", idle: "text-ink-muted" };

function statusOf(s: Streamer): { label: string; tone: Tone } {
  if (!s.is_active) return { label: "Paused · not watching", tone: "idle" };
  if (s.recording) return { label: "Recording the stream · clips arrive as it goes", tone: "busy" };
  if (s.is_live) return { label: s.live_title ? `Live now · ${s.live_title}` : "Live now", tone: "live" };
  if (s.check_error) return { label: s.check_error, tone: "error" };
  if (!s.last_checked_at) return { label: "Checking…", tone: "idle" };
  return { label: "Offline · watching for live", tone: "idle" };
}

export default function StreamersPage() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [isPending, startTransition] = useTransition();

  const loadStreamers = useCallback(async () => {
    try {
      setStreamers(await api<Streamer[]>("/api/streamers"));
    } catch (err) {
      console.warn("Could not load streamers:", err);
    }
  }, []);

  useEffect(() => {
    loadStreamers();
    const timer = setInterval(loadStreamers, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadStreamers]);

  const replace = (updated: Streamer) => setStreamers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  const fail = (err: unknown, fallback: string) => setMessage({ text: err instanceof Error ? err.message : fallback, tone: "danger" });

  function handleAddStreamer(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;

    startTransition(async () => {
      try {
        const created = await api<Streamer>("/api/streamers", {
          method: "POST",
          body: { platform, username: username.trim() },
        });

        setStreamers((prev) => (prev.some((s) => s.id === created.id) ? prev : [...prev, created]));
        setUsername("");
        setMessage({ text: `Now watching ${created.username} on ${PLATFORM_LABEL[created.platform]}.`, tone: "success" });
        // The first live check runs in the background; pick it up shortly.
        setTimeout(loadStreamers, 6_000);
      } catch (err) {
        fail(err, "Failed to add streamer channel.");
      }
    });
  }

  async function run(id: number, action: () => Promise<void>) {
    setBusyId(id);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  }

  const recordNow = (s: Streamer) =>
    run(s.id, async () => {
      try {
        await api(`/api/streamers/${s.id}/record`, { method: "POST" });
        replace({ ...s, recording: true });
        setMessage({ text: `Recording ${s.username} until the stream ends. New clips land in the Hub every few minutes.`, tone: "success" });
      } catch (err) {
        fail(err, "Couldn't start the recording.");
        loadStreamers();
      }
    });

  const stopRecording = (s: Streamer) =>
    run(s.id, async () => {
      try {
        await api(`/api/streamers/${s.id}/stop`, { method: "POST" });
        replace({ ...s, recording: false });
        setMessage({ text: `Stopped recording ${s.username}. The part already recorded is still being clipped.`, tone: "success" });
      } catch (err) {
        fail(err, "Couldn't stop the recording.");
        loadStreamers();
      }
    });

  const clipLatestVod = (s: Streamer) =>
    run(s.id, async () => {
      try {
        await api(`/api/streamers/${s.id}/latest-vod`, { method: "POST", body: {} });
        setMessage({ text: `Clipping ${s.username}'s latest VOD. Track progress on the Create page.`, tone: "success" });
      } catch (err) {
        fail(err, "Couldn't find a VOD to clip.");
      }
    });

  const toggleActive = (s: Streamer) =>
    run(s.id, async () => {
      try {
        replace(await api<Streamer>(`/api/streamers/${s.id}`, { method: "PATCH", body: { is_active: !s.is_active } }));
      } catch (err) {
        fail(err, "Couldn't update the channel.");
      }
    });

  const checkNow = (s: Streamer) =>
    run(s.id, async () => {
      try {
        replace(await api<Streamer>(`/api/streamers/${s.id}/check`, { method: "POST" }));
      } catch (err) {
        fail(err, "Couldn't check live status.");
      }
    });

  const remove = (s: Streamer) =>
    run(s.id, async () => {
      try {
        await api(`/api/streamers/${s.id}`, { method: "DELETE" });
        setStreamers((prev) => prev.filter((x) => x.id !== s.id));
      } catch (err) {
        fail(err, "Failed to remove channel.");
      }
    });

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Stream ingest"
        title={
          <>
            Channels we&apos;re <Em>watching</Em>
          </>
        }
        description="ClipHive monitors Twitch, Kick, and YouTube channels and records high-energy moments while they're live."
      />

      {message && (
        <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Left: monitored channels */}
        <section className="space-y-6 lg:col-span-7">
          <div className="flex items-center justify-between gap-4">
            <SectionLabel>Active channels</SectionLabel>
            <Badge tone="brand" size="md">
              {streamers.filter((s) => s.is_active).length} monitored
            </Badge>
          </div>

          {streamers.length > 0 ? (
            <ul className="divide-y divide-line border-y border-line">
              {streamers.map((s) => {
                const state = statusOf(s);
                const busy = busyId === s.id;

                return (
                  <li key={s.id} className="space-y-4 py-6">
                    <div className="flex min-w-0 items-center gap-5">
                      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-subtle font-display text-2xl font-semibold text-brand-strong uppercase">
                        {s.username.charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <a href={s.channel_url} target="_blank" rel="noreferrer" className="truncate font-display text-2xl font-semibold tracking-tight text-ink hover:underline">
                            {s.username}
                          </a>
                          <Badge tone="neutral">{PLATFORM_LABEL[s.platform] ?? s.platform}</Badge>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-2 text-base">
                          <span aria-hidden className={cn("size-3 shrink-0 rounded-full", DOT[state.tone])} />
                          <span className={cn("truncate", LABEL[state.tone])}>{state.label}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 sm:pl-19">
                      {s.recording ? (
                        <Button size="sm" variant="secondary" loading={busy} onClick={() => stopRecording(s)}>
                          <Icon name="x" />
                          Stop recording
                        </Button>
                      ) : s.is_live ? (
                        <Button size="sm" loading={busy} onClick={() => recordNow(s)}>
                          <Icon name="radio" />
                          Record now
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" loading={busy} onClick={() => clipLatestVod(s)}>
                          <Icon name="film" />
                          Clip latest VOD
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => checkNow(s)}>
                        Check now
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleActive(s)}>
                        {s.is_active ? "Pause" : "Resume"}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy || s.recording} onClick={() => remove(s)}>
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
              <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No streamers added yet</p>
              <p className="mt-2 text-lg text-ink-muted">Add a channel on the right and ClipHive starts watching.</p>
            </Panel>
          )}
        </section>

        {/* Right: add channel + pipeline */}
        <aside className="space-y-8 lg:col-span-5">
          <Panel padding="lg">
            <h3 className="font-display text-3xl font-semibold tracking-tight text-ink">Add a channel</h3>
            <p className="mt-2 text-lg text-ink-muted">Enter any Twitch, Kick, or YouTube username. ClipHive records the whole stream automatically when they go live.</p>

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

              <Field label="Channel username" hint="e.g. tarik, kaicenat, @LofiGirl, or a channel link">
                <Input type="text" placeholder="Enter channel name" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </Field>

              <Button type="submit" size="lg" className="w-full" loading={isPending}>
                <Icon name="radio" />
                Start watching
              </Button>
            </form>
          </Panel>

        </aside>
      </div>
    </div>
  );
}
