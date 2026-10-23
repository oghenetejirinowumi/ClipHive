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
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative isolate overflow-hidden rounded-xl px-8 lg:px-14",
        size === "lg" ? "pt-12 pb-24 lg:pt-16 lg:pb-32" : "pt-10 pb-20 lg:pt-12 lg:pb-24",
        className,
      )}
    >
      <SkyBackground />
      {eyebrow && <SectionLabel inverse>{eyebrow}</SectionLabel>}
      <h1
        className={cn(
          "mt-4 font-display font-semibold tracking-tight [overflow-wrap:anywhere] text-on-brand",
          size === "lg" ? "text-5xl lg:text-7xl" : "text-4xl lg:text-6xl",
        )}
      >
        {title}
      </h1>
      {description && <p className="mt-4 max-w-3xl text-xl text-on-brand/85 lg:text-2xl">{description}</p>}
      {actions && <div className="mt-8 flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}
