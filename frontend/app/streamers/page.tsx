"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge, Button, Field, Icon, Ledger, PageHeader, Panel } from "@/components/ui";
import { api } from "@/lib/api";

type Streamer = {
  id: number;
  user_id: number;
  platform: "twitch" | "kick" | "youtube";
  username: string;
  is_active: boolean;
  created_at: string;
};

export default function StreamersPage() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<"twitch" | "kick" | "youtube">("twitch");
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
        alert("Failed to remove channel.");
      }
    });
  }

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Stream Ingest"
        title="Monitored Streamers"
        description="ClipHive autonomously monitors Twitch, Kick, and YouTube channels to capture high-energy clips."
      />

      {message && (
        <Panel tone="brand" padding="sm" className="flex items-center justify-between">
          <span className="text-base font-semibold text-brand-strong">{message}</span>
          <Button variant="ghost" size="sm" onClick={() => setMessage(null)}>
            Dismiss
          </Button>
        </Panel>
      )}

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Streamers List (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">Active Channels</h2>
            <Badge tone="brand" size="md">
              {streamers.length} Monitored
            </Badge>
          </div>

          <div className="grid gap-4">
            {streamers.map((s, idx) => {
              // Alternate status for realistic demo visual
              const isLive = idx % 2 === 0;

              return (
                <Panel key={s.id} padding="sm" className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-strong">
                      <Icon name="radio" className="size-6" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-display text-xl font-bold text-ink">{s.username}</span>
                        <Badge tone={s.platform === "twitch" ? "brand" : "neutral"} size="sm">
                          {s.platform.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-meta">
                        <span aria-hidden className={`size-3 rounded-full ${isLive ? "bg-success" : "bg-ink-faint"}`} />
                        <span className={isLive ? "font-medium text-success" : "text-ink-muted"}>
                          {isLive ? "LIVE NOW (Monitoring)" : "Offline (Watching for live)"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleDeleteStreamer(s.id)}
                  >
                    Remove
                  </Button>
                </Panel>
              );
            })}

            {streamers.length === 0 && (
              <Panel tone="sunken" className="text-center py-8">
                <p className="text-base text-ink-muted">No streamers added yet.</p>
              </Panel>
            )}
          </div>
        </div>

        {/* Right Column: Add Streamer & Ingestion Status (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          <Panel>
            <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Channel</h3>
            <p className="mt-2 text-base text-ink-muted">
              Enter any Twitch, Kick, or YouTube username. ClipHive will automatically track when they go live.
            </p>

            <form onSubmit={handleAddStreamer} className="mt-6 space-y-4">
              <Field label="Platform">
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as "twitch" | "kick" | "youtube")}
                  className="w-full rounded-md border border-line bg-surface p-3 text-base text-ink"
                >
                  <option value="twitch">Twitch</option>
                  <option value="kick">Kick</option>
                  <option value="youtube">YouTube</option>
                </select>
              </Field>

              <Field label="Channel Username" hint="e.g. tarik, kaicenat, shroud">
                <input
                  type="text"
                  placeholder="Enter channel name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-md border border-line bg-surface p-3 text-base text-ink"
                  required
                />
              </Field>

              <div className="pt-2">
                <Button type="submit" size="md" className="w-full" loading={isPending}>
                  <Icon name="radio" className="size-5" />
                  Start Watching Channel
                </Button>
              </div>
            </form>
          </Panel>

          <Panel tone="sunken">
            <h4 className="font-display text-xl font-semibold tracking-tight text-ink">Autonomous Ingest Pipeline</h4>
            <Ledger
              className="mt-4"
              items={[
                { label: "Polling", value: "Every 60s", hint: "Twitch Helix & Kick Public endpoints" },
                { label: "Recording", value: "streamlink", hint: "Captures 1080p source stream chunks" },
                { label: "Scoring", value: "Acoustic / Scene", hint: "Loudness spikes + cut boundaries" },
                { label: "Handoff", value: "C2 Caption Studio", hint: "Auto-routes raw cuts for word-pop" },
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
