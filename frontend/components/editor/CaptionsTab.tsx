"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTextStyles } from "@/components/editor/LibraryPanel";
import { Button, compactInputClass, Icon, Segmented, Select } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatTime, TEXT_PRESETS, type Text, type Timeline } from "@/lib/editor";

const POSITIONS = [
  { value: "0.2", label: "Top" },
  { value: "0.5", label: "Middle" },
  { value: "0.72", label: "Bottom" },
];
const SIZES = [
  { value: "64", label: "S" },
  { value: "84", label: "M" },
  { value: "110", label: "L" },
];
const WORDS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "5", label: "5" },
];

type Props = {
  timeline: Timeline;
  playhead: number;
  selectedId: string | null;
  /** Save an edit to the captions (one undo step; `coalesce` merges a run of the same edit). */
  onChange(next: Timeline, coalesce?: string): void;
  onSeek(t: number): void;
  onSelect(id: string | null): void;
  /** Transcribe the timeline and write fresh captions on the server (replaces existing ones). */
  onGenerate(preset: string, wordsPerCaption: number): Promise<void>;
  onError(message: string): void;
};

/** Every caption line, editable in place, plus one place to restyle them all. */
export function CaptionsTab({ timeline, playhead, selectedId, onChange, onSeek, onSelect, onGenerate, onError }: Props) {
  const captions = useMemo(() => timeline.texts.filter((t) => t.is_caption).sort((a, b) => a.start - b.start), [timeline.texts]);
  const styles = useTextStyles();
  const [preset, setPreset] = useState("punch");
  const [words, setWords] = useState("3");
  const [busy, setBusy] = useState(false);
  const activeRow = useRef<HTMLLIElement>(null);
  const current = captions.find((c) => playhead >= c.start && playhead < c.start + c.duration)?.id;

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  async function generate() {
    if (captions.length && !window.confirm("Replace the current captions (and any words you fixed) with a fresh transcript?")) return;
    setBusy(true);
    try {
      await onGenerate(preset, Number(words));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't make captions.");
    } finally {
      setBusy(false);
    }
  }

  /** Apply a style patch to every caption (keeping each one's words and timing). */
  function styleAll(patch: Partial<Text>, coalesce?: string) {
    const ids = new Set(captions.map((c) => c.id));
    onChange({ ...timeline, texts: timeline.texts.map((t) => (ids.has(t.id) ? { ...t, ...patch } : t)) }, coalesce);
  }

  function setText(id: string, text: string) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return remove(id);
    onChange({ ...timeline, texts: timeline.texts.map((t) => (t.id === id ? { ...t, text: clean } : t)) });
  }

  function remove(id: string) {
    onChange({ ...timeline, texts: timeline.texts.filter((t) => t.id !== id) });
    if (selectedId === id) onSelect(null);
  }

  const first = captions[0];

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-meta font-semibold tracking-wide text-ink-muted uppercase">{captions.length ? "Captions" : "Auto captions"}</h4>
        {!captions.length && <p className="text-meta text-ink-muted">Transcribes the speech in your clips and adds word-timed captions you can edit line by line.</p>}
        <div className="flex items-center gap-2">
          <Select compact aria-label="Caption style" value={preset} onChange={(e) => setPreset(e.target.value)} className="flex-1">
            {Object.entries(TEXT_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </Select>
          <span className="text-meta text-ink-muted">Words</span>
          <Segmented compact label="Words per caption" value={words} onChange={setWords} options={WORDS} />
        </div>
        <Button size="xs" className="w-full" variant={captions.length ? "secondary" : "primary"} loading={busy} disabled={busy} onClick={generate}>
          <Icon name={captions.length ? "refresh" : "captions"} className="size-5" /> {captions.length ? "Redo captions from speech" : "Generate captions"}
        </Button>
        {busy && <p className="text-meta text-ink-faint">Transcribing… this takes a few seconds per minute of speech.</p>}
      </section>

      {captions.length > 0 && first && (
        <>
          <section className="space-y-3 border-t border-line pt-4">
            <h4 className="text-meta font-semibold tracking-wide text-ink-muted uppercase">Style all {captions.length}</h4>
            <ul className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto">
              {styles.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => styleAll({ ...s.style, y: s.style.y ?? first.y })}
                    title={s.description}
                    className="tactile w-full truncate rounded-md border border-line bg-paper px-2 py-1.5 text-left text-meta text-ink hover:border-brand-soft"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
              <span className="text-meta text-ink-muted">Position</span>
              <Segmented compact label="Caption position" value={closest(first.y, POSITIONS)} onChange={(v) => styleAll({ y: Number(v) })} className="w-full" options={POSITIONS} />
              <span className="text-meta text-ink-muted">Size</span>
              <Segmented compact label="Caption size" value={closest(first.size, SIZES)} onChange={(v) => styleAll({ size: Number(v) })} className="w-full" options={SIZES} />
              <span className="text-meta text-ink-muted">Case</span>
              <Segmented
                compact
                label="Caption case"
                value={first.uppercase ? "upper" : "as-said"}
                onChange={(v) => styleAll({ uppercase: v === "upper" })}
                className="w-full"
                options={[{ value: "as-said", label: "As said" }, { value: "upper", label: "CAPS" }]}
              />
            </div>
          </section>

          <section className="space-y-2 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-meta font-semibold tracking-wide text-ink-muted uppercase">Lines</h4>
              <Button size="xs" variant="ghost" onClick={() => window.confirm(`Remove all ${captions.length} captions?`) && styleAllRemove()}>
                <Icon name="trash" className="size-5" /> Remove all
              </Button>
            </div>
            <ul className="space-y-1">
              {captions.map((c) => (
                <li
                  key={c.id}
                  ref={c.id === current ? activeRow : undefined}
                  className={cn("flex items-start gap-2 rounded-md border p-1.5", c.id === current || c.id === selectedId ? "border-brand bg-brand-subtle" : "border-line bg-paper")}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSeek(c.start + 0.01);
                      onSelect(c.id);
                    }}
                    className="mt-1.5 shrink-0 font-mono text-meta text-ink-muted hover:text-brand"
                    title="Jump here"
                  >
                    {formatTime(c.start, true)}
                  </button>
                  <CaptionLine caption={c} onCommit={(text) => setText(c.id, text)} onFocus={() => onSeek(c.start + 0.01)} />
                  <Button size="xs" variant="ghost" onClick={() => remove(c.id)} aria-label={`Delete caption "${c.text}"`} title="Delete line">
                    <Icon name="x" className="size-5" />
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-meta text-ink-faint">Fix a word and press Enter. Drag a caption on the Text lane to retime it.</p>
          </section>
        </>
      )}
    </div>
  );

  function styleAllRemove() {
    const ids = new Set(captions.map((c) => c.id));
    onChange({ ...timeline, texts: timeline.texts.filter((t) => !ids.has(t.id)) });
    if (selectedId && ids.has(selectedId)) onSelect(null);
  }
}

/** One editable line: edits stay local while typing and save on Enter or when you leave it. */
function CaptionLine({ caption, onCommit, onFocus }: { caption: Text; onCommit(text: string): void; onFocus(): void }) {
  const [draft, setDraft] = useState(caption.text);
  useEffect(() => setDraft(caption.text), [caption.text]);

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      setDraft(caption.text);
      requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
    }
    e.stopPropagation(); // typing must not trigger editor shortcuts (space = play, S = split)
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={() => draft !== caption.text && onCommit(draft)}
      onKeyDown={onKey}
      aria-label={`Caption at ${formatTime(caption.start, true)}`}
      className={cn(compactInputClass, "min-w-0 flex-1")}
    />
  );
}

function closest(value: number, options: { value: string }[]): string {
  return options.reduce((best, o) => (Math.abs(Number(o.value) - value) < Math.abs(Number(best) - value) ? o.value : best), options[0].value);
}
