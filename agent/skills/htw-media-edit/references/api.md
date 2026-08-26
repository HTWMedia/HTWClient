# htw-media-edit API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.

| Method | Path | Fields |
|---|---|---|
| POST | `/api/v2/edit/coarse-cut` | multipart `video`, form `voice`, `durationMin`, `durationMax`, `blur` → `{ taskId }` |
| POST | `/api/v2/edit/draft-export` | multipart `file` (CapCut draft ZIP, must contain `draft_content.json`) → `{ taskId, warnings }` |
| POST | `/api/v2/edit/super-res` | multipart `video`, form `width`, `height` → `{ taskId }` |
| POST | `/api/v2/edit/decrypt` | multipart `file` (.json ≤ 50MB) → `{ isPlain, msg, draft_content }` |
| GET | `/api/v2/edit/status/{taskId}` | path `taskId` → `{ status, phase, progress, currentStep, downloadUrl, outputFile, error }` |

Errors: missing/invalid key → HTTP 401; quota exceeded → HTTP 402;
bad input → HTTP 400; unknown task → HTTP 404. The body is the V2 envelope
`{ ok, errCode, errMsg }`.

When `status = completed`, download the result from `downloadUrl`
(e.g. `/Download/draft_20260825xxxx.mp4`). While `status = running`, `progress`
(0–100) and `currentStep` describe progress; poll every few seconds.
