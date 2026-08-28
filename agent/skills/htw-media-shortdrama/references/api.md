# htw-media-shortdrama API reference (短剧创作 / Doubao skill gateway)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`. These routes
are `[AllowAnonymous]`: the server uses its configured 豆包 account server-side.

| Method | Path | Body / query | Returns (v1 envelope) |
|---|---|---|---|
| POST | `/api/studio/compose` | `{ text, conversationId? }` | `data.text`, `data.conversation_id` |
| GET | `/api/studio/doc/{conversationId}` | — | `data.doc_text` (剧本正文) |
| POST | `/api/studio/video` | `{ prompt, conversationId? }` | `data.video_url`, `data.model`, `data.text` (standalone Seedance; may be unavailable on some accounts) |
| GET | `/api/studio/skills` | — | 可用技能列表 |

## compose (短剧编排)

- First call: `text` = the creative premise (e.g. “帮我做个短剧：…”); auto-routes
  to the 短剧编排 skill. Returns `conversation_id`.
- Continuation calls: pass the same `conversationId` with `text` = a refinement
  / stage instruction (“生成分镜” / “合成成片” …) to advance 规划 → 剧本 →
  分镜(Seedance) → 成片.
- `data.text` holds the current stage output (plan / script / storyboard plan).

## doc

- `GET /api/studio/doc/{conversationId}` returns the full script document text
  produced by the skill.

## Notes

- Envelope is v1: `{ success: true, data: {...} }` or `{ success: false, error: "..." }`.
- The skill is rate-limited by the server 豆包 account; on `success:false` retry later.
- Storyboard clips and the final composed video are produced by the 短剧 skill
  (internally via Seedance); surface any `douyinvod` video URL found in
  `data.text` as the clip / final video.
