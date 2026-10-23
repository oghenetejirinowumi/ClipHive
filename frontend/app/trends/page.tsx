"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge, Button, Field, Icon, PageHeader, Panel } from "@/components/ui";
import { api } from "@/lib/api";

type Trend = {
  id: number;
  platform: string;
  topic?: string | null;
  hashtag: string;
  score: number;
  fetched_at: string;
};

type Clip = {
  id: number;
  title?: string | null;
  highlight_score?: number | null;
  hashtags?: string[];
  status: string;
};

export default function TrendsPage() {
  const [platform, setPlatform] = useState<"tiktok" | "youtube">("tiktok");
  const [trends, setTrends] = useState<Trend[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  // Load trends for active platform
  useEffect(() => {
    async function fetchTrends() {
      try {
        const data = await api<Trend[]>(`/api/trends?platform=${platform}`, { auth: false });
        setTrends(data);
      } catch (err) {
        console.warn("Could not fetch trends:", err);
      }
    }
    fetchTrends();
  }, [platform]);

  // Load clips
  useEffect(() => {
    async function fetchClips() {
      try {
        const data = await api<Clip[]>("/api/clips", { auth: false });
        setClips(data);
        if (data.length > 0 && selectedClipId === null) {
          setSelectedClipId(data[0].id);
        }
      } catch (err) {
        console.warn("Could not fetch clips:", err);
      }
    }
    fetchClips();
  }, [selectedClipId]);

  const activeClip = clips.find((c) => c.id === selectedClipId) || clips[0];

  // 1-Click apply single hashtag
  function handleApplySingleTag(tag: string) {
    if (!activeClip) return;

    startTransition(async () => {
      try {
        const updated = await api<Clip>("/api/trends/apply", {
          method: "POST",
          body: { clip_id: activeClip.id, hashtags: [tag] },
          auth: false,
        });
        setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setActionMessage(`Applied ${tag} to Clip #${updated.id}`);
      } catch {
        setActionMessage("Failed to apply hashtag");
      }
    });
  }

  // Trigger AI Virality Pack
  function handleGenerateAiPack() {
    if (!activeClip) return;

    startTransition(async () => {
      setActionMessage("Analyzing transcript with AI Viral Studio...");
      try {
        const updated = await api<Clip>(`/api/clips/${activeClip.id}/ai-pack`, {
          method: "POST",
          auth: false,
        });
        setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setActionMessage(`AI Virality Pack Generated! Title: "${updated.title}"`);
      } catch {
        setActionMessage("AI analysis failed — using heuristic tags.");
      }
    });
  }

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Trend Studio"
        title="Trending Topics & Hashtags"
        description="Discover viral tags across TikTok and YouTube Shorts, with one-click injection into your clips."
      />

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Platform Trends (7 cols) */}
        <div className="space-y-8 lg:col-span-7">
          {/* Platform Switcher Tabs */}
          <div className="flex items-center gap-4">
            <Button
              variant={platform === "tiktok" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setPlatform("tiktok")}
            >
              <Icon name="trending" className="size-5" />
              TikTok Trends
            </Button>
            <Button
              variant={platform === "youtube" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setPlatform("youtube")}
            >
              <Icon name="play" className="size-5" />
              YouTube Shorts
            </Button>
          </div>

          {/* Trends List */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
                Top 10 {platform === "tiktok" ? "TikTok" : "YouTube"} Tags
              </h2>
              <Badge tone="brand" size="md">
                1-Hour Cache
              </Badge>
            </div>

            <div className="grid gap-3">
              {trends.map((t) => (
                <Panel key={t.id} padding="sm" className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-display text-xl font-bold text-ink">{t.hashtag}</span>
                      <Badge tone={t.score > 90 ? "success" : "brand"} size="sm">
                        {t.score.toFixed(1)} Virality
                      </Badge>
                    </div>
                    {t.topic && (
                      <p className="mt-1 truncate text-base text-ink-muted">{t.topic}</p>
                    )}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isPending || !activeClip}
                    onClick={() => handleApplySingleTag(t.hashtag)}
                  >
                    + Add to Clip
                  </Button>
                </Panel>
              ))}

              {trends.length === 0 && (
                <Panel tone="sunken">
                  <p className="text-base text-ink-muted">No trending hashtags found for this platform.</p>
                </Panel>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Active Clip & AI Virality Studio (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          <Panel tone="brand">
            <div className="flex items-center justify-between">
              <span className="font-display text-xl font-semibold text-ink">AI Virality Studio</span>
              <Badge tone="brand" size="md">
                gpt-4o-mini
              </Badge>
            </div>
            <p className="mt-2 text-base text-ink-muted">
              Analyze clip transcript to generate high-CTR titles, compute hook retention scores, and inject viral tags.
            </p>

            <div className="mt-6">
              <Button
                variant="primary"
                size="md"
                className="w-full"
                loading={isPending}
                disabled={!activeClip || isPending}
                onClick={handleGenerateAiPack}
              >
                <Icon name="radio" className="size-5" />
                Generate AI Virality Pack
              </Button>
            </div>

            {actionMessage && (
              <p className="mt-4 text-base font-medium text-brand-strong">{actionMessage}</p>
            )}
          </Panel>

          {/* Active Clip Card */}
          <Panel>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl font-semibold text-ink">Active Clip Metadata</h3>
              {activeClip?.highlight_score && (
                <Badge tone="success" size="md">
                  Hook Score: {activeClip.highlight_score}/100
                </Badge>
              )}
            </div>

            <div className="mt-6 space-y-4">
              {clips.length > 0 ? (
                <Field label="Selected Clip" hint="Target clip for hashtag injection">
                  <select
                    value={selectedClipId ?? ""}
                    onChange={(e) => setSelectedClipId(Number(e.target.value))}
                    className="w-full rounded-md border border-line bg-surface p-3 text-base text-ink"
                  >
                    {clips.map((c) => (
                      <option key={c.id} value={c.id}>
                        Clip #{c.id} — {c.title || "Untitled"} ({c.status})
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p className="text-base text-ink-muted">No clips available in database.</p>
              )}

              {activeClip && (
                <div className="space-y-4 pt-2">
                  <div>
                    <span className="text-meta font-medium text-ink-faint">Viral Title:</span>
                    <p className="mt-1 font-display text-xl font-semibold text-ink">
                      {activeClip.title || "No title set"}
                    </p>
                  </div>

                  <div>
                    <span className="text-meta font-medium text-ink-faint">Current Hashtags:</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {activeClip.hashtags && activeClip.hashtags.length > 0 ? (
                        activeClip.hashtags.map((tag, idx) => (
                          <Badge key={idx} tone="neutral" size="md">
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-base text-ink-muted">No hashtags attached yet.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
