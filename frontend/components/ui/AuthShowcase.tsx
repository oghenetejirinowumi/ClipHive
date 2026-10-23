import type { ReactNode } from "react";
import { FeatureCloud, SkyBackground, Watermark } from "@/components/effects";
import { cn } from "@/lib/cn";
import { SITE } from "@/lib/site";
import { Em, SectionLabel } from "./Editorial";

const DEFAULT_CHIPS = ["Twitch · Kick · YouTube", "Word-perfect captions", "Auto 9:16 crop", "Trending hashtags", "One-tap posting"];

const DEFAULT_HEADLINE = (
  <>
    Every stream&apos;s best moments, <Em>captioned</Em> and ready to post.
  </>
);

/**
 * The expressive half of the auth screen: a drifting brand sky, floating chips, giant watermark.
 * The headline sits in the upper (deep/brand) part of the sky where white text holds contrast.
 */
export function AuthShowcase({
  headline = DEFAULT_HEADLINE,
  chips = DEFAULT_CHIPS,
  className,
}: {
  headline?: ReactNode;
  chips?: ReactNode[];
  className?: string;
}) {
  return (
    <aside className={cn("relative isolate flex flex-col overflow-hidden rounded-xl p-12 xl:p-16", className)}>
      <SkyBackground />
      <SectionLabel inverse>Built for clippers</SectionLabel>
      <p className="mt-[9vh] max-w-2xl font-display text-5xl leading-tight font-semibold tracking-tight text-balance text-on-brand xl:text-6xl">
        {headline}
      </p>
      <FeatureCloud items={chips} className="mt-12 max-w-2xl justify-start" />
      <Watermark className="absolute -right-4 -bottom-8 -z-10 text-[12rem] xl:text-[16rem]">{SITE.name}</Watermark>
    </aside>
  );
}
