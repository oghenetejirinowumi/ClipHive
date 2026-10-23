"""Color utilities for converting between Web Hex RGB (#RRGGBB) and ASS Subtitle Hex BGR (&HAABBGGRR)."""
from __future__ import annotations

import re

ASS_COLOR_REGEX = re.compile(r"^&H([0-9A-Fa-f]{2})?([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$")


def rgb_to_ass_bgr(rgb_hex: str, alpha_hex: str = "00") -> str:
    """
    Converts a web hex color (#RRGGBB) to ASS subtitle format (&HAABBGGRR).
    Example: "#FFFF00" (Yellow) -> "&H0000FFFF"
             "#00FFFF" (Cyan)   -> "&H00FFFF00"
             "#FF007F" (Magenta)-> "&H007F00FF"
    """
    clean = rgb_hex.strip().lstrip("#")
    if len(clean) == 3:
        clean = "".join(c * 2 for c in clean)

    if len(clean) != 6:
        return "&H00FFFFFF"

    r = clean[0:2]
    g = clean[2:4]
    b = clean[4:6]
    return f"&H{alpha_hex.upper()}{b.upper()}{g.upper()}{r.upper()}"


def ass_bgr_to_rgb(ass_color: str) -> str:
    """
    Converts an ASS subtitle color (&HAABBGGRR or &HBBGGRR) to web hex (#RRGGBB).
    Example: "&H0000FFFF" -> "#FFFF00"
             "&H00FFFF00" -> "#00FFFF"
    """
    clean = ass_color.strip()
    if clean.startswith("&H") or clean.startswith("&h"):
        clean = clean[2:]

    if len(clean) == 8:
        # AABBGGRR -> ignore AA
        b = clean[2:4]
        g = clean[4:6]
        r = clean[6:8]
        return f"#{r}{g}{b}".upper()
    elif len(clean) == 6:
        # BBGGRR
        b = clean[0:2]
        g = clean[2:4]
        r = clean[4:6]
        return f"#{r}{g}{b}".upper()

    return "#FFFFFF"
