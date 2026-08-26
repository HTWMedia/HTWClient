---
name: htw-media-create
description: Run AI-assisted content-creation sessions (video / image / article) on the HTW platform via the v2 creation API: start, approve, regenerate, refine, toggle optional steps, and fetch status. Use when the user wants AI-generated videos, images, or articles.
---

# HTW Media Create (v2)

Auth is via the `HTW_API_KEY` environment variable. Every request sends the
`AuthKey` header. Response envelope: `{ ok: true, data, errCode, errMsg, taskId }`
or `{ ok: false, errCode, errMsg }`.

## Usage

```bash
htw-skills call create --type video --topic "AI 工具介绍"
# then drive the session step by step:
htw-skills call create --type video --session-id <id> --status
htw-skills call create --type video --session-id <id> --approve
htw-skills call create --type video --session-id <id> --regenerate "换成更轻松的语气"
htw-skills call create --type video --session-id <id> --refine "字幕再大一点"
htw-skills call create --type video --session-id <id> --toggle-step script --enabled false
```

## Notes

- `--type` is `video`, `image`, or `article`.
- `--status` returns the current step, artifacts, and progress logs.
- Optional-step toggling is supported for `video` type only.
- Full request/response fields: see `references/api.md`.
