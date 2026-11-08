# htw-media-shortdrama API reference (短剧创作 / storyboard gateway)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`. These routes
are `[AllowAnonymous]`: upstream credentials are resolved server-side.

| Method | Path | Body / query | Returns (v1 envelope) |
|---|---|---|---|
| POST | `/api/studio/compose` | `{ text, conversationId? }` | `data.text`, `data.conversation_id` |
| GET | `/api/studio/doc/{conversationId}` | — | `data.doc_text` (剧本正文) |
| POST | `/api/doubao/generate-video` | `{ prompt, model?, ratio?, durationSeconds?, referenceImagePath?, clientRequestId? }` | **202** + `data.job_id`, `data.status`, `data.stage`, `data.retry_after_seconds`, `data.poll_url` (async task; standalone clip generation) |
| GET | `/api/doubao/generate-video/jobs/{job_id}` | — | `data.status` (`queued`/`running`/`succeeded`/`failed`), `data.stage`, `data.video_url`, `data.model`, `data.elapsed_seconds`, `data.error` |
| GET | `/api/studio/skills` | — | 可用技能列表 |

## compose (短剧编排)

- First call: `text` = the creative premise (e.g. “帮我做个短剧：…”); auto-routes
  to the 短剧编排 skill. Returns `conversation_id`.
- Continuation calls: pass the same `conversationId` with `text` = a refinement
  / stage instruction (“生成分镜” / “合成成片” …) to advance 规划 → 剧本 →
  分镜 → 成片.
- `data.text` holds the current stage output (plan / script / storyboard plan).

## doc

- `GET /api/studio/doc/{conversationId}` returns the full script document text
  produced by the skill.

## generate-video (独立片段生成，异步)

提交只入队，立刻返回 `202` 与 `job_id`；生成过程在服务端独立跑，客户端不再
挂着一条 HTTP 连接等 1~5 分钟。

```bash
curl -s -X POST "$BASE/api/doubao/generate-video" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"prompt":"生成一段5秒视频：一只柴犬在沙滩海边奔跑"}'
# -> {"success":true,"data":{"job_id":"...","status":"queued","stage":"queued",
#      "retry_after_seconds":10,"poll_url":"/api/doubao/generate-video/jobs/..."}}

curl -s "$BASE/api/doubao/generate-video/jobs/<job_id>" -H "$AUTH"
# -> {"success":true,"data":{"status":"succeeded","stage":"done","video_url":"https://...",
#      "model":"...","elapsed_seconds":96,"error":null}}
```

轮询要点：

- 终态只有 `succeeded` / `failed`；`queued` 与 `running` 都按在跑处理。
- 间隔按 `retry_after_seconds`（默认 10s），比它更密没有意义。
- `stage` 是生成链路的内部词（`uploading` / `submitting` / `polling` /
  `confirming` / `finalizing`），不要原样抛给用户。
- `404` 表示任务记录已过保留期（180 分钟），不是服务出错；成片请到豆包网页会话找。
- 失败时 `data.error` 是上游原文，直接透出，别改写成「请检查凭据」。

> 旧的 `POST /api/studio/video`（同步阻塞整段生成）仍然可用，但桌面端已不再走它：
> 实测 700s 左右会被客户端判死，而豆包侧其实还在正常出片，成片就白丢了。

## Notes

- Envelope is v1: `{ success: true, data: {...} }` or `{ success: false, error: "..." }`.
  The submit call breaks the `200` convention on purpose: it returns **202 Accepted**.
- The skill is rate-limited server-side; on `success:false` retry later.
- Storyboard clips and the final composed video are produced by the 短剧 skill;
  surface any `douyinvod` video URL found in `data.text` as the clip / final video.
