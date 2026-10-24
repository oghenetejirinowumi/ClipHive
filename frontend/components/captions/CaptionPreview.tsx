"use client";

import { useEffect, type CSSProperties } from "react";
import { captionFamily, DEFAULT_OPTIONS, loadCaptionFont, optionsFromLegacy, withOpacity, type CaptionOptions, type PreviewEmoji } from "@/lib/captions";
import { cn } from "@/lib/cn";

export type PreviewStyle = {
  name?: string;
  font_name: string;
  font_size: number;
  animation_type: string;
  uppercase: boolean;
  options?: Partial<CaptionOptions> | null;
  colors_json?: Record<string, string | undefined>;
  font_url?: string | null;
  font_em_ratio?: number;
};

export type PreviewWord = { word: string; hype?: boolean };


/**
 * Shows a caption the way the burner draws it (backend services/caption/ass_generator.py):
 * same font file and size, same phrase grouping and line breaks, same modes. An enlarged
 * active word takes real space, so its neighbours move apart ("reflow") or the room is
 * reserved up front ("stable"); nothing overlaps. Put it in an `@container` element.
 * With `frame`, it sits at the style's vertical position inside a 9:16 frame. `zoom` enlarges
 * it for small thumbnails (1 = true to scale).
 */
export function CaptionPreview({
  style,
  words,
  activeIndex,
  frame = false,
  zoom = 1,
  emojis,
  className,
}: {
  style: PreviewStyle | undefined;
  words: PreviewWord[];
  activeIndex: number;
  frame?: boolean;
  zoom?: number;
  /** Emoji planned for these words (shown when the style has emoji on). */
  emojis?: PreviewEmoji[];
  className?: string;
}) {
  /** Video pixels (1080 wide) -> container units, so the caption scales with the frame. */
  const u = (px: number) => `${((px * zoom) / 1080) * 100}cqw`;
  const fontName = style?.font_name ?? "";
  const fontUrl = style?.font_url;
  useEffect(() => {
    if (fontName) loadCaptionFont(fontName, fontUrl);
  }, [fontName, fontUrl]);

  if (!style) return null;
  const mode = style.animation_type;
  const o: CaptionOptions = { ...DEFAULT_OPTIONS, ...(style.options ?? optionsFromLegacy(style.colors_json, mode)) };
  const em = style.font_size * (style.font_em_ratio || 0.8); // libass sizes text by the font's full height

  // Phrase containing the active word, split into lines (as the burner groups them).
  const perGroup = mode === "single_word" ? 1 : o.words_per_line * o.max_lines;
  const start = Math.floor(Math.max(0, activeIndex) / perGroup) * perGroup;
  const group = words.slice(start, start + perGroup).map((w, i) => ({ ...w, i: start + i }));
  const lines: (typeof group)[] = [];
  for (let i = 0; i < group.length; i += o.words_per_line) lines.push(group.slice(i, i + o.words_per_line));

  // The emoji on screen now: from its word until it leaves, within this phrase.
  const emoji = o.emojis
    ? emojis?.find((e) => activeIndex >= e.index && activeIndex < e.until && e.index >= start && e.index < start + perGroup)
    : undefined;

  const animated = mode !== "line" && mode !== "karaoke";
  const isBox = mode === "highlight_box";
  const maxScale = animated ? Math.max(o.active_scale, o.hype_scale) / 100 : 1;
  const pitch = style.font_size * 0.78 * ((1 + maxScale) / 2) * (o.line_spacing / 100);
  const gap = em * 0.26 + (isBox ? o.box_padding : 0);

  const shadows = [
    o.shadow_depth > 0 && o.shadow_opacity > 0 ? `${u(o.shadow_depth)} ${u(o.shadow_depth)} ${u(o.blur * 1.5)} ${withOpacity(o.shadow_color, o.shadow_opacity)}` : null,
    o.glow_strength > 0 ? `0 0 ${u(o.glow_strength)} ${o.glow_color}, 0 0 ${u(o.glow_strength * 2)} ${o.glow_color}` : null,
  ].filter(Boolean);

  const textBase: CSSProperties = {
    WebkitTextStroke: o.outline_width > 0 ? `${u(o.outline_width * 2)} ${o.outline_color}` : undefined,
    paintOrder: "stroke fill",
    textShadow: shadows.join(", ") || undefined,
    letterSpacing: o.letter_spacing ? u(o.letter_spacing) : undefined,
    fontWeight: o.bold ? 700 : 400,
    fontStyle: o.italic ? "italic" : undefined,
  };

  return (
    <div
      className={cn(frame ? "absolute inset-x-0 mx-auto" : "w-full", className)}
      style={{
        fontFamily: captionFamily(style.font_name),
        fontSize: u(em),
        lineHeight: 1,
        ...(frame ? { top: `${o.position_y}%`, transform: "translateY(-50%)", maxWidth: `${o.max_width}%` } : {}),
      }}
    >
      <div className="relative mx-auto w-fit max-w-full">
      {emoji && <CaptionEmoji key={`${emoji.index}-${emoji.emoji}`} emoji={emoji} size={u(o.emoji_size)} />}
      {lines.map((line, li) => (
        <div
          key={li}
          className="mx-auto flex w-fit max-w-full flex-nowrap items-center justify-center"
          style={{
            columnGap: u(gap),
            minHeight: u(pitch),
            ...(o.line_box
              ? { background: withOpacity(o.line_box_color, o.line_box_opacity), padding: `0 ${u(o.box_padding)}`, borderRadius: u(o.box_radius) }
              : {}),
          }}
        >
          {line.map((w) => {
            const active = w.i === activeIndex;
            const lit = active || (mode === "karaoke" && w.i < activeIndex);
            const hidden = (mode === "reveal" && w.i > activeIndex) || (mode === "single_word" && !active);
            const scale = animated && active ? (w.hype ? o.hype_scale : o.active_scale) / 100 : 1;
            const stableScale = animated ? (w.hype ? Math.max(o.active_scale, o.hype_scale) : o.active_scale) / 100 : 1;
            const colour = isBox && active ? o.active_text_color : lit && mode !== "line" && !isBox ? o.active_color : o.text_color;
            const dim = !lit && animated && o.inactive_opacity < 100 ? o.inactive_opacity / 100 : 1;
            const text = style.uppercase ? w.word.toUpperCase() : w.word;

            const visible = (
              <span
                key={active && o.pop_in && animated ? `pop-${activeIndex}` : "still"}
                className={cn("relative isolate inline-block whitespace-nowrap", active && o.pop_in && animated && "caption-pop")}
                style={{
                  ...textBase,
                  ...(isBox && active ? { WebkitTextStroke: undefined, textShadow: undefined } : {}),
                  fontSize: `${scale}em`,
                  color: colour,
                  opacity: dim,
                  transition: "font-size 120ms ease-out, color 120ms ease-out, opacity 120ms ease-out",
                }}
              >
                {isBox && active && (
                  <span
                    aria-hidden
                    className="absolute -z-10"
                    style={{
                      inset: `-${u(o.box_padding * 0.6)} -${u(o.box_padding)} -${u(o.box_padding * 0.45)}`,
                      background: withOpacity(o.box_color, o.box_opacity),
                      borderRadius: u(o.box_radius),
                    }}
                  />
                )}
                {text}
              </span>
            );

            if (mode === "single_word" && hidden) return null;
            return (
              <span key={w.i} className={cn("inline-grid place-items-center", hidden && "invisible")}>
                {o.spacing_mode === "stable" && animated && (
                  // Invisible copy at full size reserves the room, so neighbours never move.
                  <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap" style={{ ...textBase, fontSize: `${stableScale}em` }}>
                    {text}
                  </span>
                )}
                <span className="col-start-1 row-start-1">{visible}</span>
              </span>
            );
          })}
        </div>
      ))}
      </div>
    </div>
  );
}

const SPARKS = [0, 1, 2, 3, 4, 5, 6];

/** One emoji above or beside the caption block, entering with its motion (globals.css). */
function CaptionEmoji({ emoji, size }: { emoji: PreviewEmoji; size: string }) {
  const where =
    emoji.placement === "right"
      ? { left: "100%", top: "50%", marginLeft: "0.15em" }
      : emoji.placement === "left"
        ? { right: "100%", top: "50%", marginRight: "0.15em" }
        : { left: "50%", bottom: "100%", marginBottom: "0.1em" };
  const side = emoji.placement === "left" ? -1 : 1;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-10 block leading-none"
      style={{ ...where, fontSize: size, translate: emoji.placement === "above" ? "-50% 0" : "0 -50%", fontFamily: "system-ui, sans-serif" }}
    >
      {emoji.motion === "burst" &&
        SPARKS.map((k) => (
          <span
            key={k}
            className="caption-emoji-spark absolute top-1/2 left-1/2 text-[0.35em]"
            style={{ "--angle": `${(k / SPARKS.length) * 360 + 12}deg` } as CSSProperties}
          >
            {emoji.emoji}
          </span>
        ))}
      <span className={cn("caption-emoji inline-block", `caption-emoji-${emoji.motion}`)} style={{ "--side": side } as CSSProperties}>
        {emoji.emoji}
      </span>
    </span>
  );
}
