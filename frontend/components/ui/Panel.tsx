import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "surface" | "sunken" | "brand";
type Padding = "none" | "sm" | "md" | "lg";

const tones: Record<Tone, string> = {
  surface: "border border-line bg-surface shadow-glow",
  sunken: "border border-transparent bg-surface-sunken",
  brand: "border border-brand/15 bg-brand-subtle",
};

// Sizing floor: ≥ 24px. Padding may grow on large screens but never shrinks on phones.
const paddings: Record<Padding, string> = {
  none: "",
  sm: "p-6",
  md: "p-8",
  lg: "p-10 lg:p-12",
};

export type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside";
  tone?: Tone;
  padding?: Padding;
  /** Lift + stronger glow on hover, for clickable cards. */
  interactive?: boolean;
};

export function Panel({ as: Tag = "div", tone = "surface", padding = "md", interactive, className, ...rest }: PanelProps) {
  return <Tag className={cn("rounded-lg", tones[tone], paddings[padding], interactive && "tactile", className)} {...rest} />;
}
