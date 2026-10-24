"use client";

import { useEffect, useState, useTransition } from "react";
import { CaptionPreview } from "@/components/captions/CaptionPreview";
import { PhoneFrame } from "@/components/captions/PhoneFrame";
import {
  Badge,
  Button,
  Checkbox,
  Em,
  Field,
  Icon,
  Input,
  Notice,
  Panel,
  SectionLabel,
  Segmented,
  Select,
  SkyHeader,
  StatusBadge,
} from "@/components/ui";
import { api, API_URL } from "@/lib/api";
import { cn } from "@/lib/cn";

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
  context_json?: {
    summary?: string;
    game_or_topic?: string;
    suggested_style?: string;
    style_rationale?: string;
    event_type?: string;
  } | null;
};

const SAMPLE_WORDS = [
  { word: "BRO", start: 0.1, end: 0.5, hype: true },
  { word: "YOU", start: 0.5, end: 0.8, hype: false },
  { word: "CANNOT", start: 0.8, end: 1.3, hype: false },
  { word: "MISS", start: 1.3, end: 1.7, hype: true },
  { word: "THAT!", start: 1.7, end: 2.2, hype: true },
];

const ANIMATION_LABELS: Record<string, string> = { word_pop: "Word pop", karaoke: "Karaoke", line: "Line by line" };

const outcomeTone = (msg: string) => (msg.startsWith("Failed") || msg.startsWith("Error") ? "danger" : msg.startsWith("Burn Complete") || msg.startsWith("Installed") ? "success" : "brand");

export default function CaptionsPage() {
  const [styles, setStyles] = useState<CaptionStyle[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<number | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);

  const [activeWordIdx, setActiveWordIdx] = useState(0);
  const [previewMode, setPreviewMode] = useState<"simulation" | "video">("simulation");
  const [fontFile, setFontFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [burnResult, setBurnResult] = useState<string | null>(null);

  // New Custom Style form state
  const [isCreatingStyle, setIsCreatingStyle] = useState(false);
  const [newStyleName, setNewStyleName] = useState("");
  const [newFontName, setNewFontName] = useState("Bangers");
  const [newFontSize, setNewFontSize] = useState(76);
  const [newAnimationType, setNewAnimationType] = useState("word_pop");
  const [newUppercase, setNewUppercase] = useState(true);
  const [primaryColor, setPrimaryColor] = useState("&H0000FFFF");
  const outlineColor = "&H00000000";
  const [highlightColor, setHighlightColor] = useState("&H0000FFFF");
  const [styleError, setStyleError] = useState<string | null>(null);

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
  const activeClip = clips.find((c) => c.id === selectedClipId) || clips[0];

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

      const updated = await api<CaptionStyle[]>("/api/styles", { auth: false });
      setStyles(updated);
    } catch {
      setUploadStatus("Error uploading font. Ensure it is a valid .ttf or .otf file.");
    }
  }

  // Create new custom style
  async function handleCreateStyle(e: React.FormEvent) {
    e.preventDefault();
    if (!newStyleName.trim()) return;
    setStyleError(null);

    try {
      const created = await api<CaptionStyle>("/api/styles", {
        method: "POST",
        body: {
          name: newStyleName.trim(),
          font_name: newFontName,
          font_size: Number(newFontSize),
          animation_type: newAnimationType,
          uppercase: newUppercase,
          colors_json: {
            primary: primaryColor,
            outline: outlineColor,
            highlight: highlightColor,
            back: "&H80000000",
          },
        },
        auth: false,
      });

      setStyles((prev) => [...prev, created]);
      setSelectedStyleId(created.id);
      setIsCreatingStyle(false);
      setNewStyleName("");
    } catch {
      setStyleError("Could not create style. Check backend connection.");
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
        setPreviewMode("video");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error burning captions";
        setBurnResult(`Failed: ${msg}`);
      }
    });
  }

  // Find video path for active style
  const styleSlug = activeStyle ? activeStyle.name.toLowerCase() : "punch";
  const renderedVideoSrc = activeClip?.file_path
    ? `${API_URL}/${activeClip.file_path}`
    : `${API_URL}/storage/clips/clip_1_${styleSlug}.mp4`;

  return (
    <div className="space-y-12">
      <SkyHeader
        eyebrow="Caption studio"
        title={
          <>
            Captions with <Em>personality</Em>
          </>
        }
        description="Choose a high-converting subtitle aesthetic, preview live word-pop animations, or upload custom fonts."
      />

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Left: styles, font upload, burn */}
        <div className="space-y-12 lg:col-span-7">
          <section className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <SectionLabel>Styles</SectionLabel>
                <Badge tone="brand">{styles.length} loaded</Badge>
              </div>
              <Button variant={isCreatingStyle ? "ghost" : "secondary"} size="sm" onClick={() => setIsCreatingStyle(!isCreatingStyle)}>
                <Icon name={isCreatingStyle ? "x" : "plus"} className="size-5" />
                {isCreatingStyle ? "Cancel" : "New custom style"}
              </Button>
            </div>

            {isCreatingStyle && (
              <Panel tone="brand" padding="lg">
                <h3 className="font-display text-3xl font-semibold tracking-tight text-ink">Create a custom style</h3>
                <form onSubmit={handleCreateStyle} className="mt-8 grid gap-6 sm:grid-cols-2">
                  <Field label="Style name">
                    <Input type="text" placeholder="e.g. Cyberpunk Pop" value={newStyleName} onChange={(e) => setNewStyleName(e.target.value)} required />
                  </Field>
                  <Field label="Font name" hint="Bangers, Poppins, Luckiest Guy, or one you uploaded">
                    <Input type="text" placeholder="e.g. Bangers" value={newFontName} onChange={(e) => setNewFontName(e.target.value)} required />
                  </Field>
                  <Field label="Font size" hint="In video pixels (1080 wide)">
                    <Input type="number" min={8} max={300} value={newFontSize} onChange={(e) => setNewFontSize(Number(e.target.value))} />
                  </Field>
                  <Field label="Animation">
                    <Select value={newAnimationType} onChange={(e) => setNewAnimationType(e.target.value)}>
                      <option value="word_pop">Word pop</option>
                      <option value="karaoke">Karaoke</option>
                      <option value="line">Line by line</option>
                    </Select>
                  </Field>
                  <div className="space-y-2 sm:col-span-2">
                    <span className="block text-meta font-medium text-ink">Text Fill Color</span>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Yellow", ass: "&H0000FFFF", role: "bg-warning text-ink" },
                        { label: "Cyan", ass: "&H00FFFF00", role: "bg-brand text-on-brand" },
                        { label: "White", ass: "&H00FFFFFF", role: "bg-surface text-ink border border-line" },
                        { label: "Magenta", ass: "&H00FF00FF", role: "bg-danger text-on-brand" },
                        { label: "Green", ass: "&H0000FF00", role: "bg-success text-on-brand" },
                      ].map((c) => (
                        <button
                          key={c.ass}
                          type="button"
                          onClick={() => setPrimaryColor(c.ass)}
                          className={`rounded-full px-4 py-1.5 text-meta font-medium transition-transform duration-(--motion-fast) ${c.role} ${primaryColor === c.ass ? "ring-2 ring-brand scale-105" : "opacity-80"}`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <span className="block text-meta font-medium text-ink">Word-Pop Highlight Accent</span>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Yellow Pop", ass: "&H0000FFFF", role: "bg-warning text-ink" },
                        { label: "Cyan Pop", ass: "&H00FFFF00", role: "bg-brand text-on-brand" },
                        { label: "Magenta Pop", ass: "&H00FF00FF", role: "bg-danger text-on-brand" },
                        { label: "Green Pop", ass: "&H0000FF00", role: "bg-success text-on-brand" },
                      ].map((c) => (
                        <button
                          key={c.ass}
                          type="button"
                          onClick={() => setHighlightColor(c.ass)}
                          className={`rounded-full px-4 py-1.5 text-meta font-medium transition-transform duration-(--motion-fast) ${c.role} ${highlightColor === c.ass ? "ring-2 ring-brand scale-105" : "opacity-80"}`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Checkbox label="Force all caps" checked={newUppercase} onChange={(e) => setNewUppercase(e.target.checked)} className="sm:col-span-2" />
                  {styleError && <Notice tone="danger" className="sm:col-span-2">{styleError}</Notice>}
                  <div className="sm:col-span-2">
                    <Button type="submit">Save style</Button>
                  </div>
                </form>
              </Panel>
            )}

            {/* Style cards: each one previews itself in its own font and colours. */}
            <div className="grid gap-6 sm:grid-cols-2">
              {styles.map((style) => {
                const isSelected = style.id === selectedStyleId;
                return (
                  <button
                    key={style.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedStyleId(style.id)}
                    className={cn(
                      "tactile overflow-hidden rounded-lg border text-left",
                      isSelected ? "border-brand bg-brand-subtle shadow-glow-strong" : "border-line bg-surface shadow-glow",
                    )}
                  >
                    <div className="@container grid h-32 place-items-center bg-brand-deep px-6">
                      <CaptionPreview style={{ ...style, font_size: Math.min(style.font_size, 90) * 1.6 }} words={[{ word: "Clip" }, { word: "it" }]} activeIndex={1} />
                    </div>
                    <div className="p-6">
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-display text-2xl font-semibold tracking-tight text-ink">{style.name}</span>
                        <Badge tone={isSelected ? "brand" : "neutral"}>{ANIMATION_LABELS[style.animation_type] ?? style.animation_type}</Badge>
                      </div>
                      <p className="mt-2 text-base text-ink-muted">
                        {style.font_name} · {style.font_size}px · {style.uppercase ? "All caps" : "Sentence case"} · {style.is_preset ? "Preset" : "Custom"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Custom Font Upload */}
          <Panel tone="sunken" padding="lg">
            <SectionLabel>Your font</SectionLabel>
            <h3 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">Upload a custom font</h3>
            <p className="mt-2 text-lg text-ink-muted">Add your creator font (.ttf or .otf). It will be indexed and available for FFmpeg ASS burning.</p>

            <form onSubmit={handleFontUpload} className="mt-8 flex flex-wrap items-center gap-4">
              <label className="flex min-h-14 flex-1 cursor-pointer items-center gap-4 rounded-md border border-dashed border-line-strong bg-surface px-5 text-lg text-ink-muted transition-colors hover:border-brand">
                <Icon name="upload" className="size-6 text-brand" />
                <span className="truncate">{fontFile ? fontFile.name : "Choose a .ttf or .otf file"}</span>
                <input type="file" accept=".ttf,.otf" onChange={(e) => setFontFile(e.target.files?.[0] || null)} className="sr-only" />
              </label>
              <Button type="submit" disabled={!fontFile}>
                Upload font
              </Button>
            </form>

            {uploadStatus && (
              <Notice tone={outcomeTone(uploadStatus)} className="mt-6">
                {uploadStatus}
              </Notice>
            )}
          </Panel>

          {/* Burn to Clip Action */}
          <Panel padding="lg">
            <SectionLabel>Render</SectionLabel>
            <h3 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">Burn to a clip</h3>
            <p className="mt-2 text-lg text-ink-muted">
              Apply <span className="font-semibold text-ink">{activeStyle?.name}</span> captions to a clip using faster-whisper and libass.
            </p>

            <div className="mt-8 space-y-6">
              {clips.length > 0 ? (
                <Field label="Clip to burn" hint="Select an active clip from your pipeline">
                  <Select value={selectedClipId ?? ""} onChange={(e) => setSelectedClipId(Number(e.target.value))}>
                    {clips.map((c) => (
                      <option key={c.id} value={c.id}>
                        Clip #{c.id} — {c.title || "Untitled"} ({c.status})
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-lg text-ink-muted">No clips found in database.</p>
              )}

              {activeClip && (
                <>
                  {activeClip.context_json?.suggested_style && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand-subtle p-4">
                      <div className="min-w-0">
                        <span className="text-meta font-semibold text-brand-strong">
                          ⚡ Recommended Style: {activeClip.context_json.suggested_style}
                        </span>
                        {activeClip.context_json.style_rationale && (
                          <p className="mt-0.5 truncate text-fine text-ink-muted">{activeClip.context_json.style_rationale}</p>
                        )}
                      </div>
                      {styles.some((s) => s.name.toLowerCase() === activeClip.context_json?.suggested_style?.toLowerCase()) && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            const target = styles.find((s) => s.name.toLowerCase() === activeClip.context_json?.suggested_style?.toLowerCase());
                            if (target) setSelectedStyleId(target.id);
                          }}
                        >
                          Use {activeClip.context_json.suggested_style}
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-lg text-ink-muted">
                    Current status <StatusBadge status={activeClip.status} />
                  </div>
                </>
              )}

              <Button size="lg" onClick={handleBurnSubtitles} loading={isPending} disabled={!selectedClipId || !selectedStyleId || isPending}>
                <Icon name="captions" />
                Render & burn captions
              </Button>
              {burnResult && <Notice tone={outcomeTone(burnResult)}>{burnResult}</Notice>}
            </div>
          </Panel>
        </div>

        {/* Right: live 9:16 canvas */}
        <div className="lg:col-span-5">
          <div className="space-y-6 lg:sticky lg:top-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <SectionLabel>9:16 preview</SectionLabel>
              <Segmented
                label="Preview mode"
                value={previewMode}
                onChange={setPreviewMode}
                options={[
                  { value: "simulation", label: "Live" },
                  { value: "video", label: "Rendered MP4" },
                ]}
              />
            </div>

            <PhoneFrame>
              {previewMode === "video" ? (
                <video key={renderedVideoSrc} src={renderedVideoSrc} autoPlay loop muted playsInline controls className="size-full object-cover" />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-10 px-[8cqw]">
                  <CaptionPreview style={activeStyle} words={SAMPLE_WORDS} activeIndex={activeWordIdx} />
                  <span className="rounded-full border border-on-brand/20 bg-on-brand/10 px-4 py-1.5 text-meta text-on-brand/85">
                    {activeStyle?.name} · {ANIMATION_LABELS[activeStyle?.animation_type ?? ""] ?? activeStyle?.animation_type}
                  </span>
                </div>
              )}
            </PhoneFrame>
          </div>
        </div>
      </div>
    </div>
  );
}
