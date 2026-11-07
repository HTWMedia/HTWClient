# htw-media-edit API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.
All endpoints below run on the cloud base URL. `draft-export` / `draft-status` used to
require a local instance; that restriction is gone (2026-11-07). Rendering now happens
on the server, but with the **caller's own** Jianying login — there is no site account
pool. `--local-base` is an optional override only.

| Method | Path | Fields |
|---|---|---|
| POST | `/api/v2/edit/coarse-cut` | multipart `video`, form `voice`, `durationMin`, `durationMax`, `blur` → `{ taskId }` |
| POST | `/api/v2/edit/draft-export` | multipart `file` (CapCut draft ZIP, must contain `draft_content.json`) + **required** form `jianyingCookie` → `{ taskId, warnings }` |
| POST | `/api/v2/edit/super-res` | multipart `video`, form `width`, `height` → `{ taskId }` |
| POST | `/api/v2/edit/decrypt` | multipart `file` (.json ≤ 50MB) → `{ isPlain, msg, draft_content }` |
| — | ~~`/api/v2/edit/cutsame/*`~~ | **已下线（2026-11-06）**，返回 410。模板与素材版权属于剪映及模板作者，站外提供同类服务已有生效判决认定构成不正当竞争。 |
| GET | `/api/v2/edit/status/{taskId}` | path `taskId` → `{ status, phase, progress, currentStep, downloadUrl, outputFile, error }`（云端任务：粗剪 / 超分 / 智能包装） |
| GET | `/api/v2/edit/draft-status/{taskId}` | path `taskId` → 同上字段；`downloadUrl` 是**绝对**地址 |

剪同款已整体下线。要出片请走两条路：`draft-export`（用户自己的草稿工程）
或 `coarse-cut` / 智能包装（从素材开始）。

`draft-export` 由服务端**执行**，但用的是**调用方自己的剪映登录**：`jianyingCookie`
必填，缺了直接 400（站方不持有账号池、不轮换账号）。服务端不存、不落盘，只随这一次
请求用一次。**按成片时长计费**——提交前先过额度闸门（不足回 402），并受并发 / 每分钟
提交频次限制（超限回 429，带 `concurrency`、`perMinute` 两个上限字段）。进度查询必须用
`draft-status`（`edit/status` 仍然只服务粗剪 / 超分 / 智能包装那三条）。

> 历史：2026-11-07 白天曾把 `draft-export` 改成"只在本机执行、云端一律 410"，
> 同日晚间回退为服务端执行，410 已撤销；Cookie 必填这一条没变。`--local-base` 仍可用，
> 只是不再是前提。

Errors: missing/invalid key → HTTP 401; quota exceeded → HTTP 402（含 `redirectUrl`）;
并发或频次超限 → HTTP 429; bad input → HTTP 400; unknown task → HTTP 404.
The body is the V2 envelope `{ ok, errCode, errMsg }`.

When `status = completed`, download the result from `downloadUrl`
(e.g. `/Download/draft_20260825xxxx.mp4`). While `status = running`, `progress`
(0–100) and `currentStep` describe progress; poll every few seconds.
