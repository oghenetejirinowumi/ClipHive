import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink-muted",
  brand: "bg-brand-subtle text-brand-strong",
  // Status tones describe STATE (ready, failed, posted) — never decoration.
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
};

// "sm" (14px) is the absolute floor, for tiny status badges only. Use "lg" for eyebrow pills.
const sizes = {
  sm: "px-3 py-1 text-fine",
  md: "px-4 py-1.5 text-base",
  lg: "px-5 py-2 text-lg",
};

export function Badge({
  tone = "neutral",
  size = "md",
  className,
  children,
}: {
  tone?: Tone;
  size?: keyof typeof sizes;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full font-medium", sizes[size], tones[tone], className)}>
      {children}
    </span>
  );
}
