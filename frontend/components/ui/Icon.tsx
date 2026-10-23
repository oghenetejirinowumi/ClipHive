import type { SVGProps } from "react";

const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  radio:
    "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16.24 7.76a6 6 0 0 1 0 8.48M7.76 16.24a6 6 0 0 1 0-8.48M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14",
  grid: "M4 5a1 1 0 0 1 1-1h5v7H4zM14 4h5a1 1 0 0 1 1 1v6h-6zM4 13h6v7H5a1 1 0 0 1-1-1zM14 13h6v6a1 1 0 0 1-1 1h-5z",
  captions: "M4 7V5h16v2M9 20h6M12 5v15",
  trending: "M3 17l6-6 4 4 8-8M14 7h7v7",
  logout: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  arrowRight: "M5 12h14M13 5l7 7-7 7",
  play: "M8 5.5v13a.5.5 0 0 0 .77.42l10-6.5a.5.5 0 0 0 0-.84l-10-6.5A.5.5 0 0 0 8 5.5z",
  chevronDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 16V5M7 10l5-5 5 5M5 20h14",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  x: "M6 6l12 12M18 6L6 18",
  link: "M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 5.5M14 10a5 5 0 0 0-7.07 0L4.1 12.83a5 5 0 0 0 7.07 7.07l1.33-1.4",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0",
  inbox: "M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h4.5l1.5 2.5h4l1.5-2.5H20",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2",
  alert: "M12 9v4M12 16.5v.5M10.3 4 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4",
  pause: "M8 5v14M16 5v14",
  bot: "M7 9h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM12 5v4M12 4.5v.5M9 14v1M15 14v1",
  copy: "M9 9h10v11H9zM5 15V4h10",
  send: "M4 12l16-8-6 16-3-7z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={name === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      // Floor: 20px inline next to text (size-5), 24px standalone (size-6, the default).
      className={className ?? "size-6"}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
