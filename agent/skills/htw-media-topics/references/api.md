# Topics API (v2)

Base: `https://htwmedia.dpdns.org` (override with `API_BASE`).
Auth: header `AuthKey`. Envelope: `{ ok, data, errCode, errMsg, taskId }`.

The MVC stack uses `AddNewtonsoftJson` with `DefaultContractResolver`, so
POCO/DTO fields are **PascalCase** (`TopicCardDto.Title`, `EvidenceDto.RefTitle`).
Only hand-written anonymous projections are lowercase — in this area that means
`date` / `cards`, and the snake_case keys of `profile`, `health`, and
`outcome/stats` (`include_keywords`, `consecutive_failures`, `hit_rate`, …).
Bind request bodies as camelCase; ASP.NET binding is case-insensitive.

## GET /api/v2/topics/daily

Query: `count` (1..20, default 6)

```jsonc
{
  "date": "2026-09-23",
  "cards": [{
    "Id": "...", "Title": "...", "Hook": "...", "Category": "...",
    "Tags": ["weibo", "上升期"], "Score": 91,
    "Evidence": { "Type": "hot", "RefUrl": "", "RefTitle": "...", "MetricLabel": "热度", "MetricValue": "57.1万" },
    "niche_fit": 82, "niche_reason": "...", "niche_is_inferred": false,
    "Signals": { "evidence": 0.9, "momentum": 0.8, "heat": 0.7, "niche": 0.5, "has_profile": true }
  }],
  "profile_set": true, "profile_inferred": false, "profile_platforms": ["douyin"]
}
```

`Id` is the `topicId` for the outcome endpoints.

## GET /api/v2/topics/trends

Query: `category` (source filter, empty = all), `count` (1..100, default 60)

Returns `topics[]` (PascalCase `TrendRecord`) plus freshness:
`sampled_at`, `stale_minutes`, `stale`, `degraded`.
Stage ∈ `rising` / `plateau` / `fading` / `unknown`.

## GET /api/v2/topics/health

```jsonc
{
  "sources": [{
    "source": "xiaohongshu", "ok": false, "consecutive_failures": 11,
    "total_success": 0, "total_failure": 11,
    "last_success": "", "last_failure": "2026-09-23 14:31",
    "last_error": "HTTP 406 NotAcceptable", "skip_until": "...", "cooling_down": true
  }],
  "sampled_at": "...", "stale_minutes": 0, "stale": false, "degraded": false
}
```

`HTTP 406` from a source means signature/risk control rejection, not a missing
cookie — replacing the cookie does not fix it.

## Radar accounts

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/v2/topics/radar/accounts` | — |
| POST | `/api/v2/topics/radar/accounts` | `{ platform, url }` |
| DELETE | `/api/v2/topics/radar/accounts/{id}` | — |
| POST | `/api/v2/topics/radar/sample` | `{}` |
| GET | `/api/v2/topics/radar/alerts` | — |
| POST | `/api/v2/topics/radar/alerts/{id}/dismiss` | `{}` |

Account health: `ok` / `waiting` / `nodata` / `stale`. Max 3 accounts.

## Profile

`GET /api/v2/topics/profile`

```jsonc
{
  "platforms": [], "include_keywords": [], "exclude_keywords": [], "audience": "",
  "has_profile": false, "effective_inferred": false,
  "inferred_platforms": [], "available_platforms": ["bilibili","douyin","xiaohongshu","weibo","toutiao"]
}
```

`PUT /api/v2/topics/profile` — same four lists/string; platforms are whitelisted
server-side, keywords capped at 30 items × 30 chars.

## Outcome loop

| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/v2/topics/outcome/adopt` | `{ topicId, title, evidenceType, source, score, nicheFit, signals }` |
| POST | `/api/v2/topics/outcome/publish` | `{ topicId, platform, url }` |
| POST | `/api/v2/topics/outcome/metrics` | `{ topicId, views, likes, comments }` |
| GET | `/api/v2/topics/outcome/stats` | — |

`publish` / `metrics` fail with `4002` if the topic was never adopted.

`GET .../outcome/stats` returns `adopted`, `published`, `measured`, `hits`,
`adoption_rate`, `hit_rate`, `baseline_views`, `baseline_ready`,
`current_weights{evidence,momentum,heat,niche}`,
`tuning{applied,reason,weights,notes[]}`, and `rows[]` where each row has
`topic_id`, `title`, `stage` (`adopted`|`published`|`measured`), `published`,
`publish_platform`, `publish_url`, `views`, `likes`, `comments`, `multiplier`,
`verdict`, `verdict_text`.

`baseline_ready: false` means not enough measured samples yet — "hit" is judged
against your own median views, not an absolute number.

## POST /api/v2/topics/feedback

`{ topicTitle, reason }` — suppresses a topic from future daily cards.
