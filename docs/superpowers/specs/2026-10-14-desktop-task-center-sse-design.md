# 桌面端任务中心与 SSE 实时化 —— 设计文档

- 日期：2026-10-14（2026-10-14 修订：服务端 publish 域缺陷已先行修复，不再是零改动）
- 目标仓库：`D:\HTWClient`（桌面客户端）
- 服务端仓库：`D:\HTWCore.Web`（仅 publish 域 SSE 终态一处修复，见 §5.3）

---

## 1. 背景与目标

桌面端目前有 12 个侧边栏面板，其中 8 个会产生长任务，各自手写状态轮询与进度渲染，彼此不通气。由此产生两个具体缺陷：

1. **进度不实时**：全部靠 2~6 秒轮询。服务端 `V2StreamController` 已提供 SSE 推送，但桌面端从未使用 —— agent 接口返回的 `streamUrl` 字段被展示后即丢弃。
2. **任务不跨会话**：批量、工作流、短剧的任务标识只存在内存变量里，客户端重启即丢失。用户既看不到历史，也无法在重启后继续观察仍在服务端运行的任务。

### 目标

- 新增侧边栏第 13 项「任务中心」，统一登记、展示、持久化全部长任务。
- 对服务端已支持 SSE 的域改用推送，非 SSE 域保留轮询；两者对用户无感。
- 客户端重启后能接回仍在运行的任务。

### 非目标

- 不统一各面板的进度条样式，不改面板渲染逻辑。
- 不改后端出片/发布业务逻辑（仅修 publish 域 SSE 的终态缺陷）。
- 不做任务重命名、备注、搜索、标签、多 Key 切换。

---

## 2. 硬约束：SSE 必须在主进程

这一条决定了整个架构，不可绕过。

**约束 1 —— 鉴权只认请求头。** `ApiKeyAuthHandler.HandleAuthenticateAsync`（`D:\HTWCore.Web\ApiKeyAuthHandler.cs:30-35`）只从 `AuthKey` 或 `X-API-KEY` 头取值，无 query 参数回退、无 Cookie 回退。浏览器原生 `EventSource` 无法设置自定义头。

**约束 2 —— CORS 挡死渲染进程直连。** 渲染进程页面来自 `file://`，其 `Origin` 为 `null`；`CorsOrigins.IsAllowed`（`D:\HTWCore.Web\Services\CorsOrigins.cs:26-42`）对空值直接 `return false`，白名单只有 github.io / localhost / 127.0.0.1 / `htwmedia.dpdns.org`。且 `AuthKey` 属非简单头会触发预检，请求在到达业务层前即被拒。

**结论**：SSE 连接只能由主进程用 Node `http` 发起。这同时是安全上的加分项 —— 现有全部网络访问本就经 preload 转发，不引入新信任面；且 `preload.js` 已有来源白名单机制（`registerBase`），新通道沿用同一约束。

---

## 3. 架构与组件边界

渲染进程新增 2 个文件、修改 1 个；主进程修改 2 个。服务端仅有 §5.3 描述的一处终态修复，且已先行合入。

```
渲染进程
├─ js/tasks.js                【新增】任务容器（唯一真源）
│    ├─ registerTask()        面板在最外层登记，拿到任务标识时调用一次
│    ├─ watch()               SSE 优先，失败静默降级轮询
│    ├─ cancel()              按白名单取消
│    ├─ onChange(listener)    订阅变更
│    ├─ restore()             启动时逐个重查
│    └─ 落盘                  经 saveJson，2s 尾随节流
│
├─ js/skills/tasks-panel.js   【新增】第 13 个面板（只读容器 + 取消 + 下载）
│
└─ js/api.js                  【改】仅新增 subscribeTask / unsubscribeTask 两个转发

主进程
├─ main.js                    【改】SSE 连接池 + 2 个 IPC 通道
└─ preload.js                 【改】暴露 htw:subscribe / htw:unsubscribe / htw:onStreamEvent
```

### 3.1 边界原则

**容器只回答「这个任务现在什么状态」，不负责「怎么渲染」。**

容器是并行的旁路观察者；面板是原有的主路渲染者。两者仅通过任务标识关联，互不依赖。面板现有的进度条、日志、审批门一概不动。这是「面板暂不改」得以成立的前提。

面板的接入点仅一处：在拿到 `taskId` / `sessionId` / `workflowId` / `batchId` 之后、开始自身轮询之前，调用一次 `Tasks.registerTask({ domain, taskId, panel, title, type })`。`type` 仅 `creation` 域需要。

### 3.2 域注册表

```js
var DOMAINS = {
  agent:       { sse: true,  cancel: false, status: t => get("/api/v2/agent/status?taskId=" + t) },
  marketvideo: { sse: true,  cancel: true,
                 cancelFn:   t => post("/api/v2/market-video/cancel", { TaskId: t }),
                 status:     t => get("/api/v2/market-video/status?taskId=" + t) },
  voice:       { sse: true,  cancel: false, status: t => get("/api/v2/voice/status/" + t) },
  subtitle:    { sse: true,  cancel: false, status: t => get("/api/v2/subtitle/status/" + t) },
  publish:     { sse: true,  cancel: false, status: t => get("/api/v2/publish/task-status?taskId=" + t) },
  creation:    { sse: false, cancel: false, status: t => get("/api/v2/creation/status?sessionId=" + t + "&type=" + encodeURIComponent(t.type)) },
  workflow:    { sse: false, cancel: true,
                 cancelFn:   t => post("/api/v2/workflow/cancel", { WorkflowId: t }),
                 status:     t => get("/api/v2/workflow/status?workflowId=" + t) },
  batch:       { sse: false, cancel: true,
                 cancelFn:   t => post("/api/v2/batch/cancel", { BatchId: t }),
                 status:     t => get("/api/v2/batch/status?batchId=" + t) },
  edit:        { sse: false, cancel: false, status: t => get("/api/v2/edit/status/" + t) },
  image:       { sse: false, cancel: false, status: t => get("/api/v2/image/status?taskId=" + t) },
};
```

`creation` 域的状态端点需要 `type` 查询参数（`create.js` 按当前标签页传 `video` / `image` / `article`），因此该域的任务记录额外携带一个 `type` 字段，见 §4。

### 3.3 面板到域的映射

| 面板 | 登记的域 | 登记时机 |
|---|---|---|
| 短剧创作 | `agent` | 提交生成、拿到 taskId 时 |
| 营销成片 | `marketvideo` | 提交生成、拿到 taskId 时 |
| 工具 | `voice` / `subtitle` / `agent` / `image` | 各自提交后，按工具种类分别登记 |
| 发布 | `publish` | 提交成功、拿到 taskId 时 |
| 创作 | `creation`（附 `type`） | `start` 返回 sessionId 时 |
| 工作流 | `workflow` | `create` 返回 workflowId 时 |
| 批量 | `batch` | 提交成功、拿到 batchId 时 |
| 剪辑 | `edit` | 提交成功、拿到 taskId 时 |

**扩展路径**：服务端将来若为 `creation` / `workflow` / `batch` / `edit` / `image` 补上 SSE 域，只需把对应条目的 `sse` 改为 `true`，面板与任务中心代码一行不动。本次不实施。

---

## 4. 数据模型

```js
{
  id:        "t_ab12cd34",   // 容器内自增标识，与服务端任务标识解耦
  domain:    "agent",         // 域注册表键，决定走 SSE 还是轮询
  taskId:    "srv-xxxx",     // 服务端标识；creation 用 sessionId、workflow 用 workflowId、batch 用 batchId
  type:      null,            // 仅 creation 域使用：video / image / article
  panel:     "shortdrama",    // 来源面板，供「回到面板」跳转
  title:     "短剧创作 · 都市逆袭",
  status:    "running",       // running | done | failed | canceled | interrupted
  unknown:   false,           // 最近一次状态查询失败，真实状态未知（见 §6.1）
  progress:  62,              // 0-100，允许 null（见 §4.1）
  step:      "合成中",        // 当前步骤文案，允许 null
  transport: "sse",           // sse | poll | none
  degraded:  false,           // 曾降级过则永久 true（只增不减）
  result:    null,            // 终态产物描述 { fileName }，不含地址（见 §6.3）
  error:     null,
  createdAt: 1791943264000,
  updatedAt: 1791943301000,
  endedAt:   null,
}
```

### 4.1 三处刻意的设计选择

**`id` 与 `taskId` 解耦。** 服务端任务标识四域形态各异（裸 id / `sessionId` / `workflowId` / `batchId`），容器需要一个统一主键来渲染列表、更新状态与发送取消。

**`progress` 允许 `null`，绝不伪造。** 创作、工作流、批量三个接口的进度语义本质不同（批量是逐条目计数、工作流是四阶段跟踪）。把它们硬凑成一个百分比就是在骗用户。`null` 时 UI 退化为「状态点 + 步骤文案」。

**`degraded` 与 `transport` 分开。** `transport` 反映当前实际通道（会变），`degraded` 记录历史事实（只增不减），用于排查「为什么这个面板感觉慢」。

---

## 5. SSE 生命周期与静默降级

### 5.1 状态机

```
watch(task)
  ├─ 注册表查 sse 标志
  ├─ sse:false ─────────────────────────────► pollLoop(3s)
  └─ sse:true ─► subscribe(domain, taskId)
       ├─ 收到首个 data ─────────► transport="sse"，正常
       ├─ 连接报错 / 8s 未收到首事件 ─► 静默切 pollLoop(3s)，degraded=true
       └─ 中途断流 ─► 重连 1 次(2s)；仍失败则切 pollLoop，degraded=true

终态判定（两路满足其一即结束）
  ├─ 服务端发出 event: end
  └─ 载荷 status ∈ { success, completed, failed, canceled, cancelled, error }
```

降级对用户完全无感：面板本来就在用自己的轮询，容器降级只是它自己从推送切到轮询。面板不知道、也不需要知道容器存在。

### 5.2 已知服务端缺陷：publish 域的流不会自行结束

`V2StreamController.Snapshot` 对 publish 分支返回的状态字符串是空（`D:\HTWCore.Web\Controllers\Api\V2\V2StreamController.cs:169`），而 `IsTerminal("")` 返回 `false`（同文件 `:221-223`）。因此 publish 的 SSE 只能等满 60 分钟上限才断开。

载荷中实际带有真实状态（`PublishManager.GetTaskStatus` 返回的 `task.Status`），服务端未用它判终态。

**客户端应对**：终态判定必须包含「按载荷自行判定并主动断流」，不可只等 `event: end`。原因有二：publish 域的服务端缺陷（§5.3）虽已修复，但客户端不应把流的生命周期绑定在服务端实现细节上；且其余 SSE 域同样不会主动下发终态事件。

### 5.3 服务端 publish 域缺陷（已修复，先于本设计落地）

原计划客户端自行规避，评审后决定直接修服务端。提交：`0942b4c`。

**根因是两个缺陷叠加**，缺一不可：

1. `V2StreamController.Snapshot` 的 publish 分支把「终态检测用的状态」硬编码为 `""`（原 `:169`），而 `IsTerminal("")` 恒为 false。
2. `IsTerminal` 的列表里没有 `partial_failed`。而 `PublishManager.FinalizeTask` 的判定是「任一子任务 ≠ success 即算」，因此抖音人工发布（`awaiting_manual`）、存草稿（`draft_saved`）、未取到证据（`unconfirmed`）**全部落进 `partial_failed`** —— 也就是说最常见的发布结局都不在终态表里。

`PublishTasks.Status` 的取值全集只有四个：`pending`（INSERT）、`running`（起跑 / 重试拉回）、`completed`、`partial_failed`。

**修复**：
- `PublishManager` 增加 `GetTaskStatusWithStatus`，把主任务状态与载荷一次返回（沿用同一次 `LoadTask`，不额外查库）；原 `GetTaskStatus` 改为委托，既有调用方行为不变。
- `Snapshot` 的 publish 分支返回真实状态。
- `IsTerminal` 补 `partial_failed`。

**对客户端的影响**：客户端**仍然**必须按载荷自行判终态并主动断流（见 §5.2）。服务端修的是「服务端不再无谓挂满 60 分钟」，客户端保留自行判定是为了不让流生命周期依赖服务端实现细节 —— 两者都要，不是二选一。

**回归测试**：`HTWCore.Web.Tests/Controllers/Api/V2/V2StreamPublishDomainTests.cs` —— 钉住 `partial_failed` 是终态、`pending`/`running`/`uploading` 不是、空串不是；以及 publish 分支返回真实主任务状态、越权按 notfound 处理。

---

## 6. 重启恢复、取消与下载

### 6.1 启动恢复

在 `app.js` 启动序列中，读完配置与 AuthKey 之后、`mountSkills()` 之前插入 `Tasks.restore()`：

```
读 htw-tasks.json（上限 200 条）
└─ 对每条 status === "running" 的任务，各发【一次】状态查询（不轮询、不并发）
   ├─ 返回进行中
   │    ├─ SSE 域 → 重新订阅（同一任务标识，服务端仍在跑）
   │    └─ 非 SSE 域 → 重开轮询（3s）
   ├─ 返回 notfound / 任务不存在
   │    └─ status="interrupted"，error="服务端已无此任务（Web 服务可能已重启）"
   └─ 请求本身失败（网络故障 / 401）
        └─ **status 保持 "running"**，置 unknown=true，error 记录失败原因
```

**最后一条是硬要求。** 服务端 `VideoGenTaskManager` / `AgentTaskManager` / `AudioTaskManager` 均为进程内存态。客户端启动瞬间，服务端可能尚未就绪，或 AuthKey 正待续期 —— 这两种情况都会被 `api.js` 的 `normalize()` 归为一次「失败」。若据此判定任务已死，即为误报。

`unknown=true` 的任务在面板中照常显示为进行中，只是步骤文案后附「（状态未确认）」。下一次状态查询成功即清除该标记。

启动开销为 N 次请求。N ≤ 200，但实际非终态任务通常为个位数。

### 6.2 取消

白名单三域。请求体**必须为 PascalCase** —— 服务端 MVC 走 Newtonsoft，仓库中现有三处调用均为 PascalCase；`api.js` 的 `camelize` 只作用于响应，不作用于请求体。

| 域 | 端点 | 请求体 | 现有调用位置 |
|---|---|---|---|
| `marketvideo` | `POST /api/v2/market-video/cancel` | `{ TaskId }` | `js/skills/marketing.js:113` |
| `batch` | `POST /api/v2/batch/cancel` | `{ BatchId }` | `js/skills/batch.js:482` |
| `workflow` | `POST /api/v2/workflow/cancel` | `{ WorkflowId }` | `js/skills/workflow.js:516` |

其余七域**不渲染取消按钮**（不做置灰占位，避免无效交互）。取消成功后容器将任务标记 `canceled`，并停止其 SSE 连接或轮询。

### 6.3 产物与下载

**容器不缓存下载地址。** 后端的 `downloadUrl` 带短时效凭证（`DownloadTokens`），缓存下来到期即为死链。

任务行点击「下载」时才现取：SSE 域从最近一次事件载荷读取（agent 域每次事件均携带 `downloadUrl`），非 SSE 域现场查一次状态端点。

下载复用现有两条通路，不新增：跨域 CDN 链接走 `window.htw.openExternal`；需带凭证的走 `api.download()` → Blob（短剧分镜缩略图已是此实现）。

`interrupted` 状态的任务不显示下载按钮。

---

## 7. 任务中心面板

沿用现有面板约定：`js/skills/tasks-panel.js` 导出 `Tasks.mount(panel)`；`index.html` 增加 `<section id="panel-tasks">`；`app.js` 的 `SKILLS` 白名单（`js/app.js:5`）增加 `"tasks"`。现有 `js/app.panels.test.mjs` 会自动校验这三处一致性，无需修改该测试。

### 7.1 布局

```
┌ 进行中 2   已完成 18   失败 1   [ 清空已完成 ] ┐
├───────────────────────────────────────────────┤
│ ● 短剧创作 · 都市逆袭              [已降级]     │
│   ▓▓▓▓▓▓▓░░░ 62%   合成中 · 约剩 3 分钟       │
│                             [回到面板] [取消]  │
├───────────────────────────────────────────────┤
│ ◐ 营销成片 · 保温杯                            │
│   ▓▓░░░░░░░ 25%   生成配音                    │
├───────────────────────────────────────────────┤
│ ✓ 图文成片 · 春季新品          12:04   [下载]  │
├───────────────────────────────────────────────┤
│ ✕ 批量 · 商品A 失败                [重试][详情] │
└───────────────────────────────────────────────┘
```

### 7.2 交互规则

- 分组顺序：进行中 → 失败 → 已完成。后两组默认折叠，各显示前 20 条。
- `progress` 为 `null` 的任务不绘制进度条，退化为状态点 + 步骤文案。
- 「重试」仅在失败任务上出现，行为是**切回来源面板**（`showPanel(task.panel)`），不自动重发 —— 自动重发会二次扣减额度，必须由人确认。
- 「清空已完成」只移除终态记录，不影响运行中任务。
- 没有任何真实产物的任务（`interrupted`）不显示下载按钮。

---

## 8. 主进程 SSE 客户端

### 8.1 可测性拆法

将「解析 SSE 行」抽为纯函数，不触碰 `http` 对象：

```js
parseSseChunk(remainder, chunk) -> { events, remainder }
```

这样 `node --test` 可直接覆盖分包边界 —— 一条 `data:` 跨两个 TCP 包到达是最易出错之处。keepalive 注释行（`: ka`）必须被忽略。

### 8.2 连接管理

- 连接池以 `streamId`（`domain + ":" + taskId`）为键。
- 同一 `streamId` 重复订阅时复用既有连接，不重复发起。
- 任务进入终态、面板卸载或窗口关闭时销毁连接并 `req.destroy()`。

### 8.3 IPC 契约

```
主进程 → 渲染进程   htw:stream-event   { streamId, type: "data"|"end"|"error", payload }
渲染进程 → 主进程   htw:subscribe      { streamId, domain, taskId, base, apiKey }
渲染进程 → 主进程   htw:unsubscribe    { streamId }
```

`htw:subscribe` 的 `base` 必须先经现有 `registerBase` 白名单校验，与 `htw:call` 同一约束。

---

## 9. 错误处理

| 情况 | 行为 |
|---|---|
| SSE 连不上 / 8s 无首事件 | 静默切轮询，`degraded=true` |
| SSE 中途断流 | 重连 1 次（2s），仍失败则切轮询 |
| 载荷 `status: notfound` | 标记 `interrupted` |
| 状态查询请求失败（非 404/401） | `status` 不变，置 `unknown=true` |
| HTTP 401 | 走既有 `key-warning` 横幅，不重复报错 |
| HTTP 402 | 走既有 `onQuotaExceeded` 横幅（复用 `api.js` 已有机制） |
| 取消请求失败 | 按钮恢复可点，错误显示在任务行内，不弹全局 |
| 写盘失败 | 吞掉，内存态继续工作；落盘失败不得影响任务执行 |
| 超过 200 条 | 丢弃最旧的终态记录；运行中任务永不淘汰 |

---

## 10. 测试

沿用现有 `npm test`（`node --test`，当前 6 个测试文件），新增 3 个：

| 文件 | 覆盖内容 |
|---|---|
| `js/tasks.test.cjs` | 终态判定（含 publish 的 `partial_failed` 与三个非成功子任务终态）；200 条淘汰且运行中任务不被淘汰；PascalCase 请求体构造；下载地址现取不缓存 |
| `js/tasks-sse.test.cjs` | `parseSseChunk` 分包边界：一个事件跨 3 个 chunk 到达；`data:` 被切在包中间；忽略 keepalive 行 |
| `js/skills/tasks-panel.mount.test.cjs` | 对齐现有 `workflow.mount.test.cjs` 写法；mount 不抛异常；`progress: null` 时渲染不崩 |

现有 `js/app.panels.test.mjs` 自动覆盖 `index.html` / `SKILLS` / `mount` 三处一致性，**不需修改**。

不新增端到端测试 —— 现有 E2E 仅 `test/marketing-e2e.mjs` 一个且依赖真实 `HTW_API_KEY`，继续增加只会引入需要联网的脆弱测试。

---

## 11. 风险

1. **Cloudflare 长连接限制**是最大的不确定性。降级路径即为它而设；`degraded` 徽标使上线后能立即观测到实际降级率。
2. **写入压力**：批量场景（单批上限 50 条）会产生密集状态变更，靠 2s 尾随合并压缩。
3. **请求量上升**：非 SSE 域容器降级后会与面板各自轮询一次，`creation` / `workflow` / `batch` / `edit` / `image` 五域流量接近翻倍。可接受，但需知悉。
4. **双渲染的短暂不一致**：容器与面板各自持有进度，切到任务中心的那一瞬间两者可能差一个进度点。不做同步 —— 为一个进度点的差异引入双向同步，收益远低于复杂度。

---

## 12. 交付顺序

1. `parseSseChunk` 纯函数 + 单测（无外部依赖，可独立验证）
2. 主进程 SSE 连接池 + IPC 通道
3. `js/tasks.js` 容器（注册表、状态机、降级、落盘、恢复）
4. `js/skills/tasks-panel.js` 面板 + 三处注册
5. 按 §3.3 映射表，为 8 个面板各接入一处 `registerTask` 调用（助手与设置面板不产生任务，不接入）