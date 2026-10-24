"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from "react";
import { ASPECT_SIZE, type Aspect, type Text } from "@/lib/editor";

/** The bits of <hyperframes-player>'s API the editor uses. */
type Player = HTMLElement & {
  play(): void;
  pause(): void;
  seek(t: number): void;
  currentTime: number;
  paused: boolean;
};

/**
 * Media kept in memory for this session. The player reloads the whole composition after every
 * edit, and browsers don't reliably reuse their cache for streamed video, so each edit used to
 * download every clip on the timeline again (seconds of "Updating…" on a real connection).
 * Each file is now fetched once and the preview points at the in-memory copy (a blob: URL).
 * The export renders from the server's files, so it's unaffected.
 */
const MAX_BLOB_BYTES = 250 * 1024 * 1024; // full source videos can be huge: those stream as before
const MEDIA_WAIT_MS = 15_000; // first load: wait this long for downloads, then show what's ready
const MEDIA_SRC = /\ssrc="([^"]+\/storage\/[^"]+\.(?:mp4|webm|mov|m4v|m4a|mp3|wav|ogg|aac|opus))"/gi;
const blobs = new Map<string, Promise<string | null>>();
const localMedia = new Map<string, string>();

function mediaUrls(html: string): string[] {
  return [...new Set([...html.matchAll(MEDIA_SRC)].map((m) => m[1]))];
}

function fetchBlob(url: string): Promise<string | null> {
  let job = blobs.get(url);
  if (!job) {
    job = (async () => {
      const ctrl = new AbortController();
      const res = await fetch(url, { signal: ctrl.signal });
      const size = Number(res.headers.get("content-length") || 0);
      if (!res.ok || size > MAX_BLOB_BYTES) {
        ctrl.abort();
        return null;
      }
      const objectUrl = URL.createObjectURL(await res.blob());
      localMedia.set(url, objectUrl);
      return objectUrl;
    })().catch(() => null);
    blobs.set(url, job);
  }
  return job;
}

/** The composition with every downloaded media file pointing at its in-memory copy. */
function withLocalMedia(html: string): string {
  return html.replace(MEDIA_SRC, (whole, url: string) => {
    const local = localMedia.get(url);
    return local ? whole.replace(url, local) : whole;
  });
}

export type PreviewHandle = { play(): void; pause(): void; seek(t: number): void };

type Props = {
  /** Compiled HyperFrames composition (from the API), shown via srcdoc. */
  html: string | null;
  aspect: Aspect;
  playhead: number;
  /** Selected text overlay: shows a handle to drag it around the frame. */
  selectedText: Text | null;
  onTime(t: number): void;
  onPlayingChange(playing: boolean): void;
  onMoveText(id: string, x: number, y: number, commit: boolean): void;
};

/**
 * The live preview is the real HyperFrames runtime (the same one that renders the export),
 * so what you see here is what you get in the MP4.
 */
export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { html, aspect, playhead, selectedText, onTime, onPlayingChange, onMoveText },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const playheadRef = useRef(playhead);
  const callbacks = useRef({ onTime, onPlayingChange });
  const [ready, setReady] = useState(false);
  const [mediaLoading, setMediaLoading] = useState<{ done: number; total: number } | null>(null);
  const loadSeq = useRef(0);
  const [width, height] = ASPECT_SIZE[aspect];

  const htmlRef = useRef(html);
  playheadRef.current = playhead;
  htmlRef.current = html;
  callbacks.current = { onTime, onPlayingChange };

  // The player is a custom element that touches `window` on import: create it on the client only.
  useEffect(() => {
    let disposed = false;
    import("@hyperframes/player").then(() => {
      if (disposed || !host.current) return;
      const el = document.createElement("hyperframes-player") as Player;
      el.style.width = "100%";
      el.style.height = "100%";
      el.setAttribute("disable-click-to-play", "");
      el.addEventListener("ready", () => {
        setReady(true);
        el.seek(playheadRef.current); // a reload after a save keeps your place
      });
      el.addEventListener("timeupdate", () => callbacks.current.onTime(el.currentTime));
      el.addEventListener("play", () => callbacks.current.onPlayingChange(true));
      el.addEventListener("pause", () => callbacks.current.onPlayingChange(false));
      el.addEventListener("ended", () => callbacks.current.onPlayingChange(false));
      host.current.appendChild(el);
      player.current = el;
      if (htmlRef.current) loadRef.current(htmlRef.current);
    });
    return () => {
      disposed = true;
      player.current?.remove();
      player.current = null;
    };
  }, []);

  /** Show a composition, once its media is in memory (or after MEDIA_WAIT_MS, whatever is). */
  const load = useCallback(async (doc: string) => {
    const seq = ++loadSeq.current;
    setReady(false);
    const urls = mediaUrls(doc);
    const missing = urls.filter((u) => !localMedia.has(u));
    if (missing.length) {
      let done = 0;
      setMediaLoading({ done, total: missing.length });
      const all = Promise.all(
        missing.map((u) =>
          fetchBlob(u).then(() => {
            if (seq === loadSeq.current) setMediaLoading({ done: ++done, total: missing.length });
          }),
        ),
      );
      await Promise.race([all, new Promise((r) => setTimeout(r, MEDIA_WAIT_MS))]);
      if (seq !== loadSeq.current) return; // a newer composition arrived meanwhile
      setMediaLoading(null);
    }
    player.current?.setAttribute("srcdoc", withLocalMedia(doc));
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (player.current && html) load(html);
  }, [html, load]);

  useImperativeHandle(ref, () => ({
    play: () => player.current?.play(),
    pause: () => player.current?.pause(),
    seek: (t: number) => player.current?.seek(t),
  }));

  // Drag the selected text's handle to reposition it (x/y are fractions of the frame).
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  function textPoint(e: PointerEvent) {
    const box = frame.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        ref={frame}
        className="relative max-h-full max-w-full overflow-hidden rounded-md bg-surface-sunken shadow-glow"
        style={{ aspectRatio: `${width} / ${height}`, height: width < height ? "100%" : undefined, width: width >= height ? "100%" : undefined }}
      >
        <div ref={host} className="absolute inset-0" />
        {!html && <p className="absolute inset-0 grid place-items-center text-base text-ink-muted">Loading preview…</p>}
        {html && !ready && (
          <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-surface px-3 py-1 text-meta text-ink-muted">
            {mediaLoading ? `Loading media ${mediaLoading.done}/${mediaLoading.total}…` : "Updating…"}
          </p>
        )}

        {selectedText && (
          <button
            type="button"
            aria-label="Drag to move the text"
            className="tactile absolute grid size-12 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none place-items-center rounded-full border-2 border-on-brand bg-brand text-on-brand shadow-glow-strong"
            style={{ left: `${selectedText.x * 100}%`, top: `${selectedText.y * 100}%` }}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragging.current) return;
              const { x, y } = textPoint(e);
              onMoveText(selectedText.id, x, y, false);
            }}
            onPointerUp={(e) => {
              if (!dragging.current) return;
              dragging.current = false;
              const { x, y } = textPoint(e);
              onMoveText(selectedText.id, x, y, true);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
