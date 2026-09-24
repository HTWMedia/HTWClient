---
name: htw-media-topics
description: Topic radar for the HTW platform via the v2 topics API — daily topic cards with evidence, hot-search trends, competitor (radar) accounts and breakout alerts, niche profile tuning, and the adopt → publish → measure feedback loop that adjusts recommendation weights. Use when the user wants to find what to create, track competitors, or review which topics actually performed.
---

# HTW Media Topics (v2)

Auth is via the `HTW_API_KEY` environment variable. Every request sends the
`AuthKey` header. Response envelope: `{ ok: true, data, errCode, errMsg, taskId }`
or `{ ok: false, errCode, errMsg }`.

## Usage

```bash
# 今日选题 / 热榜趋势 / 数据源健康
htw-skills call topics --daily [--count 6]
htw-skills call topics --trends [--category douyin] [--count 60]
htw-skills call topics --health

# 对标雷达
htw-skills call topics --radar
htw-skills call topics --radar-add "https://www.douyin.com/user/xxx" --platform douyin
htw-skills call topics --radar-remove <id>
htw-skills call topics --radar-sample
htw-skills call topics --alerts
htw-skills call topics --alert-dismiss <alertId>

# 垂类画像
htw-skills call topics --profile
htw-skills call topics --profile-save --platforms "douyin,xiaohongshu" \
  --include "AI 工具,效率" --exclude "八卦,明星" --audience "25-35 岁职场人"

# 选题闭环：采纳 → 发布 → 回填效果 → 看统计
htw-skills call topics --adopt <topicId> --title "标题" --score 91
htw-skills call topics --published <topicId> --platform douyin --url "https://..."
htw-skills call topics --metrics <topicId> --views 12000 --likes 800 --comments 45
htw-skills call topics --outcome-stats

# 不感兴趣
htw-skills call topics --feedback "某条选题标题" --reason "不感兴趣"
```

## Notes

- `--daily` cards carry an `id` — that is the `topicId` used by `--adopt` and
  the later publish/metrics steps. Without adopting, the server cannot tell
  "recommended but never used" from "used and flopped", and the scoring weights
  never get tuned.
- `--adopt` / `--metrics` are what feed the weight tuning. Skipping them leaves
  the loop open and `--outcome-stats` will keep reporting zero samples.
- `POST/PUT` bodies are camelCase here; ASP.NET model binding is
  case-insensitive, so they bind to the server's PascalCase models.
- Full request/response fields: see `references/api.md`.
