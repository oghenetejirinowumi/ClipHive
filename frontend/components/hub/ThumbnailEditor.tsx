"use client";

import { useEffect, useState } from "react";
import { Button, Icon, Input } from "@/components/ui";
import { api, API_URL, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

export type Thumbnail = { path: string; text: string; frame_s: number; streamer_tag?: string | null };
type Frame = { t: number; score: number; preview: string };

type Props<C> = {
  clipId: number;
  thumbnail?: Thumbnail | null;
  /** The clip as the server returns it after a remake (its context_json carries the thumbnail). */
  onClip(clip: C): void;
};

/**
 * A clip's thumbnail: the best frame with a 2-4 word hook. Pick another frame, change the words,
 * remake, download. Every clip gets one automatically when it's cut; this is for changing it.
 */
export function ThumbnailEditor<C>({ clipId, thumbnail, onClip }: Props<C>) {
  const [open, setOpen] = useState(false);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [frame, setFrame] = useState<number | null>(thumbnail?.frame_s ?? null);
  const [text, setText] = useState(thumbnail?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = thumbnail ? `${API_URL}/${thumbnail.path}` : null;

  useEffect(() => {
    if (!open || frames) return;
    api<Frame[]>(`/api/clips/${clipId}/thumbnail/frames`)
      .then(setFrames)
      .catch((err) => {
        setFrames([]);
        setError(err instanceof ApiError ? err.message : "Couldn't load frames.");
      });
  }, [open, frames, clipId]);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      onClip(await api<C>(`/api/clips/${clipId}/thumbnail`, { method: "POST", body: { frame_s: frame, text: text.trim() || null } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't make the thumbnail.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated file in our storage
          <img src={url} alt="" className="h-20 w-auto rounded-md border border-line object-cover" />
        ) : (
          <span className="grid h-20 w-12 place-items-center rounded-md border border-dashed border-line-strong text-ink-faint">
            <Icon name="image" className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-ink">Thumbnail</p>
          <p className="truncate text-base text-ink-muted">{thumbnail ? `"${thumbnail.text}"` : "Not made yet"}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Done" : thumbnail ? "Change" : "Make one"}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 rounded-md border border-line bg-surface-sunken p-3">
          <p className="text-base font-medium text-ink">Frame</p>
          {frames === null ? (
            <p className="text-base text-ink-muted">Finding the best frames…</p>
          ) : (
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Thumbnail frame">
              {frames.map((f, i) => (
                <button
                  key={f.t}
                  type="button"
                  role="radio"
                  aria-checked={frame === f.t || (frame === null && i === 0)}
                  aria-label={`Frame at ${f.t.toFixed(1)}s${i === 0 ? " (best)" : ""}`}
                  onClick={() => setFrame(f.t)}
                  className={cn(
                    "overflow-hidden rounded-md border-2 transition-colors",
                    frame === f.t || (frame === null && i === 0) ? "border-brand" : "border-transparent hover:border-line-strong",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data: preview */}
                  <img src={f.preview} alt="" className="aspect-[9/16] w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-base font-medium text-ink">Hook text</span>
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={60} placeholder="2-4 words, e.g. SHE WASN'T READY" />
          </label>
          {error && <p className="text-base text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={make}>
              <Icon name="sparkles" className="size-5" /> {thumbnail ? "Remake" : "Make thumbnail"}
            </Button>
            {url && (
              <a href={url} download={`clip_${clipId}_thumbnail.jpg`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 px-3 text-base font-medium text-brand hover:underline">
                <Icon name="download" className="size-5" /> Download JPG
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
