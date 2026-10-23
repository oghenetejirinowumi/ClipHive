"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Icon, Notice, Panel, Segmented, inputClass } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

type Platform = "tiktok" | "youtube";

type PopularHashtag = { tag: string; uses: number; total_views: number; score: number; kind: "niche" | "broad"; relevant: boolean };

export type SocialTrends = {
  clip_id: number;
  current_title: string | null;
  current_hashtags: string[];
  context: { summary: string | null; game_or_topic: string | null; event_type: string | null; mood: string | null; creator: string | null };
  platform: Platform;
  fetched_at: string;
  queries: string[];
  videos_scanned: number;
  hashtags: PopularHashtag[];
  recommended_hashtags: string[];
  captions: { text: string; reason: string }[];
  patterns: { sample_size: number; emoji_percent: number; all_caps_percent: number; avg_words: number; hook_words: string[] };
  examples: { title: string; url: string | null; channel: string | null; view_count: number | null }[];
  warnings: string[];
};

const CAPTION_LIMIT: Record<Platform, number> = { tiktok: 2200, youtube: 100 };
const PLATFORM_LABEL: Record<Platform, string> = { tiktok: "TikTok", youtube: "YouTube Shorts" };

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

const asTag = (raw: string) => {
  const clean = raw.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return clean ? `#${clean.toLowerCase()}` : "";
};

export function SocialTrendsPanel({ clipId, clipLabel, onClose }: { clipId: number; clipLabel: string; onClose: () => void }) {
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [data, setData] = useState<SocialTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [customTag, setCustomTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<SocialTrends>(`/api/clips/${clipId}/social-trends?platform=${platform}${refresh ? "&refresh=true" : ""}`);
        setData(res);
        setSelected(res.recommended_hashtags);
        setCaption(res.captions[0]?.text ?? res.current_title ?? "");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't look up popular hashtags. Is the backend running?");
      } finally {
        setLoading(false);
      }
    },
    [clipId, platform],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [clipId]);

  const niche = useMemo(() => data?.hashtags.filter((h) => h.kind === "niche") ?? [], [data]);
  const broad = useMemo(() => data?.hashtags.filter((h) => h.kind === "broad") ?? [], [data]);
  // Picks that aren't in the scraped list (platform tag, custom adds) still show as chips.
  const extras = useMemo(() => selected.filter((t) => !data?.hashtags.some((h) => h.tag === t)), [selected, data]);

  const preview = [caption.trim(), selected.join(" ")].filter(Boolean).join(" ");
  const limit = CAPTION_LIMIT[platform];

  function toggle(tag: string) {
    setSelected((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  }

  function addCustom(e: FormEvent) {
    e.preventDefault();
    const tag = asTag(customTag);
    if (tag && !selected.includes(tag)) setSelected((cur) => [...cur, tag]);
    setCustomTag("");
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      await api(`/api/clips/${clipId}`, { method: "PATCH", body: { title: caption.trim() || null, hashtags: selected } });
      setNotice({ tone: "success", text: "Saved to the clip. It'll be used when you post." });
    } catch (err) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(preview);
      setNotice({ tone: "success", text: "Caption and hashtags copied." });
    } catch {
      setNotice({ tone: "danger", text: "Your browser blocked copying. Select the preview text instead." });
    }
  }

  const chip = (tag: string, uses?: number) => {
    const on = selected.includes(tag);
    return (
      <button
        key={tag}
        type="button"
        aria-pressed={on}
        onClick={() => toggle(tag)}
        title={uses ? `Used by ${uses} of the similar videos` : undefined}
        className={cn(
          "tactile inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-base font-medium",
          on ? "border-brand bg-brand text-on-brand" : "border-line-strong bg-surface text-ink hover:border-brand-soft",
        )}
      >
        {tag}
        {uses ? <span className={cn("font-mono text-fine tabular-nums", on ? "text-on-brand/80" : "text-ink-muted")}>×{uses}</span> : null}
      </button>
    );
  };

  return (
    <div ref={root} className="scroll-mt-10">
    <Panel as="section" padding="md" className="space-y-8" aria-label="Hashtags and captions">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">Hashtags & captions</h2>
          <p className="text-lg text-ink-muted">
            {clipLabel}
            {data && (
              <>
                {" "}
                · from {data.videos_scanned} popular Shorts like this clip, {ago(data.fetched_at)}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Platform"
            value={platform}
            onChange={setPlatform}
            options={[
              { value: "tiktok", label: "TikTok" },
              { value: "youtube", label: "Shorts" },
            ]}
          />
          <Button variant="secondary" size="sm" loading={loading && !!data} disabled={loading} onClick={() => load(true)}>
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close hashtags and captions">
            <Icon name="x" className="size-5" />
          </Button>
        </div>
      </header>

      {error && <Notice tone="danger">{error}</Notice>}

      {loading && !data && (
        <p className="py-10 text-center text-lg text-ink-muted">
          Reading the clip and searching similar Shorts… The first time can take a minute while the clip is transcribed.
        </p>
      )}

      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            {data.context.game_or_topic && <Badge tone="brand">{data.context.game_or_topic}</Badge>}
            {data.context.event_type && <Badge tone="neutral">{data.context.event_type.replace(/_/g, " ")}</Badge>}
            {data.context.creator && <Badge tone="neutral">{data.context.creator}</Badge>}
            {data.patterns.sample_size > 0 && (
              <Badge tone="neutral">
                {data.patterns.emoji_percent}% use emoji · {data.patterns.all_caps_percent}% all-caps · ~{Math.round(data.patterns.avg_words)} words
              </Badge>
            )}
          </div>

          {data.warnings.length > 0 && <Notice tone="brand">{data.warnings.join(" ")}</Notice>}

          <div className="grid gap-10 lg:grid-cols-2">
            {/* Hashtags */}
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="text-lg font-medium text-ink">About this clip</p>
                {niche.length ? (
                  <div className="flex flex-wrap gap-2">{niche.map((h) => chip(h.tag, h.uses))}</div>
                ) : (
                  <p className="text-base text-ink-muted">No topic hashtags found in similar videos.</p>
                )}
              </div>
              {broad.length > 0 && (
                <div className="space-y-3">
                  <p className="text-lg font-medium text-ink">Discovery</p>
                  <div className="flex flex-wrap gap-2">{broad.map((h) => chip(h.tag, h.uses))}</div>
                </div>
              )}
              <div className="space-y-3">
                <p className="text-lg font-medium text-ink">Yours</p>
                {extras.length > 0 && <div className="flex flex-wrap gap-2">{extras.map((t) => chip(t))}</div>}
                <form onSubmit={addCustom} className="flex gap-2">
                  <label htmlFor={`custom-tag-${clipId}`} className="sr-only">
                    Add a hashtag
                  </label>
                  <input
                    id={`custom-tag-${clipId}`}
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    placeholder="#addyourown"
                    className={inputClass}
                  />
                  <Button type="submit" variant="secondary" disabled={!asTag(customTag)}>
                    <Icon name="plus" className="size-5" /> Add
                  </Button>
                </form>
              </div>
            </div>

            {/* Caption */}
            <div className="space-y-6">
              <fieldset className="space-y-3">
                <legend className="mb-3 text-lg font-medium text-ink">Caption ideas</legend>
                {data.captions.map((c) => (
                  <label
                    key={c.text}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-md border p-4",
                      caption === c.text ? "border-brand bg-brand-subtle" : "border-line hover:border-brand-soft",
                    )}
                  >
                    <input type="radio" name={`caption-${clipId}`} checked={caption === c.text} onChange={() => setCaption(c.text)} className="mt-1.5 size-5 accent-brand" />
                    <span className="min-w-0 space-y-1">
                      <span className="block text-lg text-ink">{c.text}</span>
                      <span className="block text-base text-ink-muted">{c.reason}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="space-y-2">
                <label htmlFor={`caption-text-${clipId}`} className="block text-lg font-medium text-ink">
                  Caption
                </label>
                <textarea
                  id={`caption-text-${clipId}`}
                  value={caption}
                  maxLength={255}
                  rows={2}
                  onChange={(e) => setCaption(e.target.value)}
                  className={cn(inputClass, "h-auto resize-y py-4")}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-lg font-medium text-ink">Preview</p>
                  <span className={cn("font-mono text-meta tabular-nums", preview.length > limit ? "text-danger" : "text-ink-muted")}>
                    {preview.length}/{limit}
                  </span>
                </div>
                <Panel tone="sunken" padding="sm" className="text-lg break-words text-ink">
                  {preview || <span className="text-ink-faint">Pick a caption and some hashtags.</span>}
                </Panel>
                {preview.length > limit && <p className="text-base text-danger">Too long for {PLATFORM_LABEL[platform]}. Drop a few hashtags or shorten the caption.</p>}
              </div>

              {notice && (
                <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
                  {notice.text}
                </Notice>
              )}

              <div className="flex flex-wrap gap-3">
                <Button loading={saving} disabled={saving || !preview} onClick={save}>
                  Save to clip
                </Button>
                <Button variant="secondary" disabled={!preview} onClick={copy}>
                  Copy
                </Button>
              </div>
            </div>
          </div>

          {data.examples.length > 0 && (
            <div className="space-y-3">
              <p className="text-lg font-medium text-ink">Popular similar videos</p>
              <ul className="divide-y divide-line">
                {data.examples.map((v, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-4 py-3">
                    <span className="min-w-0">
                      {v.url ? (
                        <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-lg text-ink underline-offset-4 hover:underline">
                          {v.title}
                        </a>
                      ) : (
                        <span className="text-lg text-ink">{v.title}</span>
                      )}
                      {v.channel && <span className="block text-base text-ink-muted">{v.channel}</span>}
                    </span>
                    {v.view_count != null && <span className="shrink-0 font-mono text-meta text-ink-muted tabular-nums">{compact.format(v.view_count)} views</span>}
                  </li>
                ))}
              </ul>
              <p className="text-base text-ink-muted">Searched: {data.queries.join(" · ")}</p>
            </div>
          )}
        </>
      )}
    </Panel>
    </div>
  );
}
