# htw-media-marketing API reference (v2 营销成片)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.

## Marketing assist (AuthKey-routable)

| Method | Path | Body fields | Returns |
|---|---|---|---|
| POST | `/api/v2/market-video/product-info` | `text` (商品描述/名称) | `data.productName`, `data.sellPoints[]` |
| POST | `/api/v2/market-video/generate-script` | `productName`, `sellPoints`, `ratio`(9:16/16:9), `duration`(0-15/15-30/30-60), `discountActivity`, `audienceTypes` | `data.script` |

Both call DeepSeek (same model as the Web 端 `/WebAI/MarketVideo*`), but are
exposed under `ApiKeyScheme` so a stateless client (desktop / agent) can call
them without a session login.

## Creation session (generic v2 pipeline)

| Method | Path | Body / query fields |
|---|---|---|
| POST | `/api/v2/creation/start` | `type`(`video`), `topic`, `optionalSteps[]`, `videoTypeId`, `enableSeedance`(bool), `seedanceMaxClips`(int), `enableMarketingOverlay`(bool), `marketingCtaText`, `marketingHeroText`, `productImageUrls[]`, `userMaterialIds[]` |
| POST | `/api/v2/creation/upload-material` | multipart `file`, query `sessionId` (≤20MB; call once per reference) |
| GET | `/api/v2/creation/status` | query `sessionId`, `type` |
| POST | `/api/v2/creation/approve` | `sessionId`, `type` |
| POST | `/api/v2/creation/regenerate` | `sessionId`, `instruction`, `type` |
| POST | `/api/v2/creation/refine` | `sessionId`, `message`, `type` |

### `creation/start` → marketing fields

- `enableSeedance: true` — Seedance 生成钩子镜头分镜（见 `ProgressLogs` 中
  “种子动态视频（钩子镜头 …）”）。
- `seedanceMaxClips` — 钩子镜头数量（建议 2）。
- `enableMarketingOverlay: true` — 叠加营销浮层。
- `marketingCtaText` — 浮层卖点 / CTA（如 “开学季买二送一”）。
- `marketingHeroText` — 浮层主标题（如 “学生,上班族”）。

### status response shape

`data` (PascalCase):

- `Status` — `running` / `waiting_approval` / `completed` / `failed`
- `CurrentStepId` / `CurrentStepLabel` — e.g. `script`, `voice`, `visual`,
  `music`, `template`, `compositor`
- `ProgressLogs[]` — 进度日志
- `Artifact` — JSON string; on `completed` contains
  `DownloadUrl` (`/Download/creation_*.mp4`), `OutputPath`, `DraftId`

The finished video URL is `data.Artifact.DownloadUrl` (server-relative path).

### Reference requirement

The marketing creation needs **≥5 reference images OR 1 reference video**
uploaded via `upload-material` before/after `start`; otherwise the server
rejects or the result quality degrades.
