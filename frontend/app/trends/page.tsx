"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import {
  Badge,
  Button,
  Field,
  Icon,
  Notice,
  PageHeader,
  Panel,
  Segmented,
  Select,
  inputClass,
} from "@/components/ui";
import { api, ApiError, GENERIC_ERROR } from "@/lib/api";

type Platform = "youtube" | "tiktok";
type TrendRow = {
  id: number;
  hashtag: string;
  score: number | null;
  stage: string;
  sample_size: number;
  source: string;
  reasons: string[];
  velocity: number | null;
  usage_growth: number | null;
  calculated_at: string;
};
type PageResult = {
  items: TrendRow[];
  page: number;
  page_size: number;
  total: number;
};
type TrendStatus = {
  providers: {
    provider: string;
    configured: boolean;
    collection_allowed: boolean;
    healthy: boolean | null;
    last_success: string | null;
    last_error: string | null;
    quota_used_today: number;
    tracked_video_count: number;
    capabilities: { regions: string[] };
  }[];
};
type TrendVideo = {
  external_id: string;
  title: string;
  url: string;
  thumbnail_url: string | null;
  velocity: number;
  views: number | null;
  short_confidence: number;
  source: string;
};
type Patterns = {
  region: string;
  sample_size: number;
  disclaimer?: string;
  median_title_words?: number;
  patterns: { name: string; percent: number; count: number }[];
};
type Detail = {
  hashtag: string;
  history: {
    score: number | null;
    stage: string;
    reasons: string[];
    calculated_at: string;
  }[];
  reasons: string[];
  videos: {
    title: string;
    url: string;
    thumbnail_url: string | null;
    views: number | null;
    short_confidence: number;
  }[];
  related_hashtags: string[];
};
type Clip = {
  id: number;
  title: string | null;
  hashtags: string[];
  context_json?: {
    ai_generated?: boolean;
    suggested_style?: string;
    hype_words?: string[];
    hashtag_sources?: { hashtag: string; source: string }[];
  } | null;
};

const stageTone = (stage: string): "brand" | "neutral" | "warning" => {
  if (stage === "emerging" || stage === "accelerating") return "brand";
  if (stage === "declining" || stage === "peaking") return "warning";
  return "neutral";
};

function formatNumber(value: number | null | undefined) {
  if (value == null) return "Not available";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function updatedLabel(value?: string | null) {
  if (!value) return "No successful collection yet";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 1 ? "Updated just now" : `Updated ${minutes} min ago`;
}

export default function TrendsPage() {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [region, setRegion] = useState<"NG" | "US">("NG");
  const [data, setData] = useState<PageResult | null>(null);
  const [videos, setVideos] = useState<TrendVideo[] | null>(null);
  const [patterns, setPatterns] = useState<Patterns | null>(null);
  const [status, setStatus] = useState<TrendStatus | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClip, setSelectedClip] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedTag, setSelectedTag] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [videosLoading, setVideosLoading] = useState(true);
  const [patternsLoading, setPatternsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api<PageResult>(
      `/api/trends/hashtags?platform=${platform}&region=${region}&page=${page}&page_size=20`,
      { auth: false },
    )
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof ApiError ? cause.message : GENERIC_ERROR);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [platform, region, page]);

  useEffect(() => {
    let active = true;
    setVideosLoading(true);
    setPatternsLoading(true);
    setVideoError(null);
    setPatternsError(null);
    api<TrendVideo[]>(
      `/api/trends/videos?region=${region}&sort=velocity&limit=12`,
      { auth: false },
    )
      .then((result) => {
        if (active) setVideos(result);
      })
      .catch((cause: unknown) => {
        if (active) setVideoError(cause instanceof ApiError ? cause.message : GENERIC_ERROR);
      })
      .finally(() => {
        if (active) setVideosLoading(false);
      });
    api<Patterns>(`/api/trends/patterns?region=${region}`, { auth: false })
      .then((result) => {
        if (active) setPatterns(result);
      })
      .catch((cause: unknown) => {
        if (active) setPatternsError(cause instanceof ApiError ? cause.message : GENERIC_ERROR);
      })
      .finally(() => {
        if (active) setPatternsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [region]);

  useEffect(() => {
    api<TrendStatus>("/api/trends/status", { auth: false })
      .then(setStatus)
      .catch(() => setStatus(null));
    api<Clip[]>("/api/clips", { auth: false })
      .then((result) => {
        setClips(result);
        if (result.length) setSelectedClip(String(result[0].id));
      })
      .catch(() => setClips([]));
  }, []);

  useEffect(() => {
    if (!selectedTag) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    api<Detail>(
      `/api/trends/hashtags/${encodeURIComponent(selectedTag)}?platform=${platform}&region=${region}`,
      { auth: false },
    )
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((cause: unknown) => {
        if (active) setDetailError(cause instanceof ApiError ? cause.message : GENERIC_ERROR);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTag, platform, region]);

  const youtubeStatus = status?.providers.find(
    (provider) => provider.provider === "youtube",
  );
  const sourceLabel =
    platform === "youtube"
      ? !youtubeStatus?.configured
        ? "YouTube trends are coming soon"
        : !youtubeStatus.collection_allowed
          ? "YouTube trends are coming soon"
          : youtubeStatus.healthy === false
            ? "YouTube trends couldn't be updated. Try again later."
            : `YouTube Shorts · ${youtubeStatus.tracked_video_count} videos tracked · ${updatedLabel(youtubeStatus?.last_success)}`
      : "TikTok · add hashtags you're tracking by importing them";

  function addTag(tag: string) {
    if (!selectedClip) {
      setMessage("Select a clip before adding a hashtag.");
      return;
    }
    startTransition(async () => {
      try {
        await api("/api/trends/apply", {
          method: "POST",
          body: { clip_id: Number(selectedClip), hashtags: [tag] },
          auth: false,
        });
        setMessage(`${tag} added to clip ${selectedClip}.`);
      } catch (cause) {
        setMessage(
          cause instanceof ApiError ? cause.message : GENERIC_ERROR,
        );
      }
    });
  }

  function runCollection() {
    startTransition(async () => {
      try {
        const result = await api<{ status: string; detail?: string }>(
          "/api/trends/jobs/run",
          { method: "POST", body: { regions: [region] } },
        );
        setMessage(result.detail || `Collection finished: ${result.status}.`);
        const refreshed = await api<PageResult>(
          `/api/trends/hashtags?platform=${platform}&region=${region}&page=1&page_size=20`,
          { auth: false },
        );
        setPage(1);
        setData(refreshed);
        const nextStatus = await api<TrendStatus>("/api/trends/status", {
          auth: false,
        });
        setStatus(nextStatus);
      } catch (cause) {
        setMessage(
          cause instanceof ApiError ? cause.message : GENERIC_ERROR,
        );
      }
    });
  }

  function importManualTags() {
    startTransition(async () => {
      try {
        const result = await api<{ imported: number }>("/api/trends/import", {
          method: "POST",
          body: { csv_text: csvText, region },
        });
        setMessage(`${result.imported} manual TikTok tags imported.`);
        setCsvText("");
        const refreshed = await api<PageResult>(
          `/api/trends/hashtags?platform=tiktok&region=${region}&page=1&page_size=20`,
          { auth: false },
        );
        setData(refreshed);
      } catch (cause) {
        setMessage(
          cause instanceof ApiError ? cause.message : GENERIC_ERROR,
        );
      }
    });
  }

  function generateAiPack() {
    if (!selectedClip) {
      setMessage("Select a clip before generating its AI pack.");
      return;
    }
    startTransition(async () => {
      try {
        const updated = await api<Clip>(
          `/api/clips/${selectedClip}/ai-pack?platform=${platform}`,
          { method: "POST", auth: false },
        );
        setClips((current) =>
          current.map((clip) => (clip.id === updated.id ? updated : clip)),
        );
        setMessage("Clip package generated.");
      } catch (cause) {
        setMessage(
          cause instanceof ApiError ? cause.message : GENERIC_ERROR,
        );
      }
    });
  }

  const totalPages = Math.max(
    1,
    Math.ceil((data?.total ?? 0) / (data?.page_size ?? 20)),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Trend intelligence"
        title="Rising signals"
        description="A regional read on gaming Shorts, built from observed video performance."
      />

      {message && (
        <Notice tone="brand" onDismiss={() => setMessage(null)}>
          {message}
        </Notice>
      )}

      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-6">
        <div className="flex flex-wrap items-end gap-5">
          <Segmented
            label="Platform"
            value={platform}
            onChange={(value) => {
              setPlatform(value);
              setPage(1);
            }}
            options={[
              { value: "youtube", label: "YouTube Shorts", icon: "play" },
              { value: "tiktok", label: "TikTok", icon: "trending" },
            ]}
          />
          <Segmented
            label="Region"
            value={region}
            onChange={setRegion}
            options={[
              { value: "NG", label: "Nigeria" },
              { value: "US", label: "United States" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {platform === "youtube" &&
            youtubeStatus?.configured &&
            youtubeStatus.collection_allowed && (
              <Button
                size="sm"
                variant="secondary"
                loading={pending}
                onClick={runCollection}
              >
                <Icon name="trending" className="size-5" />
                Collect now
              </Button>
            )}
          <span className="text-meta text-ink-muted" role="status">
            {sourceLabel}
          </span>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <section aria-labelledby="rising-heading" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="rising-heading"
                className="font-display text-2xl font-semibold text-ink"
              >
                Rising hashtags
              </h2>
              <p className="mt-1 text-meta text-ink-muted">
                Sorted by normalized trend score, not lifetime views.
              </p>
            </div>
            {clips.length > 0 && (
              <Field label="Target clip">
                <Select
                  value={selectedClip}
                  onChange={(event) => setSelectedClip(event.target.value)}
                >
                  {clips.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      Clip {clip.id} · {clip.title || "Untitled"}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <Panel padding="none" className="overflow-hidden">
            {loading ? (
              <p className="p-6 text-base text-ink-muted">
                Loading hashtag signals…
              </p>
            ) : error ? (
              <Notice tone="danger">{error}</Notice>
            ) : data?.items.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-190 border-collapse text-left">
                    <thead className="bg-surface-sunken text-meta text-ink-muted">
                      <tr>
                        <th className="px-5 py-4 font-medium">Hashtag</th>
                        <th className="px-3 py-4 font-medium">Stage</th>
                        <th className="px-3 py-4 font-medium">Score</th>
                        <th className="px-3 py-4 font-medium">24h use</th>
                        <th className="px-3 py-4 font-medium">Videos</th>
                        <th className="px-3 py-4 font-medium">
                          Median views/hr
                        </th>
                        <th className="px-5 py-4" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.items.map((row) => (
                        <tr key={row.id} className="align-middle">
                          <td className="px-5 py-4">
                            <button
                              type="button"
                              className="font-display text-lg font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:text-brand"
                              onClick={() => setSelectedTag(row.hashtag)}
                            >
                              {row.hashtag}
                            </button>
                            <p className="mt-1 text-meta text-ink-muted">
                              {row.source === "manual_import"
                                ? "Manual import"
                                : `From ${row.sample_size} collected videos`}
                            </p>
                          </td>
                          <td className="px-3 py-4">
                            <Badge tone={stageTone(row.stage)}>
                              {row.stage.replaceAll("_", " ")}
                            </Badge>
                          </td>
                          <td className="px-3 py-4 font-mono text-base tabular-nums text-ink">
                            {row.score == null ? "—" : row.score.toFixed(0)}
                          </td>
                          <td className="px-3 py-4 text-base tabular-nums text-ink-muted">
                            {row.usage_growth == null
                              ? "—"
                              : `${row.usage_growth > 0 ? "+" : ""}${row.usage_growth.toFixed(0)}%`}
                          </td>
                          <td className="px-3 py-4 text-base tabular-nums text-ink-muted">
                            {row.sample_size}
                          </td>
                          <td className="px-3 py-4 text-base tabular-nums text-ink-muted">
                            {formatNumber(row.velocity)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!selectedClip || pending}
                              onClick={() => addTag(row.hashtag)}
                            >
                              <Icon name="plus" className="size-5" />
                              <span className="sr-only">
                                Add {row.hashtag} to clip
                              </span>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-line px-5 py-4">
                  <span className="text-meta text-ink-muted">
                    {data.total} signals
                  </span>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      <Icon name="arrowRight" className="size-5 rotate-180" />
                      <span>Previous</span>
                    </Button>
                    <span className="text-meta tabular-nums text-ink-muted">
                      {page} / {totalPages}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      <span>Next</span>
                      <Icon name="arrowRight" className="size-5" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3 p-6">
                <p className="text-lg font-medium text-ink">
                  {platform === "youtube" && !youtubeStatus?.configured
                    ? "YouTube collection is not configured."
                    : platform === "youtube" &&
                        !youtubeStatus?.collection_allowed
                      ? "YouTube trends are coming soon."
                      : platform === "tiktok"
                        ? "No TikTok manual imports for this region."
                        : "No scored hashtags yet."}
                </p>
                <p className="text-base text-ink-muted">
                  {platform === "youtube" && !youtubeStatus?.configured
                    ? "YouTube trends aren't available yet. Check back soon."
                    : platform === "youtube" &&
                        !youtubeStatus?.collection_allowed
                      ? "YouTube trends aren't available yet. Check back soon."
                      : "Trends appear once we've collected a few days of data."}
                </p>
              </div>
            )}
          </Panel>
        </section>

        <aside className="space-y-8">
          <section aria-labelledby="detail-heading" className="space-y-4">
            <h2
              id="detail-heading"
              className="font-display text-2xl font-semibold text-ink"
            >
              {selectedTag || "Hashtag detail"}
            </h2>
            {!selectedTag ? (
              <p className="text-base text-ink-muted">
                Select a hashtag to inspect its score history and source videos.
              </p>
            ) : detailLoading ? (
              <p className="text-base text-ink-muted">
                Loading hashtag detail…
              </p>
            ) : detailError ? (
              <Notice tone="danger">{detailError}</Notice>
            ) : (
              detail && (
                <div className="space-y-5 border-l-2 border-brand pl-5">
                  <div>
                    <p className="text-meta font-medium text-ink-muted">
                      Score history
                    </p>
                    {detail.history.length ? (
                      <div
                        className="mt-3 flex h-20 items-end gap-1.5"
                        aria-label="Trend score history"
                      >
                        {detail.history.map((point, index) => (
                          <div
                            key={`${point.calculated_at}-${index}`}
                            title={`${point.score ?? "No score"} · ${point.stage}`}
                            className="min-w-1 flex-1 rounded-t-sm bg-brand"
                            style={{
                              height: `${Math.max(8, point.score ?? 8)}%`,
                              opacity:
                                0.35 +
                                (index / Math.max(detail.history.length, 1)) *
                                  0.65,
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-base text-ink-muted">
                        No score history available.
                      </p>
                    )}
                  </div>
                  <ul className="space-y-2">
                    {detail.reasons.map((reason) => (
                      <li key={reason} className="text-base text-ink-muted">
                        {reason}
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-2">
                    <p className="text-meta font-medium text-ink-muted">
                      Sample videos
                    </p>
                    {detail.videos.length ? (
                      detail.videos.map((video) => (
                        <a
                          key={video.url}
                          href={video.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 border-t border-line py-3 text-base text-ink hover:text-brand"
                        >
                          {video.thumbnail_url && (
                            <Image
                              src={video.thumbnail_url}
                              alt=""
                              width={80}
                              height={48}
                              unoptimized
                              className="h-12 w-20 rounded-sm object-cover"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {video.title}
                          </span>
                          <Icon name="link" className="size-5 shrink-0" />
                        </a>
                      ))
                    ) : (
                      <p className="text-base text-ink-muted">
                        No sample videos linked.
                      </p>
                    )}
                  </div>
                  {detail.related_hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {detail.related_hashtags.map((tag) => (
                        <button
                          type="button"
                          key={tag}
                          onClick={() => setSelectedTag(tag)}
                        >
                          <Badge tone="neutral">{tag}</Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </section>

          <section
            aria-labelledby="patterns-heading"
            className="space-y-4 border-t border-line pt-6"
          >
            <div>
              <h2
                id="patterns-heading"
                className="font-display text-2xl font-semibold text-ink"
              >
                Observed title patterns
              </h2>
              <p className="mt-1 text-meta text-ink-muted">
                Descriptive signals, not causes.
              </p>
            </div>
            {patternsLoading ? (
              <p className="text-base text-ink-muted">Loading patterns…</p>
            ) : patternsError ? (
              <Notice tone="danger">{patternsError}</Notice>
            ) : patterns?.sample_size ? (
              <div className="space-y-3">
                {patterns.patterns.map((pattern) => (
                  <div key={pattern.name} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 text-base text-ink">
                      {pattern.name.replaceAll("_", " ")}
                    </span>
                    <span className="font-mono text-base tabular-nums text-ink-muted">
                      {pattern.percent}%
                    </span>
                  </div>
                ))}
                <p className="text-meta text-ink-muted">
                  {patterns.disclaimer} Median title length:{" "}
                  {patterns.median_title_words} words.
                </p>
              </div>
            ) : (
              <p className="text-base text-ink-muted">
                No fast-riser sample is available yet.
              </p>
            )}
          </section>

          <section
            aria-labelledby="clip-package-heading"
            className="space-y-4 border-t border-line pt-6"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="clip-package-heading"
                className="font-display text-2xl font-semibold text-ink"
              >
                Clip package
              </h2>
              {clips.find((clip) => String(clip.id) === selectedClip)
                ?.context_json?.ai_generated ? (
                <Badge tone="brand">AI-generated</Badge>
              ) : null}
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={!selectedClip || pending}
              loading={pending}
              onClick={generateAiPack}
            >
              <Icon name="sparkles" className="size-5" />
              Generate package
            </Button>
            {(() => {
              const activeClip = clips.find(
                (clip) => String(clip.id) === selectedClip,
              );
              if (!activeClip) {
                return (
                  <p className="text-base text-ink-muted">
                    Select a clip to build its title, tags, and caption cues.
                  </p>
                );
              }
              if (!activeClip.context_json) {
                return (
                  <p className="text-base text-ink-muted">
                    No package generated for this clip yet.
                  </p>
                );
              }
              return (
                <div className="space-y-3">
                  <p className="font-display text-xl font-semibold text-ink">
                    {activeClip.title || "Untitled clip"}
                  </p>
                  <p className="text-meta text-ink-muted">
                    {activeClip.context_json.ai_generated
                      ? "AI-generated text"
                      : "Offline heuristic text"}
                    {activeClip.context_json.suggested_style
                      ? ` · ${activeClip.context_json.suggested_style} style`
                      : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(activeClip.context_json.hashtag_sources || []).map(
                      (item) => (
                        <Badge
                          key={`${item.hashtag}-${item.source}`}
                          tone="neutral"
                        >
                          {item.hashtag} · {item.source.replaceAll("_", " ")}
                        </Badge>
                      ),
                    )}
                  </div>
                  {activeClip.context_json.hype_words?.length ? (
                    <p className="text-meta text-ink-muted">
                      Caption cues:{" "}
                      {activeClip.context_json.hype_words.join(", ")}
                    </p>
                  ) : null}
                </div>
              );
            })()}
          </section>
        </aside>
      </div>

      <section
        aria-labelledby="fastest-heading"
        className="space-y-4 border-t border-line pt-7"
      >
        <div>
          <h2
            id="fastest-heading"
            className="font-display text-2xl font-semibold text-ink"
          >
            Fastest-rising Shorts
          </h2>
          <p className="mt-1 text-meta text-ink-muted">
            Videos with at least two valid public view snapshots; Shorts
            classification is probabilistic.
          </p>
        </div>
        {videosLoading ? (
          <p className="text-base text-ink-muted">Loading video sample…</p>
        ) : videoError ? (
          <Notice tone="danger">{videoError}</Notice>
        ) : videos?.length ? (
          <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((video) => (
              <a
                key={video.external_id}
                href={video.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 gap-4 border-t border-line py-4 hover:text-brand"
              >
                {video.thumbnail_url && (
                  <Image
                    src={video.thumbnail_url}
                    alt=""
                    width={128}
                    height={80}
                    unoptimized
                    className="h-20 w-32 shrink-0 rounded-sm object-cover"
                  />
                )}
                <span className="min-w-0">
                  <span className="block line-clamp-2 text-base font-medium text-ink">
                    {video.title}
                  </span>
                  <span className="mt-2 block text-meta tabular-nums text-ink-muted">
                    {formatNumber(video.velocity)} views/hr ·{" "}
                    {Math.round(video.short_confidence * 100)}% Shorts
                    confidence
                  </span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className="text-base text-ink-muted">
            No qualifying videos yet. Two snapshots are required to calculate
            velocity.
          </p>
        )}
      </section>

      {platform === "tiktok" && (
        <section
          aria-labelledby="manual-import-heading"
          className="max-w-3xl space-y-4 border-t border-line pt-7"
        >
          <div>
            <h2
              id="manual-import-heading"
              className="font-display text-2xl font-semibold text-ink"
            >
              Manual TikTok import
            </h2>
            <p className="mt-1 text-meta text-ink-muted">
              Paste a CSV copied from your own Creative Center research.
              Imported tags are labeled as manual; metrics remain unavailable.
            </p>
          </div>
          <Field
            label="CSV text"
            hint="Required column: hashtag. Optional columns are ignored."
          >
            <textarea
              className={`${inputClass} min-h-32 w-full resize-y py-4`}
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder="hashtag&#10;valorant&#10;gaming"
            />
          </Field>
          <Button
            variant="secondary"
            disabled={!csvText.trim() || pending}
            loading={pending}
            onClick={importManualTags}
          >
            <Icon name="upload" className="size-5" />
            Import manual tags
          </Button>
        </section>
      )}

    </div>
  );
}
