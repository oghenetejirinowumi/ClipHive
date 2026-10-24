from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel


# POST /auth/register
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


# POST /auth/login
class UserLogin(BaseModel):
    email: EmailStr
    password: str


# POST /auth/google: the ID token ("credential") from Google Identity Services
class GoogleLogin(BaseModel):
    credential: str = Field(min_length=20, max_length=8192)


class UserRead(ORMModel):
    id: int
    email: EmailStr
    name: str | None = None
    avatar_url: str | None = None
    created_at: datetime


class AuthConfig(BaseModel):
    google_client_id: str | None  # None: Google sign-in is off


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead
