---
name: htw-media-publish
description: Publish content to Douyin / XHS / Bilibili / Toutiao from the HTW platform via the v2 publish API, track and retry tasks, check compliance, generate tags/content, and manage platform cookies. Use when the user wants to distribute posts across short-video platforms.
---

# HTW Media Publish (v2)

Auth is via the `HTW_API_KEY` environment variable. Every request sends the
`AuthKey` header. Response envelope: `{ ok: true, data, errCode, errMsg, taskId }`
or `{ ok: false, errCode, errMsg }`.

## Usage

```bash
htw-skills call publish --submit --title "标题" --content "正文" \
  --tags "a,b,c" --media-urls "https://...,https://..." \
  --platforms douyin,xhs [--is-draft]
htw-skills call publish --status <taskId>
htw-skills call publish --queue
htw-skills call publish --history
htw-skills call publish --retry <subTaskId>
htw-skills call publish --compliance --content "待审核内容"
htw-skills call publish --tags-gen --title "标题" --content "正文"
htw-skills call publish --content-gen --title "标题" [--media-hint "视频"]
htw-skills call publish --platform-status
```

## Notes

- Media URLs can come from `/api/v2/publish/upload-file` (returns a
  `/MediaFiles/...` URL) or any reachable media URL.
- Cookie endpoints only save/check/status — cookie values are never returned.
- Full request/response fields: see `references/api.md`.
