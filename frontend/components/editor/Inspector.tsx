"use client";

import type { ReactNode } from "react";
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
const FONTS: Font[] = ["Bangers", "Luckiest Guy", "Poppins", "System"];
const ANIMATIONS: { value: TextAnimation; label: string }[] = [
  { value: "pop", label: "Pop" },
  { value: "fade", label: "Fade" },
  { value: "slide_up", label: "Slide up" },
  { value: "typewriter", label: "Typewriter" },
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
              <select className={control} value={clip.speed} onChange={(e) => set("speed", { speed: Number(e.target.value) })}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×{s === 1 ? " (normal)" : ""}
                  </option>
                ))}
              </select>
            </Row>
            {asset?.has_audio ? (
              <>
                <Row label="Volume" hint={`${Math.round(clip.volume * 100)}%`}>
                  <Range value={clip.volume} min={0} max={2} step={0.05} onChange={(volume) => set("volume", { volume })} />
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
        <Section title="Style">
          <div className="flex flex-wrap gap-2">
            {Object.entries(TEXT_PRESETS).map(([key, preset]) => (
              <Button key={key} size="xs" variant="secondary" onClick={() => onPatch(id, preset.style, `${id}:preset`)}>
                {preset.label}
              </Button>
            ))}
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
          <p className="text-base text-ink-muted">Or drag the handle on the preview.</p>
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
