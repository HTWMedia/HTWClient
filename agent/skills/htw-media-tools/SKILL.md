---
name: htw-media-tools
description: Online media tools on the HTW platform via the v2 API — audio (transcribe/translate/summarize/separate/lyrics/tts), AI image generation & recognition, and the multi-agent video pipeline (start or one-click). Editing features (coarse-cut / draft-export / super-res) live in the htw-media-edit skill. Use when the user needs any of these content-production utilities.
---

# HTW Media Tools (v2)

Auth is via the `HTW_API_KEY` environment variable. Every request sends the
`AuthKey` header. Response envelope: `{ ok: true, data, errCode, errMsg, taskId }`
or `{ ok: false, errCode, errMsg }`.

## Usage

```bash
# audio (upload first -> {fileId}; start returns taskId, then poll --audio-status)
htw-skills call tools --audio-upload <fileId> --convert --format txt
htw-skills call tools --audio-upload <fileId> --translate          # speech translation
htw-skills call tools --audio-status <taskId>
htw-skills call tools --audio-upload <fileId> --summarize
htw-skills call tools --audio-upload <fileId> --separate
htw-skills call tools --audio-upload <fileId> --lyrics
htw-skills call tools --tts --text "你好" --speaker zh_female_qinglengnv
# image gen / recognize
htw-skills call tools --image-gen --prompt "赛博朋克城市夜景"
htw-skills call tools --recognize photo.jpg
# agent (topic -> video)
htw-skills call tools --agent --theme "科技新闻"                  # full VideoOptions
htw-skills call tools --agent --one-click --topic "一条关于AI的短视频" --platform xhs
# subtitle extraction (async: returns taskId, poll --subtitle-status)
htw-skills call tools --subtitle <video.mp4> --format srt           # ocr engine
htw-skills call tools --subtitle <video.mp4> --format txt --engine kimi
htw-skills call tools --subtitle-status <taskId>
# template search
htw-skills call tools --template-search "新年" --page 1 --pageSize 20
```

## Notes

- Audio convert/summarize/separate/lyrics/translate/tts and image generation are
  async: POST returns `{ taskId }`, poll `GET /api/v2/voice/status/{taskId}` or
  `GET /api/v2/image/status?taskId=...` until `status = completed`.
- `agent/one-click` is the minimal-param path: give a `topic` (+ optional
  `platform`/`length`/`style`/`ratio`/`mode`/`referenceText`/`voice`) and the
  server runs the whole pipeline (research → script → material → voice → visual →
  music → composite) to a finished video.
- Several tools (image gen, agent) require a platform cookie configured on the
  server side; if missing the API returns `{ ok: false, errCode: 400 }`.
- Editing (coarse-cut / draft-export / super-res / decrypt) is a separate skill
  `htw-media-edit` (`/api/v2/edit/*`). Draft JSON decrypt moved there
  (`/api/v2/edit/decrypt`).
- Subtitle extraction and template search are now v2:
  `/api/v2/subtitle/extract` + `/api/v2/subtitle/status/{taskId}`,
  `/api/v2/template/search`.
- Full request/response fields: see `references/api.md`.
