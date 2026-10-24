import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-lg font-medium text-brand">{eyebrow}</p>}
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight [overflow-wrap:anywhere] text-ink sm:text-4xl lg:text-5xl">{title}</h1>
        {description && <p className="mt-3 max-w-3xl text-lg text-ink-muted sm:text-xl">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
