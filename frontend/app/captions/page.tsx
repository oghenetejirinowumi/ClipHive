"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge, Button, Field, Icon, PageHeader, Panel } from "@/components/ui";
import { api, API_URL } from "@/lib/api";

type CaptionColors = {
  primary?: string;
  outline?: string;
  highlight?: string;
  back?: string;
};

type CaptionStyle = {
  id: number;
  name: string;
  font_name: string;
  font_size: number;
  colors_json: CaptionColors;
  animation_type: string;
  uppercase: boolean;
  is_preset: boolean;
  font_file?: string | null;
};

type Clip = {
  id: number;
  title?: string | null;
  file_path?: string | null;
  raw_file_path?: string | null;
  status: string;
  caption_style_id?: number | null;
};

const SAMPLE_WORDS = [
  { word: "BRO", start: 0.1, end: 0.5, hype: true },
  { word: "YOU", start: 0.5, end: 0.8, hype: false },
  { word: "CANNOT", start: 0.8, end: 1.3, hype: false },
  { word: "MISS", start: 1.3, end: 1.7, hype: true },
  { word: "THAT!", start: 1.7, end: 2.2, hype: true },
];

export default function CaptionsPage() {
  const [styles, setStyles] = useState<CaptionStyle[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<number | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);

  const [activeWordIdx, setActiveWordIdx] = useState(0);
  const [fontFile, setFontFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [burnResult, setBurnResult] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  // Fetch styles and clips on load
  useEffect(() => {
    async function loadData() {
      try {
        const styleData = await api<CaptionStyle[]>("/api/styles", { auth: false });
        setStyles(styleData);
        if (styleData.length > 0) {
          setSelectedStyleId(styleData[0].id);
        }

        const clipData = await api<Clip[]>("/api/clips", { auth: false });
        setClips(clipData);
        if (clipData.length > 0) {
          setSelectedClipId(clipData[0].id);
        }
      } catch (err) {
        console.warn("Could not load initial data:", err);
      }
    }
    loadData();
  }, []);

  // Word-pop kinetic animation ticker for live preview
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveWordIdx((prev) => (prev + 1) % SAMPLE_WORDS.length);
    }, 450);
    return () => clearInterval(timer);
  }, []);

  const activeStyle = styles.find((s) => s.id === selectedStyleId) || styles[0];

  // Upload custom font
  async function handleFontUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!fontFile) return;

    setUploadStatus("Uploading font...");
    try {
      const formData = new FormData();
      formData.append("file", fontFile);

      const res = await fetch(`${API_URL}/api/styles/upload-font`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setUploadStatus(`Installed: ${data.font_name}`);
      setFontFile(null);

      // Refresh styles
      const updated = await api<CaptionStyle[]>("/api/styles", { auth: false });
      setStyles(updated);
    } catch {
      setUploadStatus("Error uploading font. Ensure it is a valid .ttf or .otf file.");
    }
  }

  // Trigger real FFmpeg subtitle burn
  function handleBurnSubtitles() {
    if (!selectedClipId || !selectedStyleId) return;

    startTransition(async () => {
      setBurnResult("Burning subtitles with FFmpeg...");
      try {
        const updated = await api<Clip>(`/api/clips/${selectedClipId}/regenerate-captions`, {
          method: "POST",
          body: { style_id: selectedStyleId, caption_mode: "burned" },
          auth: false,
        });
        setBurnResult(`Burn Complete! Status: ${updated.status}`);
        const clipList = await api<Clip[]>("/api/clips", { auth: false });
        setClips(clipList);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error burning captions";
        setBurnResult(`Failed: ${msg}`);
      }
    });
  }

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Caption Studio"
        title="Style & Kinetic Captions"
        description="Choose a high-converting subtitle aesthetic, preview live word-pop animations, or upload custom fonts."
      />

      {/* Main Grid: Left = Style Selection, Right = 9:16 Live Preview */}
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Preset Styles & Customizer (7 cols) */}
        <div className="space-y-8 lg:col-span-7">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">Built-in Presets</h2>
              <Badge tone="brand" size="md">
                3 Standard Presets
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {styles.map((style) => {
                const isSelected = style.id === selectedStyleId;
                return (
                  <Panel
                    key={style.id}
                    interactive
                    onClick={() => setSelectedStyleId(style.id)}
                    tone={isSelected ? "brand" : "surface"}
                    className={isSelected ? "ring-2 ring-brand" : ""}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="block font-display text-2xl font-semibold text-ink">{style.name}</span>
                        <span className="mt-1 block text-meta text-ink-muted">
                          Font: {style.font_name} ({style.font_size}pt)
                        </span>
                      </div>
                      <Badge tone={isSelected ? "brand" : "neutral"} size="sm">
                        {style.animation_type.replace("_", " ").toUpperCase()}
                      </Badge>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <span className="text-meta text-ink-faint">Case:</span>
                      <span className="text-meta font-medium text-ink">
                        {style.uppercase ? "ALL CAPS" : "Standard"}
                      </span>
                      <span className="mx-2 text-ink-faint">•</span>
                      <span className="text-meta text-ink-faint">Type:</span>
                      <span className="text-meta font-medium text-ink">
                        {style.is_preset ? "Preset" : "Custom"}
                      </span>
                    </div>
                  </Panel>
                );
              })}
            </div>
          </section>

          {/* Custom Font Upload */}
          <Panel tone="sunken">
            <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">Custom Font Uploader</h3>
            <p className="mt-2 text-base text-ink-muted">
              Add your creator font (.ttf or .otf). It will be indexed and available for FFmpeg ASS burning.
            </p>

            <form onSubmit={handleFontUpload} className="mt-6 flex flex-wrap items-center gap-4">
              <input
                type="file"
                accept=".ttf,.otf"
                onChange={(e) => setFontFile(e.target.files?.[0] || null)}
                className="text-base text-ink file:mr-4 file:rounded-full file:border-0 file:bg-brand-subtle file:px-5 file:py-2.5 file:font-medium file:text-brand-strong"
              />
              <Button type="submit" size="sm" disabled={!fontFile}>
                Upload Font
              </Button>
            </form>

            {uploadStatus && (
              <p className="mt-4 text-base font-medium text-ink-muted">{uploadStatus}</p>
            )}
          </Panel>

          {/* Burn to Clip Action */}
          <Panel>
            <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">Burn to Selected Clip</h3>
            <p className="mt-2 text-base text-ink-muted">
              Apply {activeStyle?.name} captions to a clip using faster-whisper and libass.
            </p>

            <div className="mt-6 space-y-4">
              {clips.length > 0 ? (
                <Field label="Choose Clip to Burn" hint="Select an active clip from your pipeline">
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
                <p className="text-base text-ink-muted">No clips found in database.</p>
              )}

              <div className="flex items-center gap-4 pt-2">
                <Button
                  onClick={handleBurnSubtitles}
                  loading={isPending}
                  disabled={!selectedClipId || !selectedStyleId || isPending}
                >
                  <Icon name="captions" className="size-5" />
                  Render & Burn Captions
                </Button>
                {burnResult && (
                  <span className="text-base font-medium text-brand-strong">{burnResult}</span>
                )}
              </div>
            </div>
          </Panel>
        </div>

        {/* Right Column: Simulated 9:16 Kinetic Phone Canvas (5 cols) */}
        <div className="lg:col-span-5">
          <div className="sticky top-8 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-display text-xl font-semibold text-ink">9:16 Kinetic Preview</span>
              <Badge tone="success" size="sm">
                Word-Pop Active
              </Badge>
            </div>

            {/* Smartphone Canvas Frame */}
            <div className="relative mx-auto flex aspect-[9/16] w-full max-w-[340px] flex-col justify-between overflow-hidden rounded-xl border-4 border-line-strong bg-ink p-6 shadow-glow">
              {/* Top Notch & Time */}
              <div className="flex items-center justify-between text-meta font-medium text-surface opacity-75">
                <span>9:41</span>
                <span className="flex items-center gap-1">
                  <span>5G</span>
                  <span>100%</span>
                </span>
              </div>

              {/* Center Kinetic Word Pop Display */}
              <div className="my-auto flex flex-col items-center justify-center text-center">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {SAMPLE_WORDS.map((w, idx) => {
                    const isActive = idx === activeWordIdx;
                    const isPunch = activeStyle?.name === "Punch";
                    const isNeon = activeStyle?.name === "Neon";

                    return (
                      <span
                        key={idx}
                        className="inline-block transition-transform duration-(--motion-fast)"
                        style={{
                          transform: isActive
                            ? w.hype
                              ? "scale(1.3)"
                              : "scale(1.15)"
                            : "scale(1.0)",
                          fontWeight: isActive || isPunch ? 800 : 600,
                          color: isActive
                            ? isNeon
                              ? "var(--brand)"
                              : isPunch
                              ? "var(--warning)"
                              : "var(--surface)"
                            : "var(--surface)",
                          textShadow: isPunch
                            ? "0 2px 4px var(--ink)"
                            : isNeon && isActive
                            ? "0 0 12px var(--brand)"
                            : "0 1px 2px var(--ink)",
                        }}
                      >
                        {activeStyle?.uppercase ? w.word.toUpperCase() : w.word}
                      </span>
                    );
                  })}
                </div>

                <div className="mt-8 rounded-full bg-surface-sunken/20 px-4 py-1 text-meta text-surface/80 backdrop-blur-md">
                  Active Style: {activeStyle?.name} ({activeStyle?.animation_type})
                </div>
              </div>

              {/* Bottom TikTok/Reels UI Overlay Protection Zone */}
              <div className="border-t border-dashed border-surface/20 pt-4 text-center">
                <div className="flex items-center justify-between text-meta text-surface/50">
                  <span>TikTok UI Margin (480px Safe)</span>
                  <span>Protected</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
