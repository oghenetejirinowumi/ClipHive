import base64
import hashlib
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import settings


def _prehash(password: str) -> bytes:
    # bcrypt only reads 72 bytes (and bcrypt>=5 rejects longer input); passwords may be
    # up to 128 chars, so hash to a fixed 44-byte value first.
    return base64.b64encode(hashlib.sha256(password.encode()).digest())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode())
    except ValueError:  # malformed hash in the DB
        return False


def create_access_token(user_id: int) -> str:
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(minutes=settings.access_token_expire_minutes)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int | None:
    """User id from a valid token, or None if it's invalid or expired."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
