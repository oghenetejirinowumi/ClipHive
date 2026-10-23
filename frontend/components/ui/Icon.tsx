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
