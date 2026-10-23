"""What kind of moment a user likes, learned from the clips they star.

Every auto-picked clip stores the shape of its moment (detector.FEATURES, standardised within
its own video). A user's taste is the direction from the average clip they were given to the
average clip they starred: if they keep starring slow build-ups over single loud spikes, the
"build" axis grows and later picks lean that way. Confidence ramps up over the first few stars,
so one star nudges and a handful steer.
"""
from __future__ import annotations

import numpy as np
from sqlalchemy.orm import Session

from app.models import Clip
from app.services.clip.detector import FEATURES

FULL_CONFIDENCE_STARS = 5


def _vectors(rows: list[list[float] | None]) -> np.ndarray:
    good = [r for r in rows if r and len(r) == len(FEATURES)]
    return np.array(good, dtype=float) if good else np.zeros((0, len(FEATURES)))


def user_taste(db: Session, user_id: int) -> np.ndarray | None:
    """Unit taste direction scaled by confidence (0-1), or None until the user has starred."""
    rows = db.query(Clip.moment_features, Clip.starred).filter(Clip.user_id == user_id, Clip.moment_features.isnot(None)).all()
    starred = _vectors([f for f, s in rows if s])
    if len(starred) == 0:
        return None
    direction = starred.mean(axis=0) - _vectors([f for f, _ in rows]).mean(axis=0)
    norm = float(np.linalg.norm(direction))
    if norm < 0.05:  # stars look like everything else: nothing to lean toward yet
        return None
    confidence = min(1.0, len(starred) / FULL_CONFIDENCE_STARS)
    return direction / norm * confidence


def starred_count(db: Session, user_id: int) -> int:
    return db.query(Clip).filter(Clip.user_id == user_id, Clip.starred.is_(True)).count()
