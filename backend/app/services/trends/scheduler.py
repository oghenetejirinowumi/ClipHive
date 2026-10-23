from __future__ import annotations

import asyncio
import logging
import time

from app.config import settings
from app.db import SessionLocal
from app.services.trends.collection import (
    RUN_LOCK,
    refresh_tracked_videos,
    run_collection,
)

logger = logging.getLogger(__name__)


def _run_job(discovery: bool) -> None:
    if not RUN_LOCK.acquire(blocking=False):
        logger.info("Trend scheduler skipped overlapping run")
        return
    try:
        with SessionLocal() as db:
            result = run_collection(db) if discovery else refresh_tracked_videos(db)
            logger.info("Trend scheduler completed: %s", result.get("status"))
    except Exception:
        logger.exception("Trend scheduler run failed")
    finally:
        RUN_LOCK.release()


async def trend_scheduler() -> None:
    next_discovery = time.monotonic() + 6 * 60 * 60
    next_refresh = time.monotonic() + 60 * 60
    while True:
        now = time.monotonic()
        if now >= next_discovery:
            await asyncio.to_thread(_run_job, True)
            next_discovery = time.monotonic() + 6 * 60 * 60
        elif now >= next_refresh:
            await asyncio.to_thread(_run_job, False)
            next_refresh = time.monotonic() + 60 * 60
        await asyncio.sleep(min(60, max(1, next_refresh - time.monotonic())))


def scheduler_status() -> dict:
    if not settings.trends_scheduler_enabled:
        return {
            "enabled": False,
            "next_discovery_in_seconds": None,
            "next_stats_refresh_in_seconds": None,
        }
    return {
        "enabled": True,
        "cadence": {"discovery_hours": 6, "stats_refresh_hours": 1},
    }
