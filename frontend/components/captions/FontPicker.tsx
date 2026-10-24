"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Icon, Notice } from "@/components/ui";
import { api, ApiError, apiUrl, GENERIC_ERROR } from "@/lib/api";
import { captionFamily, loadCaptionFont, type GoogleFontEntry, type InstalledFont } from "@/lib/captions";
import { cn } from "@/lib/cn";

const WEIGHT_LABEL: Record<number, string> = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };

type Picked = { name: string; url: string; em_ratio: number };

/** Pick a caption font: installed ones, popular Google Fonts (installed on click), any Google Font, or your own file. */
export function FontPicker({ value, onChange }: { value: string; onChange: (font: Picked) => void }) {
  const [installed, setInstalled] = useState<InstalledFont[]>([]);
  const [google, setGoogle] = useState<GoogleFontEntry[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customWeight, setCustomWeight] = useState(700);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ installed: InstalledFont[]; google: GoogleFontEntry[] }>("/api/styles/fonts", { auth: false });
      setInstalled(data.installed);
      setGoogle(data.google);
      data.installed.forEach((f) => loadCaptionFont(f.name, f.url));
    } catch {
      setError(GENERIC_ERROR);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function installGoogle(family: string, weight: number) {
    const key = `${family} ${weight}`;
    setBusy(key);
    setError(null);
    try {
      const font = await api<InstalledFont>("/api/styles/fonts/google", { method: "POST", body: { family, weight }, auth: false });
      await loadCaptionFont(font.name, font.url);
      setInstalled((prev) => (prev.some((f) => f.name === font.name) ? prev : [...prev, font].sort((a, b) => a.name.localeCompare(b.name))));
      onChange(font);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't install that font.");
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiUrl("/api/styles/upload-font"), { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Upload failed");
      const font: InstalledFont = { name: data.name, source: "upload", url: data.url, em_ratio: data.em_ratio };
      await loadCaptionFont(font.name, font.url);
      setInstalled((prev) => [...prev.filter((f) => f.name !== font.name), font]);
      onChange(font);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const q = query.trim().toLowerCase();
  const installedNames = useMemo(() => new Set(installed.map((f) => f.name.toLowerCase())), [installed]);
  const shownInstalled = installed.filter((f) => !q || f.name.toLowerCase().includes(q));
  const shownGoogle = google.filter((g) => !q || g.family.toLowerCase().includes(q) || g.category.toLowerCase().includes(q));
  const exactGoogle = q.length > 1 && !google.some((g) => g.family.toLowerCase() === q);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search fonts, or type any Google Font"
          aria-label="Search fonts"
          className="block h-12 w-full rounded-md border border-line-strong bg-surface pr-4 pl-12 text-base text-ink placeholder:text-ink-faint focus:border-brand focus:shadow-ring focus-visible:outline-none"
        />
      </div>

      <div className="max-h-80 space-y-5 overflow-y-auto rounded-md border border-line p-3">
        {shownInstalled.length > 0 && (
          <div className="space-y-1">
            <p className="px-2 text-meta font-semibold tracking-[0.12em] text-ink-muted uppercase">Ready to use</p>
            {shownInstalled.map((f) => (
              <button
                key={f.name}
                type="button"
                onClick={() => onChange(f)}
                aria-pressed={f.name === value}
                className={cn(
                  "flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-3 text-left",
                  f.name === value ? "bg-brand-subtle text-brand-strong" : "hover:bg-surface-sunken",
                )}
              >
                <span className="truncate text-xl text-ink" style={{ fontFamily: captionFamily(f.name) }}>
                  {f.name}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {f.source !== "bundled" && <Badge size="sm">{f.source === "google" ? "Google" : "Yours"}</Badge>}
                  {f.name === value && <Icon name="check" className="size-5" />}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1">
          <p className="px-2 text-meta font-semibold tracking-[0.12em] text-ink-muted uppercase">Google Fonts · free</p>
          {shownGoogle.map((g) => (
            <div key={g.family} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 hover:bg-surface-sunken">
              <span className="min-w-0">
                <span className="block truncate text-base font-medium text-ink">{g.family}</span>
                <span className="block text-meta text-ink-muted">{g.category}</span>
              </span>
              <span className="flex flex-wrap gap-1">
                {g.weights.map((w) => {
                  const name = `${g.family} ${w}`;
                  const have = installedNames.has(name.toLowerCase());
                  return (
                    <button
                      key={w}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => (have ? onChange(installed.find((f) => f.name.toLowerCase() === name.toLowerCase())!) : installGoogle(g.family, w))}
                      title={`${WEIGHT_LABEL[w] ?? w}${have ? "" : " (downloads once)"}`}
                      className={cn(
                        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-base tabular-nums",
                        name === value ? "border-brand bg-brand text-on-brand" : have ? "border-line-strong text-ink hover:border-brand" : "border-dashed border-line-strong text-ink-muted hover:border-brand",
                      )}
                    >
                      {busy === name ? <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-current border-r-transparent" /> : w}
                    </button>
                  );
                })}
              </span>
            </div>
          ))}
          {exactGoogle && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-sunken px-3 py-3">
              <span className="text-base text-ink">
                Install <span className="font-semibold">“{query.trim()}”</span> from Google Fonts
              </span>
              <select
                aria-label="Weight"
                value={customWeight}
                onChange={(e) => setCustomWeight(Number(e.target.value))}
                className="h-11 rounded-md border border-line-strong bg-surface px-3 text-base text-ink"
              >
                {[400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w} {WEIGHT_LABEL[w]}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" loading={busy === `${query.trim()} ${customWeight}`} onClick={() => installGoogle(query.trim(), customWeight)}>
                Install
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" loading={busy === "upload"} onClick={() => fileInput.current?.click()}>
          <Icon name="upload" className="size-5" /> Upload your own font
        </Button>
        <span className="text-meta text-ink-muted">.ttf or .otf, used exactly as-is in the video</span>
        <input ref={fileInput} type="file" accept=".ttf,.otf" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {error && (
        <Notice tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
    </div>
  );
}
