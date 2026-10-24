"""Caption fonts: what's installed, Google Fonts on demand, and the metrics libass uses.

Every font a caption can use lives in one flat folder, backend/assets/fonts (libass only
reads the top level): bundled files, "google-*" files downloaded from Google Fonts (free OFL
licences) and "upload-*" files from the creator. The burner points libass at this folder,
and the browser preview loads the very same files, so the preview and the MP4 use one font.

Google Fonts files are renamed to a unique family such as "Montserrat 900" so libass can't
confuse them with another weight or a system font of the same name.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

import requests

logger = logging.getLogger("cliphive.fonts")

FONTS_DIR = Path(__file__).resolve().parents[3] / "assets" / "fonts"
GOOGLE_PREFIX = "google-"
UPLOAD_PREFIX = "upload-"
FONT_EXTS = {".ttf", ".otf"}

# A browser that predates WOFF2 makes the Google Fonts CSS API answer with plain TTF links.
_OLD_UA = "Mozilla/4.0"  # unknown old browser: the CSS API answers with plain TTF links

# Families that work well for short-form captions, with the weights worth offering.
POPULAR_GOOGLE_FONTS: list[dict] = [
    {"family": "Montserrat", "weights": [700, 800, 900], "category": "Bold sans"},
    {"family": "Anton", "weights": [400], "category": "Condensed"},
    {"family": "Bebas Neue", "weights": [400], "category": "Condensed"},
    {"family": "Oswald", "weights": [600, 700], "category": "Condensed"},
    {"family": "Barlow Condensed", "weights": [700, 800, 900], "category": "Condensed"},
    {"family": "League Spartan", "weights": [700, 800, 900], "category": "Bold sans"},
    {"family": "Poppins", "weights": [600, 700, 800, 900], "category": "Bold sans"},
    {"family": "Inter", "weights": [600, 700, 800, 900], "category": "Clean sans"},
    {"family": "Roboto", "weights": [500, 700, 900], "category": "Clean sans"},
    {"family": "DM Sans", "weights": [600, 700], "category": "Clean sans"},
    {"family": "Outfit", "weights": [600, 700, 800], "category": "Clean sans"},
    {"family": "Plus Jakarta Sans", "weights": [700, 800], "category": "Clean sans"},
    {"family": "Archivo Black", "weights": [400], "category": "Bold sans"},
    {"family": "Rubik", "weights": [700, 800, 900], "category": "Rounded"},
    {"family": "Nunito", "weights": [800, 900], "category": "Rounded"},
    {"family": "Fredoka", "weights": [600, 700], "category": "Rounded"},
    {"family": "Lilita One", "weights": [400], "category": "Display"},
    {"family": "Titan One", "weights": [400], "category": "Display"},
    {"family": "Luckiest Guy", "weights": [400], "category": "Display"},
    {"family": "Bangers", "weights": [400], "category": "Display"},
    {"family": "Bowlby One SC", "weights": [400], "category": "Display"},
    {"family": "Permanent Marker", "weights": [400], "category": "Handwritten"},
    {"family": "Kalam", "weights": [700], "category": "Handwritten"},
    {"family": "Playfair Display", "weights": [700, 800, 900], "category": "Serif"},
    {"family": "Lora", "weights": [600, 700], "category": "Serif"},
    {"family": "Space Mono", "weights": [700], "category": "Mono"},
]


@dataclass
class FontInfo:
    name: str  # the family libass and the browser use
    file: Path
    units_per_em: int
    win_height: int  # usWinAscent + usWinDescent (what libass sizes text against)
    hhea_ascent: int
    hhea_descent: int  # positive
    cap_height: int
    advances: dict[str, int] = field(default_factory=dict)  # char -> advance (font units)
    default_advance: int = 0
    source: str = "bundled"  # bundled | google | upload

    @property
    def em_ratio(self) -> float:
        """Em size in pixels per 1px of ASS font size (libass: size * upem / (winAscent+winDescent))."""
        return self.units_per_em / self.win_height if self.win_height else 1.0

    def text_width(self, text: str, size: float, scale: float = 1.0, spacing: float = 0.0) -> float:
        """Width in pixels that libass gives `text` at ASS size `size`, horizontal scale and \\fsp."""
        em_px = size * self.em_ratio
        units = sum(self.advances.get(ch, self.default_advance) for ch in text)
        return (units * em_px / self.units_per_em + spacing * len(text)) * scale

    def ratios(self) -> dict[str, float]:
        """Vertical metrics as fractions of the ASS font size."""
        h = self.win_height or self.units_per_em
        return {
            "ascent": self.hhea_ascent / h,
            "descent": self.hhea_descent / h,
            "cap": (self.cap_height or 0.7 * self.units_per_em) / h,
        }


class _Registry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_key: dict[str, FontInfo] = {}
        self._stamp: tuple | None = None

    def _scan_stamp(self) -> tuple:
        files = sorted(p for p in FONTS_DIR.glob("*") if p.suffix.lower() in FONT_EXTS)
        return tuple((str(p), p.stat().st_mtime) for p in files)

    def _load(self, path: Path) -> list[tuple[str, FontInfo]]:
        from fontTools.ttLib import TTFont

        font = TTFont(str(path), lazy=True)
        names = font["name"]

        def get(nid: int) -> str | None:
            rec = names.getName(nid, 3, 1, 0x409) or names.getName(nid, 1, 0, 0) or names.getDebugName(nid)
            return str(rec).strip() if rec else None

        os2 = font["OS/2"] if "OS/2" in font else None
        hhea = font["hhea"]
        upem = font["head"].unitsPerEm
        win_h = (os2.usWinAscent + os2.usWinDescent) if os2 else (hhea.ascent - hhea.descent)
        cmap = font.getBestCmap() or {}
        hmtx = font["hmtx"].metrics
        advances = {chr(cp): hmtx[g][0] for cp, g in cmap.items() if g in hmtx and cp < 0x3000}
        default = advances.get("n") or (sum(advances.values()) // max(1, len(advances))) or upem // 2
        source = "google" if path.name.startswith(GOOGLE_PREFIX) else "upload" if path.name.startswith(UPLOAD_PREFIX) else "bundled"
        family = get(1) or path.stem
        info = FontInfo(
            name=family,
            file=path,
            units_per_em=upem,
            win_height=win_h,
            hhea_ascent=hhea.ascent,
            hhea_descent=-hhea.descent,
            cap_height=getattr(os2, "sCapHeight", 0) if os2 else 0,
            advances=advances,
            default_advance=default,
            source=source,
        )
        keys = {family}
        for nid in (16, 4):  # typographic family ("Poppins"), full name ("Poppins SemiBold")
            if get(nid):
                keys.add(get(nid))
        font.close()
        return [(k, info) for k in keys]

    def refresh(self) -> None:
        FONTS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = self._scan_stamp()
        if stamp == self._stamp:
            return
        by_key: dict[str, FontInfo] = {}
        for path_str, _ in stamp:
            try:
                for key, info in self._load(Path(path_str)):
                    # Exact family names win over typographic/full-name aliases.
                    if key.lower() not in by_key or by_key[key.lower()].name.lower() != key.lower():
                        by_key[key.lower()] = info
            except Exception as err:
                logger.warning("Skipping unreadable font %s: %s", path_str, err)
        self._by_key, self._stamp = by_key, stamp

    def get(self, name: str | None) -> FontInfo | None:
        if not name:
            return None
        with self._lock:
            self.refresh()
            return self._by_key.get(name.strip().lower())

    def all(self) -> list[FontInfo]:
        with self._lock:
            self.refresh()
            unique = {id(f): f for f in self._by_key.values()}
            return sorted(unique.values(), key=lambda f: f.name.lower())


registry = _Registry()


def get_font(name: str | None) -> FontInfo | None:
    return registry.get(name)


def installed_fonts() -> list[FontInfo]:
    return registry.all()


# ---------- Google Fonts ----------
_GOOGLE_NAME = re.compile(r"^(?P<family>[A-Za-z0-9 ]+?) (?P<weight>[1-9]00)$")


def google_font_name(family: str, weight: int) -> str:
    return f"{family.strip()} {int(weight)}"


def parse_google_name(name: str) -> tuple[str, int] | None:
    """'Montserrat 900' -> ('Montserrat', 900)."""
    m = _GOOGLE_NAME.match(name.strip())
    return (m.group("family"), int(m.group("weight"))) if m else None


class FontInstallError(RuntimeError):
    pass


_install_lock = threading.Lock()


def install_google_font(family: str, weight: int = 400) -> FontInfo:
    """Download one weight of a Google Font (TTF) and register it as '<Family> <weight>'."""
    family = re.sub(r"\s+", " ", family).strip()
    if not re.fullmatch(r"[A-Za-z0-9 ]{2,60}", family):
        raise FontInstallError("Use a Google Fonts family name, like Montserrat.")
    name = google_font_name(family, weight)
    existing = get_font(name)
    if existing:
        return existing

    with _install_lock:
        existing = get_font(name)
        if existing:
            return existing
        try:
            css = requests.get(
                "https://fonts.googleapis.com/css2",
                params={"family": f"{family}:wght@{weight}"},
                headers={"User-Agent": _OLD_UA},
                timeout=15,
            )
        except requests.RequestException as err:
            raise FontInstallError("Couldn't reach Google Fonts.") from err
        if css.status_code == 400:
            raise FontInstallError(f'Google Fonts has no "{family}" in weight {weight}.')
        css.raise_for_status()
        url = re.search(r"url\((https://[^)]+\.(?:ttf|otf))\)", css.text)
        if not url:
            raise FontInstallError(f'Google Fonts has no TTF for "{family}" {weight}.')
        try:
            data = requests.get(url.group(1), timeout=30).content
        except requests.RequestException as err:
            raise FontInstallError("Couldn't download the font file.") from err

        FONTS_DIR.mkdir(parents=True, exist_ok=True)
        out = FONTS_DIR / f"{GOOGLE_PREFIX}{family.replace(' ', '')}-{weight}.ttf"
        tmp = out.with_suffix(".part")
        tmp.write_bytes(data)
        _rename_family(tmp, name)
        tmp.replace(out)
        logger.info("Installed Google Font %s", name)

    info = get_font(name)
    if info is None:
        raise FontInstallError("The font downloaded but couldn't be read.")
    return info


def _rename_family(path: Path, family: str) -> None:
    """Give a font a unique family name so libass and the browser pick exactly this file."""
    from fontTools.ttLib import TTFont

    font = TTFont(str(path))
    table = font["name"]
    postscript = re.sub(r"[^A-Za-z0-9-]", "", family.replace(" ", "-"))
    for record in list(table.names):
        if record.nameID in (16, 17, 21, 22):
            table.removeNames(nameID=record.nameID)
    for nid, value in ((1, family), (2, "Regular"), (4, family), (6, postscript)):
        table.setName(value, nid, 3, 1, 0x409)
        table.setName(value, nid, 1, 0, 0)
    if "OS/2" in font:
        font["OS/2"].usWeightClass = 400  # libass then never synthesises bold for it
        font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~0b1100001) | 0b1000000  # REGULAR
    font["head"].macStyle = 0
    font.save(str(path))


def ensure_font(name: str | None) -> FontInfo | None:
    """The font for a style, downloading it from Google Fonts if it's one of ours and missing."""
    info = get_font(name)
    if info or not name:
        return info
    parsed = parse_google_name(name)
    if parsed:
        try:
            return install_google_font(*parsed)
        except Exception as err:
            logger.warning("Couldn't install %s from Google Fonts: %s", name, err)
    return None


def install_in_background(names: list[str]) -> None:
    """Fetch preset fonts after startup so the first preview/burn doesn't wait."""

    def run() -> None:
        for n in names:
            ensure_font(n)

    threading.Thread(target=run, daemon=True, name="font-install").start()
