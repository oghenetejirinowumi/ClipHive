/**
 * Caption styles store colours the way FFmpeg/libass wants them: "&HAABBGGRR" (or "&HBBGGRR"),
 * blue-green-red order, alpha 00 = opaque. This converts one for an on-screen preview.
 * These are the user's caption colours (data), not UI tokens.
 */
export function assToCss(ass: string | null | undefined, fallback = "currentColor"): string {
  const match = ass?.match(/^&H([0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match) return fallback;
  const hex = match[1].padStart(8, "0");
  const [a, b, g, r] = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${(1 - a / 255).toFixed(3)})`; // design-check-ignore: user caption colour
}
