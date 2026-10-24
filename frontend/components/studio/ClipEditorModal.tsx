"use client";

import { GENERIC_ERROR, ApiError } from "@/lib/api";
import { useState } from "react";
import { Button, Field, Icon, Notice, Panel, Segmented, Select } from "@/components/ui";
import { FILTER_OPTIONS, SPEED_OPTIONS, type Layout, type StudioClip } from "@/lib/imports";

type CaptionStyle = { id: number; name: string };

export function ClipEditorModal({
  clip,
  styles,
  onSave,
  onClose,
}: {
  clip: StudioClip;
  styles: CaptionStyle[];
  onSave: (params: {
    speed: number;
    volume: number;
    color_filter: string;
    layout: Layout;
    caption_position_y: number;
    style_id?: number | null;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [speed, setSpeed] = useState<number>(clip.speed ?? 1.0);
  const [volume, setVolume] = useState<number>(clip.volume ?? 1.0);
  const [colorFilter, setColorFilter] = useState<string>(clip.color_filter ?? "none");
  const [layout, setLayout] = useState<Layout>(clip.layout ?? "fill");
  const [captionPosition, setCaptionPosition] = useState<number>(clip.caption_position_y ?? 68);
  const [styleId, setStyleId] = useState<number | null>(clip.caption_style_id ?? (styles[0]?.id || null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        speed,
        volume,
        color_filter: colorFilter,
        layout,
        caption_position_y: captionPosition,
        style_id: styleId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    // Phones: a bottom sheet that scrolls inside itself. sm+: a centred card.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 backdrop-blur-xs sm:items-center sm:p-4">
      <Panel
        tone="surface"
        padding="lg"
        className="relative max-h-[92dvh] w-full max-w-lg space-y-6 overflow-y-auto overscroll-contain rounded-b-none pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-b-lg"
      >
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit & Polish Clip</h3>
            <p className="text-meta text-ink-muted">Fine-tune speed, audio, color grading, and caption position.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <Icon name="x" className="size-5" />
          </button>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Speed Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-meta font-medium text-ink">Speed</span>
              <span className="font-mono text-meta font-semibold text-brand-strong">{speed}x</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={`min-h-11 rounded-md text-center font-mono text-meta font-semibold transition-colors ${
                    speed === s ? "bg-brand text-on-brand shadow-sm" : "border border-line bg-surface text-ink hover:border-brand/50"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
            <p className="text-fine text-ink-muted">
              {speed < 1 ? "Slow-mo: great for epic plays and reactions." : speed > 1 ? "Speed up: high-energy fast-paced pacing." : "Normal playback speed."}
            </p>
          </div>

          {/* Audio Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-meta font-medium text-ink">Audio Level</span>
              <span className="font-mono text-meta font-semibold text-brand-strong">
                {volume === 0 ? "Muted" : `${Math.round(volume * 100)}%`}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Mute", val: 0.0 },
                { label: "100%", val: 1.0 },
                { label: "+50%", val: 1.5 },
                { label: "+100%", val: 2.0 },
              ].map((v) => (
                <button
                  key={v.val}
                  type="button"
                  onClick={() => setVolume(v.val)}
                  className={`min-h-11 rounded-md text-center text-meta font-medium transition-colors ${
                    volume === v.val ? "bg-brand text-on-brand shadow-sm" : "border border-line bg-surface text-ink hover:border-brand/50"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color Filter */}
          <div className="space-y-2">
            <span className="block text-meta font-medium text-ink">Color Style</span>
            <div className="flex flex-wrap gap-2">
              {FILTER_OPTIONS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setColorFilter(f.value)}
                  className={`min-h-11 rounded-full px-4 text-meta font-medium transition-colors ${
                    colorFilter === f.value ? "bg-brand text-on-brand shadow-sm" : "border border-line bg-surface text-ink hover:border-brand/50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Framing Layout */}
          <div className="space-y-2">
            <span className="block text-meta font-medium text-ink">Framing Layout</span>
            <Segmented
              label="Framing layout"
              value={layout}
              onChange={setLayout}
              className="w-full"
              options={[
                { value: "fill", label: "Fill (Zoomed)" },
                { value: "blur", label: "Blur (Full Frame)" },
              ]}
            />
          </div>

          {/* Spoken Dialogue */}
          {clip.transcript_json && clip.transcript_json.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-line bg-surface-sunken p-4">
              <span className="text-meta font-semibold text-ink">Spoken Dialogue</span>
              <p className="text-base text-ink leading-relaxed">
                “{clip.transcript_json.map((w) => w.word).join(" ")}”
              </p>
            </div>
          )}

          {/* Caption Position */}
          <div className="space-y-3 rounded-xl border border-line bg-surface-sunken p-4">
            <div className="flex items-center justify-between">
              <span className="text-meta font-semibold text-ink">Caption Position</span>
              <span className="font-mono text-meta font-semibold text-brand-strong">{captionPosition}% from top</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Top", pos: 20 },
                { label: "Center", pos: 50 },
                { label: "Bottom", pos: 68 },
              ].map((p) => (
                <button
                  key={p.pos}
                  type="button"
                  onClick={() => setCaptionPosition(p.pos)}
                  className={`min-h-11 rounded-md text-meta font-medium transition-colors ${
                    captionPosition === p.pos ? "bg-brand text-on-brand shadow-sm" : "border border-line bg-surface text-ink hover:border-brand/50"
                  }`}
                >
                  {p.label} ({p.pos}%)
                </button>
              ))}
            </div>
            <input
              type="range"
              min={12}
              max={86}
              value={captionPosition}
              onChange={(e) => setCaptionPosition(Number(e.target.value))}
              aria-label="Caption position"
              className="h-11 w-full accent-brand"
            />
            {styles.length > 0 && (
              <Field label="Caption style" hint="Burned ASS subtitle aesthetic">
                <Select value={styleId ?? ""} onChange={(e) => setStyleId(Number(e.target.value))}>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Icon name="sparkles" className="size-5" /> Apply & Recut
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
