"use client";

import { Segmented } from "@/components/ui";
import { ANIMATIONS, EMOJI_MOTIONS, type CaptionOptions, type StyleDraft } from "@/lib/captions";
import { cn } from "@/lib/cn";
import { ColorField, EditorSection, RangeField, Toggle } from "./Controls";
import { FontPicker } from "./FontPicker";

/** Every knob of a caption style. Calls onChange with a new draft on each edit. */
export function StyleEditor({ draft, onChange }: { draft: StyleDraft; onChange: (d: StyleDraft) => void }) {
  const o = draft.options;
  const set = (patch: Partial<StyleDraft>) => onChange({ ...draft, ...patch });
  const opt = <K extends keyof CaptionOptions>(key: K, value: CaptionOptions[K]) => onChange({ ...draft, options: { ...o, [key]: value } });

  const mode = draft.animation_type;
  const animated = mode !== "line" && mode !== "karaoke";
  const isBox = mode === "highlight_box";

  return (
    <div className="space-y-8">
      <EditorSection title="Basics">
        <div className="space-y-2">
          <label htmlFor="style-name" className="block text-base font-medium text-ink">
            Style name
          </label>
          <input
            id="style-name"
            value={draft.name}
            maxLength={100}
            onChange={(e) => set({ name: e.target.value })}
            className="block h-12 w-full rounded-md border border-line-strong bg-surface px-4 text-base text-ink focus:border-brand focus:shadow-ring focus-visible:outline-none"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-base font-medium text-ink">Animation</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ANIMATIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                aria-pressed={mode === a.value}
                onClick={() => set({ animation_type: a.value })}
                className={cn(
                  "min-h-14 rounded-md border px-4 py-3 text-left transition-colors duration-(--motion-fast)",
                  mode === a.value ? "border-brand bg-brand-subtle" : "border-line-strong hover:border-brand",
                )}
              >
                <span className="block text-base font-semibold text-ink">{a.label}</span>
                <span className="block text-meta text-ink-muted">{a.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </EditorSection>

      <EditorSection title="Font">
        <FontPicker value={draft.font_name} onChange={(f) => set({ font_name: f.name, font_url: f.url, font_em_ratio: f.em_ratio })} />
        <RangeField label="Size" value={draft.font_size} min={40} max={240} onChange={(v) => set({ font_size: v })} hint="In video pixels (the frame is 1080 wide). Long words shrink to fit automatically." />
        <div className="grid gap-x-8 sm:grid-cols-2">
          <Toggle label="All caps" checked={draft.uppercase} onChange={(v) => set({ uppercase: v })} />
          <Toggle label="Italic" checked={o.italic} onChange={(v) => opt("italic", v)} />
          <Toggle label="Faux bold" checked={o.bold} onChange={(v) => opt("bold", v)} hint="Prefer a heavier weight above" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <RangeField label="Letter spacing" value={o.letter_spacing} min={-5} max={30} step={0.5} unit="px" onChange={(v) => opt("letter_spacing", v)} />
          <RangeField label="Line spacing" value={o.line_spacing} min={70} max={180} unit="%" onChange={(v) => opt("line_spacing", v)} />
        </div>
      </EditorSection>

      <EditorSection title="Colours">
        <div className="grid gap-6 sm:grid-cols-2">
          <ColorField label="Text" value={o.text_color} onChange={(v) => opt("text_color", v)} />
          {mode !== "line" && !isBox && <ColorField label={mode === "karaoke" ? "Filled words" : "Active word"} value={o.active_color} onChange={(v) => opt("active_color", v)} />}
          {isBox && <ColorField label="Text on the box" value={o.active_text_color} onChange={(v) => opt("active_text_color", v)} />}
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <ColorField label="Outline" value={o.outline_color} onChange={(v) => opt("outline_color", v)} />
          <RangeField label="Outline width" value={o.outline_width} min={0} max={24} step={0.5} unit="px" onChange={(v) => opt("outline_width", v)} />
        </div>
        <ColorField label="Shadow" value={o.shadow_color} onChange={(v) => opt("shadow_color", v)} opacity={o.shadow_opacity} onOpacity={(v) => opt("shadow_opacity", v)} />
        <div className="grid gap-6 sm:grid-cols-2">
          <RangeField label="Shadow distance" value={o.shadow_depth} min={0} max={24} step={0.5} unit="px" onChange={(v) => opt("shadow_depth", v)} />
          <RangeField label="Softness" value={o.blur} min={0} max={10} step={0.5} onChange={(v) => opt("blur", v)} hint="Blurs outline and shadow edges" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <ColorField label="Glow" value={o.glow_color} onChange={(v) => opt("glow_color", v)} />
          <RangeField label="Glow strength" value={o.glow_strength} min={0} max={40} onChange={(v) => opt("glow_strength", v)} />
        </div>
      </EditorSection>

      {animated && (
        <EditorSection title="Active word">
          <div className="grid gap-6 sm:grid-cols-2">
            <RangeField label="Grow to" value={o.active_scale} min={100} max={180} unit="%" onChange={(v) => opt("active_scale", v)} />
            <RangeField label="Hype words grow to" value={o.hype_scale} min={100} max={200} unit="%" onChange={(v) => opt("hype_scale", v)} hint="Words the AI flags as hype (NO WAY, CLUTCH…)" />
          </div>
          {mode !== "single_word" && (
            <>
              <div className="space-y-2">
                <p className="text-base font-medium text-ink">When a word grows</p>
                <Segmented
                  label="When a word grows"
                  value={o.spacing_mode}
                  onChange={(v) => opt("spacing_mode", v)}
                  options={[
                    { value: "reflow", label: "Push words apart" },
                    { value: "stable", label: "Keep words still" },
                  ]}
                />
                <p className="text-meta text-ink-muted">
                  {o.spacing_mode === "reflow" ? "Neighbours slide aside to make room, so nothing overlaps." : "Room is reserved for every word's largest size, so nothing moves or overlaps."}
                </p>
              </div>
              <RangeField label="Other words" value={o.inactive_opacity} min={15} max={100} unit="% opacity" onChange={(v) => opt("inactive_opacity", v)} hint="Dim the words not being said" />
            </>
          )}
          <Toggle label="Pop in" checked={o.pop_in} onChange={(v) => opt("pop_in", v)} hint="The active word springs to size" />
        </EditorSection>
      )}

      <EditorSection title="Boxes">
        {isBox && (
          <>
            <ColorField label="Highlight box" value={o.box_color} onChange={(v) => opt("box_color", v)} opacity={o.box_opacity} onOpacity={(v) => opt("box_opacity", v)} />
          </>
        )}
        <Toggle label="Box behind each line" checked={o.line_box} onChange={(v) => opt("line_box", v)} hint="The classic subtitle bar" />
        {o.line_box && <ColorField label="Line box" value={o.line_box_color} onChange={(v) => opt("line_box_color", v)} opacity={o.line_box_opacity} onOpacity={(v) => opt("line_box_opacity", v)} />}
        {(isBox || o.line_box) && (
          <div className="grid gap-6 sm:grid-cols-2">
            <RangeField label="Box padding" value={o.box_padding} min={0} max={60} unit="px" onChange={(v) => opt("box_padding", v)} />
            <RangeField label="Corner radius" value={o.box_radius} min={0} max={60} unit="px" onChange={(v) => opt("box_radius", v)} />
          </div>
        )}
      </EditorSection>

      <EditorSection title="Emoji">
        <Toggle label="Add emoji" checked={o.emojis} onChange={(v) => opt("emojis", v)} hint="Only where a word calls for one: a laugh, a clutch, a fail. Never on filler." />
        {o.emojis && (
          <>
            <div className="space-y-2">
              <p className="text-base font-medium text-ink">How many</p>
              <Segmented
                label="How many emoji"
                value={o.emoji_amount}
                onChange={(v) => opt("emoji_amount", v)}
                options={[
                  { value: "few", label: "Few" },
                  { value: "normal", label: "Normal" },
                  { value: "lots", label: "Lots" },
                ]}
              />
              <p className="text-meta text-ink-muted">
                {o.emoji_amount === "few" ? "Only the biggest moments." : o.emoji_amount === "lots" ? "Most emotional words get one." : "The clear moments, spaced out."}
              </p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-base font-medium text-ink">How they show up</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[{ value: "mix" as const, label: "Mix", hint: "Each emoji gets a motion that fits it" }, ...EMOJI_MOTIONS].map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={o.emoji_motion === m.value}
                    onClick={() => opt("emoji_motion", m.value)}
                    className={cn(
                      "min-h-14 rounded-md border px-3 py-2 text-left transition-colors duration-(--motion-fast)",
                      o.emoji_motion === m.value ? "border-brand bg-brand-subtle" : "border-line-strong hover:border-brand",
                    )}
                  >
                    <span className="block text-base font-semibold text-ink">{m.label}</span>
                    <span className="block text-meta text-ink-muted">{m.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-2">
              <p className="text-base font-medium text-ink">Where</p>
              <Segmented
                label="Where emoji go"
                value={o.emoji_placement}
                onChange={(v) => opt("emoji_placement", v)}
                options={[
                  { value: "mix", label: "Mix" },
                  { value: "above", label: "Above" },
                  { value: "beside", label: "Beside" },
                ]}
              />
            </div>
            <RangeField label="Emoji size" value={o.emoji_size} min={50} max={260} unit="px" onChange={(v) => opt("emoji_size", v)} />
          </>
        )}
      </EditorSection>

      <EditorSection title="Layout">
        <div className="grid gap-6 sm:grid-cols-2">
          {mode !== "single_word" && (
            <>
              <RangeField label="Words per line" value={o.words_per_line} min={1} max={8} onChange={(v) => opt("words_per_line", v)} />
              <RangeField label="Lines at once" value={o.max_lines} min={1} max={3} onChange={(v) => opt("max_lines", v)} />
            </>
          )}
          <RangeField label="Height on screen" value={o.position_y} min={8} max={92} unit="%" onChange={(v) => opt("position_y", v)} hint="From the top. Keep above ~80% to clear TikTok's buttons." />
          <RangeField label="Max width" value={o.max_width} min={40} max={100} unit="%" onChange={(v) => opt("max_width", v)} />
        </div>
      </EditorSection>
    </div>
  );
}
