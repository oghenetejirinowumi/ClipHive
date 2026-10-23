"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Badge, Button, buttonClass, Em, Field, Icon, Input, Notice, Panel, SectionLabel, Segmented, SkyHeader } from "@/components/ui";
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
};

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

export default function StreamersPage() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const [statuses, setStatuses] = useState<Record<number, LiveStatus>>({});
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [, tick] = useState(0); // re-render so "checked 20s ago" stays current

  const loadStatus = useCallback(async (refresh = false) => {
    setChecking(true);
    try {
      const list = await api<LiveStatus[]>(`/api/streamers/status${refresh ? "?refresh=true" : ""}`, { auth: false });
      setStatuses(Object.fromEntries(list.map((st) => [st.streamer_id, st])));
      setLastChecked(new Date().toISOString());
    } catch (err) {
      console.warn("Could not check live status:", err);
    } finally {
      setChecking(false);
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

  useEffect(() => {
    async function loadStreamers() {
      try {
        const data = await api<Streamer[]>("/api/streamers", { auth: false });
        setStreamers(data);
      } catch (err) {
        console.warn("Could not load streamers:", err);
      }
    }
    loadStreamers();
  }, []);

  function handleAddStreamer(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;

    startTransition(async () => {
      try {
        const created = await api<Streamer>("/api/streamers", {
          method: "POST",
          body: { platform, username: username.trim().toLowerCase() },
          auth: false,
        });

        setStreamers((prev) => {
          if (prev.some((s) => s.id === created.id)) return prev;
          return [...prev, created];
        });

        setUsername("");
        setMessage(`Added ${created.username} on ${PLATFORM_LABEL[created.platform] ?? created.platform}.`);
        loadStatus();
      } catch {
        setMessage("Failed to add streamer channel.");
      }
    });
  }

  function handleDeleteStreamer(id: number) {
    startTransition(async () => {
      try {
        await api(`/api/streamers/${id}`, { method: "DELETE", auth: false });
        setStreamers((prev) => prev.filter((s) => s.id !== id));
      } catch {
        setMessage("Failed to remove channel.");
      }
    });
  }

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Stream ingest"
        title={
          <>
            Channels we&apos;re <Em>watching</Em>
          </>
        }
        description="See which of your Twitch, Kick and YouTube channels are live right now, checked against each platform. When a stream ends, paste its VOD into Create to clip it."
      />

      {message && (
        <Notice tone={message.startsWith("Failed") ? "danger" : "success"} onDismiss={() => setMessage(null)}>
          {message}
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Left: monitored channels */}
        <section className="space-y-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <SectionLabel>Your channels</SectionLabel>
              <Badge tone="brand" size="md">
                {Object.values(statuses).filter((st) => st.live).length} live of {streamers.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              {lastChecked && <span className="text-base text-ink-muted">Checked {ago(lastChecked)}</span>}
              <Button variant="ghost" size="sm" loading={checking} disabled={checking || streamers.length === 0} onClick={() => loadStatus(true)}>
                Refresh
              </Button>
            </div>
          </div>

          {streamers.length > 0 ? (
            <ul className="divide-y divide-line border-y border-line">
              {streamers.map((s) => {
                const st = statuses[s.id];
                const live = st?.live === true;

                return (
                  <li key={s.id} className="flex items-center justify-between gap-4 py-6">
                    <div className="flex min-w-0 items-center gap-5">
                      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-subtle font-display text-2xl font-semibold text-brand-strong uppercase">
                        {s.username.charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="truncate font-display text-2xl font-semibold tracking-tight text-ink">{s.username}</span>
                          <Badge tone="neutral">{PLATFORM_LABEL[s.platform] ?? s.platform}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-base" aria-live="polite">
                          {/* status dot (decorative: the text next to it carries the state) */}
                          <span aria-hidden className={cn("size-3 shrink-0 rounded-full", !st ? "animate-pulse bg-ink-faint" : live ? "bg-success" : st.live === null ? "bg-warning" : "bg-ink-faint")} />
                          {!st ? (
                            <span className="text-ink-muted">Checking…</span>
                          ) : live ? (
                            <span className="font-medium text-success">
                              Live now{st.viewers != null && ` · ${compact(st.viewers)} watching`}
                              {st.category && ` · ${st.category}`}
                            </span>
                          ) : st.live === null ? (
                            <span className="text-warning">Couldn&apos;t check{st.error ? ` · ${st.error}` : ""}</span>
                          ) : (
                            <span className="text-ink-muted">Offline</span>
                          )}
                        </div>
                        {live && st.title && <p className="mt-1 line-clamp-1 text-base text-ink-muted">{st.title}</p>}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {live && (
                        <a href={st.url} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                          <Icon name="play" className="size-5" /> Watch
                        </a>
                      )}
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
              <p className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink">No streamers added yet</p>
              <p className="mt-2 text-lg text-ink-muted">Add a channel on the right and ClipHive starts watching.</p>
            </Panel>
          )}
        </section>

        {/* Right: add channel + pipeline */}
        <aside className="space-y-8 lg:col-span-5">
          <Panel padding="lg">
            <h3 className="font-display text-3xl font-semibold tracking-tight text-ink">Add a channel</h3>
            <p className="mt-2 text-lg text-ink-muted">Enter any Twitch, Kick, or YouTube username. ClipHive checks whether they’re live and shows it here.</p>

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

              <Field label="Channel username" hint="e.g. tarik, kaicenat, shroud">
                <Input type="text" placeholder="Enter channel name" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </Field>

              <Button type="submit" size="lg" className="w-full" loading={isPending}>
                <Icon name="radio" />
                Add channel
              </Button>
            </form>
          </Panel>

        </aside>
      </div>
    </div>
  );
}
