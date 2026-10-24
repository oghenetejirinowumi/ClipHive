from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
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
    "clips": {"review_status": "VARCHAR(20) DEFAULT 'pending'", "description": "TEXT"},
    "streamers": {
        "last_checked_at": "DATETIME",
        "last_seen_video_id": "VARCHAR(255)",
        "last_seen_video_url": "VARCHAR(2048)",
        "last_seen_video_title": "VARCHAR(300)",
        "last_check_error": "VARCHAR(300)",
    },
    "posts": {"scheduled_for": "DATETIME", "caption_text": "TEXT", "schedule_reason": "VARCHAR(300)"},
    "import_jobs": {"agent_brief": "JSON"},
    "users": {"google_sub": "VARCHAR(255)", "name": "VARCHAR(255)", "avatar_url": "VARCHAR(1024)"},
}


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
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
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
    if settings.database_url.startswith("sqlite"):
        with engine.connect() as conn:
            from sqlalchemy import text
            try:
                conn.execute(text("ALTER TABLE clips ADD COLUMN context_json JSON DEFAULT '{}'"))
                conn.commit()
            except Exception:
                pass
