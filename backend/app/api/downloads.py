"""Instagram downloader: paste a public post/reel link, get the full video back as an MP4."""
from __future__ import annotations

import json
import re
import uuid

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.api.deps import Owner
from app.core.media import public_path, storage_root
from app.schemas.import_job import DownloadRead, InstagramDownloadRequest
from app.services.ingest.downloader import IngestError, download
from app.services.ingest.sources import is_instagram, normalise

router = APIRouter(prefix="/downloads", tags=["downloads"])

MAX_BYTES = 500 * 1024 * 1024
_ID = re.compile(r"^[0-9a-f]{32}$")


def _safe_name(title: str) -> str:
    cleaned = re.sub(r"[^\w\- ]+", "", title).strip()[:80]
    return (cleaned or "instagram-video").replace(" ", "_") + ".mp4"


@router.post("/instagram", response_model=DownloadRead)
def download_instagram(body: InstagramDownloadRequest, _: Owner) -> DownloadRead:
    url = normalise(body.url)
    if not is_instagram(url):
        raise HTTPException(422, "Paste an Instagram post or reel link (instagram.com/...).")

    download_id = uuid.uuid4().hex
    out_dir = storage_root() / "downloads" / download_id
    try:
        path, info = download(url, out_dir, max_bytes=MAX_BYTES)
    except IngestError as err:
        raise HTTPException(422, str(err)) from err

    title = (info.get("title") or info.get("description") or "Instagram video").strip().splitlines()[0][:120]
    meta = {"title": title, "uploader": info.get("uploader") or info.get("channel"), "duration_s": info.get("duration"), "file": path.name}
    (out_dir / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return DownloadRead(
        id=download_id,
        title=title,
        uploader=meta["uploader"],
        duration_s=meta["duration_s"],
        size_bytes=path.stat().st_size,
        preview_path=public_path(path),
        download_url=f"/api/downloads/{download_id}/file",
    )


@router.get("/{download_id}/file")
def download_file(download_id: str) -> FileResponse:
    """Serves the file with Content-Disposition: attachment, so browsers save it instead of playing it."""
    if not _ID.match(download_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Download not found.")
    folder = storage_root() / "downloads" / download_id
    try:
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        path = folder / meta["file"]
    except (OSError, KeyError, ValueError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Download not found or expired.") from None
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Download not found or expired.")
    return FileResponse(path, media_type="video/mp4", filename=_safe_name(meta.get("title", "")))
