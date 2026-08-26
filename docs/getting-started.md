# Getting Started

## Requirements

- Node.js >= 18 (for the CLI), or any AI client that supports OpenAI-style
  skills / can read SKILL.md files.
- An HTW API key (see README).
- Network access to `https://htwmedia.dpdns.org`.

## Installing the skills

```bash
npx -y github:HTWMedia/HTWSkills#v1.0.1 install
```

Installed locations:

- `~/.agents/skills/htw-media-*` — generic agents
- `~/.claude/skills/htw-media-*` — Claude Code (when present)

## Setting the key

| Shell | Command |
|---|---|
| PowerShell | `$env:HTW_API_KEY = "your-key"` |
| bash/zsh (macOS/Linux) | `export HTW_API_KEY="your-key"` |

The CLI reads the key from `HTW_API_KEY` only. If it is missing, the CLI prints
setup guidance and makes no live request.

## CLI reference

```text
htw-skills list                                    # list installed skills
htw-skills guide [feature]                         # print a skill's guide
htw-skills install [feature]                       # install skills (default all)
htw-skills call <feature> [options] [--dry-run]    # call the API
```

### call insight
`--video <url>` · `--account <url>` · `--copy <text>` · `--hot` ·
`--search <kw> --platform xhs|douyin|bilibili|toutiao`

### call create
`--type video|image|article --topic "..."` plus session control:
`--session-id X --approve | --regenerate "<指令>" | --refine "<反馈>" |
--toggle-step <stepId> --enabled true/false | --status`

### call publish
`--submit --title ... --content ... [--tags a,b] [--media-urls u1,u2]
[--platforms douyin,xhs] [--is-draft]` ·
`--status <taskId>` · `--queue` · `--history` · `--retry <subTaskId>` ·
`--compliance --content ...` · `--tags-gen --title ... --content ...` ·
`--content-gen --title ... [--media-hint ...]` · `--platform-status`

### call tools
`--audio-upload <file> --convert/--summarize/--separate/--lyrics` ·
`--subtitle <video> [--format srt]` · `--draft-upload <zip>` ·
`--draft-status <id>` · `--draft-decrypt <json>` ·
`--video-gen --theme "..." [--confirm-script ...]` ·
`--image-gen --prompt "..."` · `--recognize <img>` ·
`--template-search <kw>` · `--agent --theme "..."`

## Examples with AI clients

### Codex CLI

```text
Read the skill at ~/.agents/skills/htw-media-insight/SKILL.md, then analyze
this video URL and summarize the top 5 insight points: https://...
```

### Claude Code

```text
Use the htw-media-insight skill to analyze: https://...
```

### Generic AI (any assistant that reads the installed skills)

Ask it to "read ~/.agents/skills/htw-media-publish/SKILL.md and draft + submit
a post about ...".

## Troubleshooting

- **401 / 402** — key missing, invalid, or expired. Re-request via the
  `/auth/applykey` flow.
- **"未配置 Cookie"** — the tool needs a platform cookie configured server-side.
- **HTW_API_KEY not set** — the CLI prints setup guidance; export the key first.
- **fetch failed / ECONNREFUSED** — check network access to
  `https://htwmedia.dpdns.org`.
