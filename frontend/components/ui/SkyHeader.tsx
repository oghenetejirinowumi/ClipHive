import type { ReactNode } from "react";
import { SkyBackground } from "@/components/effects";
import { cn } from "@/lib/cn";
import { SectionLabel } from "./Editorial";

/**
 * Page header on the brand sky: the one loud moment at the top of an app page; everything
 * below it stays calm. Use Button variant="inverse" / "ghostInverse" for `actions`.
 */
export function SkyHeader({
  eyebrow,
  title,
  description,
  actions,
  size = "md",
  decoration,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  size?: "md" | "lg";
  /** Extra background layers drawn over the sky, behind the text (e.g. a bee swarm). */
  decoration?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative isolate overflow-hidden rounded-xl px-6 sm:px-8 lg:px-12",
        size === "lg" ? "pt-8 pb-10 sm:pt-10 sm:pb-16 lg:pt-12 lg:pb-20" : "pt-6 pb-8 sm:pt-7 sm:pb-10 lg:pt-8 lg:pb-12",
        className,
      )}
    >
      <SkyBackground className="fx-sky-compact" />
      {decoration}
      {eyebrow && <SectionLabel inverse>{eyebrow}</SectionLabel>}
      <h1
        className={cn(
          "mt-3 font-display font-semibold tracking-tight [overflow-wrap:anywhere] text-on-brand",
          size === "lg" ? "text-4xl lg:text-6xl" : "text-3xl lg:text-5xl",
        )}
      >
        {title}
      </h1>
      {description && <p className="mt-3 max-w-3xl text-lg text-on-brand/85 lg:text-xl">{description}</p>}
      {actions && <div className="mt-6 flex flex-wrap gap-3 max-sm:[&>a]:w-full max-sm:[&>button]:w-full">{actions}</div>}
    </header>
  );
}
