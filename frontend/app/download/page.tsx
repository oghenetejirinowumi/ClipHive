"use client";

import { useState, type FormEvent } from "react";
import { Button, buttonClass, Em, Icon, Notice, Panel, SectionLabel, SkyHeader } from "@/components/ui";
import { api, ApiError, API_URL, apiUrl } from "@/lib/api";

type DownloadResult = {
  id: string;
  title: string;
  uploader: string | null;
  duration_s: number | null;
  size_bytes: number;
  preview_path: string;
  download_url: string;
};

const isInstagram = (url: string) => /(^|\/\/|\.)(instagram\.com|instagr\.am)(\/|$)/i.test(url.trim());

const formatSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
const formatTime = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—");

export default function DownloadPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DownloadResult[]>([]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    if (!isInstagram(url)) {
      setError("That isn't an Instagram link. For Twitch, Kick or YouTube, use Create to turn it into clips.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api<DownloadResult>("/api/downloads/instagram", { method: "POST", body: { url: url.trim() } });
      setResults((prev) => [result, ...prev.filter((r) => r.id !== result.id)]);
      setUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  const [latest, ...earlier] = results;

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Instagram downloader"
        title={
          <>
            Save any <Em>reel</Em> in full
          </>
        }
        description="Paste an Instagram post or reel link. We fetch the original video and hand you a downloadable MP4."
      />

      <Panel padding="lg">
        <form onSubmit={onSubmit} className="space-y-3">
          <label htmlFor="ig-url" className="block text-lg font-medium text-ink">
            Instagram link
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Icon name="link" className="pointer-events-none absolute top-1/2 left-5 size-6 -translate-y-1/2 text-ink-faint" />
              <input
                id="ig-url"
                type="text"
                inputMode="url"
                autoComplete="off"
                placeholder="https://www.instagram.com/reel/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="block h-16 w-full rounded-full border border-line-strong bg-surface pr-6 pl-14 text-lg text-ink transition-[border-color,box-shadow] duration-(--motion-fast) placeholder:text-ink-faint hover:border-ink-faint focus:border-brand focus:shadow-ring focus-visible:outline-none"
              />
            </div>
            <Button type="submit" size="lg" loading={loading} disabled={!url.trim()}>
              <Icon name="download" />
              {loading ? "Fetching…" : "Fetch video"}
            </Button>
          </div>
          <p className="text-base text-ink-muted">Only download videos you own or have permission to reuse.</p>
        </form>

        {error && (
          <Notice tone="danger" onDismiss={() => setError(null)} className="mt-6">
            {error}
          </Notice>
        )}
      </Panel>

      {latest && (
        <section className="grid items-start gap-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <video key={latest.id} src={`${API_URL}/${latest.preview_path}`} controls playsInline className="mx-auto aspect-[9/16] w-full max-w-[24rem] rounded-xl bg-brand-deep object-contain shadow-glow-strong" />
          <div className="space-y-8">
            <div>
              <SectionLabel>Ready to download</SectionLabel>
              <h2 className="mt-4 font-display text-4xl leading-tight font-semibold tracking-tight text-balance text-ink">{latest.title}</h2>
              {latest.uploader && <p className="mt-2 text-xl text-ink-muted">@{latest.uploader}</p>}
            </div>
            <dl className="grid max-w-md grid-cols-2 gap-6 border-y border-line py-6">
              <div>
                <dt className="text-lg text-ink-muted">Length</dt>
                <dd className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink tabular-nums">{formatTime(latest.duration_s)}</dd>
              </div>
              <div>
                <dt className="text-lg text-ink-muted">Size</dt>
                <dd className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink tabular-nums">{formatSize(latest.size_bytes)}</dd>
              </div>
            </dl>
            <a href={apiUrl(latest.download_url)} className={buttonClass({ size: "lg" })}>
              <Icon name="download" />
              Download MP4
            </a>
          </div>
        </section>
      )}

      {earlier.length > 0 && (
        <section className="space-y-4">
          <SectionLabel>Earlier this session</SectionLabel>
          <ul className="divide-y divide-line border-y border-line">
            {earlier.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-5">
                <div className="min-w-0">
                  <p className="truncate font-display text-xl font-semibold tracking-tight text-ink">{r.title}</p>
                  <p className="text-base text-ink-muted">
                    {formatTime(r.duration_s)} · {formatSize(r.size_bytes)}
                  </p>
                </div>
                <a href={apiUrl(r.download_url)} className={buttonClass({ variant: "secondary", size: "sm" })}>
                  <Icon name="download" className="size-5" />
                  Download
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
