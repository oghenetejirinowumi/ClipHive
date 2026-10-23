/**
 * Single source of truth for every design token.
 *
 * themeToCss() writes these onto :root as CSS custom properties (camelCase → kebab-case),
 * plus a [data-theme="dark"] block from `darkColors` / `darkGlow`. app/globals.css maps the
 * variables onto Tailwind utilities, and nothing else in the app may contain a colour
 * literal (`npm run lint` enforces this). Change a value here and the whole app re-skins.
 *
 * Colours are ROLES, not a palette. Values marked TODO(brand) are placeholders until the
 * real values from the design brief §2 are filled in. Tints and shades are derived with
 * color-mix() from `brand`, `ink` and `paper`, so dark mode only has to swap the base
 * values and every derived role follows.
 */
export const theme = {
  colors: {
    // Neutrals
    paper: "#FFFFFF", // TODO(brand) page background
    surface: "#FFFFFF", // TODO(brand) panels, cards, inputs
    surfaceSunken: "color-mix(in oklab, var(--ink) 4%, var(--paper))",
    ink: "#15151B", // TODO(brand) primary text
    inkMuted: "color-mix(in oklab, var(--ink) 64%, var(--paper))",
    inkFaint: "color-mix(in oklab, var(--ink) 42%, var(--paper))",
    line: "color-mix(in oklab, var(--ink) 9%, var(--paper))",
    lineStrong: "color-mix(in oklab, var(--ink) 16%, var(--paper))",

    // The one brand hue
    brand: "#5B4FE9", // TODO(brand)
    brandStrong: "color-mix(in oklab, var(--brand) 82%, var(--ink))",
    brandSoft: "color-mix(in oklab, var(--brand) 32%, var(--paper))",
    brandSubtle: "color-mix(in oklab, var(--brand) 7%, var(--paper))",
    // Night-sky shade of the brand for showcase skies; deep in both modes.
    brandDeep: "color-mix(in oklab, var(--brand) 40%, #030409)",
    onBrand: "#FFFFFF", // TODO(brand) text/icons placed on `brand`, `brand-deep` or a status fill

    // Status — STATE ONLY. Never decoration, never a chart series.
    success: "#1E9E62", // TODO(brand)
    successSubtle: "color-mix(in oklab, var(--success) 10%, var(--paper))",
    warning: "#B8770B", // TODO(brand)
    warningSubtle: "color-mix(in oklab, var(--warning) 12%, var(--paper))",
    danger: "#D3403A", // TODO(brand)
    dangerSubtle: "color-mix(in oklab, var(--danger) 9%, var(--paper))",
  },

  radii: {
    sm: "10px",
    md: "14px",
    lg: "20px",
    xl: "28px",
    pill: "9999px",
  },

  // Depth is a brand-tinted glow, never a black offset shadow.
  glow: {
    soft: "0 0 0 1px color-mix(in oklab, var(--brand) 6%, transparent), 0 6px 24px -10px color-mix(in oklab, var(--brand) 30%, transparent)",
    strong: "0 0 0 1px color-mix(in oklab, var(--brand) 14%, transparent), 0 14px 40px -12px color-mix(in oklab, var(--brand) 48%, transparent)",
    ring: "0 0 0 4px color-mix(in oklab, var(--brand) 22%, transparent)",
  },

  motion: {
    fast: "160ms",
    base: "240ms",
    slow: "560ms",
    easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
    easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
    press: "0.97",
    lift: "-2px",
    revealDistance: "16px",
    stagger: "70ms",
  },

  typeface: {
    sans: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
    display: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
    mono: "var(--font-geist-mono), ui-monospace, monospace",
  },

  // Sizing floor (brief §4b). Hard minimums, set before the fluid root scaling, which only
  // ever makes things bigger. Tailwind's text-xs / text-sm are removed; the smallest
  // content size is `text-meta`, and `text-fine` is for tiny badges / legal only.
  type: {
    // Fluid root: 16px on phones, growing with the viewport to 22px on very wide screens.
    // Every size in the app is rem-based, so the whole UI scales up instead of floating in white space.
    rootSize: "clamp(100%, 0.55rem + 0.62vw, 137.5%)",
    body: "1.0625rem", // 17px
    bodyLeading: "1.55",
    meta: "0.9375rem", // 15px: captions, helper text, table cells, timestamps
    metaLeading: "1.5",
    fine: "0.875rem", // 14px absolute floor: tiny badges, legal footnotes. Nothing smaller.
    fineLeading: "1.45",
  },
} as const;

export type Theme = typeof theme;
export type ColorRole = keyof Theme["colors"];

/** Dark mode: white ink on near-black. Only base values change; derived roles follow via color-mix. */
export const darkColors: Partial<Record<ColorRole, string>> = {
  paper: "#07080B", // TODO(brand)
  surface: "#0F1117", // TODO(brand)
  surfaceSunken: "color-mix(in oklab, var(--ink) 5%, var(--paper))",
  ink: "#F2F3F7", // TODO(brand)
  inkMuted: "color-mix(in oklab, var(--ink) 68%, var(--paper))",
  inkFaint: "color-mix(in oklab, var(--ink) 46%, var(--paper))",
  line: "color-mix(in oklab, var(--ink) 11%, var(--paper))",
  lineStrong: "color-mix(in oklab, var(--ink) 20%, var(--paper))",
  brand: "#7A6FFF", // TODO(brand) lifted so it holds contrast on black
  brandStrong: "color-mix(in oklab, var(--brand) 70%, var(--ink))",
  brandSoft: "color-mix(in oklab, var(--brand) 46%, var(--paper))",
  brandSubtle: "color-mix(in oklab, var(--brand) 14%, var(--paper))",
  success: "#3CCB8A", // TODO(brand)
  successSubtle: "color-mix(in oklab, var(--success) 16%, var(--paper))",
  warning: "#E7A93E", // TODO(brand)
  warningSubtle: "color-mix(in oklab, var(--warning) 16%, var(--paper))",
  danger: "#F2655E", // TODO(brand)
  dangerSubtle: "color-mix(in oklab, var(--danger) 16%, var(--paper))",
};

/** On black, glows read as light: a faint ink hairline plus a brighter brand halo. */
export const darkGlow: Partial<Record<keyof Theme["glow"], string>> = {
  soft: "0 0 0 1px color-mix(in oklab, var(--ink) 7%, transparent), 0 8px 32px -12px color-mix(in oklab, var(--brand) 55%, transparent)",
  strong: "0 0 0 1px color-mix(in oklab, var(--brand) 40%, transparent), 0 16px 48px -10px color-mix(in oklab, var(--brand) 70%, transparent)",
  ring: "0 0 0 4px color-mix(in oklab, var(--brand) 40%, transparent)",
};

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// Colours are unprefixed (--brand, --ink-muted). The other prefixes deliberately avoid
// Tailwind's own namespaces (--radius-*, --shadow-*, --ease-*, --font-*, --text-*), which
// globals.css points at these variables.
const PREFIX: Record<keyof Theme, string> = {
  colors: "",
  radii: "rounded",
  glow: "glow",
  motion: "motion",
  typeface: "typeface",
  type: "type",
};

export function cssVarName(group: keyof Theme, key: string): string {
  return PREFIX[group] ? `--${PREFIX[group]}-${kebab(key)}` : `--${kebab(key)}`;
}

function block(selector: string, vars: Array<[string, string]>, scheme: "light" | "dark"): string {
  return `${selector} {\n${vars.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n  color-scheme: ${scheme};\n}`;
}

export function themeToCss(t: Theme = theme): string {
  const base: Array<[string, string]> = [];
  for (const group of Object.keys(t) as (keyof Theme)[]) {
    for (const [key, value] of Object.entries(t[group])) base.push([cssVarName(group, key), value]);
  }
  const dark: Array<[string, string]> = [
    ...Object.entries(darkColors).map(([k, v]) => [cssVarName("colors", k), v] as [string, string]),
    ...Object.entries(darkGlow).map(([k, v]) => [cssVarName("glow", k), v] as [string, string]),
  ];
  return [
    block(":root", base, "light"),
    block(':root[data-theme="dark"]', dark, "dark"),
    // No-JS fallback: the init script in app/layout.tsx normally sets data-theme before paint.
    `@media (prefers-color-scheme: dark) {\n${block(":root:not([data-theme])", dark, "dark")}\n}`,
  ].join("\n");
}
