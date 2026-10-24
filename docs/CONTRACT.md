# ClipHive — Shared Team Contract & Source of Truth

> **Rule 0**: Everyone codes against this contract. No teammate waits on another. Every domain ships a fixture before it ships a feature.

---

## 1. Team Division & Ownership Boundaries

| Role | Domain | Deliverable | Hard Boundary (Never Touches) |
| :--- | :--- | :--- | :--- |
| **🟦 C1 — The Clip Factory** | Stream monitoring, `streamlink`/`yt-dlp` recording, highlight scoring, FFmpeg cut + 9:16 crop | Records/pulls VOD $\rightarrow$ writes `clips` row with `raw_file_path` and `status='processing'` | Captions, auth, posting |
| **🟪 C2 — Caption & Trend Studio** | `faster-whisper` word timestamps, ASS styling, AI proofreading & virality, trends engine, style editor UI | Takes raw clip $\rightarrow$ burns animated subtitles to `file_path`, generates title & hashtags, sets `status='ready'` | Ingestion, auth, posting |
| **🟩 C3 — Identity & Shell** | Auth backend + JWT, design system tokens (`theme.ts`), primitives (`Panel`, `Button`, `Badge`), app shell | Register $\rightarrow$ login $\rightarrow$ protected dashboard shell | The clip pipeline |
| **🟨 C4 — Distribution Hub** | Ready-clip hub grid, video preview, manual download, Postiz / social media auto-posting | Reads `status='ready'` clips $\rightarrow$ download MP4 or auto-post to TikTok/YouTube | Recording, captions, auth |

---

## 2. Shared Database Schema

### `users`
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email VARCHAR(320) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `streamers`
```sql
CREATE TABLE streamers (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL, -- 'twitch' | 'kick' | 'youtube'
    username VARCHAR(100) NOT NULL,      -- case-insensitive; pasted channel links are reduced to the name
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `streams`
```sql
CREATE TABLE streams (
    id INTEGER PRIMARY KEY,
    streamer_id INTEGER REFERENCES streamers(id) ON DELETE CASCADE,
    platform_stream_id VARCHAR(255),     -- the platform's broadcast id (one row per recorded broadcast)
    recording_path VARCHAR(1024),        -- folder of gapless .ts segments (deleted after cutting unless KEEP_RECORDINGS)
    status VARCHAR(50) NOT NULL, -- 'recording' -> 'ended' (segment saved) -> 'processed' (clips cut) | 'failed'
    started_at TIMESTAMP,
    ended_at TIMESTAMP
);
```

### `clips` (The Primary Handoff Table)
```sql
CREATE TABLE clips (
    id INTEGER PRIMARY KEY,
    stream_id INTEGER REFERENCES streams(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    start_s FLOAT NOT NULL,
    end_s FLOAT NOT NULL,
    raw_file_path VARCHAR(1024),         -- Written by C1 (cut + 9:16, uncaptioned)
    file_path VARCHAR(1024),             -- Written by C2 (final burned MP4 deliverable)
    transcript_json JSON,                -- Written by C2 ([{"word", "start", "end", "confidence"}])
    caption_style_id INTEGER REFERENCES caption_styles(id) ON DELETE SET NULL,
    caption_mode VARCHAR(50) DEFAULT 'burned', -- 'burned' | 'platform_native'
    highlight_score FLOAT,               -- Written by C1 (detection) or C2 (hook score)
    title VARCHAR(255),                  -- Written by C2 (AI Viral Studio)
    hashtags JSON DEFAULT '[]',          -- Written by C2 (Trends Studio)
    status VARCHAR(50) NOT NULL,         -- 'processing' (C1) -> 'captioning' (C2) -> 'ready' (C4) -> 'failed'
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `caption_styles`
```sql
CREATE TABLE caption_styles (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, -- NULL = global preset
    name VARCHAR(100) NOT NULL,
    font_file VARCHAR(1024),
    font_name VARCHAR(100) NOT NULL,
    font_size INTEGER DEFAULT 72,
    colors_json JSON DEFAULT '{}',       -- {"primary", "outline", "highlight", "back"} in ASS BGR format
    animation_type VARCHAR(50) DEFAULT 'word_pop', -- 'word_pop' | 'karaoke' | 'line'
    uppercase BOOLEAN DEFAULT FALSE,
    is_preset BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `trends`
```sql
CREATE TABLE trends (
    id INTEGER PRIMARY KEY,
    platform VARCHAR(50) NOT NULL,      -- 'tiktok' | 'youtube' | 'instagram' | 'x'
    topic VARCHAR(255),
    hashtag VARCHAR(255) NOT NULL,
    score FLOAT DEFAULT 0.0,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `import_jobs`
```sql
CREATE TABLE import_jobs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL,        -- 'twitch' | 'kick' | 'youtube' | 'upload'
    url VARCHAR(2048),
    original_filename VARCHAR(255),
    title VARCHAR(255),
    duration_s FLOAT,
    thumbnail_path VARCHAR(1024),       -- public "storage/..." path
    clip_count INTEGER DEFAULT 5,       -- requested
    clip_seconds INTEGER DEFAULT 30,
    layout VARCHAR(10) DEFAULT 'fill', -- 'fill' | 'blur' for auto-cut clips
    clip_layouts JSON,                  -- {clip_id: layout} for every clip cut from this source
    clip_ids JSON DEFAULT '[]',         -- clips rows written (status='processing', ready for C2)
    status VARCHAR(50) NOT NULL,        -- 'queued' | 'downloading' | 'analyzing' | 'cutting' | 'done' | 'failed'
    progress INTEGER DEFAULT 0,         -- 0-100
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP
);
```
Live recordings take the same path: the stream monitor (`app/workers/ingest_worker.py`) polls active streamers every `LIVE_POLL_INTERVAL_S` and records each live broadcast start to finish (until it ends, the user stops it, or `MAX_STREAM_HOURS`), split into gapless `SEGMENT_MINUTES` segments. Each segment is cut as soon as it completes into `SEGMENT_CLIP_COUNT` clips with `stream_id` set and `start_s`/`end_s` in broadcast time, so clips arrive while the stream is live.

Imports analyse the whole video by default (`MAX_IMPORT_MINUTES=0`), up to 30 clips per import.

Each import writes its clips as normal `clips` rows (`raw_file_path` = the 9:16 cut, `file_path` = the same file until C2 burns captions, `status='processing'`).

### `editor_projects` (Video editor)
```sql
CREATE TABLE editor_projects (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    timeline JSON NOT NULL,              -- the edit (schema: backend/app/schemas/editor.py Timeline)
    revision INTEGER DEFAULT 1,          -- bumps on every save; PATCH with a stale revision gets 409
    chat JSON DEFAULT '[]',              -- AI chat: [{"role", "content", "changes", "at"}]
    media JSON DEFAULT '[]',             -- every "storage/..." file ever added (saves may only use these)
    render_status VARCHAR(20) DEFAULT 'idle', -- 'idle' | 'rendering' | 'done' | 'failed'
    render_progress INTEGER DEFAULT 0,
    render_error TEXT,
    render_path VARCHAR(1024),           -- public "storage/..." path of the last export
    export_clip_id INTEGER REFERENCES clips(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);
```
The timeline compiles to a HyperFrames composition (`services/editor/compose.py`), used both for the browser preview (`<hyperframes-player srcdoc>`) and for export (`hyperframes render`). An export becomes a `clips` row with `status='ready'`, so it shows up in the Hub.

### `posts`
```sql
CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    clip_id INTEGER REFERENCES clips(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,      -- 'tiktok' | 'youtube' | 'instagram' | 'x'
    status VARCHAR(50) NOT NULL,        -- 'queued' | 'posting' | 'posted' | 'failed'
    platform_post_id VARCHAR(255),
    posted_at TIMESTAMP,
    error TEXT
);
```

---

## 3. Shared API Contract

| Route | Method | Owner | Purpose | Request Body / Query | Response |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/register` | `POST` | **C3** | User registration | `{"email", "password"}` | `{"access_token", "token_type", "user"}` |
| `/api/auth/login` | `POST` | **C3** | User login | `{"email", "password"}` | `{"access_token", "token_type", "user"}` |
| `/api/auth/me` | `GET` | **C3** | Current user (send `Authorization: Bearer <token>`) | — | `UserRead` |
| `/api/streamers` | `GET/POST`| **C1** | List / add monitored streamers (includes live status) | `{"platform", "username"}` | `StreamerRead` (+ `is_live`, `live_title`, `recording`, `last_checked_at`, `check_error`, `channel_url`) |
| `/api/streamers/{id}` | `PATCH/DELETE` | **C1** | Pause/resume or remove a channel | `{"is_active"}` | `StreamerRead` / 204 |
| `/api/streamers/{id}/check` | `POST` | **C1** | Check live status now | — | `StreamerRead` |
| `/api/streamers/{id}/record` | `POST` | **C1** | Start recording the live broadcast now (409 if offline or already recording) | — | `StreamRead` (202) |
| `/api/streamers/{id}/stop` | `POST` | **C1** | Stop recording; what was recorded is still clipped (409 if not recording) | — | `StreamerRead` |
| `/api/streamers/{id}/latest-vod` | `POST` | **C1** | Find the latest past broadcast → import job | `{"clip_count", "clip_seconds"}` | `ImportRead` (202) |
| `/api/streamers/{id}/streams` | `GET` | **C1** | Recorded broadcasts, newest first | — | `list[StreamRead]` (+ `clip_ids`) |
| `/api/clips` | `GET` | **C2/C4** | List clips (filter by `?status=ready`) | Query: `?status=ready` | `list[ClipRead]` |
| `/api/clips/{id}` | `GET` | **C2** | Fetch single clip details | — | `ClipRead` |
| `/api/clips/{id}/caption` | `POST` | **C2** | Burn captions on clip | `{"style_id", "caption_mode"}` | `ClipRead` |
| `/api/clips/{id}/regenerate-captions` | `POST` | **C2** | Switch style & re-burn | `{"style_id", "caption_mode"}` | `ClipRead` |
| `/api/clips/{id}/ai-pack` | `POST` | **C2** | Generate AI title & hashtags | — | `ClipRead` |
| `/api/styles` | `GET/POST`| **C2** | List / create caption styles | `CaptionStyleCreate` | `list[CaptionStyleRead]` |
| `/api/styles/upload-font` | `POST` | **C2** | Upload custom `.ttf`/`.otf` font | `multipart/form-data (file)` | `{"font_name", "font_file"}` |
| `/api/trends` | `GET` | **C2** | Top 10 hashtags (TikTok/YouTube) | Query: `?platform=tiktok` | `list[TrendRead]` |
| `/api/trends/apply` | `POST` | **C2** | Inject hashtags into clip | `{"clip_id", "hashtags"}` | `ClipRead` |
| `/api/hub/clips` | `GET` | **C4** | Grid of ready clips for hub | Query: `?page=1` | `PaginatedClips` |
| `/api/hub/clips/{id}/post` | `POST` | **C4** | Auto-post clip to platforms | `{"platforms": ["tiktok", "youtube"]}` | `PostStatus` |
| `/api/hub/clips/{id}/download` | `GET` | **C4** | Direct MP4 stream/download | — | Binary MP4 file |
| `/api/imports/link` | `POST` | **C1** | Paste a Twitch / Kick / YouTube link → several clips (async) | `{"url", "clip_count": 1-30, "clip_seconds": 10-90, "layout": "fill"\|"blur"}` | `ImportRead` (202) |
| `/api/imports/upload` | `POST` | **C1** | Upload a video (camera roll) → several clips (async) | `multipart/form-data (file, clip_count, clip_seconds, layout)` | `ImportRead` (202) |
| `/api/imports` | `GET` | **C1** | Your import projects, newest first (poll while active) | — | `list[ImportRead]` |
| `/api/imports/{id}` | `GET` | **C1** | One import's status / progress / clip_ids | — | `ImportRead` |
| `/api/editor/projects` | `GET/POST` | **Editor** | List / create edits (optionally from a clip or an import) | `{"title", "aspect", "clip_id"?, "import_id"?}` | `ProjectRead` (201) |
| `/api/editor/projects/{id}` | `GET/PATCH/DELETE` | **Editor** | Load / save the timeline (send `revision`) / delete | `{"timeline"?, "title"?, "revision"?}` | `ProjectRead` |
| `/api/editor/projects/{id}/assets` | `POST` | **Editor** | Upload a video, image or audio file | `multipart/form-data (file, place)` | `ProjectRead` (201) |
| `/api/editor/projects/{id}/assets/library` | `POST` | **Editor** | Bring in one of your clips or an import's full video | `{"clip_id"? , "import_id"?, "place"}` | `ProjectRead` (201) |
| `/api/editor/projects/{id}/composition` | `GET` | **Editor** | Compiled HyperFrames HTML for the preview | — | `{"revision", "html"}` |
| `/api/editor/projects/{id}/chat` | `POST` | **Editor** | AI edits the timeline (one revision per reply) | `{"message", "playhead", "selected_id"?}` | `{"reply", "changes", "project"}` |
| `/api/editor/projects/{id}/render` | `POST` | **Editor** | Export to MP4 in the background → Hub clip | — | `ProjectRead` (202) |
| `/api/downloads/instagram` | `POST` | **C1** | Fetch a public Instagram post/reel as MP4 | `{"url"}` | `DownloadRead` |
| `/api/downloads/{id}/file` | `GET` | **C1** | The fetched file, as an attachment | — | Binary MP4 file |
| `/api/studio/imports/{id}` | `GET` | **C1** | Open a project in the Clipping Studio: source video, energy curve, suggested moments, its clips | — | `StudioProject` |
| `/api/studio/imports/{id}/clips` | `POST` | **C1** | Cut a hand-picked range as a clip | `{"start_s", "end_s", "layout"}` | `StudioClip` (201) |
| `/api/studio/clips/{id}/layout` | `POST` | **C1** | Re-cut a clip in the other layout (drops burned captions) | `{"layout": "fill"\|"blur"}` | `StudioClip` |
| `/api/studio/clips/{id}/remove-captions` | `POST` | **C1** | Serve the clean cut again (caption_mode=platform_native, status=ready) | — | `StudioClip` |
| `/api/studio/clips/{id}/project` | `GET` | **C1** | Which project a clip came from (Hub → Studio link) | — | `{"job_id"}` |

**Layouts** (`backend/app/services/clip/cutter.py`): `fill` crops/zooms to cover 9:16; `blur` keeps the whole frame centred over a blurred copy of itself. Burning captions on a studio clip still goes through C2's `POST /api/clips/{id}/caption`.

---

## 4. Unblocking Fixtures

Nobody waits on other teammates to finish. The following fixtures are already checked in:
- **Raw Clip Fixture**: `tests/fixtures/sample_raw.mp4` (10s 1080×1920 portrait video)
- **Transcript Fixture**: `tests/fixtures/sample_transcript.json` (Word-level timestamps)
- **Google Fonts**: `backend/assets/fonts/` (*Bangers*, *Poppins*, *Luckiest Guy*)
- **Pre-rendered Golden Demo Clips**: `storage/clips/clip_1_punch.mp4`, `clip_1_clean.mp4`, `clip_1_neon.mp4`
