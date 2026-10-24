"""Configuration settings for ClipHive."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Loaded from environment / .env / backend/.env. See .env.example for descriptions."""

    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), extra="ignore")

    database_url: str = "sqlite:///./cliphive.db"

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440

    cors_origins: str = "http://localhost:3000"

    media_dir: str = "./media"
    fonts_dir: str = "./assets/fonts"

    twitch_client_id: str = ""
    twitch_client_secret: str = ""
    live_poll_interval_s: int = 60
    # Stream monitor: polls active streamers and records each live broadcast start to finish,
    # split into gapless segments that are clipped as soon as each one completes.
    stream_monitor_enabled: bool = True
    segment_minutes: int = 10
    max_stream_hours: float = 12  # safety stop for one broadcast; 0 = record until it ends
    recording_workers: int = 3  # broadcasts recorded at the same time
    segment_clip_count: int = 3  # clips cut from each segment
    segment_clip_seconds: int = 30
    keep_recordings: bool = False  # delete each segment once its clips are cut

    # Link / upload imports (VOD-first: we process files offline, never record 24/7)
    ffmpeg_path: str = ""  # empty = system ffmpeg on PATH, else the bundled imageio-ffmpeg binary
    storage_dir: str = "storage"  # served at /storage by app.main
    max_import_minutes: int = 0  # 0 = analyse the whole video; N = only the first N minutes
    max_upload_mb: int = 8192
    import_workers: int = 2  # concurrent download/cut jobs
    # Netscape cookies.txt exported from a logged-in browser. Instagram (and some YouTube
    # videos) refuse anonymous downloads; with this set, yt-dlp downloads as that account.
    ytdlp_cookies_file: str = ""

    # Video editor: exports render with the HyperFrames CLI (needs Node.js 22+; npx fetches it once).
    hyperframes_version: str = "0.8.189"
    editor_render_quality: str = "looks"  # draft | looks | delivery

    # One-click demo login (app/core/demo.py). Disable for anything public.
    demo_login_enabled: bool = True

    # AI & Speech APIs (all optional, with robust offline/free fallbacks)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_transcribe_model: str = "whisper-1"
    assemblyai_api_key: str | None = None
    whisper_model_size: str = "base"

    youtube_api_key: str = ""
    trends_cache_ttl_s: int = 3600

    oauth_redirect_base_url: str = "http://localhost:8000/oauth"

    tiktok_client_key: str = ""
    tiktok_client_secret: str = ""
    tiktok_access_token: str = ""
    tiktok_refresh_token: str = ""

    youtube_client_id: str = ""
    youtube_client_secret: str = ""
    youtube_refresh_token: str = ""

    instagram_app_id: str = ""
    instagram_app_secret: str = ""
    instagram_user_id: str = ""
    instagram_access_token: str = ""

    x_api_key: str = ""
    x_api_secret: str = ""
    x_access_token: str = ""
    x_access_token_secret: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
