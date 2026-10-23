import type { IconName } from "@/components/ui/Icon";

/** Cookie holding the access token. Read by middleware.ts to gate app routes. */
export const SESSION_COOKIE = "ch_session";

export type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: IconName;
  description: string;
};

/** Every route here is wrapped in the app shell and requires sign-in. */
export const APP_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: "home", description: "Your overview." },
  {
    href: "/streamers",
    label: "Streamers",
    short: "Watch",
    icon: "radio",
    description: "Add the Twitch, Kick and YouTube channels you clip.",
  },
  {
    href: "/hub",
    label: "Clip hub",
    short: "Hub",
    icon: "grid",
    description: "Ready clips: preview, download or post.",
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
];

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
