import { Bangers, Luckiest_Guy, Poppins } from "next/font/google";

// The fonts the preset caption styles burn with (backend/assets/fonts), so previews match the MP4.
const bangers = Bangers({ weight: "400", subsets: ["latin"], display: "swap" });
const luckiestGuy = Luckiest_Guy({ weight: "400", subsets: ["latin"], display: "swap" });
const poppins = Poppins({ weight: "600", subsets: ["latin"], display: "swap" });

const FAMILIES: Record<string, string> = {
  bangers: bangers.style.fontFamily,
  "luckiest guy": luckiestGuy.style.fontFamily,
  poppins: poppins.style.fontFamily,
};

/** CSS font-family for a caption style's font_name; unknown (uploaded) fonts fall back gracefully. */
export function captionFontFamily(fontName: string | null | undefined): string {
  const key = (fontName ?? "").trim().toLowerCase();
  return FAMILIES[key] ?? `"${fontName}", var(--typeface-display)`;
}
