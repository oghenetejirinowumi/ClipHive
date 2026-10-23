from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db import get_db
from app.models import User

bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    """Protect a route: `def route(user: CurrentUser): ...`. 401 if the token is missing or bad."""
    user_id = decode_access_token(credentials.credentials) if credentials else None
    user = db.get(User, user_id) if user_id is not None else None
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not signed in, or your session has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_owner(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    """Signed-in user when the token is valid, otherwise the demo user (first in the DB).

    Matches the C2 routes, which aren't auth-gated yet, so mock-auth frontends still work.
    Switch a route to CurrentUser once everything sends real tokens.
    """
    user_id = decode_access_token(credentials.credentials) if credentials else None
    user = db.get(User, user_id) if user_id is not None else None
    user = user or db.query(User).order_by(User.id).first()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Create an account first.")
    return user


Owner = Annotated[User, Depends(get_owner)]
