from __future__ import annotations

import math
import re
import statistics
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Sequence

HASHTAG_PATTERN = re.compile(r"#([\w\u0080-\uffff\u0300-\u036f]+)", re.UNICODE)


@dataclass(frozen=True)
class ScoreWeights:
    velocity: float = 0.30
    acceleration: float = 0.20
    usage_growth: float = 0.20
    engagement: float = 0.15
    recency: float = 0.15


DEFAULT_WEIGHTS = ScoreWeights()


def normalize_hashtag(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().lstrip("#")
    normalized = re.sub(
        r"^[^\w\u0080-\uffff]+|[^\w\u0080-\uffff]+$", "", normalized, flags=re.UNICODE
    )
    return normalized.casefold()


def extract_hashtags(texts: Iterable[str]) -> list[tuple[str, str]]:
    found: dict[str, str] = {}
    for text in texts:
        for match in HASHTAG_PATTERN.finditer(text or ""):
            display = match.group(1).strip("_-")
            normalized = normalize_hashtag(display)
            if normalized:
                found.setdefault(normalized, display)
    return list(found.items())


def view_velocity(previous: object, current: object) -> float | None:
    previous_views = getattr(previous, "views", None)
    current_views = getattr(current, "views", None)
    previous_at = getattr(previous, "collected_at", None)
    current_at = getattr(current, "collected_at", None)
    if (
        previous_views is None
        or current_views is None
        or previous_at is None
        or current_at is None
    ):
        return None
    hours = (current_at - previous_at).total_seconds() / 3600
    if hours <= 0 or current_views < previous_views:
        return None
    return (current_views - previous_views) / hours


def engagement_rate(snapshot: object) -> tuple[float | None, list[str]]:
    views = getattr(snapshot, "views", None)
    if views is None or views <= 0:
        return None, []
    metrics: list[str] = []
    engagements = 0
    for metric in ("likes", "comments"):
        value = getattr(snapshot, metric, None)
        if value is not None:
            engagements += value
            metrics.append(metric)
    if not metrics:
        return None, []
    return engagements / views * 100, metrics


def view_acceleration(snapshots: Sequence[object]) -> float | None:
    if len(snapshots) < 3:
        return None
    previous_velocity = view_velocity(snapshots[-3], snapshots[-2])
    latest_velocity = view_velocity(snapshots[-2], snapshots[-1])
    if previous_velocity is None or latest_velocity is None:
        return None
    interval_hours = (
        snapshots[-1].collected_at - snapshots[-2].collected_at
    ).total_seconds() / 3600
    if interval_hours <= 0:
        return None
    return (latest_velocity - previous_velocity) / interval_hours


def percentile_normalize(values: Sequence[float | None]) -> list[float]:
    present = sorted(
        value for value in values if value is not None and math.isfinite(value)
    )
    if not present:
        return [0.0 for _ in values]
    result: list[float] = []
    for value in values:
        if value is None or not math.isfinite(value):
            result.append(0.0)
        elif len(present) == 1:
            result.append(1.0)
        else:
            rank = sum(candidate <= value for candidate in present) - 1
            result.append(rank / (len(present) - 1))
    return result


def classify_stage(
    sample_size: int,
    snapshots_per_video: Sequence[int],
    velocity: float | None,
    acceleration: float | None,
    usage_growth: float | None,
) -> str:
    if sample_size < 3 or not snapshots_per_video or max(snapshots_per_video) < 2:
        return "insufficient_data"
    if sample_size <= 5 and (usage_growth or 0) >= 30 and (velocity or 0) > 0:
        return "emerging"
    if (acceleration or 0) > 0 and (usage_growth or 0) > 0:
        return "accelerating"
    if sample_size >= 12 and (acceleration or 0) <= 0:
        return "peaking"
    if (velocity or 0) <= 0 and (usage_growth or 0) < 0:
        return "declining"
    return "established"


def score_sample_rows(
    rows: list[dict], weights: ScoreWeights = DEFAULT_WEIGHTS
) -> list[dict]:
    component_names = (
        "velocity",
        "acceleration",
        "usage_growth",
        "engagement",
        "recency",
    )
    normalized = {
        name: percentile_normalize([row.get(name) for row in rows])
        for name in component_names
    }
    result = []
    for index, row in enumerate(rows):
        score = 100 * sum(
            getattr(weights, name) * normalized[name][index] for name in component_names
        )
        updated = dict(row)
        updated["score"] = round(score, 2)
        velocity = row.get("velocity")
        growth = row.get("usage_growth")
        engagement = row.get("engagement")
        reasons = []
        if velocity is not None:
            reasons.append(
                f"Median velocity {velocity:,.0f} views/hr across {row['sample_size']} videos"
            )
        if growth is not None:
            direction = "up" if growth >= 0 else "down"
            reasons.append(
                f"Usage is {direction} {abs(growth):.0f}% versus the prior 24h"
            )
        if engagement is not None:
            reasons.append(f"Median likes and comments engagement is {engagement:.2f}%")
        updated["reasons"] = reasons[:3]
        result.append(updated)
    return result


def recency_score(
    published_at: datetime | None,
    now: datetime | None = None,
    half_life_days: float = 7.0,
) -> float | None:
    if published_at is None:
        return None
    reference = now or datetime.now(timezone.utc)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    age_days = max(0.0, (reference - published_at).total_seconds() / 86400)
    return math.exp(-math.log(2) * age_days / max(half_life_days, 0.01))


def median_or_none(values: Sequence[float | None]) -> float | None:
    present = [value for value in values if value is not None and math.isfinite(value)]
    return statistics.median(present) if present else None
