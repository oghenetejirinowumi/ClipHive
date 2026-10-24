import Link from "next/link";
import { cn } from "@/lib/cn";
import { SITE } from "@/lib/site";
import { Icon } from "./Icon";

/** `inverse` is for brand backgrounds (the sky hero, the auth showcase); `compact` shows the mark only. */
export function Logo({
  href = "/",
  inverse,
  compact,
  className,
  nameClassName,
}: {
  href?: string;
  inverse?: boolean;
  compact?: boolean;
  className?: string;
  /** Classes for the wordmark, e.g. to hide it on the narrowest phones. */
  nameClassName?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={compact ? SITE.name : undefined}
      className={cn(
        "inline-flex min-h-11 items-center gap-3 rounded-full font-display text-2xl font-semibold tracking-tight",
        inverse ? "text-on-brand" : "text-ink",
        className,
      )}
    >
      <span className={cn("grid size-12 place-items-center rounded-md shadow-glow", inverse ? "bg-on-brand text-brand" : "bg-brand text-on-brand")}>
        <Icon name="play" className="size-6" />
      </span>
      {!compact && <span className={nameClassName}>{SITE.name}</span>}
    </Link>
  );
}
