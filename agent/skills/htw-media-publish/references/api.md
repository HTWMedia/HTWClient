# htw-media-publish API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.

| Method | Path | Body / query fields |
|---|---|---|
| POST | `/api/v2/publish/submit` | `title`, `content`, `tags[]`, `mediaUrls[]`, `coverImage`, `category`, `isDraft`, `platforms[{platformId, creativeStatement, savePermission}]` |
| GET | `/api/v2/publish/task-status` | query `taskId` |
| GET | `/api/v2/publish/queue-status` | active tasks |
| GET | `/api/v2/publish/history` | query `page`, `pageSize` |
| POST | `/api/v2/publish/retry` | `subTaskId` |
| GET | `/api/v2/publish/platform-config` | platform metadata |
| GET | `/api/v2/publish/platform-status` | connection status per platform |
| GET | `/api/v2/publish/check-connections` | check all platform connections |
| POST | `/api/v2/publish/upload-file` | multipart `file` → `{ url, contentType }` |
| POST | `/api/v2/publish/check-compliance` | `content`, `platform` |
| POST | `/api/v2/publish/generate-tags` | `title`, `content`, `platform` |
| POST | `/api/v2/publish/generate-content` | `title`, `mediaHint`, `platform` |
| POST | `/api/v2/publish/save-cookie` | `platform`, `cookieText` |
| POST | `/api/v2/publish/check-cookie` | `platform` |
| GET | `/api/v2/publish/cookie-status` | per-platform has-cookie flags |
| GET | `/api/v2/publish/get-cookie` | query `platform` |

Platform ids: `douyin`, `xhs`, `bilibili`, `toutiao`. Cookie values are stored
server-side; the API never returns them.
