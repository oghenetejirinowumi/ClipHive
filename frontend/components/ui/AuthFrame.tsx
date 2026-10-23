import type { ReactNode } from "react";
import { AuthShowcase } from "./AuthShowcase";
import { Logo } from "./Logo";

/**
 * Split auth layout: calm form on the left, expressive showcase on the right.
 * Below `lg` the showcase is dropped so phones only render the form.
 */
export function AuthFrame({
  title,
  subtitle,
  children,
  footer,
  showcase,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  showcase?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-4 py-6 sm:px-10 sm:py-8">
        <Logo />
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-16">
          <header className="fx-rise mb-10">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink lg:text-5xl">{title}</h1>
            {subtitle && <p className="mt-3 text-xl text-ink-muted">{subtitle}</p>}
          </header>
          {children}
          {footer && <div className="mt-10 text-lg text-ink-muted">{footer}</div>}
        </main>
      </div>
      <div className="hidden p-3 lg:block">{showcase ?? <AuthShowcase className="h-full" />}</div>
    </div>
  );
}
