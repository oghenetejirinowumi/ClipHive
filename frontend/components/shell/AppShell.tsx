"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { NotificationBell } from "@/components/agents/NotificationBell";
import { OnboardingTour } from "@/components/shell/OnboardingTour";
import { Button, Icon, Logo, ResizeHandle, ThemeSwitch } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { NAV_GROUPS, activeGroup, isActive, type NavItem } from "@/lib/routes";
import { startTour } from "@/lib/tour";
import { usePersistentState } from "@/lib/usePersistentState";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 360;
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_COLLAPSED = 76;

/** Working screens that need the whole window (no centred page column). */
const FULL_BLEED = [/^\/editor\/[^/]+/];

/**
 * Sidebar on desktop, top bar + bottom tabs on phones. Wraps every route in APP_NAV.
 * Both show the same five groups (lib/routes.ts NAV_GROUPS); the open group's pages are
 * listed under it in the sidebar and as a tab strip above the page.
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
  const group = activeGroup(pathname);

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
  const tourButton = (
    <Button variant="ghost" size="xs" onClick={startTour} data-tour="tour-replay" aria-label="Take the tour" title="Take the tour">
      <Icon name="sparkles" className="size-5" />
    </Button>
  );
  const signOutButton = (
    <Button variant="ghost" size="xs" onClick={signOut} aria-label="Sign out" title="Sign out">
      <Icon name="logout" className="size-5" />
    </Button>
  );

  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[var(--sidebar)_minmax(0,1fr)]" style={{ "--sidebar": `${sidebarWidth}px` } as React.CSSProperties}>
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:flex">
        <div className={cn("flex min-w-0 flex-1 flex-col py-5", collapsed ? "items-center px-3" : "px-4")}>
          <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "justify-between")}>
            {collapsed ? <Logo href="/dashboard" compact /> : <Logo href="/dashboard" className="px-2" />}
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

          <nav aria-label="Main" className="mt-8 w-full flex-1 space-y-1 overflow-y-auto">
            {NAV_GROUPS.map((g) => {
              const open = g === group;
              const showItems = open && !collapsed && g.items.length > 1;
              return (
                <div key={g.id}>
                  <Link
                    href={g.items[0].href}
                    data-tour={`nav-${g.id}`}
                    aria-current={open && !showItems ? "page" : undefined}
                    aria-label={collapsed ? g.label : undefined}
                    title={collapsed ? g.label : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-full text-base font-medium transition-colors duration-(--motion-fast)",
                      collapsed ? "justify-center px-0" : "px-4",
                      open ? "bg-brand-subtle text-brand-strong" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                    )}
                  >
                    <Icon name={g.icon} className="size-5 shrink-0" />
                    {!collapsed && <span className="truncate">{g.label}</span>}
                  </Link>
                  {showItems && (
                    <ul className="mt-1 mb-3 ml-6 space-y-0.5 border-l border-line pl-3">
                      {g.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "flex min-h-10 items-center rounded-full px-3 text-meta font-medium transition-colors duration-(--motion-fast)",
                                active ? "bg-surface-sunken text-ink" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                              )}
                            >
                              <span className="truncate">{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>

          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <span data-tour="bell" className="inline-flex">
                <NotificationBell side="top" />
              </span>
              {tourButton}
              <ThemeSwitch />
              {signOutButton}
            </div>
          ) : (
            <div className="space-y-1 border-t border-line pt-4">
              <p className="truncate px-2 text-meta font-medium text-ink-muted" title={user?.email}>
                {user?.email ?? " "}
              </p>
              <div className="flex items-center justify-between">
                <span data-tour="bell" className="inline-flex">
                  <NotificationBell side="top" />
                </span>
                {tourButton}
                <ThemeSwitch />
                {signOutButton}
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
            <span data-tour="bell" className="inline-flex">
              <NotificationBell align="right" />
            </span>
            {tourButton}
            <ThemeSwitch />
            {signOutButton}
          </div>
        </header>
        <main
          className={cn(
            "w-full flex-1 px-4 pb-32",
            fullBleed ? "pt-4 lg:px-5 lg:py-5" : "mx-auto max-w-7xl pt-6 sm:px-8 lg:px-10 lg:pt-8 lg:pb-10",
          )}
        >
          {!fullBleed && group && group.items.length > 1 && <SectionTabs pathname={pathname} items={group.items} label={group.label} />}
          {children}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 gap-2 border-t border-line bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV_GROUPS.map((g) => {
          const active = g === group;
          return (
            <Link
              key={g.id}
              href={g.items[0].href}
              data-tour={`nav-${g.id}`}
              aria-current={active ? "page" : undefined}
              className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-md py-2 text-meta font-medium", active ? "text-brand" : "text-ink-muted")}
            >
              <Icon name={g.icon} className="size-6" />
              {g.label}
            </Link>
          );
        })}
      </nav>

      <OnboardingTour />
    </div>
  );
}

/** The open group's pages, above the page content. Scrolls sideways on narrow screens. */
function SectionTabs({ pathname, items, label }: { pathname: string; items: NavItem[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-full border border-line bg-surface p-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                data-tour={`tab-${item.href}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-full px-4 text-meta font-medium whitespace-nowrap transition-colors duration-(--motion-fast)",
                  active ? "bg-brand text-on-brand" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                )}
              >
                <Icon name={item.icon} className="size-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
