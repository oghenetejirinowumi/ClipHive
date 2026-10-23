import type { IconName } from "@/components/ui/Icon";

/** Cookie holding the access token. Read by middleware.ts to gate app routes. */
export const SESSION_COOKIE = "ch_session";

export type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: IconName;
  description: string;
  /** Shown in the phone bottom bar (max 5); everything is always in the desktop sidebar. */
  tab?: boolean;
};

/** Every route here is wrapped in the app shell and requires sign-in. */
export const APP_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: "home", description: "Your overview.", tab: true },
  {
    href: "/create",
    label: "Create",
    short: "Create",
    icon: "plus",
    description: "Paste a Twitch, Kick or YouTube link, or upload a video, and get a batch of clips.",
    tab: true,
  },
  {
    href: "/inbox",
    label: "Inbox",
    short: "Inbox",
    icon: "inbox",
    description: "Clips the agents made, waiting for your OK. Approve to schedule, reject to teach.",
    tab: true,
  },
  {
    href: "/agents",
    label: "Agents",
    short: "Agents",
    icon: "bot",
    description: "What Scout, Producer and Publisher did, step by step, and what they've learned about you.",
  },
  {
    href: "/studio",
    label: "Studio",
    short: "Studio",
    icon: "film",
    description: "Scrub a video's timeline, pick the exact moment, choose layout and captions.",
    tab: true,
  },
  {
    href: "/streamers",
    label: "Streamers",
    short: "Watch",
    icon: "radio",
    description: "Channels the Scout agent watches. New VODs get clipped automatically.",
  },
  {
    href: "/hub",
    label: "Clip hub",
    short: "Hub",
    icon: "grid",
    description: "Every clip and its posting schedule: download, copy the caption, mark as posted.",
    tab: true,
  },
  {
    href: "/captions",
    label: "Caption styles",
    short: "Styles",
    icon: "captions",
    description: "Pick a preset or upload your own font.",
  },
  {
    href: "/trends",
    label: "Trends",
    short: "Trends",
    icon: "trending",
    description: "This week's hashtags for TikTok and YouTube.",
  },
  {
    href: "/download",
    label: "IG downloader",
    short: "Download",
    icon: "download",
    description: "Paste an Instagram post or reel link and save the full video.",
  },
];

export const TAB_NAV = APP_NAV.filter((item) => item.tab);

export const AUTH_ROUTES = ["/login", "/register"];

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function isAppRoute(pathname: string): boolean {
  return APP_NAV.some((item) => matches(pathname, item.href));
}

export function isActive(pathname: string, href: string): boolean {
  return matches(pathname, href);
}

/** Only allow same-origin relative redirects after sign-in. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
