"use client";

import { ClipRadar } from "@/components/trends/ClipRadar";
import { HashtagResearch } from "@/components/trends/HashtagResearch";
import { Icon } from "@/components/ui";

/**
 * Trends: the Clip Radar (what clippers are posting now, and what to make next), with the
 * older hashtag research tools folded away underneath.
 */
export default function TrendsPage() {
  return (
    <div className="space-y-10 sm:space-y-14">
      <ClipRadar />
      <details className="group rounded-lg border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 font-display text-xl font-semibold tracking-tight text-ink">
          Hashtag research
          <Icon name="chevronDown" className="size-5 text-ink-faint transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line px-4 py-6 sm:px-6">
          <HashtagResearch />
        </div>
      </details>
    </div>
  );
}
