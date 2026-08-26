# htw-media-create API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.

| Method | Path | Body / query fields |
|---|---|---|
| GET | `/api/v2/creation/types` | returns video-type presets (`data` = array) |
| POST | `/api/v2/creation/start` | `type`(video/image/article), `topic`, `referenceVideoUrls[]`, `userMaterialIds[]`, `videoTypeId`, `optionalSteps[]` |
| POST | `/api/v2/creation/approve` | `sessionId`, `type` |
| POST | `/api/v2/creation/regenerate` | `sessionId`, `instruction`, `type` |
| POST | `/api/v2/creation/refine` | `sessionId`, `message`, `type` |
| POST | `/api/v2/creation/toggle-step` | `sessionId`, `stepId`, `enabled`, `type` |
| GET | `/api/v2/creation/status` | query `sessionId`, `type` |
| GET | `/api/v2/creation/recommendations` | hot news + idea presets |
| POST | `/api/v2/creation/upload-material` | multipart `file`, query `sessionId` |
| GET | `/api/v2/creation/media-file` | query `sessionId`, `fileName` |
| GET | `/api/v2/creation/proxy-media` | query `url` |

A creation session produces step-by-step artifacts; drive it with approve /
regenerate / refine. `data` on `start` contains `sessionId` + first `step`.
