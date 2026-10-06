# htw-media-workflow API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.

| Method | Path | Fields |
|---|---|---|
| GET | `/api/v2/workflow/topics` | query `count` (1–20) → `{ items: [{ id, title, hook, category, tags, score, nicheFit, evidence }], exhausted }` |
| POST | `/api/v2/workflow/create` | body `{ topic?, topicSource?, style?, ratio?, mode?, length?, voice?, referenceText?, publish: { platform?, platforms[], autoPublish } }` → `{ workflowId, stage, topic, topicSource, produceTaskId }` |
| POST | `/api/v2/workflow/create-batch` | body `{ topics[], style?, ratio?, mode?, length?, voice?, referenceText?, publish }` → `{ total, accepted, rejected: [{ index, error }], items: [{ index, workflowId, topic }] }` |
| GET | `/api/v2/workflow/status` | query `workflowId` → `{ workflowId, stage, topic, active, produceTaskId, packageTaskId, publishTaskId, title, content, tags, compliance, error, createdAt }` |
| POST | `/api/v2/workflow/approve` | body `{ workflowId, stage: "publish" }` → `{ approved: true }` |
| POST | `/api/v2/workflow/cancel` | body `{ workflowId }` → `{ cancelled: true }` |
| GET | `/api/v2/workflow/history` | query `limit` (1–100) → `{ items: [{ workflowId, stage, topic, title, error, createdAt }] }` |

## Stage machine

```
produce → package → compose → publishing → completed
                (compose may) → awaiting-publish → publishing
                                → failed (compliance not safe)
```

Terminal stages: `completed`, `failed`, `cancelled`. `active` in the status
response is true only for the four stages the server advances on its own
(`produce`, `package`, `compose`, `publishing`) — it is false for
`awaiting-publish`, which waits for a person.

`compliance` and `tags` come back as **JSON strings**, not objects
(the DB columns are TEXT): `tags` → `["a","b"]`, `compliance` →
`{ evaluated, safe, note }`.

## Quota and rate — counted per workflow

A workflow spans **two billable render stages**: `produce` (same as
`/api/v2/agent/one-click`) and `package` (same as `/api/v2/edit/smart-package`).
Both are charged. One workflow therefore costs roughly twice a single
one-click.

A batch of N costs N units and consumes N rate tickets. A free-tier account
(6/minute) submitting 20 usually gets 6 `accepted` and 14 in `rejected` with
`"提交过于频繁，请下一分钟补交剩余条目"` — resubmit the rest a minute later.
Never retry the whole batch at once.

## Publishing

The workflow stops at `awaiting-publish`. `POST /approve` submits to the
platforms. If the submit fails (e.g. expired platform cookie) the workflow
**stays** in `awaiting-publish` so it can be retried — it is not marked failed.
Publishing outcomes are three-way and must not be conflated:

| outcome | meaning | what to do |
|---|---|---|
| `completed` | published | done |
| `failed` | not published | may retry |
| `unconfirmed` | clicked publish, no success evidence | **verify on the platform first** — resending may post a duplicate |

`autoPublish: true` skips the gate but is refused unless explicitly enabled
server-side. It is deliberately off by default: automated posting uses the
user's own platform credentials and violates platform ToS.

## Errors

`401` key invalid/expired · `402` quota exhausted · `429` rate or concurrency
limit · `503` no usable Jianying account in the pool · `400` bad input ·
`404` unknown or expired workflow · `409` approve rejected (already past the
gate, or the workflow failed).

Gate order is fixed: static validation → account-pool precheck → quota →
rate/concurrency → create. Do not assume a different order.
