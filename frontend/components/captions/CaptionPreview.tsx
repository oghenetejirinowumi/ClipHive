"use client";

import { assToCss } from "@/lib/ass-color";
import { captionFontFamily } from "@/lib/caption-fonts";
import { cn, cssVars } from "@/lib/cn";

export type PreviewStyle = {
  name: string;
  font_name: string;
  font_size: number;
  colors_json: { primary?: string; outline?: string; highlight?: string; back?: string };
  animation_type: string;
  uppercase: boolean;
};

export type PreviewWord = { word: string; hype?: boolean };

/**
 * Renders caption words the way the burner will: the style's own font, ASS colours, outline,
 * and animation (word_pop scales the active word, karaoke fills words up to it, line stays
 * still on a back box). Sized in container units so it scales with the 9:16 frame.
 */
export function CaptionPreview({
  style,
  words,
  activeIndex,
  className,
}: {
  style: PreviewStyle | undefined;
  words: PreviewWord[];
  activeIndex: number;
  className?: string;
}) {
  if (!style) return null;
  const primary = assToCss(style.colors_json.primary, "currentColor");
  const highlight = assToCss(style.colors_json.highlight, primary);
  const outline = assToCss(style.colors_json.outline, "transparent");
  const back = assToCss(style.colors_json.back, "transparent");
  const mode = style.animation_type;
  // ASS sizes are in 1080-wide video pixels; express them relative to the frame width.
  const size = `${(style.font_size / 1080) * 100}cqw`;

  return (
    <p
      className={cn("flex flex-wrap items-center justify-center gap-x-[0.28em] gap-y-[0.1em] text-center leading-[1.15]", className)}
      style={{
        fontFamily: captionFontFamily(style.font_name),
        fontSize: size,
        ...(mode === "line" ? { background: back, padding: "0.2em 0.45em", borderRadius: "0.3em" } : {}),
      }}
    >
      {words.map((w, i) => {
        const active = i === activeIndex;
        const lit = mode === "karaoke" ? i <= activeIndex : mode === "word_pop" && active;
        const scale = mode === "word_pop" && active ? (w.hype ? 1.32 : 1.18) : 1;
        return (
          <span
            key={i}
            className="inline-block transition-[transform,color] duration-(--motion-fast) ease-soft"
            style={{
              ...cssVars({ "--outline": outline }),
              color: lit ? highlight : primary,
              transform: `scale(${scale})`,
              WebkitTextStroke: "0.09em var(--outline)",
              paintOrder: "stroke fill",
            }}
          >
            {style.uppercase ? w.word.toUpperCase() : w.word}
          </span>
        );
      })}
    </p>
  );
}
