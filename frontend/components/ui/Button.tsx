import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "inverse" | "ghostInverse";
type Size = "sm" | "md" | "lg";

const base =
  "tactile inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-on-brand shadow-glow hover:bg-brand-strong",
  secondary: "border border-line-strong bg-surface text-ink shadow-glow hover:border-brand-soft",
  ghost: "text-ink-muted hover:bg-brand-subtle hover:text-ink [--tactile-glow:none]",
  // Destructive actions only (delete, disconnect) — status colours are for state.
  danger: "bg-danger text-on-brand shadow-glow",
  // For use on the brand sky / brand fills (SkyBackground, QuoteBanner).
  inverse: "bg-on-brand text-brand-deep shadow-glow hover:bg-on-brand/90",
  ghostInverse: "border border-on-brand/45 text-on-brand hover:bg-on-brand/12 hover:text-on-brand [--tactile-glow:none]",
};

// Generous by default: 56px. Compact (sm) is 48px; the 44px floor is never crossed. min-w keeps icon-only buttons square.
const sizes: Record<Size, string> = {
  sm: "h-12 min-w-12 px-5 text-base",
  md: "h-14 min-w-14 px-7 text-lg",
  lg: "h-16 min-w-16 px-9 text-xl",
};

type Common = { variant?: Variant; size?: Size; loading?: boolean; className?: string; children?: ReactNode };
type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsLink = Common & Omit<ComponentProps<typeof Link>, "className" | "children">;

export type ButtonProps = AsButton | AsLink;

export function buttonClass({ variant = "primary", size = "md", className }: Pick<Common, "variant" | "size" | "className"> = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

/** Renders a <button>, or a Next <Link> when given `href`. */
export function Button(props: ButtonProps) {
  const { variant, size, loading, className, children, ...rest } = props;
  const classes = buttonClass({ variant, size, className });
  const content = (
    <>
      {loading && <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </>
  );

  if (rest.href !== undefined) {
    return (
      <Link className={classes} {...(rest as Omit<AsLink, keyof Common>)}>
        {content}
      </Link>
    );
  }

  const { disabled, type = "button", ...buttonRest } = rest as Omit<AsButton, keyof Common>;
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...buttonRest}>
      {content}
    </button>
  );
}
