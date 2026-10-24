"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

type Props = {
  /** "x" resizes a width (a vertical bar you drag sideways), "y" a height. */
  axis: "x" | "y";
  label: string;
  /** Called with the pointer movement in px since the last call (or ±16 for arrow keys). */
  onResize(delta: number): void;
  onDoubleClick?(): void;
  className?: string;
};

/** A thin drag bar between two panels. Keyboard: focus it and use the arrow keys. */
export function ResizeHandle({ axis, label, onResize, onDoubleClick, className }: Props) {
  const last = useRef<number | null>(null);

  function down(e: PointerEvent<HTMLDivElement>) {
    last.current = axis === "x" ? e.clientX : e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (last.current === null) return;
    const now = axis === "x" ? e.clientX : e.clientY;
    if (now !== last.current) onResize(now - last.current);
    last.current = now;
  }
  function up() {
    last.current = null;
    document.body.style.userSelect = "";
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 48 : 16;
    const keys = axis === "x" ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
    const delta = keys[e.key as keyof typeof keys];
    if (delta) {
      e.preventDefault();
      onResize(delta);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group relative shrink-0 touch-none focus:outline-none",
        axis === "x" ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full bg-line transition-colors group-hover:bg-brand-soft group-focus-visible:bg-brand",
          axis === "x" ? "inset-y-2 left-1/2 w-0.5 -translate-x-1/2" : "inset-x-2 top-1/2 h-0.5 -translate-y-1/2",
        )}
      />
    </div>
  );
}
