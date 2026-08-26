<h1 align="center">🐬 HTW Media Skills</h1>

<p align="center">
  <strong>Plug your AI agent into the HTW media platform in one command</strong>
</p>

<p align="center">
  Media insight · Content creation · Multi-platform publishing · Online tools — one AuthKey, four skills
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/HTWMedia/HTWSkills/tags"><img src="https://img.shields.io/github/v/tag/HTWMedia/HTWSkills?style=for-the-badge" alt="Latest tag"></a>
  <a href="#quick-install"><img src="https://img.shields.io/badge/install-npx%20one--liner-yellow.svg?style=for-the-badge" alt="npx install"></a>
</p>

<p align="center">
  <a href="#why">Why</a> · <a href="#four-skills">Four skills</a> · <a href="#quick-install">Quick install</a> · <a href="#quick-start">Quick start</a> · <a href="#api-overview">API overview</a> · <a href="#design-philosophy">Design</a> · <a href="#releases">Releases</a> · <a href="#about">About</a> · <a href="#contact">Contact</a> · <a href="README.md">中文</a>
</p>

---

## Why?

Your AI agent can write code, edit docs, and manage projects — but ask it to analyze a video, draft a Xiaohongshu post, or distribute a work to six platforms, and it's stuck:

- 🎬 "Analyze why this Douyin video went viral" → **impossible**, there's no data API
- 📈 "What's trending on Douyin/Xiaohongshu/Weibo today" → **can't find out**, you'd have to scrape each platform
- ✍️ "Write a short-video script with recommendation copy for this topic" → **you'd have to hand-tune a pile of prompts**
- 📤 "Publish this to Douyin, Xiaohongshu, Bilibili and Toutiao" → **log into four dashboards and do it by hand**
- 🎙️ "Transcribe this audio and summarize it into key points" → **install ffmpeg, hunt for an ASR, wire up a bunch of APIs**
- 🎬 "Turn this copy into an AI video" → **chain together script, visuals, voiceover and editing tools**

**These aren't impossible — they're just a chore.**

Behind every one of these capabilities sit platform APIs, login sessions, async jobs and rate limits. You spend an afternoon wiring one up; the next platform means starting all over again.

**HTW Media Skills turns it into a single command:**

```
npx -y github:HTWMedia/HTWSkills#v1.0.1 install
```

Once installed, your agent can analyze videos, pull hot searches, write copy, publish to multiple platforms, transcribe subtitles, and generate AI videos — all sharing **one AuthKey**.

> ⭐ **Star this project** — we keep shipping new capabilities and platforms, and you won't even notice when APIs change under the hood.

### Before you start, you might want to know

| | |
|---|---|
| 🔑 **One key for everything** | All four skills share a single `AuthKey` — apply once, use everywhere |
| ⏱️ **Async tasks** | Time-consuming jobs (video generation, audio transcription, multi-platform publishing) use a uniform "submit `taskId` → poll status" pattern — no timeouts |
| 🛡️ **Safe by design** | Only the public API contract (paths/fields/usage) is exposed — no source code or internals; the API key is kept in memory, never written to disk |
| 🤖 **Works with any agent** | Claude Code, Codex, Cursor, Windsurf… any agent that can read SKILL.md / run a shell works |
| 🔍 **Built-in dry-run** | Append `--dry-run` to any command to preview the request that would be sent — no real request fired |

---

## Four skills

| Skill | Capability | One-liner |
|------|------|-----------|
| 🔍 **insight** | Media insight | Analyze videos/accounts/copy, trending searches, cross-platform search |
| ✍️ **create** | Content creation | An AI creation session from a one-line topic to step-by-step deliverables |
| 📤 **publish** | Multi-platform publishing | One-click publishing to Douyin/Xiaohongshu/Bilibili/Toutiao, traceable and retryable |
| 🧰 **tools** | Online tools | Audio transcription/summary/vocal separation/lyrics, subtitles, draft-to-video, AI video/image, agents |

### 🔍 insight — media insight

Turns "why did this content go viral?" into a question that can be answered:

- **Video analysis** — pass a video URL, get a structured analysis (cover, title, retention factors, etc.)
- **Account analysis** — analyze an account's content strategy
- **Copy analysis** — break down how a piece of copy is written
- **Trending searches** — one command aggregates hot searches from Douyin/Xiaohongshu/Weibo/Baidu/Bilibili/Toutiao
- **Platform search** — search by keyword per platform (Xiaohongshu/Bilibili return entries; Douyin/Toutiao return direct links)
- **Toutiao capabilities** — user info, work list, video URL resolution

### ✍️ create — content creation

Turns "write me some copy" into a **step-by-step creation pipeline** from topic to finished video: topic ideas → script → storyboard → voice → visuals → final cut, with every step's deliverable visible, reviewable and editable.

- **Video type presets** — 9 built-in personas: talking-head/knowledge creator, science explainer, e-commerce/promotion, short drama, vlog, news, tutorial, emotional story, corporate. Each preset locks in **platform, visual style, storyboard style, script length, voice persona, character hint and aspect ratio** — pick a type and the whole pipeline aligns itself
- **Topic recommendations** — hot news + creative-idea presets, so inspiration is never a problem
- **Step-by-step pipeline** — each session advances through 10 steps: `research → key points → script → voice → materials → visuals → music → template → compositing → publish`, each returning its own deliverable
- **Script & storyboard** — the script step produces output **per shot (Shot)**: copy + visual description + duration, forming a natural storyboard; material matching and visual generation both work shot-by-shot
- **Characters & voice** — a character is defined by the preset's **persona + speaker voice**: short drama is multi-character dialogue, science is a male explainer, e-commerce is a female beat; script, voice and visuals all follow the same persona throughout
- **Step control** — `approve` (pass) / `regenerate` (redo on instruction) / `refine` (polish on feedback) / `toggle-step` (enable/disable optional steps)
- **Status tracking** — query the session's progress and each step's deliverable at any time
- **Asset management** — upload assets, pull asset/media files on demand; assets can join shot matching

### 📤 publish — multi-platform publishing

Turns "publish to multiple platforms" into a single submission:

- **One-click submit** — one request distributes to `douyin / xhs / bilibili / toutiao` at once
- **Fully traceable** — task status, active queue, history
- **Retry on failure** — a failed subtask can be retried individually without affecting other platforms
- **Compliance helpers** — content compliance checks, auto-generated tags, per-platform copy generation
- **Asset upload** — upload once, get a directly referencable URL
- **Cookie management** — platform login states stored server-side (the API never echoes cookie contents)

### 🧰 tools — online tools

Turns grunt work into async tasks — video generation follows "**submit `taskId` → poll → download the final cut**":

- **Audio** — upload → transcribe/translate/summarize/vocal separation/lyrics (submit → poll → download result)
- **Subtitle extraction** — extract subtitles from a video (`txt`/`srt`), also async
- **Draft to video** — CapCut draft upload, render status, packaged download, encrypted-draft decryption; draft tooling and end-to-end utilities live in the sibling project [JyDraft](https://github.com/HTWMedia/JyDraft)
- **Image to video** — one-line topic → generated script (per-shot storyboard; **re-generate an individual shot** or upload custom visuals) → confirm script → voiceover/assets → one-click assembly into a final cut
- **Images** — AI image generation (async), image recognition
- **Templates / Agent** — template search (reuse an existing template to produce a video directly); a multi-agent full-pipeline video: topic → script → storyboard → assets → assembly, all run automatically in one task

---

## Quick install

Copy this line into your AI agent (Claude Code, Codex, Cursor, Windsurf, etc.):

```bash
npx -y github:HTWMedia/HTWSkills#v1.0.1 install
```

It installs the four skills into `~/.agents/skills` (and into `~/.claude/skills` if Claude Code is present).

> 🔄 **Want a different version?** Replace `#v1.0.1` with the target tag — see [Releases](#releases).

### Get an API key

Apply on the platform with your email — one command is all it takes:

```bash
# The server returns your key
curl -X POST "https://htwmedia.dpdns.org/auth/applykey?email=<you@example.com>" \
     -H "X-App-Source: HDraft"
```

Then export it as an environment variable (the CLI only reads the key from the environment — never writes it to disk, never puts it on the command line):

```bash
# PowerShell
$env:HTW_API_KEY = "your-key"
# macOS / Linux
export HTW_API_KEY="your-key"
```

---

## Quick start

```bash
htw-skills list                                     # List the four skills
htw-skills guide insight                            # Read a skill's usage

# Media insight
htw-skills call insight --video "https://www.douyin.com/video/xxxx"    # Video analysis
htw-skills call insight --hot                       # Trending searches

# Content creation
htw-skills call create --topic "travel vlog" --type video              # Start a creation session

# Multi-platform publishing
htw-skills call publish --submit --title "Title" --content "Body" --platforms douyin,xhs

# Online tools
htw-skills call tools --draft-decrypt draft.json    # Decrypt a draft
htw-skills call tools --audio-upload <fileId> --convert --format txt   # Transcribe audio
htw-skills call tools --audio-status <taskId>       # Poll an audio task
```

> 🔍 Add `--dry-run` to any command to only print the request that would be sent (with `AuthKey=<redacted>`), without firing a real request.

**Time-consuming tasks are async**: submit-style endpoints return `{ taskId }` immediately, then you poll the matching `status` endpoint until `status = completed`. The CLI ships status commands for audio/subtitle/draft/image-to-video/image/agent.

---

## API overview

> Base URL `https://htwmedia.dpdns.org`, all requests carry `AuthKey: <key>`. Responses use a uniform envelope `{ success: true, data }` or `{ success: false, error }`.

### insight — media insight

| Method | Path | Description |
|---|---|---|
| POST | `/api/insight/video` | `{ url }` video analysis |
| POST | `/api/insight/account` | `{ url }` account analysis |
| POST | `/api/insight/copy` | `{ text }` copy analysis |
| GET | `/api/insight/hot-rankings` | trending searches (platform → ranking arrays) |
| POST | `/api/insight/search` | `{ platform, keyword, count }` platform search |
| POST | `/api/insight/toutiao/user-info` | `{ userUrl }` Toutiao user info |
| POST | `/api/insight/toutiao/works` | `{ userUrl }` Toutiao work list |
| POST | `/api/insight/toutiao/video-url` | `{ videoId }` Toutiao video URL resolution |

### create — content creation

| Method | Path | Description |
|---|---|---|
| GET | `/api/create/types` | video type presets |
| POST | `/api/create/start` | `{ type, topic, ... }` start a session → `{ sessionId, step }` |
| POST | `/api/create/approve` | `{ sessionId, type }` approve the current step |
| POST | `/api/create/regenerate` | `{ sessionId, instruction, type }` redo on instruction |
| POST | `/api/create/refine` | `{ sessionId, message, type }` polish on feedback |
| POST | `/api/create/toggle-step` | `{ sessionId, stepId, enabled, type }` enable/disable a step |
| GET | `/api/create/status` | `?sessionId=&type=` session progress |
| GET | `/api/create/recommendations` | hot news + topic idea presets |
| POST | `/api/create/material` | upload an asset |
| GET | `/api/create/material-file` | fetch an asset file |
| GET | `/api/create/media-file` | fetch a media file |

### publish — multi-platform publishing

| Method | Path | Description |
|---|---|---|
| POST | `/api/publish/submit` | one-click publishing (douyin/xhs/bilibili/toutiao) → `{ taskId }` |
| GET | `/api/publish/task-status` | `?taskId=` task status |
| GET | `/api/publish/queue` | active task queue |
| GET | `/api/publish/history` | `?page=&pageSize=` history |
| POST | `/api/publish/retry` | `{ subTaskId }` retry a subtask |
| GET | `/api/publish/platform-config` | platform metadata |
| GET | `/api/publish/platform-status` | per-platform connection status |
| POST | `/api/publish/compliance` | content compliance check |
| POST | `/api/publish/tags` | generate tags |
| POST | `/api/publish/content` | generate per-platform copy |
| POST | `/api/publish/upload` | asset upload → `{ url, contentType }` |
| POST | `/api/publish/save-cookie` | save a platform login state |
| POST | `/api/publish/check-cookie` | validate a login state |
| GET | `/api/publish/cookie-status` | which platforms have cookies |

### tools — online tools

| Method | Path | Description |
|---|---|---|
| POST | `/api/tools/audio/upload` | upload audio → `{ fileId }` |
| POST | `/api/tools/audio/convert` | transcribe/translate → `{ taskId }` |
| POST | `/api/tools/audio/summarize` | summarize → `{ taskId }` |
| POST | `/api/tools/audio/separate` | vocal separation → `{ taskId }` |
| POST | `/api/tools/audio/lyrics` | lyrics recognition → `{ taskId }` |
| GET | `/api/tools/audio/status` | `?taskId=` poll status |
| GET | `/api/tools/audio/download` | `?fileId=` download result |
| POST | `/api/tools/subtitle/extract` | subtitle extraction → `{ taskId }` |
| GET | `/api/tools/subtitle/status` | `?taskId=` poll status |
| POST | `/api/tools/draft/upload` | upload a draft package → `{ taskId, warnings }` |
| GET | `/api/tools/draft/status` | draft render status |
| GET | `/api/tools/draft/download` | download the final cut |
| POST | `/api/tools/draft/decrypt` | decrypt an encrypted draft |
| POST | `/api/tools/video/start` | image-to-video → `{ taskId }` |
| POST | `/api/tools/video/confirm-script` | confirm the script |
| POST | `/api/tools/video/regen-shot` | re-generate a shot |
| POST | `/api/tools/video/upload-shot` | upload a shot's visuals |
| POST | `/api/tools/video/start-assembly` | start assembling the final cut |
| GET | `/api/tools/video/status` | poll status |
| GET | `/api/tools/video/image` | fetch a shot's visual |
| POST | `/api/tools/image/generate` | AI image generation → `{ taskId }` |
| GET | `/api/tools/image/status` | poll status |
| POST | `/api/tools/image/recognize` | image recognition |
| GET | `/api/tools/template/search` | template search |
| POST | `/api/tools/agent/start` | multi-agent video → `{ taskId }` |
| GET | `/api/tools/agent/status` | poll status |
| GET | `/api/tools/agent/image` | fetch an agent artifact image |

> Result files (audio/video/images) are uniformly downloaded via `/api/tools/*/download`. Error codes: missing/wrong key → `401`, expired key → `402`, everything else → `{ success: false, error }`.

---

## Design philosophy

**HTW Media Skills is a capability layer, not yet another tool.**

Underneath is the full HTW media platform API; this package handles the **contract, encapsulation and guidance** — the agent never has to worry about request formats, async polling, or how platform cookies are configured. Read the SKILL.md once and you're ready.

### 🔑 One key, four skills

```
insight ▸ create ▸ publish ▸ tools
        └──── shared AuthKey ────┘
```

Apply once, unlock all four skills. The CLI reads the key only from the `HTW_API_KEY` environment variable — never written to disk, never in shell history.

### ⏱️ One async model

Time-consuming operations (video generation, audio transcription, multi-platform publishing) all follow "**submit → poll**":

```
POST /api/tools/video/start      ──►  { taskId }     （returns in seconds, doesn't wait）
GET  /api/tools/video/status     ──►  { status }     （completed / running / failed）
GET  /api/tools/video/image      ──►  result file
```

No timeouts. The agent gets a `taskId` and polls at its own pace.

### 🛡️ Security & boundaries

- Only the **public API contract** is exposed: paths, field names, usage. No source code or internals.
- Cookies live **server-side**; the API never returns the raw contents. Your only local secret is your API key environment variable.
- Keep your key safe and rotate it if you suspect a leak. Full docs in `docs/getting-started.md`.

---

## Releases

This project uses "semver + GitHub tags"; pin a version by using `#<tag>`:

```bash
npx -y github:HTWMedia/HTWSkills#<tag> install
```

| Version | Date | Notes |
|------|------|------|
| [v1.0.1](https://github.com/HTWMedia/HTWSkills/releases/tag/v1.0.1) | 2026-08 | Audio/subtitle endpoints switched to an async contract: `audio/convert`, `audio/summarize`, `audio/separate`, `audio/lyrics`, `subtitle/extract` now return `taskId`; added `audio/status` and `subtitle/status` polling; CLI added `--audio-status` and `--subtitle-status` |
| [v1.0.0](https://github.com/HTWMedia/HTWSkills/releases/tag/v1.0.0) | 2026-08 | Initial release: four skills (insight / create / publish / tools) + `htw-skills` CLI + docs |

> Each release page matches a tag and includes the matching server-side API reference.

---

## About

**HTW Media Skills** is the open-source agent-skills package for the **HTWMedia audio/video AI platform** (`https://htwmedia.dpdns.org`), maintained by the platform team.

The platform's vision: turn the audio/video content production pipeline (insight → creation → publishing → tooling) into callable APIs, then deliver them to AI agents as SKILL.md + CLI. Any agent that can read a SKILL.md can be plugged into the full capability set within minutes.

This repo is intentionally just the **contract layer**: public API paths, fields and usage, plus a thin CLI. The heavy lifting — media insight, AI creation, multi-platform publishing, and audio/video processing — all happens server-side.

**Tech stack**: Node.js (≥18) CLI · Markdown skills · server .NET 8 + AI pipeline

**Topics**: `ai-agent` · `agent-skills` · `claude-code` · `codex` · `cursor` · `llm` · `video-generation` · `content-creation` · `multi-platform-publish` · `audio-transcription` · `subtitle` · `capcut` · `douyin` · `xiaohongshu` · `bilibili` · `api`

📖 Getting started: [docs/getting-started.md](docs/getting-started.md)

---

## Contact

- 📧 **Email:** 1005354833@qq.com
- 💬 **WeChat:** haitunwanav

For bugs and feature requests, prefer [GitHub Issues](https://github.com/HTWMedia/HTWSkills/issues) — easier to track.

---

## License

[MIT](LICENSE)
