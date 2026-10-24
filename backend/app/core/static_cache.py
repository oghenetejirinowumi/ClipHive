"""Static file serving that lets browsers keep media.

Without cache headers the editor preview re-downloaded every video on the timeline after each
edit (it reloads the composition). Files whose name is unique to one version (a timestamp suffix
like clip_3_s1_1792809602.mp4, or a random editor asset id) are never rewritten, so browsers may
keep them for a year. Anything else may be stored but is revalidated on each use: a cheap 304,
no re-download, and an overwritten file still shows up at once.
"""
from __future__ import annotations

import os
import re

from starlette.staticfiles import StaticFiles
from starlette.types import Scope

# clip_3_s1_1792809602.mp4, import_7_5_1792825833.mp4, studio_4_12_fill_1792820000.mp4
_STAMPED = re.compile(r"_\d{9,}\.[A-Za-z0-9]+$")
# storage/editor/<project>/assets/<random id>.<ext>
_EDITOR_ASSET = re.compile(r"[/\\]editor[/\\]\d+[/\\]assets[/\\][^/\\]+$")

IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "public, no-cache"


class CachedStaticFiles(StaticFiles):
    def __init__(self, *args, max_age: int | None = None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.max_age = max_age  # for folders of fixed assets (fonts, sound effects)

    def file_response(self, full_path, stat_result, scope: Scope, status_code: int = 200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        path = os.fspath(full_path)
        if _STAMPED.search(os.path.basename(path)) or _EDITOR_ASSET.search(path):
            response.headers["Cache-Control"] = IMMUTABLE
        elif self.max_age:
            response.headers["Cache-Control"] = f"public, max-age={self.max_age}"
        else:
            response.headers["Cache-Control"] = REVALIDATE
        return response
