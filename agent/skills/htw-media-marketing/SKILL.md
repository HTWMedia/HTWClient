---
name: htw-media-marketing
description: Generate e-commerce / product short-video ads (营销成片) on the HTW platform via the v2 API. Use when the user wants AI-generated marketing videos from product references — create sell points and marketing copy from a product name, then start a Seedance-powered creation session that turns ≥5 reference images (or 1 reference video) into a finished promo video with a marketing overlay.
---

# HTW Media Marketing (v2 营销成片)

Auth is via the `HTW_API_KEY` environment variable (sent as the `AuthKey`
header). Response envelope: `{ ok: true, data, errCode, errMsg, taskId }` or
`{ ok: false, errCode, errMsg }`.

The HTW desktop client also ships a dedicated **营销成片 MarketVideo** panel
(left sidebar) that drives the same endpoints with one click.

## Flow

1. **Generate sell points** — `POST /api/v2/market-video/product-info`
2. **Generate marketing copy** — `POST /api/v2/market-video/generate-script`
3. **Start the promo session** — `POST /api/v2/creation/start`
   (`type=video`, `enableSeedance=true`, `enableMarketingOverlay=true`,
   `marketingCtaText`, `marketingHeroText`)
4. **Upload references** — `POST /api/v2/creation/upload-material` (multipart
   `file`, query `sessionId`). **Requirement: ≥5 reference images OR 1 reference
   video.**
5. **Drive the session** — poll `GET /api/v2/creation/status` and `approve` each
   `waiting_approval` gate (script → voice → visual → music → template →
   compositor) until `Status=completed`. Final video is in
   `data.Artifact.DownloadUrl`.

## curl examples

```bash
BASE=https://htwmedia.dpdns.org
AUTH="AuthKey: $HTW_API_KEY"

# 1) 生成卖点
curl -s -X POST "$BASE/api/v2/market-video/product-info" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"text":"铅笔"}'
# -> {"ok":true,"data":{"productName":"铅笔","sellPoints":["书写顺滑不断芯",...]}}

# 2) 生成营销文案
curl -s -X POST "$BASE/api/v2/market-video/generate-script" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"productName":"铅笔","sellPoints":"书写顺滑\n天然椴木","ratio":"16:9","duration":"15-30"}'
# -> {"ok":true,"data":{"script":"别眨眼，这支铅笔..."}}

# 3) 成片（先 start，再上传素材，再轮询/approve）
curl -s -X POST "$BASE/api/v2/creation/start" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"type":"video","topic":"铅笔\n<文案>","optionalSteps":[],"enableSeedance":true,"seedanceMaxClips":2,"enableMarketingOverlay":true,"marketingCtaText":"开学季买二送一","marketingHeroText":"学生,上班族"}'
# -> {"ok":true,"data":{"sessionId":"...","step":{...}}}

curl -s -X POST "$BASE/api/v2/creation/upload-material?sessionId=<id>" \
  -H "$AUTH" -F "file=@img1.jpg"   # 重复上传 ≥5 张
```

Full request / response fields: see `references/api.md`.

## Notes

- The creation session reuses the generic v2 creation pipeline; `approve`,
  `regenerate`, `refine` work exactly as in `htw-media-create`.
- `keypoint` optional step is currently unreliable in the v2 pipeline (server
  null-ref); leave it off and rely on the uploaded references instead.
