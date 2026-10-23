from __future__ import annotations

import argparse
import time

from app.config import settings
from app.db import SessionLocal, init_db
from app.services.trends.collection import refresh_tracked_videos, run_collection


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect real YouTube trend snapshots for a pre-demo sample."
    )
    parser.add_argument("--interval-seconds", type=int, default=180)
    parser.add_argument("--snapshots", type=int, default=3)
    args = parser.parse_args()
    if args.snapshots < 2 or args.snapshots > 3:
        parser.error("--snapshots must be 2 or 3")
    if args.interval_seconds < 60:
        parser.error("--interval-seconds must be at least 60")
    if not settings.youtube_api_key:
        raise SystemExit("YouTube not configured: add YOUTUBE_API_KEY")

    init_db()
    with SessionLocal() as db:
        first = run_collection(db)
        print(
            f"Discovery: {first['status']} (quota units: {first.get('quota_used', 0)})"
        )
        if first["status"] == "not_configured":
            raise SystemExit(first["detail"])
        for index in range(1, args.snapshots):
            print(
                f"Waiting {args.interval_seconds}s before snapshot {index + 1}/{args.snapshots}."
            )
            time.sleep(args.interval_seconds)
            result = refresh_tracked_videos(db)
            print(
                f"Refresh {index + 1}: {result['status']} (quota units: {result.get('quota_used', 0)})"
            )
            if result["status"] != "success":
                raise SystemExit(
                    "A refresh failed; inspect /api/trends/status before continuing."
                )


if __name__ == "__main__":
    main()
