# ClipHive

ClipHive turns livestream moments into captioned vertical clips. Trend Intelligence includes a fixture-tested YouTube adapter and manual TikTok CSV import. The YouTube collector is disabled by default pending explicit written approval for cross-channel aggregation and API-derived metrics; the usable default is manual-only.

## Run locally

Backend (Python 3.11+):

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Set a strong `JWT_SECRET`. `YOUTUBE_API_KEY` is optional; without it the app starts, AI-pack falls back offline, and the trends screen reports that YouTube is not configured. Add `OPENAI_API_KEY` only if you want model-written clip packaging. API keys stay in the backend environment.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000/trends. The app shell requires a signed-in session; the existing demo/auth configuration applies.

## Trends collection

Do not enable YouTube collection unless the team has explicit written approval for the specific derived-metrics use case. The current YouTube Developer Policies restrict aggregating API data across unrelated content owners and deriving velocity/engagement/trend scores. The guard `TRENDS_YOUTUBE_DERIVED_METRICS_APPROVED` defaults to `false`; adding a key alone does not cause requests. Until approval exists, use the authenticated manual TikTok CSV import, which records `source=manual_import` with null scores and metrics.

After approval is granted, set `YOUTUBE_API_KEY` and `TRENDS_YOUTUBE_DERIVED_METRICS_APPROVED=true`, then optionally configure `TRENDS_DEFAULT_REGIONS=NG,US`, `TRENDS_KEYWORDS`, and `TRENDS_MAX_VIDEOS_PER_RUN`. For background collection, set `TRENDS_SCHEDULER_ENABLED=true`. Discovery runs every six hours and stats refresh every hour. For an approved pre-demo sample, run:

```bash
cd backend
.venv/bin/python scripts/seed_trend_snapshots.py --snapshots 3 --interval-seconds 180
```

Or trigger one discovery run from the signed-in UI or `POST /api/trends/jobs/run`. Check `/api/trends/status` for the approval gate, provider configuration, latest job outcome, quota and errors. The seed script exits unless a key is configured and the policy gate is enabled.

## Per-clip hashtags and captions

In the studio, each clip has a **Hashtags & captions** button. It reads the clip's context (game, moment type, creator; transcribing first if needed), then uses yt-dlp to read matching YouTube Shorts: hashtag feeds like `youtube.com/hashtag/valorant/shorts` plus a keyword search. It ranks the hashtags those videos use by their views, drops feed spam that only mentions the topic in hashtags, and suggests captions based on how the top titles are written. You pick tags, edit the caption, and save it to the clip. Code: `backend/app/services/trends/social_search.py`, endpoint `GET /api/clips/{id}/social-trends?platform=tiktok|youtube&refresh=false`.

This scrapes public YouTube pages without an API key, which YouTube's terms don't permit. It's fine for a hackathon demo but not for production. Results are cached in memory for `TRENDS_CACHE_TTL_S` and saved on the clip. If YouTube shows a bot check, full-description lookups pause for 15 minutes and the listings alone are used; setting `YTDLP_COOKIES_FILE` helps. Hashtag data comes from YouTube Shorts and stands in for TikTok trends.

## Tests and frontend checks

```bash
cd backend
.venv/bin/python -m pytest
cd ../frontend
npm run lint
npm run typecheck
```

Tests use recorded provider response fixtures and an in-memory SQLite database; they make no network calls. Live API tests are not part of the default suite.

## Quota estimate and limitations

Conditional on approval, the default six keywords, two regions, 60-video cap and four discovery runs/day estimate 48 `search.list` calls/day (of the documented default 100-call search quota) and about 104 `videos.list` calls/day (of the documented 10,000 shared units/day). Each endpoint call costs one unit and video IDs are batched. This is a quota estimate only, not proof of approval or live usage; no paid service is used within the documented default allocation.

YouTube-derived trend scores are unavailable until written approval is received and the gate is enabled. If enabled, Shorts classification remains probabilistic because public API data does not reliably expose video orientation; likes/comments can be missing, and share counts are unavailable. TikTok Research API access is restricted; manual Creative Center observations are never presented as official API trends. Read [docs/TRENDS_RESEARCH.md](docs/TRENDS_RESEARCH.md) for source verification and scoring details.

SQLite plus `create_all` keeps this hackathon build additive. A production move to Postgres would add Alembic migrations, server-side locking/job execution and retention management for provider data; none is included here.

## Next steps

Out of scope for this hackathon: Postgres/Alembic, Redis/Celery, Docker, alerts, exports, saved trends, many-country support, separate trend roles, email, Twitch signals, and a permitted TikTok provider integration. Before production, add tested YouTube API data-retention cleanup, operational scheduling/locking, broader provider coverage where authorized, and score calibration against a representative labeled dataset.
