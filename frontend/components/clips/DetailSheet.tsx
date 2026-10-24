"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { HoneyDrip } from "@/components/hive";
import { Button, Icon } from "@/components/ui";

/**
 * The details popup for a project or an edit, styled like the clip popup: a native <dialog>
 * (focus stays inside; Esc and the backdrop close it), a bottom sheet on phones.
 * `media` sits on the left from sm up and on top on phones.
 */
export function DetailSheet({
  label,
  title,
  media,
  onClose,
  children,
}: {
  /** Small caps label in the header, e.g. "Project". */
  label: string;
  title: string;
  media?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      aria-label={title}
      className="clip-dialog m-0 mt-auto max-h-[94dvh] w-full max-w-none overflow-y-auto rounded-t-xl border-0 bg-surface p-0 text-ink shadow-glow-strong sm:m-auto sm:max-h-[90dvh] sm:max-w-3xl sm:rounded-xl"
    >
      <div className="relative">
        <HoneyDrip className="z-10" />
        <div className="flex items-center justify-between gap-3 px-4 pt-8 pb-3 sm:px-6">
          <p className="font-mono text-meta font-medium tracking-[0.16em] text-ink-muted uppercase">{label}</p>
          <Button variant="ghost" size="xs" onClick={() => ref.current?.close()} aria-label="Close">
            <Icon name="x" className="size-5" />
          </Button>
        </div>
        <div className="flex flex-col gap-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:flex-row sm:gap-6 sm:px-6 sm:pb-6">
          {media && <div className="mx-auto w-44 shrink-0 sm:mx-0 sm:w-56">{media}</div>}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <h2 className="font-display text-2xl leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] text-ink">{title}</h2>
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}
