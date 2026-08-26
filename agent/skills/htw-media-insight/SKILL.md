---
name: htw-media-insight
description: Analyze short-video / account / copywriting, fetch hot rankings, and search content across Douyin, XHS, Bilibili, Toutiao via the HTW v2 insight API. Use when the user wants media analysis, hot trends, or cross-platform search.
---

# HTW Media Insight (v2)

Auth is via the `HTW_API_KEY` environment variable. Every request sends the
`AuthKey` header. Response envelope: `{ ok: true, data, errCode, errMsg, taskId }`
or `{ ok: false, errCode, errMsg }`.

## Usage

```bash
htw-skills call insight --video <video-url>
htw-skills call insight --account <account-url>
htw-skills call insight --copy "<text>"
htw-skills call insight --hot
htw-skills call insight --search "<keyword>" --platform xhs|douyin|bilibili|toutiao
```

Add `--dry-run` to preview the HTTP request without sending it.

## Notes

- `search` for `douyin`/`toutiao` returns a browser search URL; `xhs`/`bilibili`
  return live result items.
- Hot rankings cover bilibili/weibo/baidu/douyin/xiaohongshu/toutiao.
- Cookie-dependent calls (toutiao-*) require a server-side cookie; missing
  cookie returns `{ ok: false, errCode: 400 }`.
- Full request/response fields: see `references/api.md`.
