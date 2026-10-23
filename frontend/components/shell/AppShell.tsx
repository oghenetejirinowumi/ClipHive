"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Button, Icon, Logo } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { APP_NAV, isActive } from "@/lib/routes";

/** Sidebar on desktop, top bar + bottom tabs on phones. Wraps every route in APP_NAV. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, status, logout } = useAuth();
  const signingOut = useRef(false);

  // Middleware gates on the cookie; this catches a session cleared while the page is open.
  useEffect(() => {
    if (status === "anonymous" && !signingOut.current) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  function signOut() {
    signingOut.current = true;
    logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-5 py-8 lg:flex">
        <Logo href="/dashboard" className="px-2" />
        <nav aria-label="Main" className="mt-10 flex-1 space-y-2">
          {APP_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 items-center gap-4 rounded-full px-5 text-lg font-medium transition-colors duration-(--motion-fast)",
                  active ? "bg-brand-subtle text-brand-strong" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                )}
              >
                <Icon name={item.icon} className="size-6" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="rounded-md bg-surface-sunken p-4">
          <p className="truncate text-base font-medium text-ink">{user?.email ?? " "}</p>
          <Button variant="ghost" size="sm" onClick={signOut} className="mt-2 -ml-3">
            <Icon name="logout" className="size-6" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-18 items-center justify-between border-b border-line bg-surface/95 px-4 lg:hidden">
          <Logo href="/dashboard" />
          <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
            <Icon name="logout" className="size-6" />
          </Button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-8 pb-32 sm:px-8 lg:px-12 lg:py-14">{children}</main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 gap-2 border-t border-line bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {APP_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-md py-2 text-meta font-medium", active ? "text-brand" : "text-ink-muted")}
            >
              <Icon name={item.icon} className="size-6" />
              {item.short}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
