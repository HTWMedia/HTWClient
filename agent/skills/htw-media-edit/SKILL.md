---
name: htw-media-edit
description: Edit existing video on the HTW platform via the v2 API — AI coarse-cut with TTS dubbing, export a CapCut draft package to a finished video, super-resolution / quality upscale, and decrypt a CapCut draft JSON. Use when the user wants to auto-recap/trim a video, turn a draft into a clip, upscale video quality, or decrypt a draft file.
---

# HTW Media Edit (v2)

Auth is via the `HTW_API_KEY` environment variable. Every request sends the
`AuthKey` header. Response envelope: `{ ok: true, data, errCode, errMsg, taskId }`
or `{ ok: false, errCode, errMsg }`.

## Usage

```bash
# AI coarse-cut (auto recap + Edge-TTS dubbing)
htw-skills call edit --coarse-cut video.mp4 --voice zh-CN-XiaoxiaoNeural --duration-min 60 --duration-max 180
# export a CapCut draft package (ZIP) to a finished video
htw-skills call edit --draft-export draft.zip
# super-resolution / quality upscale
htw-skills call edit --super-res video.mp4 --width 1708 --height 960
# decrypt a CapCut draft JSON (synchronous)
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
- `coarse-cut` params: `voice` (Edge TTS voice, default `zh-CN-XiaoxiaoNeural`),
  `durationMin`/`durationMax` (seconds, default 60/180), `blur` (bool — blur
  original subtitles).
- `super-res` params: `width`/`height` (default 1708×960).
- `draft-export` returns `{ taskId, warnings }` where `warnings` lists missing
  local assets in the draft.
- `decrypt` is synchronous (not a task): upload a `.json` draft (≤ 50MB);
  returns `{ isPlain, msg, draft_content }`. Plain (unencrypted) drafts are
  detected by a `"version"` field and echoed back with `isPlain = true`.
- Full request/response fields: see `references/api.md`.
