"use client";

import { useEffect, useRef } from "react";
import { HoneyDrip } from "@/components/hive";
import { Button, Icon } from "@/components/ui";
import { API_URL } from "@/lib/api";

/**
 * The popup frame for one clip: the video on the left, the page's details on the right.
 * A native <dialog>, so focus stays inside and Esc / the backdrop close it. Phones get a
 * bottom sheet. J/K or the arrow keys move between clips.
 */
export function ClipDialog({
  title,
  filePath,
  position,
  total,
  onPrev,
  onNext,
  onClose,
  videoOverlay,
  children,
}: {
  title: string | null | undefined;
  filePath: string | null | undefined;
  position: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  /** Drawn over the video, e.g. while it re-renders. */
  videoOverlay?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const nav = useRef({ onPrev, onNext });
  nav.current = { onPrev, onNext };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, video, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "j" || key === "arrowright") nav.current.onNext?.();
      else if (key === "k" || key === "arrowleft") nav.current.onPrev?.();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself.
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      aria-label={title || "Clip"}
      className="clip-dialog m-0 mt-auto border-0 max-h-[94dvh] w-full max-w-none overflow-y-auto rounded-t-xl bg-surface p-0 text-ink shadow-glow-strong sm:m-auto sm:max-h-[90dvh] sm:max-w-4xl sm:rounded-xl"
    >
      <div className="relative">
        <HoneyDrip className="z-10" />

        <div className="flex items-center justify-between gap-3 px-4 pt-8 pb-3 sm:px-6">
          <p className="font-mono text-meta font-medium tracking-[0.16em] text-ink-muted uppercase">
            Clip {position} of {total}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="xs" disabled={!onPrev} onClick={onPrev} aria-label="Previous clip">
              <Icon name="chevronDown" className="size-5 rotate-90" />
            </Button>
            <Button variant="secondary" size="xs" disabled={!onNext} onClick={onNext} aria-label="Next clip">
              <Icon name="chevronDown" className="size-5 -rotate-90" />
            </Button>
            <Button variant="ghost" size="xs" onClick={() => ref.current?.close()} aria-label="Close">
              <Icon name="x" className="size-5" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:gap-6 sm:px-6 sm:pb-6">
          <div className="flex justify-center bg-brand-deep sm:block sm:shrink-0 sm:overflow-hidden sm:rounded-lg">
            <div className="relative aspect-[9/16] h-[min(56dvh,32rem)] sm:h-auto sm:w-64 lg:w-72">
              {filePath ? (
                <video key={filePath} src={`${API_URL}/${filePath}`} controls autoPlay playsInline preload="auto" className="size-full object-contain" />
              ) : (
                <p className="grid size-full place-items-center px-6 text-center text-base text-on-brand/75">Still rendering…</p>
              )}
              {videoOverlay}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-4 sm:px-0 sm:pt-0">{children}</div>
        </div>
      </div>
    </dialog>
  );
}

/** The action row at the bottom of the popup. Phones: stuck to the bottom of the sheet. */
export function ClipDialogActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pt-4 sm:pb-0">
      {children}
    </div>
  );
}
