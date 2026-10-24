from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.config import settings
from app.core import google_auth
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User
from app.schemas import Token, UserCreate, UserLogin, UserRead
from app.schemas.user import AuthConfig, GoogleLogin

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_for(user: User) -> Token:
    return Token(access_token=create_access_token(user.id), user=UserRead.model_validate(user))


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(body: UserCreate, db: DbSession) -> Token:
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists. Try signing in.")
    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_for(user)


@router.post("/login", response_model=Token)
def login(body: UserLogin, db: DbSession) -> Token:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    # Same message for unknown email and wrong password, so emails can't be probed.
    if user is None or not verify_password(body.password, user.password_hash):
        hint = " If you signed up with Google, use Continue with Google." if google_auth.enabled() else ""
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password." + hint)
    return _token_for(user)


@router.get("/config", response_model=AuthConfig)
def auth_config() -> AuthConfig:
    """Which sign-in methods this server offers (the Google client ID is public by design)."""
    return AuthConfig(google_client_id=settings.google_client_id or None)


@router.post("/google", response_model=Token)
def google_login(body: GoogleLogin, db: DbSession) -> Token:
    """Sign in or sign up with Google. Matches the Google account first, then links an existing
    ClipHive account with the same (Google-verified) email, otherwise creates one."""
    try:
        identity = google_auth.verify(body.credential)
    except google_auth.GoogleAuthError as err:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(err)) from err

    user = db.scalar(select(User).where(User.google_sub == identity.sub))
    if user is None:
        user = db.scalar(select(User).where(User.email == identity.email))
        if user is None:
            user = User(email=identity.email, password_hash="")
            db.add(user)
        elif user.google_sub and user.google_sub != identity.sub:
            raise HTTPException(status.HTTP_409_CONFLICT, "That email is already linked to a different Google account.")
        user.google_sub = identity.sub
    user.name = identity.name or user.name
    user.avatar_url = identity.picture or user.avatar_url
    db.commit()
    db.refresh(user)
    return _token_for(user)


@router.get("/me", response_model=UserRead)
def me(user: CurrentUser) -> User:
    return user
