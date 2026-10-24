// Enforces the design brief in app/, components/ and lib/:
//  - no colour literals: every colour is a role token from theme.ts (bg-brand, var(--line), ...)
//  - the sizing floor (§4b): no text-xs / text-sm, no arbitrary text below 15px, and no
//    icons/marks below 20px. Decorative aria-hidden elements are exempt from the size check.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const ROOTS = ["app", "components", "lib"];
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".js", ".jsx", ".mjs"]);

const RULES = [
  { name: "colour literal (use a role token)", pattern: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g },
  // Tailwind's default palette is switched off in globals.css, so these classes draw nothing
  // (e.g. a badge with bg-black has no background at all).
  {
    name: "colour not in the theme (use a role token, e.g. bg-brand-deep / text-on-brand)",
    pattern: /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|placeholder|shadow)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/g,
  },
  { name: "text below the floor (use text-meta / text-base)", pattern: /(?<!-)\btext-(?:xs|sm)\b|\btext-\[(?:0?\.\d+rem|0?\.\d+em|(?:[0-9]|1[0-4])px)\]/g },
  { name: "icon/mark below 20px (use size-5+)", pattern: /\bsize-(?:[1-4](?:\.5)?|0\.5|\[(?:[0-9]|1[0-9])px\])(?![\w.-])/g, skip: /aria-hidden/ },
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (EXTENSIONS.has(extname(entry.name))) yield path;
  }
}

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(?:\/\/|\/?\*)/.test(line)) return; // comments
        if (line.includes("design-check-ignore:")) return; // explicit, reasoned opt-out (e.g. user caption colours)
        for (const rule of RULES) {
          if (rule.skip?.test(line)) continue;
          for (const match of line.matchAll(rule.pattern)) hits.push(`${file}:${i + 1}  ${match[0]}  — ${rule.name}`);
        }
      });
  }
}

if (hits.length) {
  console.error("Design check failed:\n" + hits.join("\n"));
  process.exit(1);
}
console.log("check-design: colours and sizing floor OK");
