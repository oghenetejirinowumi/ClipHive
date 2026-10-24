import type { IconName } from "@/components/ui/Icon";

/** Cookie holding the access token. Read by middleware.ts to gate app routes. */
export const SESSION_COOKIE = "ch_session";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  description: string;
};

/** A sidebar / bottom-bar entry. Its pages share a tab strip at the top of the page. */
export type NavGroup = {
  id: string;
  label: string;
  icon: IconName;
  description: string;
  items: NavItem[];
};

/**
 * Every route here is wrapped in the app shell and requires sign-in. Five groups so the
 * sidebar and the phone bottom bar show the same thing; the first item is the group's home.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    description: "Your overview.",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "home", description: "Your overview." }],
  },
  {
    id: "agents",
    label: "Agents",
    icon: "bot",
    description: "Review what the agents clipped, see their work, and choose the channels they watch.",
    items: [
      {
        href: "/inbox",
        label: "Inbox",
        icon: "inbox",
        description: "Clips the agents made, waiting for your OK. Approve to schedule, reject to teach.",
      },
      {
        href: "/hive",
        label: "The Hive",
        icon: "hive",
        description: "Your colony of autonomous bees: Scout Bee, Worker Bee, Honey Bee & Queen Bee.",
      },
      {
        href: "/streamers",
        label: "Channels",
        icon: "radio",
        description: "Channels the Scout agent watches. New VODs get clipped automatically.",
      },
    ],
  },
  {
    id: "create",
    label: "Create",
    icon: "plus",
    description: "Start from a link or upload, then pick moments, caption and finish it in the Editor.",
    items: [
      {
        href: "/create",
        label: "New project",
        icon: "plus",
        description: "Paste a Twitch, Kick or YouTube link, or upload a video, and get a batch of clips.",
      },
      {
        href: "/editor",
        label: "Editor",
        icon: "scissors",
        description: "Pick moments from your videos, then cut, caption, add music and effects, by hand or with the AI.",
      },
    ],
  },
  {
    id: "library",
    label: "Library",
    icon: "grid",
    description: "Every clip you've made and the caption styles you use on them.",
    items: [
      {
        href: "/hub",
        label: "Clips",
        icon: "grid",
        description: "Every clip and its posting schedule: download, copy the caption, mark as posted.",
      },
      { href: "/captions", label: "Caption styles", icon: "captions", description: "Pick a preset or upload your own font." },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: "sparkles",
    description: "What's trending among clippers.",
    items: [
      { href: "/trends", label: "Trends", icon: "trending", description: "What clippers are posting right now, and what you should make next." },
    ],
  },
];

export const APP_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const AUTH_ROUTES = ["/login", "/register"];

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function isAppRoute(pathname: string): boolean {
  return APP_NAV.some((item) => matches(pathname, item.href)) || matches(pathname, "/agents");
}

export function isActive(pathname: string, href: string): boolean {
  return matches(pathname, href);
}

/** The group the current page belongs to, if any. */
export function activeGroup(pathname: string): NavGroup | undefined {
  return NAV_GROUPS.find((g) => g.items.some((item) => matches(pathname, item.href)));
}

/** Only allow same-origin relative redirects after sign-in. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
