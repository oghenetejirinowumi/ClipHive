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
    max_recording_minutes: int = 10

    # Link / upload imports (VOD-first: we process files offline, never record 24/7)
    ffmpeg_path: str = ""  # empty = system ffmpeg on PATH, else the bundled imageio-ffmpeg binary
    storage_dir: str = "storage"  # served at /storage by app.main
    max_import_minutes: int = 30  # only the first N minutes of a link/upload are analysed
    max_upload_mb: int = 1024
    import_workers: int = 2  # concurrent download/cut jobs
    # Netscape cookies.txt exported from a logged-in browser. Instagram (and some YouTube
    # videos) refuse anonymous downloads; with this set, yt-dlp downloads as that account.
    ytdlp_cookies_file: str = ""

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
