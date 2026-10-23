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
    channel_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `streams`
```sql
CREATE TABLE streams (
    id INTEGER PRIMARY KEY,
    streamer_id INTEGER REFERENCES streamers(id) ON DELETE CASCADE,
    platform_stream_id VARCHAR(255),
    status VARCHAR(50) NOT NULL, -- 'live' | 'recording' | 'ended' | 'processed'
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
| `/api/auth/register` | `POST` | **C3** | User registration | `{"email", "password"}` | `{"token", "user"}` |
| `/api/auth/login` | `POST` | **C3** | User login | `{"email", "password"}` | `{"token", "user"}` |
| `/api/streamers` | `GET/POST`| **C1** | Manage monitored streamers | `{"platform", "channel_name"}` | `StreamerRead` |
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

---

## 4. Unblocking Fixtures

Nobody waits on other teammates to finish. The following fixtures are already checked in:
- **Raw Clip Fixture**: `tests/fixtures/sample_raw.mp4` (10s 1080×1920 portrait video)
- **Transcript Fixture**: `tests/fixtures/sample_transcript.json` (Word-level timestamps)
- **Google Fonts**: `backend/assets/fonts/` (*Bangers*, *Poppins*, *Luckiest Guy*)
- **Pre-rendered Golden Demo Clips**: `storage/clips/clip_1_punch.mp4`, `clip_1_clean.mp4`, `clip_1_neon.mp4`
