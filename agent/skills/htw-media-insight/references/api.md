# htw-media-insight API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.

| Method | Path | Body / query fields | Notes |
|---|---|---|---|
| POST | `/api/v2/insight/analyze-video` | `url` | Video analysis result |
| POST | `/api/v2/insight/analyze-account` | `url` | Account analysis result |
| POST | `/api/v2/insight/analyze-copy` | `text` | Copywriting analysis result |
| GET | `/api/v2/insight/hot-rankings` | — | `data` = map platform → `[{rank,title,url,score,tag}]` |
| POST | `/api/v2/insight/search` | `platform`, `keyword`, `count` | xhs/bilibili return items; douyin/toutiao return a `url` |
| POST | `/api/v2/insight/toutiao-search` | `keyword`, `count` | Toutiao search |
| POST | `/api/v2/insight/toutiao-user-info` | `userUrl` | |
| POST | `/api/v2/insight/toutiao-user-works` | `userUrl` | |
| POST | `/api/v2/insight/toutiao-video-url` | `videoId` | |
| POST | `/api/v2/insight/toutiao-set-cookie` | cookie payload | Save toutiao cookie server-side |
| POST | `/api/v2/insight/save-cookie` | `platform`, `cookieText` | Save insight cookie |
| GET | `/api/v2/insight/cookie-status` | — | insight cookie flag |
| GET | `/api/v2/insight/toutiao-cookie-status` | — | toutiao cookie flag |
| GET | `/api/v2/insight/proxy-image` | `url` | proxy an image URL |

Errors: missing/invalid key → HTTP 401; expired key → HTTP 402; other failures
return `{ ok: false, errCode: 400, errMsg }`.
