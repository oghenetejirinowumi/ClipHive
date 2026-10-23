import type { ReactNode } from "react";
import { AuroraBackground, FeatureCloud, Watermark } from "@/components/effects";
import { cn } from "@/lib/cn";
import { SITE } from "@/lib/site";
import { Badge } from "./Badge";

const DEFAULT_CHIPS = ["Twitch · Kick · YouTube", "Word-perfect captions", "Auto 9:16 crop", "Trending hashtags", "One-tap posting"];

/** The expressive half of the auth screen: aurora, floating chips, giant watermark. */
export function AuthShowcase({
  headline = SITE.tagline,
  chips = DEFAULT_CHIPS,
  className,
}: {
  headline?: ReactNode;
  chips?: ReactNode[];
  className?: string;
}) {
  return (
    <aside className={cn("relative isolate flex flex-col justify-between overflow-hidden rounded-xl bg-brand-subtle p-12 xl:p-16", className)}>
      <AuroraBackground />
      <Badge tone="brand" size="lg" className="self-start bg-surface">
        Built for clippers
      </Badge>
      <div className="relative">
        <p className="max-w-2xl font-display text-5xl leading-tight font-semibold tracking-tight text-balance text-ink xl:text-6xl">{headline}</p>
        <FeatureCloud items={chips} className="mt-10 max-w-2xl justify-start" />
      </div>
      <Watermark className="absolute -right-4 -bottom-8 -z-10 text-[12rem] xl:text-[16rem]">{SITE.name}</Watermark>
    </aside>
  );
}
