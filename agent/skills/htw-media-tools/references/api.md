# htw-media-tools API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.

## Voice / Audio
| Method | Path | Fields |
|---|---|---|
| POST | `/api/v2/voice/upload` | multipart `file` → `{ fileId }` |
| POST | `/api/v2/voice/transcribe` | `fileId`, `format`(txt/doc/srt), `language`, `translate`, `role`, `alignText` → `{ taskId }` |
| POST | `/api/v2/voice/translate` | `fileId`, `language` → `{ taskId }` (speech translation) |
| POST | `/api/v2/voice/summarize` | `fileId` → `{ taskId }` |
| POST | `/api/v2/voice/lyrics` | `fileId` → `{ taskId }` |
| POST | `/api/v2/voice/separate` | `fileId`, `type`(human/music) → `{ taskId }` |
| POST | `/api/v2/voice/tts` | `text`, `speaker` → `{ taskId }` |
| GET | `/api/v2/voice/status/{taskId}` | path `taskId` → `{ status, error, resultFile, lyrics, audioUrl, duration }` |
| GET | `/api/v2/voice/download/{fileId}` | path `fileId` |

## Image gen / recognition
| Method | Path | Fields |
|---|---|---|
| POST | `/api/v2/image/generate` | `prompt`, `model`, `ratio`, `resolution`, `sampleStrength`, `negativePrompt` → `{ taskId }` |
| GET | `/api/v2/image/status` | query `taskId` |
| POST | `/api/v2/image/qwen-generate` | `prompt`, `model`, `size`, `n`, `waitForCompletion` |
| POST | `/api/v2/image/recognize` | multipart `file` → `{ result }` |

## Agent (topic → video)
| Method | Path | Fields |
|---|---|---|
| POST | `/api/v2/agent/start` | `theme`, `platform`, `scriptLength`, `mode` (VideoOptions subset) → `{ taskId }` |
| POST | `/api/v2/agent/one-click` | `topic`, `platform`, `length`, `style`, `ratio`, `mode`, `referenceText`, `voice` → `{ taskId, statusUrl, streamUrl }` |
| GET | `/api/v2/agent/status` | query `taskId` |
| GET | `/api/v2/agent/image` | query `taskId`, `shotId` |

## Subtitle extraction
| Method | Path | Fields |
|---|---|---|
| POST | `/api/v2/subtitle/extract` | multipart `file` (video), form `format`(txt/srt), `engine`(ocr/kimi) → `{ taskId }`。`engine` 只用这两个值：ocr=抽帧网格拼图（服务端 DeepSeek 通道，推荐）；kimi=整段视频直传（免费档拥堵时会失败）。不要传 `deepseek`——整段视频直传被上游类型白名单硬拒（`biz_code=9 unsupported file type`），该值仅服务端保留用于错误透传 |
| GET | `/api/v2/subtitle/status/{taskId}` | path `taskId` → `{ status, format, result, lineCount, error }` |

## Template search
| Method | Path | Fields |
|---|---|---|
| GET | `/api/v2/template/search` | query `keyword`, `page`(1), `pageSize`(20) → `{ list }` |

Audio/video/images are served from `/api/v2/voice/download/{fileId}` or
`/MediaFiles/*` URLs returned in `data`.

Voice/image/agent jobs are async: POST returns `{ taskId }`, poll the matching
`status` endpoint until `status = completed`, then fetch the result file.
