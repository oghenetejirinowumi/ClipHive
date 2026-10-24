"""Verify "Sign in with Google" ID tokens.

The browser gets a signed ID token (a JWT) from Google Identity Services and posts it to
POST /api/auth/google. Never trust its contents unverified: google-auth checks Google's RS256
signature against Google's published keys, the audience (our client ID, so tokens minted for
another app are rejected), the issuer and the expiry.
"""
from __future__ import annotations

from dataclasses import dataclass

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.config import settings

_transport = google_requests.Request()  # reused: keeps one HTTP session for Google's key fetches


class GoogleAuthError(ValueError):
    """The token is invalid, expired, for another app, or its email isn't verified."""


@dataclass
class GoogleIdentity:
    sub: str  # Google's stable account id: the real key, emails can change
    email: str
    name: str | None
    picture: str | None


def enabled() -> bool:
    return bool(settings.google_client_id)


def verify(credential: str) -> GoogleIdentity:
    if not enabled():
        raise GoogleAuthError("Google sign-in isn't set up on this server.")
    try:
        claims = id_token.verify_oauth2_token(credential, _transport, audience=settings.google_client_id, clock_skew_in_seconds=10)
    except ValueError as err:  # bad signature, wrong audience/issuer, expired, malformed
        raise GoogleAuthError("Google sign-in failed. Please try again.") from err
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise GoogleAuthError("Google sign-in failed. Please try again.")
    if not claims.get("email") or not claims.get("email_verified"):
        raise GoogleAuthError("Your Google account's email isn't verified, so it can't be used to sign in.")
    return GoogleIdentity(sub=str(claims["sub"]), email=str(claims["email"]).lower(), name=claims.get("name"), picture=claims.get("picture"))
