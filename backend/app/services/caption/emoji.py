"""Emoji for captions: pick the moments that deserve one, the emoji, and how it shows up.

Used by burned captions (ass_generator + emoji_render), the caption style preview, and the
editor's "Auto emoji". Emoji only go where a word carries a feeling or a thing worth showing
(a laugh, a clutch, money, a fail...), never on filler, and they're spaced out so the screen
doesn't turn into a sticker sheet.

Picking is two-tier, like auto SFX: the configured model (OpenAI, else Groq) when there's a
key, otherwise keyword rules. Either way `tidy` enforces the spacing and the cap, and the
motion comes from the emoji's mood (a skull stamps down, hearts float, money bursts) unless
the style pins one.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Literal

logger = logging.getLogger("cliphive.captions.emoji")

Motion = Literal["pop", "bounce", "float", "spin", "wiggle", "slide", "stamp", "burst"]
MOTIONS: tuple[str, ...] = ("pop", "bounce", "float", "spin", "wiggle", "slide", "stamp", "burst")
Amount = Literal["few", "normal", "lots"]
Placement = Literal["above", "left", "right"]

# Seconds between two emoji, and how many per minute of speech.
MIN_GAP_S: dict[str, float] = {"few": 5.0, "normal": 3.0, "lots": 1.5}
PER_MINUTE: dict[str, int] = {"few": 4, "normal": 8, "lots": 15}
# Weakest match that still earns an emoji: "few" keeps only strong moments.
MIN_SCORE: dict[str, float] = {"few": 1.35, "normal": 0.95, "lots": 0.55}
MIN_ON_S, MAX_ON_S = 1.0, 2.4  # how long one stays up


@dataclass(frozen=True)
class Entry:
    emoji: str
    motions: tuple[str, ...]  # fitting ways for it to appear, best first
    terms: tuple[str, ...]  # words; "stem*" matches any word starting with stem; spaces = phrase
    weight: float = 1.0  # how strongly these words call for an emoji


# Streaming / gaming first (that's what ClipHive cuts), then everyday feelings.
ENTRIES: tuple[Entry, ...] = (
    Entry("🔥", ("stamp", "burst"), ("fire", "lit", "insane*", "crazy", "cracked", "goated", "heat", "hot", "cooking", "cooked", "on fire"), 1.4),
    Entry("🤯", ("pop", "stamp"), ("mind blown", "unbelievable", "mindblowing", "what the", "wtf", "no way", "impossible"), 1.5),
    Entry("😱", ("pop", "wiggle"), ("omg", "oh my god", "oh my gosh", "scary", "scared", "terrif*", "shock*", "jumpscare"), 1.4),
    Entry("😂", ("wiggle", "bounce"), ("lol", "lmao", "laugh*", "haha*", "funny", "hilarious", "joke*", "dying"), 1.4),
    Entry("💀", ("stamp", "wiggle"), ("dead", "died", "die", "skull", "rip", "killed me", "i'm done", "im done"), 1.3),
    Entry("🎯", ("pop", "spin"), ("aim", "headshot*", "shot", "snipe*", "sniper", "target", "flick*", "one tap", "onetap"), 1.2),
    Entry("🏆", ("burst", "bounce"), ("win", "won", "winner", "winning", "victory", "champion*", "trophy", "first place", "dub"), 1.3),
    Entry("👑", ("bounce", "float"), ("king", "queen", "goat", "legend*", "royal*", "crown*"), 1.2),
    Entry("💰", ("burst", "bounce"), ("money", "cash", "rich", "paid", "dollar*", "bucks", "million*", "profit", "bank"), 1.2),
    Entry("🧠", ("pop", "spin"), ("brain*", "smart", "genius", "big brain", "outplay*", "iq", "strategy", "galaxy brain"), 1.2),
    Entry("⚡", ("stamp", "slide"), ("fast", "quick*", "speed*", "zap", "instant*", "reaction*", "lightning"), 1.1),
    Entry("💪", ("bounce", "stamp"), ("strong", "strength", "power*", "beast", "muscle*", "gym", "carry", "carried"), 1.1),
    Entry("😤", ("stamp", "wiggle"), ("angry", "mad", "rage*", "tilt*", "tilted", "annoy*", "furious"), 1.2),
    Entry("😭", ("float", "wiggle"), ("cry*", "sad", "tears", "heartbroken", "pain", "painful", "hurts"), 1.2),
    Entry("❤️", ("float", "pop"), ("love*", "heart*", "cute", "adorable", "sweet", "wholesome"), 1.1),
    Entry("👀", ("slide", "pop"), ("look*", "watch*", "see", "sus", "suspicious", "spotted", "peep*", "wait"), 0.8),
    Entry("🤔", ("wiggle", "float"), ("think*", "hmm*", "wonder*", "confus*", "why", "maybe", "guess"), 0.8),
    Entry("😎", ("slide", "bounce"), ("cool", "chill", "smooth", "easy", "ez", "clean", "swag*", "drip"), 1.1),
    Entry("🎉", ("burst", "bounce"), ("party", "celebrat*", "congrats", "congratulations", "birthday", "lets go", "let's go", "letsgo", "yay"), 1.3),
    Entry("🙏", ("float", "pop"), ("please", "pray*", "thank*", "thanks", "bless*", "hope"), 0.9),
    Entry("💯", ("stamp", "pop"), ("hundred", "100", "facts", "exactly", "perfect*", "literally", "real"), 1.0),
    Entry("🚀", ("slide", "float"), ("rocket", "launch*", "boost*", "blast*", "moon", "fly*", "takeoff"), 1.1),
    Entry("💥", ("burst", "stamp"), ("boom", "explo*", "bomb", "blow*", "smash*", "crash*", "hit"), 1.2),
    Entry("🥶", ("wiggle", "float"), ("cold", "freez*", "ice", "icy", "frozen", "chilly", "clutch*"), 1.2),
    Entry("🤡", ("wiggle", "bounce"), ("clown*", "fail*", "throw*", "threw", "trolled", "troll*", "noob*", "bot"), 1.1),
    Entry("😴", ("float", "wiggle"), ("sleep*", "tired", "boring", "bored", "nap", "yawn*"), 1.0),
    Entry("🍕", ("spin", "bounce"), ("pizza",), 1.0),
    Entry("🍔", ("spin", "bounce"), ("burger*", "food", "eat*", "hungry", "snack*"), 0.9),
    Entry("☕", ("float", "pop"), ("coffee", "tea", "morning"), 0.9),
    Entry("🎮", ("spin", "bounce"), ("game*", "gaming", "gamer*", "controller", "console", "play*", "ranked"), 0.8),
    Entry("🎵", ("float", "wiggle"), ("song*", "music", "sing*", "beat", "vibe*", "dance*"), 0.9),
    Entry("⏰", ("wiggle", "pop"), ("time", "late", "hurry", "clock", "minute*", "seconds", "deadline"), 0.7),
    Entry("👋", ("wiggle", "slide"), ("hello", "hi", "hey", "bye", "goodbye", "welcome"), 0.9),
    Entry("✅", ("pop", "stamp"), ("yes", "correct", "right answer", "done", "nailed it", "success*"), 0.8),
    Entry("❌", ("stamp", "wiggle"), ("no", "wrong", "nope", "never", "stop", "denied"), 0.6),
    Entry("👏", ("bounce", "wiggle"), ("clap*", "applause", "bravo", "respect", "well done", "nice", "gg", "good game"), 1.0),
    Entry("🤝", ("pop", "slide"), ("deal", "team*", "partner*", "together", "squad", "duo"), 0.9),
    Entry("🐐", ("bounce", "stamp"), ("goat", "greatest"), 1.3),
)

_WORD = re.compile(r"[^a-z0-9']+")
EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF☀-➿⬀-⯿⌀-⏿←-⇿〰〽㊗㊙©®‼⁉™ℹ]"
)


def _norm(word: str) -> str:
    return _WORD.sub("", word.lower())


def _motions_for(emoji: str) -> tuple[str, ...]:
    base = emoji.replace("️", "")
    for e in ENTRIES:
        if e.emoji.replace("️", "") == base:
            return e.motions
    return ("pop", "bounce", "float")


def is_emoji(text: str) -> bool:
    """One emoji (allowing variation selectors, skin tones and ZWJ sequences), nothing else."""
    t = text.strip()
    return 0 < len(t) <= 8 and bool(EMOJI_RE.search(t)) and not re.search(r"[A-Za-z0-9\s]", t)


# --- data ---------------------------------------------------------------------------------

@dataclass
class Word:
    text: str
    start: float
    end: float
    hype: bool = False


@dataclass
class Phrase:
    words: list[Word]

    @property
    def start(self) -> float:
        return self.words[0].start

    @property
    def end(self) -> float:
        return self.words[-1].end

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


@dataclass
class Cue:
    phrase: int  # index into the phrases given
    word: int  # index of the word it reacts to, within the phrase
    emoji: str
    score: float
    motion: str = "pop"
    placement: str = "above"
    start: float = 0.0
    end: float = 0.0
    reason: str = ""


@dataclass
class EmojiSettings:
    amount: str = "normal"
    motion: str = "mix"  # one of MOTIONS, or "mix" (each emoji gets a motion that fits it)
    placement: str = "mix"  # "above", "beside" or "mix"

    @classmethod
    def of(cls, options) -> "EmojiSettings":
        return cls(getattr(options, "emoji_amount", "normal"), getattr(options, "emoji_motion", "mix"),
                   getattr(options, "emoji_placement", "mix"))


# --- 1. rules -----------------------------------------------------------------------------

@dataclass
class _Matcher:
    exact: dict[str, Entry] = field(default_factory=dict)
    prefix: list[tuple[str, Entry]] = field(default_factory=list)
    phrases: list[tuple[str, Entry]] = field(default_factory=list)


def _build() -> _Matcher:
    m = _Matcher()
    for e in ENTRIES:
        for term in e.terms:
            if " " in term:
                m.phrases.append((term, e))
            elif term.endswith("*"):
                m.prefix.append((term[:-1], e))
            else:
                m.exact.setdefault(term, e)
    m.prefix.sort(key=lambda p: -len(p[0]))  # longest stem wins
    return m


_MATCHER = _build()


def match_word(word: str) -> Entry | None:
    w = _norm(word)
    if not w:
        return None
    if w in _MATCHER.exact:
        return _MATCHER.exact[w]
    for stem, e in _MATCHER.prefix:
        if w.startswith(stem) and len(w) - len(stem) <= 6:
            return e
    return None


def rule_cues(phrases: list[Phrase]) -> list[Cue]:
    """Every word (or phrase like "no way") that could take an emoji, scored."""
    out: list[Cue] = []
    for pi, phrase in enumerate(phrases):
        norm = [_norm(w.text) for w in phrase.words]
        bonus = 0.3 if phrase.text.rstrip().endswith("!") else 0.0
        claimed: set[int] = set()
        for term, e in _MATCHER.phrases:
            parts = [_norm(t) for t in term.split()]
            for i in range(len(norm) - len(parts) + 1):
                if norm[i : i + len(parts)] == parts:
                    last = i + len(parts) - 1  # react on the phrase's last word
                    hype = any(w.hype for w in phrase.words[i : last + 1])
                    out.append(Cue(pi, last, e.emoji, e.weight + 0.3 + (0.6 if hype else 0) + bonus, reason=term))
                    claimed.update(range(i, last + 1))
        for wi, w in enumerate(phrase.words):
            e = None if wi in claimed else match_word(w.text)
            if e:
                score = e.weight + (0.6 if w.hype else 0) + (0.3 if w.text.endswith("!") else 0) + bonus
                out.append(Cue(pi, wi, e.emoji, score, reason=w.text))
    return out


# --- 2. AI --------------------------------------------------------------------------------

PROMPT = """You add emoji to short-form video captions, like a top TikTok editor.
Pick at most {cap} phrases that deserve one emoji: a strong feeling (hype, shock, laughter,
sadness, anger), a reaction, or a concrete thing worth showing (money, food, a trophy, a skull
for a fail). Skip filler and neutral phrases; most phrases get none. Vary the emoji and keep
them on-tone (a fail is not a party). Two emoji must be at least {gap}s apart.
Answer with JSON only: {{"emojis": [{{"phrase": <id>, "word": <index of the word it reacts to, 0-based>, "emoji": "🔥", "reason": "<few words>"}}]}}"""


def _llm():
    from app.services.ai.ai_pack import get_ai_client

    try:
        return get_ai_client()
    except RuntimeError:
        return None, None


def ai_cues(phrases: list[Phrase], amount: str, duration: float, client=None, model: str | None = None) -> list[Cue]:
    """Ask the model. Raises on any failure; the caller falls back to rule_cues."""
    if client is None:
        client, model = _llm()
        if client is None:
            raise RuntimeError("no model configured")
    listing = json.dumps([{"id": i, "t": round(p.start, 2), "words": [w.text for w in p.words]} for i, p in enumerate(phrases[:300])],
                         ensure_ascii=False, separators=(",", ":"))
    response = client.chat.completions.create(
        model=model,
        temperature=0.4,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": PROMPT.format(cap=cap_for(amount, duration), gap=MIN_GAP_S.get(amount, 3.5))},
            {"role": "user", "content": f"Amount: {amount}\nLength: {duration:.1f}s\nPhrases:\n{listing}"},
        ],
        timeout=20,
    )
    text = response.choices[0].message.content or "{}"
    found = re.search(r"\{[\s\S]*\}", text)
    data = json.loads(found.group(0) if found else text)
    out: list[Cue] = []
    for item in data.get("emojis", []):
        try:
            pi, wi = int(item.get("phrase")), int(item.get("word", 0))
        except (TypeError, ValueError):
            continue
        emoji = str(item.get("emoji", "")).strip()
        if not (0 <= pi < len(phrases)) or not is_emoji(emoji):
            continue
        wi = max(0, min(wi, len(phrases[pi].words) - 1))
        hype = phrases[pi].words[wi].hype
        out.append(Cue(pi, wi, emoji, 1.2 + (0.5 if hype else 0), reason=str(item.get("reason", ""))[:60]))
    return out


# --- 3. tidy, motion, placement, timing ---------------------------------------------------

def cap_for(amount: str, duration: float) -> int:
    return max(1, round(PER_MINUTE.get(amount, 8) * max(duration, 15) / 60))


def tidy(cues: list[Cue], phrases: list[Phrase], settings: EmojiSettings) -> list[Cue]:
    """Strongest first, then keep only ones far enough apart, up to the cap."""
    if not phrases:
        return []
    duration = phrases[-1].end - phrases[0].start
    gap = MIN_GAP_S.get(settings.amount, 3.5)
    cap = cap_for(settings.amount, duration)
    kept: list[Cue] = []
    for c in sorted(cues, key=lambda c: (-c.score, phrases[c.phrase].start)):
        if len(kept) >= cap or c.score < MIN_SCORE.get(settings.amount, 0.95):
            break
        t = phrases[c.phrase].words[c.word].start
        if all(abs(t - phrases[k.phrase].words[k.word].start) >= gap for k in kept) and all(k.emoji != c.emoji or abs(t - phrases[k.phrase].words[k.word].start) > 8 for k in kept):
            kept.append(c)
    kept.sort(key=lambda c: phrases[c.phrase].words[c.word].start)
    return _finish(kept, phrases, settings)


_PLACE_MIX = ("above", "right", "above", "left")


def _finish(cues: list[Cue], phrases: list[Phrase], settings: EmojiSettings) -> list[Cue]:
    last_motion = ""
    for n, c in enumerate(cues):
        phrase = phrases[c.phrase]
        # Motion: pinned by the style, or the best fit that differs from the previous one.
        if settings.motion in MOTIONS:
            c.motion = settings.motion
        else:
            options = _motions_for(c.emoji)
            c.motion = next((m for m in options if m != last_motion), options[0])
        last_motion = c.motion
        if settings.placement == "above":
            c.placement = "above"
        elif settings.placement == "beside":
            c.placement = "right" if n % 2 == 0 else "left"
        else:
            c.placement = _PLACE_MIX[n % len(_PLACE_MIX)]
        # On screen from the word it reacts to until a beat after the phrase.
        c.start = phrase.words[c.word].start
        end = max(phrase.end + 0.3, c.start + MIN_ON_S)
        c.end = min(end, c.start + MAX_ON_S)
        if c.phrase + 1 < len(phrases):  # it's placed next to this phrase, so it leaves with it
            c.end = min(c.end, max(phrases[c.phrase + 1].start, c.start + 0.7))
        if n + 1 < len(cues):
            nxt = phrases[cues[n + 1].phrase].words[cues[n + 1].word].start
            c.end = max(c.start + 0.5, min(c.end, nxt - 0.05))
    return cues


def plan(phrases: list[Phrase], settings: EmojiSettings | None = None, *, use_ai: bool = True, client=None, model=None) -> tuple[list[Cue], bool]:
    """Pick emoji for these phrases. Returns (cues, used_ai)."""
    settings = settings or EmojiSettings()
    phrases = [p for p in phrases if p.words]
    if not phrases:
        return [], False
    if use_ai:
        try:
            cues = ai_cues(phrases, settings.amount, phrases[-1].end - phrases[0].start, client=client, model=model)
            if cues:
                return tidy(cues, phrases, settings), True
        except Exception as err:  # noqa: BLE001 - no key, network, bad JSON: the rules still work
            logger.info("Emoji picks falling back to rules: %s", err)
    return tidy(rule_cues(phrases), phrases, settings), False
