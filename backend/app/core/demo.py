"""The one-click demo account used by the login page's "Instant Demo Access" button.

Turn it off for anything public with DEMO_LOGIN_ENABLED=false: the credentials are printed in
the frontend on purpose.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import hash_password, verify_password
from app.models import User

DEMO_EMAIL = "demo@cliphive.dev"
DEMO_PASSWORD = "demo123456"
# Older seeds used a reserved .local address, which email validation rejects at login.
LEGACY_EMAILS = ("demo@cliphive.local",)


def ensure_demo_account(db: Session) -> None:
    """Make sure the demo user exists with a usable password (renaming the legacy seed in place
    so it keeps its clips)."""
    user = db.query(User).filter(User.email == DEMO_EMAIL).first()
    if not settings.demo_login_enabled:
        # The demo password is public (it's in this file), so on a public server lock any
        # existing demo account: it keeps its data but can't be signed into with that password.
        if user is not None and verify_password(DEMO_PASSWORD, user.password_hash):
            user.password_hash = ""
            db.commit()
        return
    if user is None:
        user = db.query(User).filter(User.email.in_(LEGACY_EMAILS)).first()
        if user is not None:
            user.email = DEMO_EMAIL
    if user is None:
        user = User(email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD))
        db.add(user)
    elif not verify_password(DEMO_PASSWORD, user.password_hash):
        user.password_hash = hash_password(DEMO_PASSWORD)
    db.commit()
