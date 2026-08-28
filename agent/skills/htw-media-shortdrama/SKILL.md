---
name: htw-media-shortdrama
description: Generate short-drama videos (短剧创作) on the HTW platform via the Doubao skill gateway — plan → script → storyboard (Seedance) → final video, driven by a multi-turn conversation. Use when the user wants AI-generated short dramas / micro-films / animated shorts from a creative premise.
---

# HTW Media ShortDrama (短剧创作)

Auth is via the `HTW_API_KEY` environment variable (header `AuthKey`). The
short-drama pipeline is exposed through the **Doubao skill gateway**
(`/api/studio/*`), which the server drives with its configured 豆包 account —
it is not part of the generic v2 creation API.

## Flow

1. **Start / advance** — `POST /api/studio/compose` with `{ text, conversationId? }`.
   The first call triggers the 短剧编排 skill (规划 → 剧本 → 分镜 → 成片);
   subsequent calls reusing the returned `conversationId` refine or advance
   stages. Returns `{ text, conversation_id }`.
2. **Storyboard (Seedance)** — continue the conversation with an instruction
   like “调用 Seedance 生成分镜视频”; the skill produces storyboard clips.
3. **Final video** — continue with “合成最终短剧成片视频”; the skill composes.
4. **Script doc** — `GET /api/studio/doc/{conversationId}` returns the script text.

## curl

```bash
BASE=https://htwmedia.dpdns.org
AUTH="AuthKey: $HTW_API_KEY"

# 开始创作（自动路由短剧编排技能）
curl -s -X POST "$BASE/api/studio/compose" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"text":"帮我做个短剧：一只流浪猫的职场逆袭，30秒，搞笑温情"}'
# -> {"success":true,"data":{"text":"...阶段输出...","conversation_id":"..."}}

# 续写 / 推进到分镜、成片（带 conversationId）
curl -s -X POST "$BASE/api/studio/compose" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"text":"调用 Seedance 生成分镜视频","conversationId":"<conversation_id>"}'

# 查看剧本
curl -s "$BASE/api/studio/doc/<conversation_id>" -H "$AUTH"
# -> {"success":true,"data":{"doc_text":"..."}}
```

The HTW desktop client also ships a dedicated **短剧创作 ShortDrama** panel
(left sidebar) that drives the same gateway with one click.

## Notes

- Responses use the v1 envelope `{ success, data, error }` (not the v2 `{ ok, data }`).
- The 短剧 skill is rate-limited by the server's 豆包 account; a
  `success:false` with a 频繁 / 额度 message means retry later.
- `POST /api/studio/video` is a standalone Seedance clip generator; on some
  accounts the Seedance web skill is unavailable, so prefer driving storyboards
  through the 短剧 skill conversation above.
