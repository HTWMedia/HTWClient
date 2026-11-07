---
name: htw-media-edit
description: Edit existing video on the HTW platform via the v2 API — AI coarse-cut with TTS dubbing, export a CapCut draft package to a finished video, super-resolution / quality upscale, and read an encrypted CapCut draft JSON. Use when the user wants to auto-recap/trim a video, turn their own draft into a clip, upscale video quality, or inspect a draft file they own. Does not download or apply third-party templates.
---

# HTW Media Edit (v2)

Auth is via the `HTW_API_KEY` environment variable. Every request sends the
`AuthKey` header. Response envelope: `{ ok: true, data, errCode, errMsg, taskId }`
or `{ ok: false, errCode, errMsg }`.

## Usage

```bash
# AI coarse-cut (auto recap + Edge-TTS dubbing)
htw-skills call edit --coarse-cut video.mp4 --voice zh-CN-XiaoxiaoNeural --duration-min 60 --duration-max 180
# export a CapCut draft package (ZIP) to a finished video — server-side render
htw-skills draft draft.zip --cookie-file ./jy-cookie.txt
# super-resolution / quality upscale
htw-skills call edit --super-res video.mp4 --width 1708 --height 960
# read a CapCut draft JSON (synchronous)
htw-skills call edit --decrypt draft_encrypted.json
# poll status
htw-skills call edit --status <taskId>
```

## Notes

- All three are async: submit returns `{ taskId }`, then poll
  `GET /api/v2/edit/status/{taskId}` until `status = completed`, then fetch the
  result via the returned `downloadUrl` (`/Download/<file>`).
- `coarse-cut` and `super-res` upload a video file (multipart); `draft-export`
  uploads a CapCut draft ZIP (must contain `draft_content.json`).
- **`draft-export` is rendered by the server, but with the caller's own login.**
  `jianyingCookie` is **required** — omit it and the endpoint returns 400. The site
  keeps no account pool and does not rotate accounts; the cookie is used for that one
  request and never stored. It is billed by finished duration (exhausted quota →
  **HTTP 402** with a `redirectUrl`), and concurrency / per-minute limits return
  **HTTP 429**. Pass it via `--cookie` / `--cookie-file` / `HTW_JIANYING_COOKIE`.
  Progress comes from `GET /api/v2/edit/draft-status/{taskId}` — not
  `/api/v2/edit/status/`, which serves the cloud tasks above.
  > History: on 2026-11-07 `draft-export` was briefly made local-instance-only
  > (cloud returned 410, no billing); that was reverted the same day. `--local-base`
  > still works as an optional override but is no longer required.
- `coarse-cut` params: `voice` (Edge TTS voice, default `zh-CN-XiaoxiaoNeural`),
  `durationMin`/`durationMax` (seconds, default 60/180), `blur` (bool — blur
  original subtitles).
- `super-res` params: `width`/`height` (default 1708×960).
- `draft-export` returns `{ taskId, warnings }` where `warnings` lists missing
  local assets in the draft.
- `decrypt` is synchronous (not a task): upload a `.json` draft (≤ 50MB);
  returns `{ isPlain, msg, draft_content }`. Plain (unencrypted) drafts are
  detected by a `"version"` field and echoed back with `isPlain = true`.
- `cut-same` / `--cut-same-search` were removed on 2026-11-06 and the flags now
  return an error: they required downloading Jianying's template packages and
  replacing the template author's assets, whose copyrights belong to Jianying
  and the template creators. Do not attempt to reimplement them.
- Full request/response fields: see `references/api.md`.
