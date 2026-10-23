# Trend Intelligence Research

Verified against provider documentation on 2026-10-23. The YouTube API adapter is implemented for fixture testing but is disabled by default; no live YouTube collection was run. This implementation does not scrape pages or download videos.

## YouTube Data API v3

- **Policy gate:** The current YouTube Developer Policies (section III.E.2 and III.E.4.h, updated 2026-10-15) prohibit aggregating API Data across unrelated content owners and creating derived metrics from API Data, except for a specifically audited/approved analytics use case. Velocity, engagement, hashtag aggregates and scores fall into that restricted area. Therefore `TRENDS_YOUTUBE_DERIVED_METRICS_APPROVED` defaults to `false`; collection and scoring return `approval_required` and make no network requests until ClipHive's team confirms explicit written approval for this exact use case. This code flag is an operational guard, not approval or legal advice.

- **What it provides:** `search.list` discovers recent public videos by keyword, region, and `publishedAfter`; `videos.list` returns snippet fields (title, description, tags, channel, publish time), `contentDetails.duration`, and public statistics (views, likes, comments). Hashtags are extracted from the title, description, and API tags. Shares are not returned and are not inferred.
- **Auth:** API key, held server-side as `YOUTUBE_API_KEY`. Search uses `regionCode` for NG and US. The public resource does not expose reliable vertical/aspect-ratio metadata for other people's videos; `fileDetails` video streams are owner-only.
- **Quota/cost (conditional):** If the team obtains explicit approval and enables collection, the configured schedule estimates at most 48 `search.list` calls/day (12 per six-hour run across NG/US) and about 104 `videos.list` calls/day (up to 2 batched calls per region/hour plus discovery details). These are within the documented default limits of 100 search calls/day and 10,000 shared units/day. There is no expected usage fee within enabled quota, but the estimate is an operational plan, not a compliance approval or live measurement.
- **Shorts identification:** The API search filter `videoDuration=short` is broader than Shorts and is not proof. YouTube Help currently says eligible square or vertical videos uploaded from 2024-10-15 can be Shorts up to 3 minutes. The API does not provide a public vertical flag for arbitrary videos, so ClipHive assigns confidence from duration and an explicit `#Shorts` marker. It never claims certainty; only confidence >= 0.5 appears in the fastest-Shorts list.
- **Limitations:** Search results are a sample biased by configured keywords, regions, recent publication and API search ranking, not a complete trend census. Public stats are sampled snapshots; missing values and nonpositive intervals do not create velocity. Current default operation is manual-only. For an approved API deployment, stored non-authorized YouTube data and API-derived score history are pruned after 30 days on startup and collection refreshes. No live results or quota usage have been verified.

Official references:

- [Search: list](https://developers.google.com/youtube/data/reference/rest/v3/search/list)
- [Videos: list](https://developers.google.com/youtube/data/reference/rest/v3/videos/list)
- [Quota costs](https://developers.google.com/youtube/data/determine_quota_cost)
- [Shorts up to three minutes](https://support.google.com/youtube/answer/15424877?hl=en)
- [YouTube API Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

## TikTok

- **What it provides:** TikTok Research API can expose public content/account data, but it is a research tool, not an official trends feed. Creative Center exposes trend information through its product interface; the public developer product catalog reviewed here does not document a Creative Center trends API.
- **Auth/access:** Research client credentials and a bearer token require prior approval. TikTok eligibility is limited to qualifying independent/non-commercial research and eligible academic/nonprofit organizations and locations. ClipHive is a commercial creator tool, so the team must not assume it qualifies. The adapter therefore reports no capabilities and makes no calls.
- **Quota/cost/regions/Shorts:** Not applicable to this app without approval; available query fields, access scope and limits depend on approved Research Tools access. TikTok's Research API is not a public official-trends endpoint, and TikTok videos are not YouTube Shorts.
- **Manual alternative:** A signed-in teammate can manually copy hashtag observations into the CSV import from their Creative Center research. These records are stored with `source=manual_import`, appear as manual data, and have null metrics/score. No scraping is performed.

Official references:

- [Research API eligibility](https://developers.tiktok.com/products/research-api/)
- [Research API getting started](https://developers.tiktok.com/doc/research-api-get-started)
- [TikTok Creative Center](https://ads.tiktok.com/business/creativecenter/)
- [TikTok developer products](https://developers.tiktok.com/products/)

## Scoring and Interpretation

The fixture-tested scoring code uses valid consecutive snapshots, median hashtag aggregates, and percentile weights of 0.30 velocity, 0.20 acceleration, 0.20 usage growth, 0.15 engagement, and 0.15 recency. These are unvalidated starting hypotheses. **This scoring path must remain disabled unless YouTube explicitly approves the derived-metrics use case.** TikTok manual imports therefore have null scores and no invented stages or rates.

Title-pattern percentages (questions, POV/when openers, number/list language, all-caps ratio, title length) are descriptive observations from the fastest sampled videos, not claims that a title pattern causes performance. The prototype uses SQLite and `create_all` for additive tables; the existing `trends` compatibility table is left untouched, so no migration or deletion of the developer database is needed.
