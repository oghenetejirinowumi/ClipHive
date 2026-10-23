"use client";

import { useEffect, useState, useTransition } from "react";
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
};

const PLATFORM_LABEL: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

export default function StreamersPage() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

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
        setMessage(`Now monitoring ${created.username} on ${created.platform.toUpperCase()}!`);
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
        description="ClipHive autonomously monitors Twitch, Kick, and YouTube channels to capture high-energy clips."
      />

      {message && (
        <Notice tone={message.startsWith("Failed") ? "danger" : "success"} onDismiss={() => setMessage(null)}>
          {message}
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Left: monitored channels */}
        <section className="space-y-6 lg:col-span-7">
          <div className="flex items-center justify-between gap-4">
            <SectionLabel>Active channels</SectionLabel>
            <Badge tone="brand" size="md">
              {streamers.length} monitored
            </Badge>
          </div>

          {streamers.length > 0 ? (
            <ul className="divide-y divide-line border-y border-line">
              {streamers.map((s, idx) => {
                // Alternate status for realistic demo visual
                const isLive = idx % 2 === 0;

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
                        <div className="mt-1 flex items-center gap-2 text-base">
                          <span aria-hidden className={cn("size-3 rounded-full", isLive ? "bg-success" : "bg-ink-faint")} />
                          <span className={isLive ? "font-medium text-success" : "text-ink-muted"}>{isLive ? "Live now · monitoring" : "Offline · watching for live"}</span>
                        </div>
                      </div>
                    </div>

                    <Button variant="ghost" size="sm" disabled={isPending} onClick={() => handleDeleteStreamer(s.id)}>
                      Remove
                    </Button>
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
            <p className="mt-2 text-lg text-ink-muted">Enter any Twitch, Kick, or YouTube username. ClipHive will automatically track when they go live.</p>

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
                Start watching
              </Button>
            </form>
          </Panel>

        </aside>
      </div>
    </div>
  );
}
