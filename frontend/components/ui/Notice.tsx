import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

type Tone = "brand" | "success" | "danger";

const tones: Record<Tone, string> = {
  brand: "border-brand/20 bg-brand-subtle text-brand-strong",
  success: "border-success/25 bg-success-subtle text-success",
  danger: "border-danger/25 bg-danger-subtle text-danger",
};

/** Inline status message (announced to screen readers). Success / danger are for outcomes only. */
export function Notice({ tone = "brand", children, onDismiss, className }: { tone?: Tone; children: ReactNode; onDismiss?: () => void; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center justify-between gap-4 rounded-lg border px-6 py-3", tones[tone], className)}>
      <p className="py-1 text-lg font-medium">{children}</p>
      {onDismiss && (
        <Button variant="ghost" size="sm" onClick={onDismiss} className="shrink-0">
          Dismiss
        </Button>
      )}
    </div>
  );
}
