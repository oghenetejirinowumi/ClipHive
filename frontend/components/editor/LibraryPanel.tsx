"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button, compactInputClass, Icon, Select } from "@/components/ui";
import { api, ApiError, API_URL } from "@/lib/api";
import { type CaptionStyle } from "@/lib/captions";
import { cn } from "@/lib/cn";
import { formatTime, TEXT_PRESETS, type Asset, type Font, type Project, type Text, type TextAnimation } from "@/lib/editor";
import type { ImportJob } from "@/lib/imports";

export type LibraryTab = "media" | "text" | "audio" | "properties";
type Sort = "name" | "newest" | "longest";
type LibraryClip = { id: number; title: string | null; status: string; duration_s: number; file_path: string | null };

/** dataTransfer type for dragging a tile onto the timeline. */
export const ASSET_DRAG_TYPE = "application/x-cliphive-asset";

const TABS: { value: LibraryTab; label: string }[] = [
  { value: "media", label: "Media" },
  { value: "text", label: "Captions" },
  { value: "audio", label: "Audio" },
  { value: "properties", label: "Properties" },
];

type Props = {
  tab: LibraryTab;
  onTab(tab: LibraryTab): void;
  projectId: number;
  assets: Asset[];
  /** The Properties tab (the selected item's settings). */
  properties: ReactNode;
  beforeServerEdit(): Promise<void>;
  onProject(project: Project): void;
  onPlace(assetId: string): void;
  onAddText(presetOrStyle: string | Partial<Text>): void;
  onError(message: string): void;
};

/** Left panel: media bin (search, sort, tiles), text styles, audio, and the selection's properties. */
export function LibraryPanel(props: Props) {
  const { tab, onTab } = props;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Library" className="flex gap-1 border-b border-line px-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={tab === t.value}
            onClick={() => onTab(t.value)}
            className={cn(
              "-mb-px min-h-11 border-b-2 px-3 text-meta font-medium transition-colors",
              tab === t.value ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "media" && <MediaTab {...props} kinds={["video", "image"]} />}
        {tab === "audio" && <MediaTab {...props} kinds={["audio"]} />}
        {tab === "text" && <TextTab onAddText={props.onAddText} />}
        {tab === "properties" && props.properties}
      </div>
    </div>
  );
}

function MediaTab({ projectId, assets, kinds, beforeServerEdit, onProject, onPlace, onError }: Props & { kinds: Asset["kind"][] }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [uploading, setUploading] = useState(false);
  const [library, setLibrary] = useState<{ clips: LibraryClip[]; imports: ImportJob[] } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const audio = kinds.includes("audio");

  const shown = useMemo(() => {
    const list = assets.filter((a) => kinds.includes(a.kind) && a.name.toLowerCase().includes(query.trim().toLowerCase()));
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "longest") return [...list].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    return [...list].reverse(); // newest first: assets are stored in the order they were added
  }, [assets, kinds, query, sort]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      await beforeServerEdit();
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("place", "false");
        onProject(await api<Project>(`/api/editor/projects/${projectId}/assets`, { method: "POST", body: form }));
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openLibrary() {
    if (library) return setLibrary(null);
    try {
      const [clips, imports] = await Promise.all([api<LibraryClip[]>("/api/clips"), api<ImportJob[]>("/api/imports")]);
      setLibrary({ clips: clips.filter((c) => c.file_path), imports: imports.filter((j) => j.status === "done") });
    } catch {
      onError("Couldn't load your clips.");
    }
  }

  async function addFromLibrary(body: { clip_id?: number; import_id?: number }, key: string) {
    setAdding(key);
    try {
      await beforeServerEdit();
      onProject(await api<Project>(`/api/editor/projects/${projectId}/assets/library`, { method: "POST", body: { ...body, place: false } }));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't add that video.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={audio ? "Search audio…" : "Search media…"}
          aria-label={audio ? "Search audio" : "Search media"}
          className={cn(compactInputClass, "pl-10")}
        />
      </div>
      <div className="flex items-center gap-2">
        <Select compact aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-auto">
          <option value="newest">Newest</option>
          <option value="name">Name A–Z</option>
          <option value="longest">Longest</option>
        </Select>
        <div className="flex-1" />
        <Button size="xs" loading={uploading} onClick={() => fileInput.current?.click()} title="Upload files">
          <Icon name="upload" className="size-5" /> Upload
        </Button>
        <input ref={fileInput} type="file" multiple accept={audio ? "audio/*" : "video/*,image/*"} className="hidden" onChange={(e) => upload(e.target.files)} />
      </div>

      {!audio && (
        <Button size="xs" variant="secondary" className="w-full" onClick={openLibrary}>
          <Icon name="grid" className="size-5" /> {library ? "Hide your clips" : "Add from your clips"}
        </Button>
      )}
      {library && (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-line p-1">
          {library.clips.length === 0 && library.imports.length === 0 && <p className="p-2 text-meta text-ink-muted">No clips yet. Make some on the Create page.</p>}
          {library.clips.map((c) => (
            <LibraryRow key={`c${c.id}`} label={c.title ?? `Clip ${c.id}`} meta={`${formatTime(c.duration_s)} · ${c.status}`} busy={adding === `c${c.id}`} onAdd={() => addFromLibrary({ clip_id: c.id }, `c${c.id}`)} />
          ))}
          {library.imports.map((j) => (
            <LibraryRow key={`i${j.id}`} label={j.title ?? j.original_filename ?? `Import ${j.id}`} meta={`Full video · ${j.duration_s ? formatTime(j.duration_s) : "?"}`} busy={adding === `i${j.id}`} onAdd={() => addFromLibrary({ import_id: j.id }, `i${j.id}`)} />
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-6 text-center text-meta text-ink-muted">
          {query ? "Nothing matches that search." : audio ? "Upload music or sound effects." : "Upload video or images, or add one of your clips."}
        </p>
      ) : (
        <ul className={cn("grid gap-2", audio ? "grid-cols-1" : "grid-cols-2")}>
          {shown.map((a) => (
            <li key={a.id}>
              <Tile asset={a} onPlace={() => onPlace(a.id)} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-meta text-ink-faint">Click a tile to add it at the playhead, or drag it onto a track.</p>
    </div>
  );
}

function Tile({ asset, onPlace }: { asset: Asset; onPlace(): void }) {
  const url = `${API_URL}/${asset.src}`;
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
    e.dataTransfer.effectAllowed = "copy";
  };
  if (asset.kind === "audio") {
    return (
      <button type="button" draggable onDragStart={onDragStart} onClick={onPlace} className="tactile flex w-full items-center gap-3 rounded-md border border-line bg-paper p-2 text-left hover:border-brand-soft">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-subtle text-brand-strong">
          <Icon name="music" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-meta font-medium text-ink">{asset.name}</span>
          <span className="block text-meta text-ink-faint">{asset.duration != null ? formatTime(asset.duration) : ""}</span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" draggable onDragStart={onDragStart} onClick={onPlace} title={asset.name} className="tactile group block w-full overflow-hidden rounded-md border border-line bg-paper text-left hover:border-brand-soft">
      <span className="relative block aspect-video bg-surface-sunken">
        {asset.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
        ) : (
          <video src={`${url}#t=0.5`} muted preload="metadata" playsInline className="pointer-events-none absolute inset-0 size-full object-cover" />
        )}
        {asset.duration != null && (
          <span className="absolute right-1 bottom-1 rounded-sm bg-surface/90 px-1.5 text-fine text-ink tabular-nums">{formatTime(asset.duration)}</span>
        )}
      </span>
      <span className="block truncate px-2 py-1 text-meta text-ink">{asset.name}</span>
    </button>
  );
}

function TextTab({ onAddText }: { onAddText(presetOrStyle: string | Partial<Text>): void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [dbStyles, setDbStyles] = useState<CaptionStyle[]>([]);

  useEffect(() => {
    api<CaptionStyle[]>("/api/styles", { auth: false })
      .then(setDbStyles)
      .catch(() => undefined);
  }, []);

  const allStyles = useMemo(() => {
    const list: Array<{ key: string; label: string; category: string; description: string; style: Partial<Text> }> = [];

    // Add built-in presets
    for (const [key, preset] of Object.entries(TEXT_PRESETS)) {
      list.push({ key, label: preset.label, category: preset.category, description: preset.description, style: preset.style });
    }

    // Add any custom styles from db that aren't presets
    for (const s of dbStyles) {
      if (!s.is_preset && !list.some((item) => item.label.toLowerCase() === s.name.toLowerCase())) {
        list.push({
          key: `custom_${s.id}`,
          label: s.name,
          category: s.category || "Custom",
          description: s.description || "Custom caption style",
          style: {
            font: s.font_name as Font,
            color: s.options?.text_color ?? "#FFFFFF", // design-check-ignore: caption colours
            stroke_color: s.options?.outline_color ?? null, // design-check-ignore: caption colours
            stroke_width: s.options?.outline_width ?? 0,
            background: s.options?.box_color ?? null, // design-check-ignore: caption colours
            uppercase: s.uppercase,
            animation: (s.animation_type as TextAnimation) || "pop",
            size: s.font_size || 84,
            y: (s.options?.position_y ? s.options.position_y / 100 : 0.68),
          },
        });
      }
    }
    return list;
  }, [dbStyles]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of allStyles) {
      if (s.category) set.add(s.category);
    }
    return ["All", ...Array.from(set)];
  }, [allStyles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allStyles.filter((s) => {
      const matchCat = category === "All" || s.category.toLowerCase() === category.toLowerCase();
      const matchQ = !q || s.label.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [allStyles, category, query]);

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search caption styles…"
          aria-label="Search caption styles"
          className={cn(compactInputClass, "pl-10")}
        />
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={cn(
              "rounded px-2.5 py-1 text-meta font-medium transition",
              category === c
                ? "bg-brand text-on-brand"
                : "bg-surface-elevated text-ink hover:bg-surface-sunken"
            )}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Grid of caption style tiles */}
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-meta text-ink-muted">No caption styles match that search.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {filtered.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onAddText(item.key in TEXT_PRESETS ? item.key : item.style)}
                className="tactile group flex aspect-[16/11] w-full flex-col justify-between overflow-hidden rounded-md border border-line bg-surface-sunken p-2.5 text-left transition hover:border-brand-soft"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-meta font-semibold text-ink">{item.label}</span>
                  <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-fine font-medium text-ink-muted">
                    {item.category}
                  </span>
                </div>

                <div className="flex flex-1 items-center justify-center py-1">
                  <span
                    className="rounded px-2 py-0.5 text-2xl font-bold transition group-hover:scale-105"
                    style={{
                      fontFamily: item.style.font ? `"${item.style.font}", system-ui, sans-serif` : undefined,
                      color: item.style.color,
                      background: item.style.background ?? undefined,
                      WebkitTextStroke: item.style.stroke_color && item.style.stroke_width ? `1.5px ${item.style.stroke_color}` : undefined,
                      textTransform: item.style.uppercase ? "uppercase" : undefined,
                    }}
                  >
                    Aa
                  </span>
                </div>

                <div className="flex items-center justify-between text-fine text-ink-muted">
                  <span className="truncate pr-1 text-ink-faint">{item.description}</span>
                  <span className="shrink-0 font-medium text-brand group-hover:underline">Add +</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-meta text-ink-faint">Click any style to place it at the playhead. Reposition in the preview or tweak in Properties.</p>
    </div>
  );
}

function LibraryRow({ label, meta, busy, onAdd }: { label: string; meta: string; busy: boolean; onAdd(): void }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-meta text-ink">{label}</p>
        <p className="text-meta text-ink-faint">{meta}</p>
      </div>
      <Button size="xs" variant="secondary" loading={busy} onClick={onAdd}>
        Add
      </Button>
    </div>
  );
}
