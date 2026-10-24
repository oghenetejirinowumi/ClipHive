"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { NotificationBell } from "@/components/agents/NotificationBell";
import { Button, Icon, Logo, ResizeHandle, ThemeSwitch } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { APP_NAV, TAB_NAV, isActive } from "@/lib/routes";
import { usePersistentState } from "@/lib/usePersistentState";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 360;
const SIDEBAR_DEFAULT = 248;
const SIDEBAR_COLLAPSED = 76;

/** Working screens that need the whole window (no centred page column). */
const FULL_BLEED = [/^\/editor\/[^/]+/];

/**
 * Sidebar on desktop, top bar + bottom tabs on phones. Wraps every route in APP_NAV.
 * The sidebar can be resized (drag its edge) and collapsed to icons (toggle or Ctrl+B);
 * both are remembered.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, status, logout } = useAuth();
  const signingOut = useRef(false);
  const [width, setWidth] = usePersistentState("ch_sidebar_width", SIDEBAR_DEFAULT);
  const [collapsed, setCollapsed] = usePersistentState("ch_sidebar_collapsed", false);
  const fullBleed = FULL_BLEED.some((r) => r.test(pathname));

  // Middleware gates on the cookie; this catches a session cleared while the page is open.
  useEffect(() => {
    if (status === "anonymous" && !signingOut.current) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCollapsed]);

  function signOut() {
    signingOut.current = true;
    logout();
    router.replace("/login");
  }

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));

  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[var(--sidebar)_minmax(0,1fr)]" style={{ "--sidebar": `${sidebarWidth}px` } as React.CSSProperties}>
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:flex">
        <div className={cn("flex min-w-0 flex-1 flex-col py-5", collapsed ? "items-center px-3" : "px-4")}>
          <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "justify-between")}>
            {collapsed ? <Logo href="/dashboard" compact /> : <Logo href="/dashboard" className="px-2" />}
            <NotificationBell />
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
            >
              <Icon name="panelLeft" className="size-5" />
            </Button>
          </div>

          <nav aria-label="Main" className="mt-6 flex-1 space-y-1 overflow-y-auto">
            {APP_NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-full text-base font-medium transition-colors duration-(--motion-fast)",
                    collapsed ? "justify-center px-0" : "px-4",
                    active ? "bg-brand-subtle text-brand-strong" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                  )}
                >
                  <Icon name={item.icon} className="size-5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <ThemeSwitch />
              <Button variant="ghost" size="xs" onClick={signOut} aria-label="Sign out" title="Sign out">
                <Icon name="logout" className="size-5" />
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <span className="text-meta font-medium text-ink-muted">Theme</span>
                <ThemeSwitch />
              </div>
              <div className="rounded-md bg-surface-sunken px-3 py-2">
                <p className="truncate text-meta font-medium text-ink">{user?.email ?? " "}</p>
                <Button variant="ghost" size="xs" onClick={signOut} className="-ml-3">
                  <Icon name="logout" className="size-5" />
                  Sign out
                </Button>
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <ResizeHandle
            axis="x"
            label="Resize sidebar"
            className="-mr-1.5"
            onResize={(d) => setWidth((w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w + d)))}
            onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
          />
        )}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-surface/95 px-4 lg:hidden">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-2">
            <NotificationBell align="right" />
            <ThemeSwitch />
            <Button variant="ghost" size="xs" onClick={signOut} aria-label="Sign out">
              <Icon name="logout" className="size-5" />
            </Button>
          </div>
        </header>
        <main
          className={cn(
            "w-full flex-1 px-4 pb-32",
            fullBleed ? "pt-4 lg:px-5 lg:py-5" : "mx-auto max-w-7xl pt-8 sm:px-8 lg:px-10 lg:pt-10 lg:pb-10",
          )}
        >
          {children}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 gap-2 border-t border-line bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {TAB_NAV.map((item) => {
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
