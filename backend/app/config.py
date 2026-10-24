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
    ffmpeg_path: str = (
        ""  # empty = system ffmpeg on PATH, else the bundled imageio-ffmpeg binary
    )
    storage_dir: str = "storage"  # served at /storage by app.main
    max_import_minutes: int = (
        30  # only the first N minutes of a link/upload are analysed
    )
    max_upload_mb: int = 1024
    import_workers: int = 2  # concurrent download/cut jobs
    # Netscape cookies.txt exported from a logged-in browser. Instagram (and some YouTube
    # videos) refuse anonymous downloads; with this set, yt-dlp downloads as that account.
    ytdlp_cookies_file: str = ""
    # Read cookies straight from a local browser instead, e.g. "brave", "edge", "chrome",
    # or "brave:Profile 1". Only used as a retry when YouTube blocks the cookie-less try.
    ytdlp_cookies_from_browser: str = ""
    # YouTube player clients tried in order. web_embedded and mweb usually get past the
    # "confirm you're not a bot" wall without any login. web_embedded goes first: on a
    # bot-walled network it's the one that still returns audio-only streams, and when it
    # came after "default" its formats were dropped, leaving only combined video streams.
    ytdlp_youtube_clients: str = "web_embedded,default,mweb"

    # One-click demo login (app/core/demo.py). Disable for anything public.
    demo_login_enabled: bool = True

    # AI & Speech APIs (all optional, with robust offline/free fallbacks)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_transcribe_model: str = "whisper-1"
    assemblyai_api_key: str | None = None
    whisper_model_size: str = "base"

    # Groq (optional): fast hosted Whisper + LLM. Empty key = local faster-whisper and
    # loudness-only highlights, exactly as before.
    groq_api_key: str = ""
    groq_transcribe_model: str = "whisper-large-v3-turbo"
    groq_chat_model: str = "openai/gpt-oss-20b"
    # Re-rank loudness candidates by what is said in them (needs GROQ_API_KEY).
    ai_highlights_enabled: bool = True

    # Agents (services/agents). The Producer picks and cuts clips with a tool-calling model;
    # with no key or on error, imports fall back to the fixed pipeline.
    agent_mode_enabled: bool = True
    agent_provider: str = "auto"  # auto (OpenAI if its key is set, else Groq) | openai | groq
    agent_openai_model: str = "gpt-4.1-mini"  # picked moments more consistently than gpt-4o-mini in our tests
    agent_groq_model: str = "openai/gpt-oss-120b"  # Groq model for tool calling (accurate, but slower)
    agent_max_steps: int = 25
    agent_max_seconds: int = 240
    # Scout: check monitored channels for new VODs in the background and import them.
    scout_enabled: bool = False
    scout_interval_minutes: int = 15
    # Publisher: platforms each approved clip is queued for.
    publisher_platforms: str = "tiktok,youtube"
    # YouTube search scraping with yt-dlp for the studio's social-trends panel. Off by default:
    # it is a research prototype, separate from the API-based trend collection gate.
    social_search_enabled: bool = False

    youtube_api_key: str = ""
    trends_cache_ttl_s: int = 3600
    trends_default_regions: str = "NG,US"
    trends_keywords: str = "gaming,streaming,Twitch clips,Valorant,Fortnite,FIFA"
    trends_scheduler_enabled: bool = False
    trends_max_videos_per_run: int = 60
    trends_recency_half_life_days: float = 7.0
    trends_youtube_derived_metrics_approved: bool = False

    @property
    def trends_region_list(self) -> list[str]:
        return [
            region.strip().upper()
            for region in self.trends_default_regions.split(",")
            if region.strip()
        ]

    @property
    def trends_keyword_list(self) -> list[str]:
        return [
            keyword.strip()
            for keyword in self.trends_keywords.split(",")
            if keyword.strip()
        ]

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
