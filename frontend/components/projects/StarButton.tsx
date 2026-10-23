"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

export type StarResult = { id: number; starred: boolean; starred_total: number };

/**
 * Star a clip you love. Stars teach the moment picker what you like, so the next clips it
 * finds lean that way. Optimistic: flips at once, reverts if the server says no.
 */
export function StarButton({
  clipId,
  starred,
  onChange,
  className,
}: {
  clipId: number;
  starred: boolean;
  onChange?: (result: StarResult) => void;
  className?: string;
}) {
  const [on, setOn] = useState(starred);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      onChange?.(await api<StarResult>(`/api/studio/clips/${clipId}/star`, { method: "POST", body: { starred: next } }));
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? "Unstar clip" : "Star clip: more moments like this"}
      title={on ? "Starred. ClipHive picks more moments like this" : "Star it: ClipHive learns to pick more moments like this"}
      className={cn(
        "tactile grid size-12 shrink-0 place-items-center rounded-full border transition-colors duration-(--motion-fast)",
        on ? "border-warning bg-warning-subtle text-warning" : "border-line bg-paper text-ink-muted hover:text-ink",
        className,
      )}
    >
      <Icon name="star" className="size-6" fill={on ? "currentColor" : "none"} />
    </button>
  );
}
