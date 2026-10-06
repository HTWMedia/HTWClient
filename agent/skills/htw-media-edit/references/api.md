# htw-media-edit API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.

| Method | Path | Fields |
|---|---|---|
| POST | `/api/v2/edit/coarse-cut` | multipart `video`, form `voice`, `durationMin`, `durationMax`, `blur` → `{ taskId }` |
| POST | `/api/v2/edit/draft-export` | multipart `file` (CapCut draft ZIP, must contain `draft_content.json`) → `{ taskId, warnings }` |
| POST | `/api/v2/edit/super-res` | multipart `video`, form `width`, `height` → `{ taskId }` |
| POST | `/api/v2/edit/decrypt` | multipart `file` (.json ≤ 50MB) → `{ isPlain, msg, draft_content }` |
| GET | `/api/v2/edit/cutsame/search` | query `keyword`, `count` (≤30) → `{ templates: [{ id, name, coverUrl, durationMs, fragmentCount, usageAmount, available, draftPackageUrl }] }` |
| POST | `/api/v2/edit/cutsame/submit` | multipart `videos` (repeatable, ≤ 20), form `draftPackageUrl` → `{ taskId }` |
| GET | `/api/v2/edit/status/{taskId}` | path `taskId` → `{ status, phase, progress, currentStep, downloadUrl, outputFile, error }` |

剪同款两步：先 `cutsame/search` 挑模板（只读、不计额度），把选中模板的
`draftPackageUrl` 原样回传给 `cutsame/submit`。`available = false` 的模板拿不到
草稿包（付费或未解锁），提交会被拒。素材少于模板片段数时会自动循环复用。

Errors: missing/invalid key → HTTP 401; quota exceeded → HTTP 402;
bad input → HTTP 400; unknown task → HTTP 404. The body is the V2 envelope
`{ ok, errCode, errMsg }`.

When `status = completed`, download the result from `downloadUrl`
(e.g. `/Download/draft_20260825xxxx.mp4`). While `status = running`, `progress`
(0–100) and `currentStep` describe progress; poll every few seconds.
