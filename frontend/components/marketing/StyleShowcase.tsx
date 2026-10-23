"use client";

import { useEffect, useState } from "react";
import { CaptionPreview, type PreviewStyle } from "@/components/captions/CaptionPreview";
import { useMotionBudget } from "@/components/effects";
import { Icon } from "@/components/ui";

// Mirrors the presets in backend/app/services/caption/styles.py, so the marketing preview
// shows exactly what the burner produces.
const PRESETS: Array<PreviewStyle & { blurb: string }> = [
  {
    name: "Punch",
    font_name: "Bangers",
    font_size: 84,
    colors_json: { primary: "&H0000FFFF", outline: "&H00000000", highlight: "&H0000FFFF", back: "&H80000000" },
    animation_type: "word_pop",
    uppercase: true,
    blurb: "Bold yellow, every word pops.",
  },
  {
    name: "Neon",
    font_name: "Luckiest Guy",
    font_size: 78,
    colors_json: { primary: "&H00FFFF00", outline: "&H00FF00FF", highlight: "&H0000FFFF", back: "&H80000000" },
    animation_type: "word_pop",
    uppercase: true,
    blurb: "Cyan with a magenta edge.",
  },
  {
    name: "Clean",
    font_name: "Poppins",
    font_size: 68,
    colors_json: { primary: "&H00FFFFFF", outline: "&H00202020", highlight: "&H0000FFFF", back: "&H90000000" },
    animation_type: "line",
    uppercase: false,
    blurb: "White on a soft box, line by line.",
  },
];

const WORDS = [{ word: "No", hype: true }, { word: "way" }, { word: "he" }, { word: "hit", hype: true }, { word: "that!", hype: true }];

/** The real preset captions, animating in their own fonts and colours, plus a "your font" card. */
export function StyleShowcase() {
  const budget = useMotionBudget();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (budget === "off") return;
    const t = setInterval(() => setActive((i) => (i + 1) % WORDS.length), 480);
    return () => clearInterval(t);
  }, [budget]);

  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {PRESETS.map((style) => (
        <li key={style.name}>
          <div className="@container grid aspect-[4/5] place-items-center overflow-hidden rounded-lg bg-brand-deep px-6 shadow-glow">
            <CaptionPreview style={{ ...style, font_size: style.font_size * 1.7 }} words={WORDS} activeIndex={active} />
          </div>
          <p className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">{style.name}</p>
          <p className="mt-1 text-lg text-ink-muted">{style.blurb}</p>
        </li>
      ))}
      <li>
        <div className="grid aspect-[4/5] place-items-center rounded-lg border-2 border-dashed border-line-strong bg-surface-sunken text-center">
          <div className="px-6">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand-subtle text-brand-strong">
              <Icon name="upload" />
            </span>
            <p className="mt-5 font-display text-3xl font-semibold tracking-tight text-ink">Aa</p>
          </div>
        </div>
        <p className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">Your font</p>
        <p className="mt-1 text-lg text-ink-muted">Upload a .ttf or .otf and make it yours.</p>
      </li>
    </ul>
  );
}
