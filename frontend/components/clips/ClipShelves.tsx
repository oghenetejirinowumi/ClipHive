"use client";

import type { ReactNode } from "react";
import { Badge, compactInputClass, Icon, Panel, Segmented, type SegmentedOption } from "@/components/ui";
import { cn } from "@/lib/cn";

/** The fields a clip can be searched and grouped by (both the inbox and library clip shapes fit). */
export type ShelfClip = {
  id: number;
  title?: string | null;
  hashtags?: string[];
  context_json?: { game_or_topic?: string; summary?: string } | null;
  source_title?: string | null;
};

export type Shelf<T> = { key: string; label: string; items: T[] };

/** Every word of the query must appear somewhere in the clip's title, tags, topic, summary or source. */
export function matchesQuery(clip: ShelfClip, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [clip.title, clip.source_title, clip.context_json?.game_or_topic, clip.context_json?.summary, ...(clip.hashtags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w.replace(/^#/, "")));
}

/**
 * Group clips into shelves. `keyOf` returns the group's label (null = the `fallback` shelf).
 * With `order`, shelves follow that order of labels; otherwise the biggest shelves come first.
 * The fallback shelf always comes last.
 */
export function shelvesBy<T>(items: T[], keyOf: (item: T) => string | null | undefined, fallback: string, order?: string[]): Shelf<T>[] {
  const map = new Map<string, Shelf<T>>();
  for (const item of items) {
    const label = keyOf(item)?.trim() || fallback;
    const key = label.toLowerCase();
    const shelf = map.get(key) ?? { key, label, items: [] };
    shelf.items.push(item);
    map.set(key, shelf);
  }
  const rank = (s: Shelf<T>) => (order ? order.indexOf(s.label) : -s.items.length);
  return [...map.values()].sort((a, b) => {
    if (a.label === fallback) return 1;
    if (b.label === fallback) return -1;
    return rank(a) - rank(b);
  });
}

/** Search box + "group by" switch above a set of shelves. */
export function ClipToolbar<G extends string>({
  query,
  onQuery,
  groupBy,
  onGroupBy,
  groupOptions,
  placeholder = "Search your clips: title, game, #tag…",
  className,
}: {
  query: string;
  onQuery: (q: string) => void;
  groupBy: G;
  onGroupBy: (g: G) => void;
  groupOptions: SegmentedOption<G>[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)}>
      <div className="relative min-w-0 flex-1" role="search">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Search clips"
          enterKeyHint="search"
          className={cn(compactInputClass, "rounded-full pr-11 pl-11")}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-full text-ink-muted hover:text-ink"
          >
            <Icon name="x" className="size-5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-meta text-ink-muted">Group by</span>
        <Segmented compact label="Group clips by" value={groupBy} onChange={onGroupBy} options={groupOptions} className="max-sm:flex-1" />
      </div>
    </div>
  );
}

/**
 * One titled row per shelf. Phones: each shelf swipes sideways (see .rail in globals.css), so a
 * long library reads as a few short rows. Wider screens: a grid per shelf.
 */
export function ClipShelves<T extends { id: number }>({
  shelves,
  renderTile,
  query,
  onClearQuery,
}: {
  shelves: Shelf<T>[];
  renderTile: (item: T) => ReactNode;
  query?: string;
  onClearQuery?: () => void;
}) {
  if (shelves.length === 0) {
    return (
      <Panel tone="sunken" padding="md" className="flex flex-col items-center gap-3 text-center">
        <p className="text-lg text-ink-muted">{query ? `No clips match “${query}”.` : "No clips here yet."}</p>
        {query && onClearQuery && (
          <button type="button" onClick={onClearQuery} className="min-h-11 font-semibold text-brand underline underline-offset-4">
            Clear search
          </button>
        )}
      </Panel>
    );
  }
  return (
    <div className="space-y-8">
      {shelves.map((shelf) => (
        <section key={shelf.key} aria-label={shelf.label} className="space-y-3">
          <h3 className="flex items-center gap-3">
            <span className="min-w-0 truncate font-display text-xl font-semibold tracking-tight text-ink">{shelf.label}</span>
            <Badge tone="neutral" size="sm" className="shrink-0">
              {shelf.items.length}
            </Badge>
          </h3>
          <ul className="rail rail-media grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
            {shelf.items.map((item) => (
              <li key={item.id} className="min-w-0">
                {renderTile(item)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
