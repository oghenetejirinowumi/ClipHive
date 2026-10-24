"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Badge, ChannelAvatar, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

export type Platform = "twitch" | "kick" | "youtube";

/** GET /api/streamers/search */
export type ChannelHit = {
  username: string;
  display_name: string;
  avatar_url: string | null;
  followers: number | null;
  followers_text: string | null;
  live: boolean | null;
  viewers: number | null;
};

const LABEL: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };
const DEBOUNCE_MS = 250;
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

type Props = {
  platform: Platform;
  value: string;
  onChange(value: string): void;
  /** A suggestion was picked (its username is already in `value`). */
  onPick?(hit: ChannelHit): void;
  /** Usernames already watched on this platform, lower-case: marked in the list. */
  watched?: Set<string>;
  // Passed through by <Field>, so the label and hint point at the input.
  id?: string;
  "aria-describedby"?: string;
  placeholder?: string;
};

/**
 * The channel name box with suggestions as you type: the platform's real channels, with their
 * picture, followers and live state. Arrow keys move, Enter picks, Esc closes; typing a name
 * that isn't suggested still works.
 */
export function ChannelSearch({ platform, value, onChange, onPick, watched, id, placeholder, ...rest }: Props) {
  const listId = useId();
  const [hits, setHits] = useState<ChannelHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const asked = useRef(0); // only the latest request may update the list
  const query = value.trim().replace(/^@/, "");

  useEffect(() => {
    if (query.length < 2) {
      setHits([]);
      setState("idle");
      return;
    }
    const n = ++asked.current;
    setState("loading");
    const timer = setTimeout(async () => {
      try {
        const found = await api<ChannelHit[]>(`/api/streamers/search?platform=${platform}&q=${encodeURIComponent(query)}`);
        if (n !== asked.current) return;
        setHits(found);
        setActive(-1);
        setState("done");
      } catch (err) {
        if (n !== asked.current) return;
        setHits([]);
        setState(err instanceof ApiError && err.status === 401 ? "idle" : "error");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [platform, query]);

  function pick(hit: ChannelHit) {
    asked.current++; // the value change below must not reopen a search
    onChange(hit.username);
    onPick?.(hit);
    setOpen(false);
    setHits([]);
    setState("idle");
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !hits.length) {
      if (e.key === "ArrowDown" && hits.length) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault(); // pick, don't submit the form yet
      pick(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.length >= 2 && state !== "idle";

  return (
    <div className="relative">
      <Input
        {...rest}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        required
      />
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label={`${LABEL[platform]} channels`}
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {state === "loading" && !hits.length && <p className="px-3 py-3 text-base text-ink-muted">Searching {LABEL[platform]}…</p>}
          {state === "error" && <p className="px-3 py-3 text-base text-ink-muted">Couldn&apos;t search {LABEL[platform]} right now. Type the exact name instead.</p>}
          {state === "done" && !hits.length && (
            <p className="px-3 py-3 text-base text-ink-muted">
              No {LABEL[platform]} channels match. You can still add &ldquo;{query}&rdquo; as typed.
            </p>
          )}
          {hits.map((hit, i) => {
            const already = watched?.has(hit.username.toLowerCase());
            const followers = hit.followers != null ? `${compact(hit.followers)} followers` : hit.followers_text;
            return (
              <div
                key={hit.username}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input so the click lands
                onMouseMove={() => i !== active && setActive(i)} // move, not enter: a list opening under a resting pointer mustn't steal the highlight
                onClick={() => pick(hit)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2", i === active ? "bg-brand-subtle" : "hover:bg-surface-sunken")}
              >
                <ChannelAvatar src={hit.avatar_url} name={hit.display_name} size={40} live={hit.live === true} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-ink">{hit.display_name}</span>
                  <span className="block truncate text-base text-ink-muted">
                    @{hit.username}
                    {followers && ` · ${followers}`}
                    {hit.live && <span className="font-medium text-success"> · Live{hit.viewers != null && ` · ${compact(hit.viewers)} watching`}</span>}
                  </span>
                </span>
                {already && <Badge tone="brand">Watching</Badge>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
