/**
 * Video editor timeline: types (mirror backend/app/schemas/editor.py) and the hand-editing
 * operations. The AI assistant makes the same edits server-side (services/editor/ops.py);
 * the server re-validates every save, so these stay simple and pure.
 *
 * Source math: a clip plays duration × speed seconds of its file, starting at source_in.
 */

export type Aspect = "9:16" | "16:9" | "1:1" | "4:5";
export type Font = "Bangers" | "Luckiest Guy" | "Poppins" | "System";
export type TextAnimation = "none" | "fade" | "pop" | "slide_up" | "typewriter";

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
};

export type Timeline = {
  version: 1;
  aspect: Aspect;
  background: string;
  assets: Asset[];
  clips: Clip[];
  texts: Text[];
  audio: AudioTrack[];
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
};

export type ProjectSummary = Pick<Project, "id" | "title" | "revision" | "render_status" | "created_at" | "updated_at">;

export type ItemKind = "clips" | "texts" | "audio";
export type Item = Clip | Text | AudioTrack;

export const ASPECT_SIZE: Record<Aspect, [number, number]> = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };
export const VIDEO_TRACKS = 3;
export const MIN_LEN = 0.1;

// User-chosen text colours are content, not UI chrome, so they're real colour values.
export const DEFAULT_OUTLINE = "#000000"; // design-check-ignore: text content colour
export const DEFAULT_BOX = "#111111"; // design-check-ignore: text content colour
export const TEXT_PRESETS: Record<string, { label: string; style: Partial<Text> }> = {
  punch: { label: "Punch", style: { font: "Bangers", color: "#FFE600", stroke_color: "#000000", stroke_width: 6, uppercase: true, animation: "pop", background: null } }, // design-check-ignore: caption colours
  clean: { label: "Clean", style: { font: "Poppins", color: "#FFFFFF", stroke_color: null, stroke_width: 0, uppercase: false, animation: "fade", background: "#111111" } }, // design-check-ignore: caption colours
  neon: { label: "Neon", style: { font: "Luckiest Guy", color: "#00E5FF", stroke_color: "#FF00C8", stroke_width: 5, uppercase: true, animation: "pop", background: null } }, // design-check-ignore: caption colours
  title: { label: "Title", style: { font: "Bangers", color: "#FFFFFF", stroke_color: "#000000", stroke_width: 8, uppercase: true, animation: "slide_up", background: null, size: 120 } }, // design-check-ignore: caption colours
  subtle: { label: "Subtle", style: { font: "System", color: "#FFFFFF", stroke_color: "#000000", stroke_width: 3, uppercase: false, animation: "fade", background: null, size: 56 } }, // design-check-ignore: caption colours
};

const round = (n: number) => Math.round(n * 1000) / 1000;

export function newId(timeline: Timeline, prefix: string): string {
  const taken = new Set([...timeline.assets, ...timeline.clips, ...timeline.texts, ...timeline.audio].map((x) => x.id));
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
  for (const kind of ["clips", "texts", "audio"] as const) {
    const item = (timeline[kind] as Item[]).find((x) => x.id === id);
    if (item) return { kind, item };
  }
  return null;
}

/** Longest timeline duration an item can have from its source_in (Infinity for images and texts). */
export function maxDuration(timeline: Timeline, kind: ItemKind, item: Item): number {
  if (kind === "texts") return Infinity;
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

export function update(timeline: Timeline, id: string, patch: Partial<Clip> | Partial<Text> | Partial<AudioTrack>): Timeline {
  const found = find(timeline, id);
  if (!found) return timeline;
  const next = { ...found.item, ...patch } as Item;
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
  if (kind !== "texts") {
    const sourceIn = (item as Clip | AudioTrack).source_in;
    start = Math.max(start, item.start - sourceIn / speed); // can't reveal before the file starts
  }
  start = Math.max(0, start);
  const patch: Partial<Clip> = { start: round(start), duration: round(end - start) };
  if (kind !== "texts") patch.source_in = round(Math.max(0, (item as Clip | AudioTrack).source_in + (start - item.start) * speed));
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
  if (kind !== "texts") {
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

export function addText(timeline: Timeline, at: number, preset = "punch"): { timeline: Timeline; id: string } {
  const id = newId(timeline, "t");
  const text: Text = {
    id, text: "Your text", start: round(at), duration: 3, x: 0.5, y: 0.2, width: 0.86, size: 84, font: "Bangers",
    color: "#FFFFFF", stroke_color: "#000000", stroke_width: 6, background: null, uppercase: false, animation: "pop", is_caption: false, // design-check-ignore: default text colour
    ...TEXT_PRESETS[preset]?.style,
  };
  return { timeline: { ...timeline, texts: [...timeline.texts, text] }, id };
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
