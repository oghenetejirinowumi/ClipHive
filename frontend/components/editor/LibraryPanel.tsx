"use client";

import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button, compactInputClass, Icon, Select } from "@/components/ui";
import { api, ApiError, API_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatTime, TEXT_PRESETS, type Asset, type Project } from "@/lib/editor";
import type { ImportJob } from "@/lib/imports";

export type LibraryTab = "media" | "text" | "audio" | "properties";
type Sort = "name" | "newest" | "longest";
type LibraryClip = { id: number; title: string | null; status: string; duration_s: number; file_path: string | null };

/** dataTransfer type for dragging a tile onto the timeline. */
export const ASSET_DRAG_TYPE = "application/x-cliphive-asset";

const TABS: { value: LibraryTab; label: string }[] = [
  { value: "media", label: "Media" },
  { value: "text", label: "Text" },
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
  onAddText(preset: string): void;
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

function TextTab({ onAddText }: { onAddText(preset: string): void }) {
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2">
        {Object.entries(TEXT_PRESETS).map(([key, preset]) => (
          <li key={key}>
            <button type="button" onClick={() => onAddText(key)} className="tactile flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-md border border-line bg-surface-sunken hover:border-brand-soft">
              <span
                className="rounded-sm px-2 text-xl font-bold"
                style={{
                  color: preset.style.color,
                  background: preset.style.background ?? undefined,
                  WebkitTextStroke: preset.style.stroke_color ? `1px ${preset.style.stroke_color}` : undefined,
                  textTransform: preset.style.uppercase ? "uppercase" : undefined,
                }}
              >
                Aa
              </span>
              <span className="text-meta text-ink-muted">{preset.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-meta text-ink-faint">Adds a text at the playhead. Edit it in Properties, or drag it on the preview.</p>
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
