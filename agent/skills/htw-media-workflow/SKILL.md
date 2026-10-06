---
name: htw-media-workflow
description: Run the end-to-end content pipeline (topic selection to finished video to packaging to publish) on the HTW platform via the v2 workflow API — auto-pick topics from hot rankings, start single or batch workflows, poll stage progress, review and approve publishing, cancel, and list history. Use when the user wants the whole chain run automatically instead of clicking each step.
---

# HTW Media Workflow (v2)

Auth is via the `HTW_API_KEY` environment variable. Every request sends the
`AuthKey` header. Response envelope: `{ ok: true, data, errCode, errMsg }`
or `{ ok: false, errCode, errMsg }`.

A workflow runs four stages in sequence, driven server-side:
`produce`(出片) → `package`(智能包装) → `compose`(文案/标签/合规) → `publishing`(发布).
You start it once and then poll; you do **not** call each stage yourself.

## Usage

```bash
# 1) 看自动选题候选（已剔除该账号跑过的主题，按潜力分降序）
htw-skills call workflow --topics --count 6

# 2) 发起一条（--topic 手动给主题；不给且 --auto 则由服务端挑最高分那条）
htw-skills call workflow --start --topic "秋天的第一杯咖啡" --platforms douyin,xhs
htw-skills call workflow --start --auto --platforms douyin

# 3) 一次跑多条（每条各自计费、也各自走完整链路）
htw-skills call workflow --start-batch "主题A" "主题B" "主题C" --platforms douyin

# 4) 查进度
htw-skills call workflow --status <workflowId>

# 5) 发布前人工确认（**必须由人做这一步**，见下）
htw-skills call workflow --approve <workflowId>

# 6) 其他
htw-skills call workflow --cancel <workflowId>
htw-skills call workflow --history --limit 30
```

## The publish gate — do not automate it away

A workflow stops at `awaiting-publish` and waits for `--approve`. This is
deliberate, not an unfinished feature: publishing runs on the **user's own
platform credentials**, and automated posting violates those platforms' terms
of service — which would risk the user's account.

So: never call `--approve` on the user's behalf without them first seeing and
approving the generated title, body, tags and compliance result. Fetch
`--status` and show that content to the user, then ask.

`autoPublish` exists in the API but the server requires it to be opted into
explicitly; leave it off.

## Notes

- **Polling**: each stage is a server-side task. Poll `--status` every ~6s.
  `produce` (script → voice → footage) usually takes minutes; `package` does a
  cloud render. Stages `completed` / `failed` / `cancelled` are terminal.
- **Quota and rate are counted per workflow**, not per request. A batch of N
  costs N units and consumes N rate tickets, so a free-tier account may get
  fewer than N accepted — check `rejected[]` and offer to submit the remainder
  a minute later. `rejected[].index` is the **original** index in your
  submitted array.
- **Errors**: 402 quota exhausted · 401 key invalid/expired · 429 rate or
  concurrency limit · 503 no usable Jianying account.
- An `awaiting-publish` workflow that nobody confirms is closed as `failed`
  after 24h. If a user wants to publish later, re-create it rather than
  assuming it is still waiting.
- Full request/response fields: see `references/api.md`.
