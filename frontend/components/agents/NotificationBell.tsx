"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo, type AppNotification } from "@/lib/agents";
import { cn } from "@/lib/cn";

/** What the agents did while you were away. Polls every 15 seconds. */
export function NotificationBell({ align = "left" }: { align?: "left" | "right" }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<AppNotification[]>("/api/agents/notifications?limit=12", { redirectOn401: false })
      .then(setItems)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread) {
      api("/api/agents/notifications/read-all", { method: "POST", redirectOn401: false })
        .then(() => setItems((prev) => prev.map((n) => ({ ...n, read: true }))))
        .catch(() => undefined);
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        className="relative grid size-12 place-items-center rounded-full text-ink-muted transition-colors duration-(--motion-fast) hover:bg-brand-subtle hover:text-ink"
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-6 place-items-center rounded-full bg-brand px-1.5 text-fine font-semibold text-on-brand tabular-nums">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "absolute top-14 z-30 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-3 shadow-glow",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <p className="px-3 pt-2 pb-3 font-display text-xl font-semibold tracking-tight text-ink">While you were away</p>
          {items.length === 0 ? (
            <p className="px-3 pb-3 text-base text-ink-muted">Nothing yet. The bees will notify you when clips are ready.</p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {items.map((n) => {
                const body = (
                  <>
                    <span className="block text-base font-medium text-ink">{n.title}</span>
                    {n.body && <span className="block text-base text-ink-muted">{n.body}</span>}
                    <span className="block text-meta text-ink-faint">{timeAgo(n.created_at)}</span>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 hover:bg-surface-sunken">
                        {body}
                      </Link>
                    ) : (
                      <div className="px-3 py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
