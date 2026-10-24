/**
 * Video editor timeline: types (mirror backend/app/schemas/editor.py) and the hand-editing
 * operations. The AI assistant makes the same edits server-side (services/editor/ops.py);
 * the server re-validates every save, so these stay simple and pure.
 *
 * Source math: a clip plays duration × speed seconds of its file, starting at source_in.
 */

export type Aspect = "9:16" | "16:9" | "1:1" | "4:5";
export type Font =
  | "Bangers"
  | "Luckiest Guy"
  | "Poppins"
  | "Montserrat 900"
  | "Montserrat 800"
  | "Rubik 800"
  | "Inter 700"
  | "Anton 400"
  | "Lilita One 400"
  | "Roboto 500"
  | "Lora 700"
  | "Bebas Neue 400"
  | "System"
  | (string & {});

export type TextAnimation =
  | "none"
  | "fade"
  | "pop"
  | "slide_up"
  | "typewriter"
  | "highlight_box"
  | "karaoke"
  | "reveal"
  | "line"
  | "word_pop"
  | "single_word";
export type EffectKind = "punch_zoom" | "slow_zoom" | "shake" | "flash" | "glitch" | "vignette" | "color_pop" | "black_white";
export type EffectStyle = "hype" | "cinematic" | "clean";

export type Asset = {
  id: string;
  kind: "video" | "image" | "audio";
  name: string;
  src: string; // public "storage/..." path
  duration: number | null;
  width: number | null;
  height: number | null;
  has_audio: boolean;
};

export type Clip = {
  id: string;
  asset_id: string;
  track: number; // 0 main, 1-2 overlays
  start: number;
  duration: number;
  source_in: number;
  speed: number;
  volume: number;
  muted: boolean;
  fit: "cover" | "contain";
  fade_in: number;
  fade_out: number;
};

export type Text = {
  id: string;
  text: string;
  start: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  size: number;
  font: Font;
  color: string;
  stroke_color: string | null;
  stroke_width: number;
  background: string | null;
  uppercase: boolean;
  animation: TextAnimation;
  is_caption: boolean;
};

export type AudioTrack = {
  id: string;
  asset_id: string;
  start: number;
  duration: number;
  source_in: number;
  volume: number;
  fade_in: number;
  fade_out: number;
  /** Placed by "Auto SFX" (running it again replaces these) or from the sound-effects list. */
  is_sfx?: boolean;
};

/** A timed visual effect on the picture (text is unaffected). auto: placed by "Auto effects". */
export type Effect = {
  id: string;
  kind: EffectKind;
  start: number;
  duration: number;
  intensity: number; // 0.05-1
  auto: boolean;
};

export type Timeline = {
  version: 1;
  aspect: Aspect;
  background: string;
  assets: Asset[];
  clips: Clip[];
  texts: Text[];
  audio: AudioTrack[];
  effects: Effect[];
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  changes: string[];
  at: string;
  version_from?: number | null; // "v11 → v12": the version this turn started from
  version_to?: number | null;
};

export type Project = {
  id: number;
  title: string;
  timeline: Timeline;
  revision: number;
  chat: ChatMessage[];
  render_status: "idle" | "rendering" | "done" | "failed";
  render_progress: number;
  render_error: string | null;
  render_path: string | null;
  export_clip_id: number | null;
  version: number; // latest saved version, shown as "Saved · v12"
  created_at: string;
  updated_at: string | null;
  notice?: string | null; // one-off summary of a server edit
};

export type ProjectSummary = Pick<Project, "id" | "title" | "revision" | "render_status" | "created_at" | "updated_at">;

export type ItemKind = "clips" | "texts" | "audio" | "effects";
export type Item = Clip | Text | AudioTrack | Effect;

export const ASPECT_SIZE: Record<Aspect, [number, number]> = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };
export const VIDEO_TRACKS = 3;
export const MIN_LEN = 0.1;

// User-chosen text colours are content, not UI chrome, so they're real colour values.
export const DEFAULT_OUTLINE = "#000000"; // design-check-ignore: text content colour
export const DEFAULT_BOX = "#111111"; // design-check-ignore: text content colour
export type TextPreset = {
  label: string;
  category: string;
  description: string;
  style: Partial<Text>;
};

export const TEXT_PRESETS: Record<string, TextPreset> = {
  punch: { label: "Punch", category: "Gaming", description: "Comic-book caps with thick black outline & yellow pop", style: { font: "Bangers", color: "#FFE600", stroke_color: "#000000", stroke_width: 8, uppercase: true, animation: "pop", background: null, size: 96, y: 0.66 } }, // design-check-ignore: caption colours
  clean: { label: "Clean", category: "Minimal", description: "Calm sentence case with dimmed background", style: { font: "Poppins", color: "#FFFFFF", stroke_color: null, stroke_width: 0, uppercase: false, animation: "fade", background: "#111111B3", size: 76, y: 0.70 } }, // design-check-ignore: caption colours
  neon: { label: "Neon", category: "Fun", description: "Cyan rounded display caps with magenta outline", style: { font: "Luckiest Guy", color: "#3DF5FF", stroke_color: "#2B0040", stroke_width: 6, uppercase: true, animation: "pop", background: null, size: 84, y: 0.66 } }, // design-check-ignore: caption colours
  podcast_bold: { label: "Podcast Bold", category: "Podcast", description: "Heavy white caps with yellow active word", style: { font: "Montserrat 900", color: "#FFE600", stroke_color: "#000000", stroke_width: 8, uppercase: true, animation: "pop", background: null, size: 88, y: 0.68 } }, // design-check-ignore: caption colours
  podcast_green: { label: "Podcast Green", category: "Podcast", description: "Heavy white caps with neon lime green active pop", style: { font: "Montserrat 900", color: "#39FF14", stroke_color: "#000000", stroke_width: 8, uppercase: true, animation: "pop", background: null, size: 88, y: 0.68 } }, // design-check-ignore: caption colours
  highlight_box: { label: "Highlight Box", category: "Viral", description: "Rounded purple highlight box behind words", style: { font: "Montserrat 800", color: "#FFFFFF", stroke_color: null, stroke_width: 0, background: "#7C3AED", uppercase: true, animation: "pop", size: 80, y: 0.68 } }, // design-check-ignore: caption colours
  green_box: { label: "Green Box", category: "Viral", description: "Lime highlight box with bold dark text", style: { font: "Montserrat 900", color: "#0B0B0B", stroke_color: "#B6FF3B", stroke_width: 4, background: "#B6FF3B", uppercase: true, animation: "pop", size: 80, y: 0.68 } }, // design-check-ignore: caption colours
  one_word: { label: "One Word", category: "Viral", description: "Huge condensed word spring, fast and punchy", style: { font: "Anton 400", color: "#FFFFFF", stroke_color: "#000000", stroke_width: 9, uppercase: true, animation: "pop", background: null, size: 120, y: 0.58 } }, // design-check-ignore: caption colours
  bold_pop: { label: "Bold Pop", category: "Fun", description: "Chunky rounded type, cyan pop, extra thick outline", style: { font: "Lilita One 400", color: "#00E0FF", stroke_color: "#000000", stroke_width: 10, uppercase: true, animation: "pop", background: null, size: 92, y: 0.64 } }, // design-check-ignore: caption colours
  karaoke: { label: "Karaoke", category: "Music", description: "Words fill with bright golden yellow as sung", style: { font: "Rubik 800", color: "#FFD400", stroke_color: "#000000", stroke_width: 6, uppercase: true, animation: "pop", background: null, size: 84, y: 0.68 } }, // design-check-ignore: caption colours
  typewriter: { label: "Typewriter", category: "Story", description: "Words reveal as spoken, building the sentence", style: { font: "Inter 700", color: "#FFFFFF", stroke_color: null, stroke_width: 0, uppercase: false, animation: "typewriter", background: null, size: 76, y: 0.70 } }, // design-check-ignore: caption colours
  subtitle_bar: { label: "Subtitle Bar", category: "Broadcast", description: "Broadcast subtitles on a dark bar", style: { font: "Roboto 500", color: "#FFFFFF", stroke_color: null, stroke_width: 0, background: "#000000B3", uppercase: false, animation: "fade", size: 64, y: 0.80 } }, // design-check-ignore: caption colours
  documentary: { label: "Documentary", category: "Story", description: "Elegant serif with cinematic soft shadow", style: { font: "Lora 700", color: "#FFFFFF", stroke_color: "#000000", stroke_width: 2, uppercase: false, animation: "fade", background: null, size: 76, y: 0.80 } }, // design-check-ignore: caption colours
  neon_glow: { label: "Neon Glow", category: "Fun", description: "Tall pink caps with bright glow and white pop", style: { font: "Bebas Neue 400", color: "#FF4FD8", stroke_color: "#3A0030", stroke_width: 4, uppercase: true, animation: "pop", background: null, size: 110, y: 0.66 } }, // design-check-ignore: caption colours
  title: { label: "Title", category: "Display", description: "Big dramatic headline style", style: { font: "Bangers", color: "#FFFFFF", stroke_color: "#000000", stroke_width: 8, uppercase: true, animation: "slide_up", background: null, size: 120 } }, // design-check-ignore: caption colours
  subtle: { label: "Subtle", category: "Minimal", description: "Clean, unobtrusive sans-serif label", style: { font: "System", color: "#FFFFFF", stroke_color: "#000000", stroke_width: 3, uppercase: false, animation: "fade", background: null, size: 56 } }, // design-check-ignore: caption colours
};

const round = (n: number) => Math.round(n * 1000) / 1000;

export const EFFECTS: Record<EffectKind, { label: string; length: number; hint: string }> = {
  punch_zoom: { label: "Punch zoom", length: 0.6, hint: "Quick zoom hit" },
  slow_zoom: { label: "Slow zoom", length: 4, hint: "Gentle push-in" },
  shake: { label: "Shake", length: 0.45, hint: "Camera shake" },
  flash: { label: "Flash", length: 0.3, hint: "White flash" },
  glitch: { label: "Glitch", length: 0.3, hint: "Digital glitch" },
  vignette: { label: "Vignette", length: 3, hint: "Dark edges" },
  color_pop: { label: "Colour pop", length: 3, hint: "Richer colour" },
  black_white: { label: "Black & white", length: 3, hint: "Drain the colour" },
};

export const EFFECT_STYLES: { value: EffectStyle; label: string; hint: string }[] = [
  { value: "hype", label: "Hype", hint: "Punch-ins, shakes, flashes and glitches on the loud moments and cuts" },
  { value: "cinematic", label: "Cinematic", hint: "Slow push-ins, soft flashes, vignette and a light grade" },
  { value: "clean", label: "Clean", hint: "Subtle zooms on the big moments and quick flashes on cuts" },
];

export function newId(timeline: Timeline, prefix: string): string {
  const taken = new Set([...timeline.assets, ...timeline.clips, ...timeline.texts, ...timeline.audio, ...(timeline.effects ?? [])].map((x) => x.id));
  for (;;) {
    const id = `${prefix}${Math.random().toString(16).slice(2, 8)}`;
    if (!taken.has(id)) return id;
  }
}

export function duration(timeline: Timeline): number {
  const ends = [...timeline.clips, ...timeline.texts, ...timeline.audio].map((x) => x.start + x.duration);
  return ends.length ? Math.max(...ends) : 0;
}

export function assetOf(timeline: Timeline, id: string): Asset | undefined {
  return timeline.assets.find((a) => a.id === id);
}

export function find(timeline: Timeline, id: string): { kind: ItemKind; item: Item } | null {
  for (const kind of ["clips", "texts", "audio", "effects"] as const) {
    const item = ((timeline[kind] ?? []) as Item[]).find((x) => x.id === id);
    if (item) return { kind, item };
  }
  return null;
}

/** Longest timeline duration an item can have from its source_in (Infinity for images and texts). */
export function maxDuration(timeline: Timeline, kind: ItemKind, item: Item): number {
  if (kind === "texts" || kind === "effects") return Infinity;
  const media = item as Clip | AudioTrack;
  const asset = assetOf(timeline, media.asset_id);
  if (!asset || asset.kind === "image" || asset.duration == null) return Infinity;
  const speed = kind === "clips" ? (item as Clip).speed : 1;
  return Math.max(0, (asset.duration - media.source_in) / speed);
}

function replace<K extends ItemKind>(timeline: Timeline, kind: K, id: string, next: Timeline[K][number] | Timeline[K][number][]): Timeline {
  const list = timeline[kind] as Item[];
  const index = list.findIndex((x) => x.id === id);
  if (index < 0) return timeline;
  const copy = [...list];
  copy.splice(index, 1, ...(Array.isArray(next) ? next : [next]));
  return { ...timeline, [kind]: copy };
}

export function update(timeline: Timeline, id: string, patch: Partial<Clip> | Partial<Text> | Partial<AudioTrack> | Partial<Effect>): Timeline {
  const found = find(timeline, id);
  if (!found) return timeline;
  // Editing an auto effect by hand makes it yours: the next auto run keeps it.
  const next = { ...found.item, ...patch, ...(found.kind === "effects" ? { auto: false } : {}) } as Item;
  // Changing speed or source_in can run past the end of the file: shorten to fit.
  const limit = maxDuration(timeline, found.kind, next);
  if (next.duration > limit) next.duration = round(Math.max(MIN_LEN, limit));
  return replace(timeline, found.kind, id, next as never);
}

/** Move an item, keeping it at or after 0. Clips may also change track. */
export function move(timeline: Timeline, id: string, start: number, track?: number): Timeline {
  const patch: Partial<Clip> = { start: round(Math.max(0, start)) };
  if (track !== undefined) patch.track = Math.max(0, Math.min(VIDEO_TRACKS - 1, track));
  return update(timeline, id, patch);
}

/** Drag the left edge: the clip's start moves and its source in-point moves with it. */
export function trimStart(timeline: Timeline, id: string, newStart: number): Timeline {
  const found = find(timeline, id);
  if (!found) return timeline;
  const { kind, item } = found;
  const end = item.start + item.duration;
  const speed = kind === "clips" ? (item as Clip).speed : 1;
  let start = Math.min(newStart, end - MIN_LEN);
  if (kind === "clips" || kind === "audio") {
    const sourceIn = (item as Clip | AudioTrack).source_in;
    start = Math.max(start, item.start - sourceIn / speed); // can't reveal before the file starts
  }
  start = Math.max(0, start);
  const patch: Partial<Clip> = { start: round(start), duration: round(end - start) };
  if (kind === "clips" || kind === "audio") patch.source_in = round(Math.max(0, (item as Clip | AudioTrack).source_in + (start - item.start) * speed));
  return replace(timeline, kind, id, { ...item, ...patch } as never);
}

/** Drag the right edge: only the duration changes, capped by what's left of the file. */
export function trimEnd(timeline: Timeline, id: string, newEnd: number): Timeline {
  const found = find(timeline, id);
  if (!found) return timeline;
  const limit = maxDuration(timeline, found.kind, found.item);
  const length = Math.min(limit, Math.max(MIN_LEN, newEnd - found.item.start));
  return replace(timeline, found.kind, id, { ...found.item, duration: round(length) } as never);
}

export function split(timeline: Timeline, id: string, at: number): Timeline {
  const found = find(timeline, id);
  if (!found) return timeline;
  const { kind, item } = found;
  const end = item.start + item.duration;
  if (at < item.start + MIN_LEN || at > end - MIN_LEN) return timeline;
  const left = { ...item, duration: round(at - item.start) } as Item;
  const right = { ...item, id: newId(timeline, id[0]), start: round(at), duration: round(end - at) } as Item;
  if (kind === "clips" || kind === "audio") {
    const speed = kind === "clips" ? (item as Clip).speed : 1;
    (right as Clip).source_in = round((item as Clip).source_in + (at - item.start) * speed);
    (left as Clip).fade_out = 0;
    (right as Clip).fade_in = 0;
  }
  return replace(timeline, kind, id, [left, right] as never);
}

export function remove(timeline: Timeline, ids: string[]): Timeline {
  const drop = new Set(ids);
  return {
    ...timeline,
    clips: timeline.clips.filter((x) => !drop.has(x.id)),
    texts: timeline.texts.filter((x) => !drop.has(x.id)),
    audio: timeline.audio.filter((x) => !drop.has(x.id)),
    effects: (timeline.effects ?? []).filter((x) => !drop.has(x.id)),
  };
}

export function duplicate(timeline: Timeline, id: string): { timeline: Timeline; id: string } {
  const found = find(timeline, id);
  if (!found) return { timeline, id };
  const copy = { ...found.item, id: newId(timeline, id[0]), start: round(found.item.start + found.item.duration) } as Item;
  return { timeline: { ...timeline, [found.kind]: [...(timeline[found.kind] as Item[]), copy] }, id: copy.id };
}

/** Put an asset on the timeline at `at`: on `track` if given, else the first video track that's free there. */
export function placeAsset(timeline: Timeline, assetId: string, at: number, onTrack?: number): { timeline: Timeline; id: string } | null {
  const asset = assetOf(timeline, assetId);
  if (!asset) return null;
  if (asset.kind === "audio") {
    const id = newId(timeline, "a");
    const length = Math.min(asset.duration ?? 10, Math.max(duration(timeline) - at, 5));
    const track: AudioTrack = { id, asset_id: asset.id, start: round(at), duration: round(length), source_in: 0, volume: 0.6, fade_in: 0, fade_out: 0 };
    return { timeline: { ...timeline, audio: [...timeline.audio, track] }, id };
  }
  const length = asset.kind === "image" ? 3 : (asset.duration ?? 3);
  const free = (track: number) => !timeline.clips.some((c) => c.track === track && c.start < at + length && c.start + c.duration > at);
  const track = onTrack ?? [0, 1, 2].find(free) ?? 0;
  const id = newId(timeline, "c");
  const clip: Clip = {
    id, asset_id: asset.id, track, start: round(at), duration: round(length), source_in: 0, speed: 1,
    volume: 1, muted: false, fit: "cover", fade_in: 0, fade_out: 0,
  };
  return { timeline: { ...timeline, clips: [...timeline.clips, clip] }, id };
}

export function addText(
  timeline: Timeline,
  at: number,
  presetOrStyle: string | Partial<Text> = "punch",
): { timeline: Timeline; id: string } {
  const id = newId(timeline, "t");
  const custom = typeof presetOrStyle === "string" ? TEXT_PRESETS[presetOrStyle]?.style : presetOrStyle;
  const isCaption = typeof presetOrStyle === "string" ? presetOrStyle !== "title" : true;
  const text: Text = {
    id,
    text: isCaption ? "Add captions here" : "Your text",
    start: round(at),
    duration: 3,
    x: 0.5,
    y: 0.68,
    width: 0.86,
    size: 84,
    font: "Bangers",
    color: "#FFFFFF", // design-check-ignore: default text colour
    stroke_color: "#000000", // design-check-ignore: default text colour
    stroke_width: 6,
    background: null,
    uppercase: false,
    animation: "pop",
    is_caption: isCaption,
    ...custom,
  };
  return { timeline: { ...timeline, texts: [...timeline.texts, text] }, id };
}

export function addEffect(timeline: Timeline, at: number, kind: EffectKind): { timeline: Timeline; id: string } {
  const id = newId(timeline, "fx");
  const effect: Effect = { id, kind, start: round(at), duration: EFFECTS[kind].length, intensity: 0.6, auto: false };
  return { timeline: { ...timeline, effects: [...(timeline.effects ?? []), effect] }, id };
}

/** Edge times worth snapping to while dragging: 0, the playhead, and every other item's edges. */
export function snapPoints(timeline: Timeline, exceptId: string, playhead: number): number[] {
  const points = [0, playhead];
  for (const x of [...timeline.clips, ...timeline.texts, ...timeline.audio]) {
    if (x.id !== exceptId) points.push(x.start, x.start + x.duration);
  }
  return points;
}

export function formatTime(seconds: number, precise = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return precise ? `${m}:${rest.toFixed(1).padStart(4, "0")}` : `${m}:${Math.floor(rest).toString().padStart(2, "0")}`;
}

/** A built-in sound effect (GET /api/editor/sfx). Its hit lands `lead` seconds into the file. */
export type SfxItem = { name: string; label: string; description: string; lead: number; duration: number; src: string };

/** Place a sound effect so its hit lands at `at` (the effect's asset is added the first time). */
export function addSfx(timeline: Timeline, sfx: SfxItem, at: number, volume = 0.6): { timeline: Timeline; id: string } {
  const assetId = `sfx_${sfx.name}`;
  const assets = timeline.assets.some((a) => a.id === assetId)
    ? timeline.assets
    : [...timeline.assets, { id: assetId, kind: "audio" as const, name: `SFX · ${sfx.label}`, src: sfx.src, duration: sfx.duration, width: null, height: null, has_audio: true }];
  const start = Math.max(0, at - sfx.lead);
  const sourceIn = round(Math.max(0, sfx.lead - at)); // near 0:00, skip the lead-in so the hit still lands on time
  const id = newId(timeline, "sfx");
  const track: AudioTrack = { id, asset_id: assetId, start: round(start), duration: round(sfx.duration - sourceIn), source_in: sourceIn, volume, fade_in: 0, fade_out: 0, is_sfx: true };
  return { timeline: { ...timeline, assets, audio: [...timeline.audio, track] }, id };
}
