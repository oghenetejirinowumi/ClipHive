"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge, Button, Em, Field, Icon, Notice, Panel, SectionLabel, Segmented, Select, SkyHeader, StatusBadge } from "@/components/ui";
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

  const messageTone = actionMessage?.startsWith("Failed") || actionMessage?.startsWith("AI analysis failed") ? "danger" : actionMessage?.startsWith("Applied") || actionMessage?.startsWith("AI Virality Pack Generated") ? "success" : "brand";
  const platformName = platform === "tiktok" ? "TikTok" : "YouTube Shorts";

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Trend studio"
        title={
          <>
            What&apos;s <Em>trending</Em> right now
          </>
        }
        description="Discover viral tags across TikTok and YouTube Shorts, with one-click injection into your clips."
      />

      {actionMessage && (
        <Notice tone={messageTone} onDismiss={() => setActionMessage(null)}>
          {actionMessage}
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Left: ranked trends */}
        <section className="space-y-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Segmented
              label="Platform"
              value={platform}
              onChange={setPlatform}
              options={[
                { value: "tiktok", label: "TikTok", icon: "trending" },
                { value: "youtube", label: "YouTube Shorts", icon: "play" },
              ]}
            />
            <Badge tone="neutral" size="md">
              Refreshed hourly
            </Badge>
          </div>

          <SectionLabel>Top {trends.length || 10} on {platformName}</SectionLabel>

          {trends.length > 0 ? (
            <ol className="divide-y divide-line border-y border-line">
              {trends.map((t, i) => (
                <li key={t.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-5 gap-y-4 py-6 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
                  <span className={`font-display text-4xl font-semibold tracking-tight tabular-nums ${i === 0 ? "text-brand" : "text-ink-faint"}`}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-display text-2xl font-semibold tracking-tight text-ink">{t.hashtag}</p>
                    {t.topic && <p className="mt-1 truncate text-lg text-ink-muted">{t.topic}</p>}
                    {/* Virality meter */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-2.5 w-40 overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.score)} aria-label="Virality">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, t.score))}%` }} />
                      </div>
                      <span className="text-base text-ink-muted tabular-nums">{t.score.toFixed(1)} virality</span>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" disabled={isPending || !activeClip} onClick={() => handleApplySingleTag(t.hashtag)} className="col-start-2 justify-self-start sm:col-start-auto">
                    <Icon name="plus" className="size-5" />
                    Add to clip
                  </Button>
                </li>
              ))}
            </ol>
          ) : (
            <Panel tone="sunken" padding="lg" className="text-center">
              <p className="text-lg text-ink-muted">No trending hashtags found for this platform.</p>
            </Panel>
          )}
        </section>

        {/* Right: AI pack + active clip */}
        <aside className="space-y-8 lg:col-span-5">
          <div className="relative isolate overflow-hidden rounded-xl bg-brand p-8 text-on-brand shadow-glow lg:p-10">
            <div className="flex items-center justify-between gap-4">
              <SectionLabel inverse>AI virality studio</SectionLabel>
              <span className="shrink-0 rounded-full bg-on-brand/15 px-3 py-1 font-mono text-fine whitespace-nowrap text-on-brand">gpt-4o-mini</span>
            </div>
            <p className="mt-6 font-display text-3xl leading-tight font-semibold tracking-tight">
              Titles and tags that <Em>hook</Em>
            </p>
            <p className="mt-3 text-lg text-on-brand/85">Analyze clip transcript to generate high-CTR titles, compute hook retention scores, and inject viral tags.</p>
            <Button variant="inverse" size="lg" className="mt-8 w-full" loading={isPending} disabled={!activeClip || isPending} onClick={handleGenerateAiPack}>
              <Icon name="sparkles" />
              Generate AI virality pack
            </Button>
          </div>

          <Panel padding="lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">Active clip</h3>
              {activeClip?.highlight_score ? (
                <Badge tone="brand" size="md">
                  Hook {activeClip.highlight_score}/100
                </Badge>
              ) : null}
            </div>

            <div className="mt-6 space-y-6">
              {clips.length > 0 ? (
                <Field label="Selected clip" hint="Target clip for hashtag injection">
                  <Select value={selectedClipId ?? ""} onChange={(e) => setSelectedClipId(Number(e.target.value))}>
                    {clips.map((c) => (
                      <option key={c.id} value={c.id}>
                        Clip #{c.id} — {c.title || "Untitled"} ({c.status})
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-lg text-ink-muted">No clips available in database.</p>
              )}

              {activeClip && (
                <div className="space-y-6 border-t border-line pt-6">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-lg text-ink-muted">Status</span>
                    <StatusBadge status={activeClip.status} />
                  </div>
                  <div>
                    <span className="text-lg text-ink-muted">Viral title</span>
                    <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">{activeClip.title || "No title set"}</p>
                  </div>
                  <div>
                    <span className="text-lg text-ink-muted">Hashtags</span>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeClip.hashtags && activeClip.hashtags.length > 0 ? (
                        activeClip.hashtags.map((tag, idx) => (
                          <Badge key={idx} tone="brand" size="md">
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-lg text-ink-faint">No hashtags attached yet.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
