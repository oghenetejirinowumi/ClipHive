from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


def database_url(url: str) -> str:
    """Hosted Postgres hands out postgres:// or postgresql:// URLs; use the psycopg 3 driver for both."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


DATABASE_URL = database_url(settings.database_url)
IS_SQLITE = DATABASE_URL.startswith("sqlite")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
    # Free hosted Postgres (Neon, Render) closes idle connections; test each one before use.
    pool_pre_ping=not IS_SQLITE,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Columns added to tables that already existed. create_all() never alters an existing table,
# so add any that are missing. {table: {column: DDL type + default}}
ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "clips": {
        "review_status": "VARCHAR(20) DEFAULT 'pending'",
        "starred": "BOOLEAN DEFAULT 0",
        "moment_features": "JSON",
        "context_json": "JSON DEFAULT '{}'",
        "description": "TEXT",
    },
    "streamers": {
        "last_checked_at": "DATETIME",
        "last_seen_video_id": "VARCHAR(255)",
        "last_seen_video_url": "VARCHAR(2048)",
        "last_seen_video_title": "VARCHAR(300)",
        "last_check_error": "VARCHAR(300)",
    },
    "posts": {"scheduled_for": "DATETIME", "caption_text": "TEXT", "schedule_reason": "VARCHAR(300)"},
    "import_jobs": {
        "agent_brief": "JSON",
        "layout": "VARCHAR(10) DEFAULT 'fill'",
        "clip_layouts": "JSON DEFAULT '{}'",
        "detail": "VARCHAR(255)",
    },
    "caption_styles": {"options_json": "JSON", "category": "VARCHAR(40)", "description": "VARCHAR(200)"},
    "trend_scores": {"source": "VARCHAR(32) DEFAULT 'youtube_data_api'"},
    "users": {"google_sub": "VARCHAR(255)", "name": "VARCHAR(255)", "avatar_url": "VARCHAR(1024)"},
}


def column_ddl(ddl: str, dialect: str) -> str:
    """The ADDED_COLUMNS types are written for SQLite; Postgres spells two of them differently."""
    if dialect != "postgresql":
        return ddl
    return ddl.replace("DATETIME", "TIMESTAMP").replace("BOOLEAN DEFAULT 0", "BOOLEAN DEFAULT FALSE").replace("BOOLEAN DEFAULT 1", "BOOLEAN DEFAULT TRUE")


def ensure_added_columns(bind=None) -> None:
    from sqlalchemy import inspect, text

    bind = bind or engine
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    with bind.begin() as conn:
        for table, columns in ADDED_COLUMNS.items():
            if table not in tables:
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name in existing:
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {column_ddl(ddl, conn.dialect.name)}"))
                if (table, name) == ("users", "google_sub"):
                    # One ClipHive account per Google account (NULLs, i.e. password users, don't clash).
                    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"))
                if (table, name) == ("clips", "review_status"):
                    # Clips made before the inbox existed are already in the Hub; don't flood the inbox.
                    conn.execute(text("UPDATE clips SET review_status = 'approved'"))


def init_db() -> None:
    import app.models  # noqa: F401  (registers all tables on Base.metadata)

    Base.metadata.create_all(bind=engine)
    ensure_added_columns()
