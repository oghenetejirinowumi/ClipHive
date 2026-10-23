"""Shared Groq client. Groq speaks the OpenAI API, so we reuse the openai SDK."""
from __future__ import annotations

from app.config import settings

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def groq_configured() -> bool:
    return bool(settings.groq_api_key)


def groq_client(timeout_s: float = 60.0):
    """An OpenAI-SDK client pointed at Groq, or None when no key is set."""
    if not groq_configured():
        return None
    import openai

    return openai.OpenAI(
        api_key=settings.groq_api_key,
        base_url=GROQ_BASE_URL,
        timeout=timeout_s,
        max_retries=2,
    )
