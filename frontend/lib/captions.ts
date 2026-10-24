/**
 * Caption styles (backend app/schemas/caption_style.py). Colours here are the creator's
 * caption colours (data that ends up in the video), not UI tokens.
 */
import { apiUrl } from "./api";

export type AnimationType = "word_pop" | "highlight_box" | "karaoke" | "reveal" | "single_word" | "line";

export type CaptionOptions = {
  text_color: string;
  letter_spacing: number;
  line_spacing: number;
  bold: boolean;
  italic: boolean;
  active_color: string;
  active_text_color: string;
  active_scale: number;
  hype_scale: number;
  pop_in: boolean;
  inactive_opacity: number;
  outline_color: string;
  outline_width: number;
  shadow_color: string;
  shadow_opacity: number;
  shadow_depth: number;
  blur: number;
  glow_color: string;
  glow_strength: number;
  box_color: string;
  box_opacity: number;
  box_padding: number;
  box_radius: number;
  line_box: boolean;
  line_box_color: string;
  line_box_opacity: number;
  words_per_line: number;
  max_lines: number;
  position_y: number;
  max_width: number;
  spacing_mode: "reflow" | "stable";
  emojis: boolean;
  emoji_amount: EmojiAmount;
  emoji_motion: EmojiMotion | "mix";
  emoji_placement: "mix" | "above" | "beside";
  emoji_size: number;
};

export type EmojiAmount = "few" | "normal" | "lots";
export type EmojiMotion = "pop" | "bounce" | "float" | "spin" | "wiggle" | "slide" | "stamp" | "burst";

/** Ways an emoji can show up (backend services/caption/emoji_render.py draws the same ones). */
export const EMOJI_MOTIONS: { value: EmojiMotion; label: string; hint: string }[] = [
  { value: "pop", label: "Pop", hint: "Springs out of nothing" },
  { value: "bounce", label: "Bounce", hint: "Drops in and bounces" },
  { value: "float", label: "Float", hint: "Rises gently and sways" },
  { value: "spin", label: "Spin", hint: "Spins in to size" },
  { value: "wiggle", label: "Wiggle", hint: "Pops in and keeps wiggling" },
  { value: "slide", label: "Slide", hint: "Slides in from the side" },
  { value: "stamp", label: "Stamp", hint: "Slams down from big" },
  { value: "burst", label: "Burst", hint: "Pops and throws sparks" },
];

/** One emoji in the live preview, in sample-word indexes (from /api/styles/emoji-plan). */
export type PreviewEmoji = { index: number; until: number; emoji: string; motion: EmojiMotion; placement: "above" | "left" | "right" };

export type CaptionStyle = {
  id: number;
  name: string;
  font_name: string;
  font_size: number;
  animation_type: AnimationType;
  uppercase: boolean;
  options: CaptionOptions;
  category: string | null;
  description: string | null;
  is_preset: boolean;
  font_url: string | null;
  font_em_ratio: number;
  font_available: boolean;
  colors_json?: Record<string, string>;
};

/** What the editor works on: a style that may not be saved yet. */
export type StyleDraft = Pick<CaptionStyle, "name" | "font_name" | "font_size" | "animation_type" | "uppercase" | "options"> &
  Partial<Pick<CaptionStyle, "id" | "category" | "description" | "is_preset" | "font_url" | "font_em_ratio">>;

export type InstalledFont = { name: string; source: "bundled" | "google" | "upload"; url: string; em_ratio: number };
export type GoogleFontEntry = { family: string; weights: number[]; category: string };

export const DEFAULT_OPTIONS: CaptionOptions = {
  text_color: "#FFFFFF", // design-check-ignore: caption colour data
  letter_spacing: 0,
  line_spacing: 100,
  bold: false,
  italic: false,
  active_color: "#FFE600", // design-check-ignore: caption colour data
  active_text_color: "#FFFFFF", // design-check-ignore: caption colour data
  active_scale: 118,
  hype_scale: 135,
  pop_in: true,
  inactive_opacity: 100,
  outline_color: "#000000", // design-check-ignore: caption colour data
  outline_width: 6,
  shadow_color: "#000000", // design-check-ignore: caption colour data
  shadow_opacity: 60,
  shadow_depth: 3,
  blur: 0,
  glow_color: "#FFFFFF", // design-check-ignore: caption colour data
  glow_strength: 0,
  box_color: "#7C3AED", // design-check-ignore: caption colour data
  box_opacity: 100,
  box_padding: 14,
  box_radius: 16,
  line_box: false,
  line_box_color: "#000000", // design-check-ignore: caption colour data
  line_box_opacity: 65,
  words_per_line: 3,
  max_lines: 2,
  position_y: 68,
  max_width: 86,
  spacing_mode: "reflow",
  emojis: false,
  emoji_amount: "normal",
  emoji_motion: "mix",
  emoji_placement: "mix",
  emoji_size: 120,
};

export const ANIMATIONS: { value: AnimationType; label: string; hint: string }[] = [
  { value: "word_pop", label: "Word pop", hint: "The spoken word grows and changes colour" },
  { value: "highlight_box", label: "Highlight box", hint: "The spoken word sits on a coloured box" },
  { value: "karaoke", label: "Karaoke", hint: "Words fill with colour as they're said" },
  { value: "reveal", label: "Reveal", hint: "Words appear as they're said" },
  { value: "single_word", label: "One word", hint: "One big word at a time" },
  { value: "line", label: "Static", hint: "The whole phrase, no word animation" },
];

export const ANIMATION_LABEL: Record<string, string> = Object.fromEntries(ANIMATIONS.map((a) => [a.value, a.label]));

/** '#RRGGBB' + opacity (0-100) -> CSS colour. */
export function withOpacity(hex: string, opacity = 100): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${Math.max(0, Math.min(100, opacity)) / 100})`; // design-check-ignore: caption colour data
}

/** Legacy ASS colour '&HAABBGGRR' -> '#RRGGBB'. */
function assHex(ass: string | undefined, fallback: string): string {
  const m = ass?.match(/^&H([0-9a-f]{2})?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `#${m[4]}${m[3]}${m[2]}`.toUpperCase() : fallback;
}

/** Options for an old style that only has colors_json. */
export function optionsFromLegacy(colors: Record<string, string | undefined> = {}, animation = "word_pop"): CaptionOptions {
  return {
    ...DEFAULT_OPTIONS,
    text_color: assHex(colors.primary, DEFAULT_OPTIONS.text_color),
    outline_color: assHex(colors.outline, DEFAULT_OPTIONS.outline_color),
    active_color: assHex(colors.highlight, DEFAULT_OPTIONS.active_color),
    shadow_color: assHex(colors.back, DEFAULT_OPTIONS.shadow_color),
    line_box: animation === "line",
  };
}

export function draftOf(style: CaptionStyle): StyleDraft {
  return {
    id: style.id,
    name: style.name,
    font_name: style.font_name,
    font_size: style.font_size,
    animation_type: style.animation_type,
    uppercase: style.uppercase,
    options: { ...DEFAULT_OPTIONS, ...style.options },
    category: style.category,
    description: style.description,
    is_preset: style.is_preset,
    font_url: style.font_url,
    font_em_ratio: style.font_em_ratio,
  };
}

/** Body for create / update / render-preview. */
export function stylePayload(d: StyleDraft) {
  return { name: d.name, font_name: d.font_name, font_size: d.font_size, animation_type: d.animation_type, uppercase: d.uppercase, options: d.options };
}

// ---------- fonts: load the same files the burner uses ----------
const loaded = new Map<string, Promise<boolean>>();

export const fontUrl = (name: string) => apiUrl(`/api/styles/fonts/file/${encodeURIComponent(name)}`);

/** Load a caption font into the page under its own family name. Resolves false if unavailable. */
export function loadCaptionFont(name: string, url?: string | null): Promise<boolean> {
  if (typeof window === "undefined" || !name) return Promise.resolve(false);
  const key = name.toLowerCase();
  const existing = loaded.get(key);
  if (existing) return existing;
  const promise = new FontFace(`ch-${name}`, `url("${url ? apiUrl(url) : fontUrl(name)}")`)
    .load()
    .then((face) => {
      document.fonts.add(face);
      return true;
    })
    .catch(() => {
      loaded.delete(key); // allow a retry after the font is installed
      return false;
    });
  loaded.set(key, promise);
  return promise;
}

/** CSS font-family for a caption font (falls back to the display face while loading). */
export const captionFamily = (name: string) => `"ch-${name}", var(--typeface-display), sans-serif`;
