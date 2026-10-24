from unittest.mock import patch

from app.models.enums import SourcePlatform
from app.services.ingest import avatars

PIC = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png"


class _Resp:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self):
        pass


def _og(page: str) -> str | None:
    with patch.object(avatars.requests, "get", return_value=_Resp(page)):
        return avatars._og_image("https://www.twitch.tv/someone")


def test_og_image_either_attribute_order():
    assert _og(f'<meta property="og:image" content="{PIC}">') == PIC
    assert _og(f'<meta content="{PIC}" property="og:image"/>') == PIC


def test_og_image_missing():
    assert _og('<meta property="og:title" content="x">') is None


def test_only_platform_image_hosts_allowed():
    assert avatars._allowed(SourcePlatform.TWITCH, PIC) == PIC
    assert avatars._allowed(SourcePlatform.TWITCH, "https://evil.example/pic.png") is None
    assert avatars._allowed(SourcePlatform.TWITCH, PIC.replace("https", "http")) is None
