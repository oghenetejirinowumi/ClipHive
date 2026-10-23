"""Shared enums, used by both the ORM models and the Pydantic schemas."""
from enum import StrEnum


class SourcePlatform(StrEnum):
    """Where streams are recorded from."""

    TWITCH = "twitch"
    KICK = "kick"
    YOUTUBE = "youtube"


class PostPlatform(StrEnum):
    """Where clips are published and trends are fetched from."""

    TIKTOK = "tiktok"
    YOUTUBE = "youtube"
    INSTAGRAM = "instagram"
    X = "x"


class StreamStatus(StrEnum):
    LIVE = "live"
    RECORDING = "recording"
    ENDED = "ended"
    PROCESSED = "processed"
    FAILED = "failed"


class ClipStatus(StrEnum):
    PROCESSING = "processing"  # written by ingestion (C); raw file exists
    CAPTIONING = "captioning"  # caption service (A) is burning captions
    READY = "ready"  # final file exists; shown in the hub (D)
    FAILED = "failed"


class CaptionMode(StrEnum):
    BURNED = "burned"  # burn captions in ClipHive
    PLATFORM_NATIVE = "platform_native"  # upload clean, let TikTok etc. caption it


class AnimationType(StrEnum):
    WORD_POP = "word_pop"
    KARAOKE = "karaoke"
    LINE = "line"


class PostStatus(StrEnum):
    QUEUED = "queued"  # scheduled by the Publisher agent
    READY = "ready"  # its time has come: export and post it
    POSTING = "posting"
    POSTED = "posted"
    FAILED = "failed"


class ImportSource(StrEnum):
    """Where an import job's video came from: a pasted link or an uploaded file."""

    TWITCH = "twitch"
    KICK = "kick"
    YOUTUBE = "youtube"
    UPLOAD = "upload"


class ImportStatus(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    ANALYZING = "analyzing"  # scoring the audio for highlight moments
    CUTTING = "cutting"  # writing the 9:16 clips
    DONE = "done"
    FAILED = "failed"
