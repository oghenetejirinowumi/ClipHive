/**
 * The onboarding tour: a bee that flies to each part of the app and explains it.
 *
 * Targets are elements with a matching `data-tour="…"` attribute. A step with `href` opens
 * that page first. `clickToContinue` steps also move on when the highlighted thing is pressed.
 * A step whose target never shows up (e.g. hidden on this screen size) is shown centred.
 */
export type TourStep = {
  target?: string;
  href?: string;
  title: string;
  body: string;
  clickToContinue?: boolean;
};

export const TOUR_STEPS: TourStep[] = [
  {
    href: "/dashboard",
    title: "Hi, I'm Buzz 🐝",
    body: "ClipHive turns your long streams into short clips. Let me show you around. It takes about a minute.",
  },
  {
    target: "nav-home",
    href: "/dashboard",
    title: "Home",
    body: "Your overview: recent projects, clips waiting for you and what the bees have been up to.",
  },
  {
    target: "nav-create",
    title: "Make clips",
    body: "Everything starts here. Press Create to make your first clips.",
    clickToContinue: true,
  },
  {
    target: "create-link",
    href: "/create",
    title: "Paste a stream link",
    body: "Drop in a Twitch, Kick or YouTube link (or upload a video). The bees find the best moments and cut them into vertical clips.",
  },
  {
    target: "create-command",
    href: "/create",
    title: "Or just ask",
    body: "Tell the Queen Bee what you want, like “3 funny clips from my last stream for Shorts”, and she plans the job for you.",
  },
  {
    target: "tab-/studio",
    href: "/create",
    title: "Studio and Editor",
    body: "Want more control? Pick exact moments in the Studio, then fine-tune text, music and captions in the Editor.",
  },
  {
    target: "nav-agents",
    title: "Your bees",
    body: "The agents work for you in the background. Press Agents to meet them.",
    clickToContinue: true,
  },
  {
    target: "tab-/inbox",
    href: "/inbox",
    title: "Inbox",
    body: "Clips the bees made land here. Approve one to schedule it, or reject it with a reason so they learn your taste.",
  },
  {
    target: "tab-/streamers",
    href: "/inbox",
    title: "Channels",
    body: "Add the channels you stream on. The Scout Bee checks them and clips every new VOD automatically.",
    clickToContinue: true,
  },
  {
    target: "add-channel",
    href: "/streamers",
    title: "Add your channel",
    body: "Pick the platform, type your username and press Add. Then press “Check now” to clip your latest stream.",
  },
  {
    target: "tab-/hive",
    href: "/streamers",
    title: "The Hive",
    body: "See every bee at work, step by step, and what they've learned about you.",
  },
  {
    target: "nav-library",
    title: "Your clips",
    body: "Every clip you've made and when to post it: download, copy the caption, mark it posted. Caption styles live here too.",
  },
  {
    target: "nav-tools",
    title: "Tools",
    body: "Trends shows what clippers are posting right now and suggests what to make next. There's an Instagram downloader too.",
  },
  {
    target: "bell",
    title: "Notifications",
    body: "The bees ping you here when clips are ready or it's time to post.",
  },
  {
    target: "tour-replay",
    title: "That's the hive!",
    body: "You can replay this tour any time from here. Now go make your first clip. 🍯",
  },
];

const KEY = (userId: string | number) => `ch_tour:${userId}`;
export const TOUR_START_EVENT = "ch:tour-start";

type TourState = "pending" | "done";

export function tourState(userId: string | number): TourState | null {
  try {
    return localStorage.getItem(KEY(userId)) as TourState | null;
  } catch {
    return null;
  }
}

export function setTourState(userId: string | number, state: TourState) {
  try {
    localStorage.setItem(KEY(userId), state);
  } catch {
    // Storage blocked: the tour just won't be remembered.
  }
}

/** Open the tour from anywhere (the "Take the tour" button). */
export function startTour() {
  window.dispatchEvent(new Event(TOUR_START_EVENT));
}

/** Accounts made in the last 15 minutes get the tour on first sign-in (email or Google). */
export function isNewAccount(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  // The API sends UTC; treat a timestamp without a zone as UTC too.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(createdAt) ? createdAt : `${createdAt}Z`;
  const age = Date.now() - new Date(iso).getTime();
  return age >= -60_000 && age < 15 * 60_000;
}
