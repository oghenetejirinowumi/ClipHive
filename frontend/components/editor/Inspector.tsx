"use client";

import { useState, type ReactNode } from "react";
import { Button, Checkbox, compactInputClass, Icon, Segmented } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  assetOf, DEFAULT_BOX, DEFAULT_OUTLINE, EFFECTS, find, formatTime, maxDuration, TEXT_PRESETS,
  type Aspect, type AudioTrack, type Clip, type Effect, type EffectKind, type Font, type Text, type TextAnimation, type Timeline,
} from "@/lib/editor";

type Patch = Partial<Clip> | Partial<Text> | Partial<AudioTrack> | Partial<Effect>;

type Props = {
  timeline: Timeline;
  selectedId: string | null;
  playhead: number;
  /** `key` groups rapid changes to one field into a single undo step. */
  onPatch(id: string, patch: Patch, key: string): void;
  onProject(patch: { aspect?: Aspect; background?: string }): void;
  onSplit(): void;
  onDuplicate(): void;
  onDelete(): void;
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const FONTS: Font[] = [
  "Bangers",
  "Poppins",
  "Luckiest Guy",
  "Montserrat 900",
  "Montserrat 800",
  "Rubik 800",
  "Inter 700",
  "Anton 400",
  "Lilita One 400",
  "Roboto 500",
  "Lora 700",
  "Bebas Neue 400",
  "System",
];
const ANIMATIONS: { value: TextAnimation; label: string }[] = [
  { value: "pop", label: "Pop" },
  { value: "word_pop", label: "Word Pop" },
  { value: "highlight_box", label: "Highlight Box" },
  { value: "single_word", label: "Single Word" },
  { value: "karaoke", label: "Karaoke" },
  { value: "typewriter", label: "Typewriter" },
  { value: "reveal", label: "Reveal" },
  { value: "fade", label: "Fade" },
  { value: "slide_up", label: "Slide up" },
  { value: "line", label: "Line" },
  { value: "bounce", label: "Bounce" },
  { value: "float", label: "Float" },
  { value: "spin", label: "Spin" },
  { value: "wiggle", label: "Wiggle" },
  { value: "stamp", label: "Stamp" },
  { value: "burst", label: "Burst" },
  { value: "slide_in", label: "Slide in" },
  { value: "none", label: "None" },
];

const control = compactInputClass;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-2 text-meta font-medium text-ink">
        {label}
        {hint && <span className="font-normal text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Num({ value, onChange, step = 0.1, min = 0, max }: { value: number; onChange(v: number): void; step?: number; min?: number; max?: number }) {
  return (
    <input
      type="number"
      className={control}
      value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
      step={step}
      min={min}
      max={max !== undefined && Number.isFinite(max) ? Math.round(max * 100) / 100 : undefined}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(Math.max(min, max !== undefined ? Math.min(max, v) : v));
      }}
    />
  );
}

function Range({ value, onChange, min, max, step }: { value: number; onChange(v: number): void; min: number; max: number; step: number }) {
  return <input type="range" className="h-11 w-full accent-brand" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />;
}

function Check({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <Checkbox compact label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
  );
}

function Colour({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) {
  return (
    <label className="flex h-11 items-center gap-3 text-base text-ink">
      <input type="color" aria-label={label} className="h-11 w-12 cursor-pointer rounded-md border border-line-strong bg-surface" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h4 className="text-meta font-semibold tracking-wide text-ink-muted uppercase">{title}</h4>
      {children}
    </section>
  );
}

export function Inspector({ timeline, selectedId, playhead, onPatch, onProject, onSplit, onDuplicate, onDelete }: Props) {
  const [styleCategory, setStyleCategory] = useState("All");
  const found = selectedId ? find(timeline, selectedId) : null;

  if (!found) {
    return (
      <div className="space-y-5">
        <Section title="Project">
          <Row label="Canvas">
            <Segmented
              compact
              label="Canvas aspect"
              value={timeline.aspect}
              onChange={(aspect) => onProject({ aspect })}
              className="w-full"
              options={[
                { value: "9:16", label: "9:16" },
                { value: "16:9", label: "16:9" },
                { value: "1:1", label: "1:1" },
                { value: "4:5", label: "4:5" },
              ]}
            />
          </Row>
          <Colour label="Background" value={timeline.background} onChange={(background) => onProject({ background })} />
        </Section>
        <p className="text-base text-ink-muted">Select a clip, text or audio track on the timeline to edit it. Drag edges to trim, drag the middle to move.</p>
      </div>
    );
  }

  const { kind, item } = found;
  const id = item.id;
  const set = (field: string, patch: Patch) => onPatch(id, patch, `${id}:${field}`);
  const canSplit = playhead > item.start + 0.1 && playhead < item.start + item.duration - 0.1;
  const limit = maxDuration(timeline, kind, item);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button size="xs" variant="secondary" disabled={!canSplit} onClick={onSplit} title="Split at playhead (S)">
        <Icon name="scissors" className="size-5" /> Split
      </Button>
      <Button size="xs" variant="ghost" onClick={onDuplicate} title="Duplicate (Ctrl+D)">
        <Icon name="copy" className="size-5" /> Duplicate
      </Button>
      <Button size="xs" variant="ghost" onClick={onDelete} title="Delete (Del)">
        <Icon name="trash" className="size-5" /> Delete
      </Button>
    </div>
  );

  const timing = (
    <Section title="Timing">
      <div className="grid grid-cols-2 gap-3">
        <Row label="Start">
          <Num value={item.start} onChange={(start) => set("start", { start })} />
        </Row>
        <Row label="Length" hint={Number.isFinite(limit) ? `max ${formatTime(limit, true)}` : undefined}>
          <Num value={item.duration} min={0.1} max={limit} onChange={(d) => set("duration", { duration: d })} />
        </Row>
      </div>
      {(kind === "clips" || kind === "audio") && (
        <Row label="Starts in source at" hint="trim the beginning">
          <Num value={(item as Clip | AudioTrack).source_in} onChange={(source_in) => set("source_in", { source_in })} />
        </Row>
      )}
    </Section>
  );

  if (kind === "clips") {
    const clip = item as Clip;
    const asset = assetOf(timeline, clip.asset_id);
    const isVideo = asset?.kind === "video";
    return (
      <div className="space-y-5">
        <div className="space-y-3">
          <p className="truncate text-lg font-semibold text-ink">{asset?.name ?? "Clip"}</p>
          {actions}
        </div>
        {timing}
        <Section title="Picture">
          <Row label="Track">
            <Segmented
              compact
              label="Track"
              value={String(clip.track)}
              onChange={(v) => set("track", { track: Number(v) })}
              className="w-full"
              options={[{ value: "0", label: "1" }, { value: "1", label: "2" }, { value: "2", label: "3" }]}
            />
          </Row>
          <Row label="Fit">
            <Segmented compact label="Fit" value={clip.fit} onChange={(fit) => set("fit", { fit })} className="w-full" options={[{ value: "cover", label: "Fill frame" }, { value: "contain", label: "Show all" }]} />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Fade in">
              <Num value={clip.fade_in} max={10} onChange={(fade_in) => set("fade_in", { fade_in })} />
            </Row>
            <Row label="Fade out">
              <Num value={clip.fade_out} max={10} onChange={(fade_out) => set("fade_out", { fade_out })} />
            </Row>
          </div>
        </Section>
        {isVideo && (
          <Section title="Speed & sound">
            <Row label="Speed">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "0.5× Slow", speed: 0.5 },
                    { label: "0.75×", speed: 0.75 },
                    { label: "1× Normal", speed: 1 },
                    { label: "1.25×", speed: 1.25 },
                    { label: "1.5× Fast", speed: 1.5 },
                    { label: "2×", speed: 2 },
                  ].map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className={cn(
                        "rounded px-2.5 py-1 text-meta font-medium transition",
                        clip.speed === s.speed
                          ? "bg-brand text-on-brand"
                          : "bg-surface-elevated text-ink hover:bg-surface-sunken"
                      )}
                      onClick={() => set("speed", { speed: s.speed })}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <select className={control} value={clip.speed} onChange={(e) => set("speed", { speed: Number(e.target.value) })}>
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}×{s === 1 ? " (normal)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </Row>
            {asset?.has_audio ? (
              <>
                <Row label="Volume" hint={`${Math.round(clip.volume * 100)}%`}>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "Mute", vol: 0 },
                        { label: "50%", vol: 0.5 },
                        { label: "100%", vol: 1 },
                        { label: "150%", vol: 1.5 },
                        { label: "200%", vol: 2 },
                      ].map((v) => (
                        <button
                          key={v.label}
                          type="button"
                          className={cn(
                            "rounded px-2 py-0.5 text-meta font-medium transition",
                            Math.abs(clip.volume - v.vol) < 0.05
                              ? "bg-brand text-on-brand"
                              : "bg-surface-elevated text-ink hover:bg-surface-sunken"
                          )}
                          onClick={() => set("volume", { volume: v.vol, muted: v.vol === 0 })}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                    <Range value={clip.volume} min={0} max={2} step={0.05} onChange={(volume) => set("volume", { volume })} />
                  </div>
                </Row>
                <Check label="Mute this clip" checked={clip.muted} onChange={(muted) => set("muted", { muted })} />
              </>
            ) : (
              <p className="text-base text-ink-muted">This video has no sound.</p>
            )}
          </Section>
        )}
      </div>
    );
  }

  if (kind === "texts") {
    const text = item as Text;
    return (
      <div className="space-y-5">
        <div className="space-y-3">
          <Row label={text.is_caption ? "Caption" : "Text"}>
            <textarea className={cn(control, "h-24 py-2")} value={text.text} maxLength={500} onChange={(e) => set("text", { text: e.target.value || " " })} />
          </Row>
          {actions}
        </div>
        <Section title="Caption Style">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {["All", "Gaming", "Viral", "Podcast", "Fun", "Story", "Broadcast", "Minimal"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-fine font-medium transition",
                    styleCategory === cat ? "bg-brand text-on-brand" : "bg-surface-elevated text-ink hover:bg-surface-sunken"
                  )}
                  onClick={() => setStyleCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto rounded-md border border-line p-1">
              {Object.entries(TEXT_PRESETS)
                .filter(([, p]) => styleCategory === "All" || p.category === styleCategory)
                .map(([key, preset]) => {
                  const isActive = text.font === preset.style.font && text.color === preset.style.color;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onPatch(id, preset.style, `${id}:preset`)}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 text-left transition",
                        isActive ? "bg-brand-subtle border border-brand" : "bg-surface hover:bg-surface-sunken border border-line"
                      )}
                    >
                      <span
                        className="grid size-7 shrink-0 place-items-center rounded text-meta font-bold"
                        style={{
                          color: preset.style.color,
                          background: preset.style.background ?? "#111111", // design-check-ignore: caption colours
                          WebkitTextStroke: preset.style.stroke_color ? `1px ${preset.style.stroke_color}` : undefined,
                          textTransform: preset.style.uppercase ? "uppercase" : undefined,
                        }}
                      >
                        Aa
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-meta font-medium text-ink">{preset.label}</span>
                        <span className="block truncate text-fine text-ink-muted">{preset.category}</span>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Font">
              <select className={control} value={text.font} onChange={(e) => set("font", { font: e.target.value as Font })}>
                {FONTS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Row>
            <Row label="Animation">
              <select className={control} value={text.animation} onChange={(e) => set("animation", { animation: e.target.value as TextAnimation })}>
                {ANIMATIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Row>
          </div>
          <Row label="Size" hint={`${text.size}px`}>
            <Range value={text.size} min={16} max={240} step={2} onChange={(size) => set("size", { size })} />
          </Row>
          <Colour label="Text colour" value={text.color} onChange={(color) => set("color", { color })} />
          <Check
            label="Outline"
            checked={!!text.stroke_color && text.stroke_width > 0}
            onChange={(on) => set("stroke", on ? { stroke_color: text.stroke_color ?? DEFAULT_OUTLINE, stroke_width: Math.max(text.stroke_width, 4) } : { stroke_color: null })}
          />
          {text.stroke_color && text.stroke_width > 0 && (
            <div className="grid grid-cols-2 items-end gap-3">
              <Colour label="Outline colour" value={text.stroke_color} onChange={(stroke_color) => set("stroke_color", { stroke_color })} />
              <Row label="Outline width">
                <Num value={text.stroke_width} step={1} max={30} onChange={(stroke_width) => set("stroke_width", { stroke_width: Math.round(stroke_width) })} />
              </Row>
            </div>
          )}
          <Check label="Box behind text" checked={!!text.background} onChange={(on) => set("background", { background: on ? DEFAULT_BOX : null })} />
          {text.background && <Colour label="Box colour" value={text.background} onChange={(background) => set("background", { background })} />}
          <Check label="ALL CAPS" checked={text.uppercase} onChange={(uppercase) => set("uppercase", { uppercase })} />
        </Section>
        <Section title="Position">
          <div className="space-y-1.5">
            <span className="block text-meta font-medium text-ink">Presets</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Top (18%)", y: 0.18, x: 0.5 },
                { label: "Center (50%)", y: 0.5, x: 0.5 },
                { label: "Bottom (80%)", y: 0.8, x: 0.5 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-1 text-meta font-medium transition",
                    Math.abs(text.y - p.y) < 0.05
                      ? "bg-brand text-on-brand"
                      : "bg-surface-elevated text-ink hover:bg-surface-sunken"
                  )}
                  onClick={() => onPatch(id, { y: p.y, x: p.x }, `${id}:pos-preset`)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-base text-ink-muted">Or drag the handle directly on the video preview.</p>
          <Row label="Across" hint={`${Math.round(text.x * 100)}%`}>
            <Range value={text.x} min={0} max={1} step={0.01} onChange={(x) => set("x", { x })} />
          </Row>
          <Row label="Down" hint={`${Math.round(text.y * 100)}%`}>
            <Range value={text.y} min={0} max={1} step={0.01} onChange={(y) => set("y", { y })} />
          </Row>
          <Row label="Line width" hint={`${Math.round(text.width * 100)}%`}>
            <Range value={text.width} min={0.1} max={1} step={0.01} onChange={(w) => set("width", { width: w })} />
          </Row>
        </Section>
        {timing}
      </div>
    );
  }

  if (kind === "effects") {
    const effect = item as Effect;
    return (
      <div className="space-y-5">
        <div className="space-y-3">
          <p className="truncate text-lg font-semibold text-ink">{EFFECTS[effect.kind].label}</p>
          {effect.auto && <p className="text-base text-ink-muted">Placed by Auto effects. Change it and it&apos;s yours: the next auto run keeps it.</p>}
          {actions}
        </div>
        <Section title="Effect">
          <Row label="Type">
            <select className={control} value={effect.kind} onChange={(e) => set("kind", { kind: e.target.value as EffectKind })}>
              {Object.entries(EFFECTS).map(([value, fx]) => (
                <option key={value} value={value}>
                  {fx.label} · {fx.hint}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Strength" hint={`${Math.round(effect.intensity * 100)}%`}>
            <Range value={effect.intensity} min={0.05} max={1} step={0.05} onChange={(intensity) => set("intensity", { intensity })} />
          </Row>
        </Section>
        {timing}
      </div>
    );
  }

  const track = item as AudioTrack;
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="truncate text-lg font-semibold text-ink">{assetOf(timeline, track.asset_id)?.name ?? "Audio"}</p>
        {actions}
      </div>
      <Section title="Sound">
        <Row label="Volume" hint={`${Math.round(track.volume * 100)}%`}>
          <Range value={track.volume} min={0} max={2} step={0.05} onChange={(volume) => set("volume", { volume })} />
        </Row>
        <div className="grid grid-cols-2 gap-3">
          <Row label="Fade in">
            <Num value={track.fade_in} max={10} onChange={(fade_in) => set("fade_in", { fade_in })} />
          </Row>
          <Row label="Fade out">
            <Num value={track.fade_out} max={10} onChange={(fade_out) => set("fade_out", { fade_out })} />
          </Row>
        </div>
      </Section>
      {timing}
    </div>
  );
}
