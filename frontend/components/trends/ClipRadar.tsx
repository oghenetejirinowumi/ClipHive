"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bee, BeeLoader, BeeSwarm, HoneycombLattice } from "@/components/hive";
import { Badge, Button, buttonClass, ChannelAvatar, Em, Icon, Notice, Panel, SectionLabel, SkyHeader, type IconName } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

type Platform = "kick" | "twitch";

type RadarClip = {
  id: string;
  platform: Platform;
  title: string;
  url: string;
  thumbnail_url: string | null;
  views: number;
  duration_s: number | null;
  category: string | null;
  creator: string;
  creator_url: string;
  creator_avatar: string | null;
  created_at: string | null;
};

type Topic = {
  key: string;
  name: string;
  platforms: Platform[];
  live_viewers: number;
  clip_count: number;
  clip_views: number;
  rising_pct: number | null;
  score: number;
  top_clip: RadarClip | null;
  tags: string[];
};

type Creator = { name: string; platform: Platform; url: string; avatar: string | null; clip_count: number; clip_views: number; top_category: string | null };

type Radar = {
  generated_at: string;
  sources: { name: string; ok: boolean; note: string }[];
  topics: Topic[];
  creators: Creator[];
  clips: RadarClip[];
  insights: {
    sample_size: number;
    median_duration_s: number | null;
    under_60s_pct: number | null;
    caps_title_pct: number;
    emoji_title_pct: number;
    median_title_words: number | null;
    common_words: string[];
  };
};

type Suggestion = {
  kind: "clip_topic" | "watch_creator" | "format" | "title" | "your_content";
  title: string;
  why: string;
  topic: string | null;
  hashtags: string[];
  hook: string | null;
  action: { label: string; href: string | null; add_channel: { platform: Platform; username: string } | null } | null;
};

type Suggestions = { generated_at: string; source: "ai" | "rules"; items: Suggestion[] };

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  clip_topic: "Clip this",
  watch_creator: "Watch",
  format: "Format",
  title: "Titles",
  your_content: "Your content",
};

const KIND_ICON: Record<Suggestion["kind"], IconName> = {
  clip_topic: "trending",
  watch_creator: "radio",
  format: "clock",
  title: "captions",
  your_content: "film",
};

const PLATFORM_LABEL: Record<Platform, string> = { kick: "Kick", twitch: "Twitch" };

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function minutesAgo(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : `${m} min ago`;
}

function duration(s: number | null) {
  if (!s) return null;
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

/**
 * Clip Radar: what clippers are posting right now (Kick, plus Twitch when its keys are set),
 * and what this creator should make next. Backend: GET /api/trends/radar and /radar/suggestions.
 */
export function ClipRadar() {
  const [radar, setRadar] = useState<Radar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [suggestError, setSuggestError] = useState(false);
  const [watching, setWatching] = useState<Record<string, "busy" | "done">>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [openPick, setOpenPick] = useState<number | null>(0); // the first suggestion starts open
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const loadSuggestions = useCallback(async () => {
    setSuggestError(false);
    try {
      setSuggestions(await api<Suggestions>("/api/trends/radar/suggestions"));
    } catch {
      setSuggestError(true);
    }
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      setRefreshing(refresh);
      setError(null);
      try {
        const data = await api<Radar>(`/api/trends/radar${refresh ? "?refresh=true" : ""}`);
        setRadar(data);
        loadSuggestions();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't load the radar.");
      } finally {
        setRefreshing(false);
      }
    },
    [loadSuggestions],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function watch(platform: Platform, username: string) {
    const key = `${platform}:${username}`;
    setWatching((w) => ({ ...w, [key]: "busy" }));
    try {
      await api("/api/streamers", { method: "POST", body: { platform, username } });
      setWatching((w) => ({ ...w, [key]: "done" }));
      setNotice({ tone: "success", text: `Watching ${username} on ${PLATFORM_LABEL[platform]}. The Scout will clip their new streams.` });
    } catch {
      setWatching((w) => {
        const next = { ...w };
        delete next[key];
        return next;
      });
      setNotice({ tone: "danger", text: `Couldn't add ${username}.` });
    }
  }

  async function copyTags(i: number, tags: string[]) {
    try {
      await navigator.clipboard.writeText(tags.join(" "));
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1800);
    } catch {
      setNotice({ tone: "danger", text: "Couldn't copy. Select the hashtags and copy them by hand." });
    }
  }

  const down = radar?.sources.filter((s) => !s.ok) ?? [];
  const maxScore = Math.max(1, ...(radar?.topics.map((t) => t.score) ?? [1]));
  const ins = radar?.insights;

  return (
    <div className="space-y-10 sm:space-y-12">
      <SkyHeader
        eyebrow="Clip Radar"
        title={
          <>
            What clippers are posting <Em>right now</Em>
          </>
        }
        description="The topics, clips and clippers getting views in the last 24 hours, and what you should make next."
        decoration={
          <>
            <HoneycombLattice tone="inverse" fade="right" />
            <BeeSwarm count={3} tone="inverse" interactive pollen className="-z-10" />
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghostInverse" size="sm" loading={refreshing} onClick={() => load(true)}>
              <Icon name="refresh" className="size-5" /> Refresh
            </Button>
            {radar && <span className="text-base text-on-brand/80">Updated {minutesAgo(radar.generated_at)}</span>}
          </div>
        }
      />

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {down.map((s) => (
        <Notice key={s.name} tone="brand">
          <span>
            <strong className="font-semibold">{s.name}:</strong> {s.note}
          </span>
        </Notice>
      ))}

      {!radar && !error && <BeeLoader label="The scouts are checking what's hot…" />}

      {radar && (
        <div className="grid gap-10 xl:grid-cols-12 xl:items-start">
          {/* What to make next: first on phones, a sticky sidebar on wide screens. */}
          <aside aria-labelledby="next-heading" className="xl:sticky xl:top-8 xl:col-span-4 xl:col-start-9 xl:row-start-1">
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-glow xl:flex xl:max-h-[calc(100dvh-4rem)] xl:flex-col">
              <div className="next-head relative isolate overflow-hidden px-5 pt-5 pb-4 text-on-brand">
                <HoneycombLattice tone="inverse" fade="right" />
                <div className="flex items-center gap-3">
                  <Bee variant="queen" tone="inverse" size={34} className="bee-hover" />
                  <div className="min-w-0">
                    <h2 id="next-heading" className="font-display text-xl font-semibold tracking-tight">
                      What to make next
                    </h2>
                    <p className="text-meta text-on-brand/75">
                      {suggestions ? `${suggestions.items.length} picks · ${suggestions.source === "ai" ? "by the Queen Bee" : "from today's data"}` : "From today's numbers and your channels"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                {!suggestions && !suggestError && <BeeLoader label="Thinking about what fits you…" className="px-5 py-8" />}
                {suggestError && (
                  <p className="px-5 py-6 text-base text-ink-muted">
                    Couldn&apos;t make suggestions.{" "}
                    <button type="button" onClick={loadSuggestions} className="min-h-11 font-semibold text-brand underline underline-offset-4">
                      Try again
                    </button>
                  </p>
                )}
                {suggestions && (
                  <ul className="space-y-1 p-2">
                    {suggestions.items.map((s, i) => {
                      const add = s.action?.add_channel;
                      const state = add ? watching[`${add.platform}:${add.username}`] : undefined;
                      const hook = s.hook?.replace(/^Top clip right now: /, "").replace(/^"|"$/g, "");
                      const isOpen = openPick === i;
                      const mine = s.kind === "your_content";
                      return (
                        <li key={i} className={cn("rounded-lg transition-colors", isOpen ? "bg-surface-sunken" : "hover:bg-surface-sunken/60")}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setOpenPick(isOpen ? null : i)}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left"
                          >
                            <span
                              className={cn(
                                "grid size-10 shrink-0 place-items-center rounded-lg",
                                mine ? "bg-success-subtle text-success" : "bg-brand-subtle text-brand-strong",
                              )}
                            >
                              <Icon name={KIND_ICON[s.kind]} className="size-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={cn("block text-meta font-medium", mine ? "text-success" : "text-ink-faint")}>{KIND_LABEL[s.kind]}</span>
                              <span className={cn("block leading-snug font-semibold text-ink", !isOpen && "line-clamp-1")}>{s.title}</span>
                            </span>
                            <Icon name="chevronDown" className={cn("size-5 shrink-0 text-ink-faint transition-transform duration-(--motion-fast)", isOpen && "rotate-180")} />
                          </button>

                          {isOpen && (
                            <div className="fx-rise space-y-3 px-3 pb-4 pl-16">
                              <p className="text-meta text-ink-muted">{s.why}</p>
                              {hook && <p className="border-l-2 border-brand pl-3 text-meta text-ink italic">“{hook}”</p>}
                              {s.hashtags.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => copyTags(i, s.hashtags)}
                                  title="Copy hashtags"
                                  className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-left text-meta font-medium text-brand-strong hover:border-brand"
                                >
                                  <span className="min-w-0 truncate">{s.hashtags.join(" ")}</span>
                                  <span className="inline-flex shrink-0 items-center gap-1 text-ink-faint group-hover:text-brand">
                                    <Icon name={copied === i ? "check" : "copy"} aria-hidden className="size-4" />
                                    {copied === i ? "Copied" : "Copy"}
                                  </span>
                                </button>
                              )}
                              {s.action?.href && (
                                <Link href={s.action.href} className={buttonClass({ size: "xs", className: "w-full" })}>
                                  {s.action.label} <Icon name="arrowRight" aria-hidden className="size-4" />
                                </Link>
                              )}
                              {add && (
                                <Button size="xs" className="w-full" loading={state === "busy"} disabled={state === "done"} onClick={() => watch(add.platform, add.username)}>
                                  <Icon name={state === "done" ? "check" : "radio"} aria-hidden className="size-4" />
                                  {state === "done" ? "Watching" : s.action?.label}
                                </Button>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-10 sm:space-y-12 xl:col-span-8 xl:col-start-1 xl:row-start-1">
            {/* What's working */}
            {ins && ins.sample_size > 0 && (
              <section className="space-y-5">
                <div>
                  <SectionLabel>What&apos;s working</SectionLabel>
                  <p className="mt-2 text-base text-ink-muted">From today&apos;s {ins.sample_size} top clips.</p>
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Typical length", ins.median_duration_s ? `${ins.median_duration_s}s` : "—"],
                    ["Under a minute", ins.under_60s_pct !== null ? `${ins.under_60s_pct}%` : "—"],
                    ["Title length", ins.median_title_words ? `${ins.median_title_words} words` : "—"],
                    ["Titles in caps", `${ins.caps_title_pct}%`],
                  ].map(([label, value]) => (
                    <Panel key={label} padding="sm">
                      <dt className="text-meta text-ink-muted">{label}</dt>
                      <dd className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">{value}</dd>
                    </Panel>
                  ))}
                </dl>
              </section>
            )}

            {/* Hot topics */}
            <section className="space-y-5">
              <div>
                <SectionLabel>Hot topics</SectionLabel>
                <p className="mt-2 text-base text-ink-muted">Ranked by clip views today and live viewers right now.</p>
              </div>
              {radar.topics.length === 0 ? (
                <p className="text-base text-ink-muted">Nothing yet. Try Refresh in a minute.</p>
              ) : (
                <ol className="rail sm:divide-y sm:divide-line sm:border-y sm:border-line">
                  {radar.topics.slice(0, 10).map((t, i) => (
                    <li key={t.key} className="flex gap-4 rounded-lg border border-line bg-surface p-4 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0">
                      <span className="w-7 shrink-0 pt-0.5 text-right font-display text-xl font-semibold text-ink-faint">{i + 1}</span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-xl font-semibold tracking-tight text-ink">{t.name}</span>
                          {t.platforms.map((p) => (
                            <Badge key={p} size="sm">
                              {PLATFORM_LABEL[p]}
                            </Badge>
                          ))}
                          {t.rising_pct !== null && Math.abs(t.rising_pct) >= 5 && (
                            <Badge size="sm" tone={t.rising_pct > 0 ? "success" : "neutral"}>
                              {t.rising_pct > 0 ? "▲" : "▼"} {Math.abs(t.rising_pct).toFixed(0)}% live
                            </Badge>
                          )}
                        </div>
                        <p className="text-base text-ink-muted">
                          {t.clip_count > 0 ? `${t.clip_count} top clips · ${compact(t.clip_views)} views today` : "No top clips yet"}
                          {t.live_viewers > 0 && ` · ${compact(t.live_viewers)} watching live`}
                        </p>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (t.score / maxScore) * 100)}%` }} />
                        </div>
                        {t.top_clip && (
                          <a href={t.top_clip.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-meta font-medium text-brand hover:text-brand-strong">
                            <Icon name="play" aria-hidden className="size-4" />
                            <span className="line-clamp-1">
                              Top clip: “{t.top_clip.title || "Untitled"}” · {t.top_clip.creator} · {compact(t.top_clip.views)} views
                            </span>
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Clippers to watch */}
            <section className="space-y-5">
              <div>
                <SectionLabel>Clippers to watch</SectionLabel>
                <p className="mt-2 text-base text-ink-muted">Channels whose clips are getting the most views today.</p>
              </div>
              <ul className="rail rail-rows grid gap-x-8 border-t border-line sm:grid-cols-2">
                {radar.creators.slice(0, 8).map((c) => {
                  const state = watching[`${c.platform}:${c.name}`];
                  return (
                    <li key={`${c.platform}:${c.name}`} className="flex items-center gap-4 border-b border-line py-3">
                      <ChannelAvatar src={c.avatar} name={c.name} size={44} />
                      <div className="min-w-0 flex-1">
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-ink hover:text-brand">
                          {c.name}
                        </a>
                        <p className="truncate text-meta text-ink-muted">
                          {PLATFORM_LABEL[c.platform]} · {compact(c.clip_views)} clip views{c.top_category ? ` · ${c.top_category}` : ""}
                        </p>
                      </div>
                      <Button variant="ghost" size="xs" loading={state === "busy"} disabled={state === "done"} onClick={() => watch(c.platform, c.name)} aria-label={`Watch ${c.name}`}>
                        <Icon name={state === "done" ? "check" : "plus"} className="size-5" />
                        {state === "done" ? "Watching" : "Watch"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Top clips */}
            <section className="space-y-5">
              <div>
                <SectionLabel>Top clips today</SectionLabel>
                <p className="mt-2 text-base text-ink-muted">The most-viewed clips of the last 24 hours. Open one to see what made it work.</p>
              </div>
              <ul className="rail grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [--rail-item:78%]">
                {radar.clips.slice(0, 12).map((c) => (
                  <li key={c.id}>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="group block h-full overflow-hidden rounded-lg border border-line bg-surface hover:border-brand">
                      <div className="relative aspect-video bg-surface-sunken">
                        {c.thumbnail_url && (
                          // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from Kick / Twitch
                          <img src={c.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" />
                        )}
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-meta font-medium text-white">{compact(c.views)} views</span>
                        {duration(c.duration_s) && <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-2 py-0.5 text-meta font-medium text-white">{duration(c.duration_s)}</span>}
                      </div>
                      <div className="space-y-1 p-4">
                        <p className={cn("line-clamp-2 font-semibold text-ink group-hover:text-brand", !c.title && "text-ink-muted")}>{c.title || "Untitled"}</p>
                        <p className="truncate text-meta text-ink-muted">
                          {c.creator} · {PLATFORM_LABEL[c.platform]}
                          {c.category ? ` · ${c.category}` : ""}
                        </p>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
