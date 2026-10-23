"""ASS (Advanced SubStation Alpha) subtitle generator with word-level highlight animation."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Sequence

from app.models.caption_style import CaptionStyle
from app.models.enums import AnimationType
from app.schemas.clip import TranscriptWord


def seconds_to_ass_time(seconds: float) -> str:
    """Converts seconds (e.g. 12.34) to ASS timestamp H:MM:SS.cc."""
    total_centis = int(round(seconds * 100))
    centis = total_centis % 100
    total_secs = total_centis // 100
    secs = total_secs % 60
    total_mins = total_secs // 60
    mins = total_mins % 60
    hours = total_mins // 60
    return f"{hours}:{mins:02d}:{secs:02d}.{centis:02d}"


def sanitize_ass_text(text: str) -> str:
    """Escapes curly braces to prevent ASS override tag injection."""
    return text.replace("{", "(").replace("}", ")").strip()


class ASSGenerator:
    """Generates styled ASS subtitle files for video burning."""

    def __init__(self, canvas_width: int = 1080, canvas_height: int = 1920):
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height

    def generate(
        self,
        words: Sequence[TranscriptWord | dict],
        style: CaptionStyle,
        clip_start_s: float = 0.0,
        clip_end_s: float | None = None,
        words_per_group: int = 4,
        output_file: str | Path | None = None,
        hype_words: Sequence[str] = (),
    ) -> str:
        """
        Generates ASS content with word-by-word animation and burns safe margins for 9:16 portrait.
        """
        # Normalize words to objects with word, start, end
        parsed_words: list[TranscriptWord] = []
        for w in words:
            if isinstance(w, dict):
                parsed_words.append(
                    TranscriptWord(
                        word=sanitize_ass_text(str(w["word"])),
                        start=float(w["start"]),
                        end=float(w["end"]),
                    )
                )
            else:
                parsed_words.append(
                    TranscriptWord(
                        word=sanitize_ass_text(w.word),
                        start=float(w.start),
                        end=float(w.end),
                    )
                )

        # Filter words inside clip window and offset to t=0
        clip_words: list[TranscriptWord] = []
        for w in parsed_words:
            if clip_end_s is not None and w.start >= clip_end_s:
                continue
            if w.end <= clip_start_s:
                continue
            rel_start = max(0.0, w.start - clip_start_s)
            rel_end = (w.end - clip_start_s) if clip_end_s is None else min(clip_end_s - clip_start_s, w.end - clip_start_s)
            
            clean_word = w.word.upper() if style.uppercase else w.word
            clip_words.append(TranscriptWord(word=clean_word, start=rel_start, end=rel_end))

        colors = style.colors_json or {}
        primary = colors.get("primary", "&H00FFFFFF")
        outline = colors.get("outline", "&H00000000")
        highlight = colors.get("highlight", "&H0000FFFF")
        back = colors.get("back", "&H80000000")

        # 480px vertical margin protects against TikTok/Reels UI overlay
        margin_v = 480
        outline_width = 5 if style.name == "Punch" else 3
        shadow_depth = 2

        header = f"""[Script Info]
Title: ClipHive Subtitles
ScriptType: v4.00+
PlayResX: {self.canvas_width}
PlayResY: {self.canvas_height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{style.font_name},{style.font_size},{primary},&H000000FF,{outline},{back},-1,0,0,0,100,100,0,0,1,{outline_width},{shadow_depth},2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        events: list[str] = []

        if not clip_words:
            ass_content = header
            if output_file:
                Path(output_file).write_text(ass_content, encoding="utf-8")
            return ass_content

        normalized_hype = {w.upper().strip("!?,.") for w in hype_words}

        # Group words into chunks of 3-5
        for g in range(0, len(clip_words), words_per_group):
            group = clip_words[g : g + words_per_group]
            if not group:
                continue

            if style.animation_type == AnimationType.LINE:
                start_str = seconds_to_ass_time(group[0].start)
                end_str = seconds_to_ass_time(group[-1].end)
                line_text = " ".join(w.word for w in group)
                events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}")

            elif style.animation_type == AnimationType.KARAOKE:
                start_str = seconds_to_ass_time(group[0].start)
                end_str = seconds_to_ass_time(group[-1].end)
                karaoke_parts = []
                for w in group:
                    duration_cs = max(1, int(round((w.end - w.start) * 100)))
                    karaoke_parts.append(f"{{\\k{duration_cs}}}{w.word}")
                events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{' '.join(karaoke_parts)}")

            else:  # AnimationType.WORD_POP (Default)
                for active_idx, active_word in enumerate(group):
                    start_str = seconds_to_ass_time(active_word.start)
                    end_str = seconds_to_ass_time(active_word.end)

                    phrase_parts = []
                    for idx, w in enumerate(group):
                        if idx == active_idx:
                            # Hype word gets extra 125% pop, normal gets 115%
                            clean_up = w.word.upper().strip("!?,.")
                            scale = 125 if clean_up in normalized_hype else 115
                            phrase_parts.append(f"{{\\c{highlight}\\fscx{scale}\\fscy{scale}}}{w.word}{{\\r}}")
                        else:
                            phrase_parts.append(w.word)

                    line_text = " ".join(phrase_parts)
                    events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}")

        ass_content = header + "\n".join(events) + "\n"

        if output_file:
            p = Path(output_file)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(ass_content, encoding="utf-8")

        return ass_content
