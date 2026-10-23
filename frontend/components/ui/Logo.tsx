import Link from "next/link";
import { cn } from "@/lib/cn";
import { SITE } from "@/lib/site";
import { Icon } from "./Icon";

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-11 items-center gap-3 rounded-full font-display text-2xl font-semibold tracking-tight text-ink", className)}>
      <span className="grid size-12 place-items-center rounded-md bg-brand text-on-brand shadow-glow">
        <Icon name="play" className="size-6" />
      </span>
      {SITE.name}
    </Link>
  );
}
