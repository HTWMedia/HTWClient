# 桌面端任务中心与 SSE 实时化 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给桌面端新增侧边栏第 13 项「任务中心」，统一登记与持久化全部长任务，并对服务端已支持推送的域改用 SSE、其余域保留轮询。

**Architecture:** 新增渲染进程单元 `js/tasks.js` 作为任务的唯一真源（只回答「这个任务现在什么状态」，不负责渲染），旁路观察各面板，面板的进度条与渲染逻辑一律不动。SSE 连接由**主进程**发起 —— 渲染进程是 `file://` 源且 `AuthKey` 属非简单头，服务端 CORS 与鉴权都会挡死直连，因此必须经 preload/主进程。主进程把 SSE 行解析抽成纯函数以便单测。

**Tech Stack:** Electron 31（主进程 / preload / 渲染进程三层）、原生 ES5/ES2017 浏览器 JS（无打包器、无框架）、`node --test`（`.cjs` 用 require，`.mjs` 用 import.meta）。

**设计文档：** `docs/superpowers/specs/2026-10-14-desktop-task-center-sse-design.md`

## Global Constraints

- 工作目录：`D:\HTWClient`。所有路径相对于仓库根。
- 本次**不改动任何服务端代码**。服务端 publish 域终态缺陷已在 `D:\HTWCore.Web` 单独修复（commit `0942b4c`），本计划只消费它。
- 现有面板的渲染逻辑、进度条、审批门**一律不改**。面板只在拿到任务标识后多调一次 `Tasks.registerTask()`。
- 降级对用户完全无感：SSE 失败只降级容器自己，面板不知道容器存在。
- 请求体必须 **PascalCase**（服务端 MVC 走 Newtonsoft）。`api.js` 的 `camelize` 只作用于响应，不作用于请求体。
- `progress` 允许为 `null`，**绝不伪造百分比**。创作/工作流/批量三域进度语义不同，为空时 UI 退化成状态点 + 步骤文案。
- `degraded` 只增不减（历史事实），`transport` 是当前实际通道（会变）。
- 上限 200 条任务记录；**运行中的任务永不淘汰**，只丢最旧的终态记录。
- 落盘经现有 `window.htw.saveJson("tasks", data)`（落 `userData/htw-tasks.json`），2 秒尾随节流。写盘失败必须吞掉，不得影响任务执行。
- 新增测试文件后必须同步更新 `apps/desktop/package.json` 的 `test` 脚本 —— 它是**显式文件列表**，不自动发现。
- 注释与提交信息使用中文。提交信息保持简洁、高层，不逐条罗列内部实现细节。
- 仓库里存在与本计划无关的未提交改动（`apps/desktop/css/app.css`、`apps/desktop/js/skills/workflow.js`）。**提交时只 `git add` 本计划列出的文件**，不要用 `git add -A`。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `apps/desktop/js/sse-parser.js`（新建） | SSE 分片 → 事件的纯函数解析。不碰 `http`，可单测。 |
| `apps/desktop/js/sse-parser.test.cjs`（新建） | 上者的分包边界测试。 |
| `apps/desktop/main.js`（改） | SSE 连接池 + 3 个 IPC 通道（`htw:allowBase` / `htw:subscribe` / `htw:unsubscribe`）。 |
| `apps/desktop/preload.js`（改） | 暴露 `subscribeTask` / `unsubscribeTask` / `onStreamEvent`，并把 `registerBase` 的结果同步给主进程。 |
| `apps/desktop/js/api.js`（改） | 新增 `subscribeTask` / `unsubscribeTask` 两个转发。 |
| `apps/desktop/js/tasks.js`（新建） | 任务容器：域注册表、记录存取、终态判定、落盘节流、watch 状态机、restore、cancel。 |
| `apps/desktop/js/tasks.test.cjs`（新建） | 容器的纯逻辑测试。 |
| `apps/desktop/js/tasks.watch.test.cjs`（新建） | watch 状态机（注入假依赖）的测试。 |
| `apps/desktop/js/skills/tasks-panel.js`（新建） | 任务中心面板（第 13 项）。 |
| `apps/desktop/js/skills/tasks-panel.mount.test.cjs`（新建） | 面板挂载冒烟测试。 |
| `apps/desktop/index.html`（改） | 加 nav 按钮、`panel-tasks` section、script 标签。 |
| `apps/desktop/js/app.js`（改） | `SKILLS` 白名单加 `"tasks"`；`boot()` 里插入 `Tasks.restore()`。 |
| `apps/desktop/package.json`（改） | `test` 脚本加入 4 个新测试文件。 |
| 8 个既有面板（改） | 各插入一处 `Tasks.registerTask()`。 |

---

## Task 1: SSE 分片解析纯函数

无依赖，先做。产出可独立验证的解析器，后续任务直接用。

**Files:**
- Create: `apps/desktop/js/sse-parser.js`
- Create: `apps/desktop/js/sse-parser.test.cjs`
- Modify: `apps/desktop/package.json`（`test` 脚本）

**Interfaces:**
- Consumes: 无
- Produces: `parseSseChunk(remainder, chunk) -> { events: Array<{event: string, data: string}>, remainder: string }`，由 `apps/desktop/js/sse-parser.js` 以 CommonJS `module.exports` 导出。

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/js/sse-parser.test.cjs`：

```js
const test = require("node:test");
const assert = require("node:assert");
const { parseSseChunk } = require("./sse-parser.js");

/*
 * 服务端 V2StreamController 下发的帧只有两种：
 *   "data: {json}\n\n"   —— 状态快照
 *   ": ka\n\n"           —— keepalive 注释
 *   "event: end\ndata: {}\n\n"
 * 最易错的是一条 data 被 TCP 拆到两个包里，所以解析必须是无状态的
 * （靠 remainder 续接），不能假设一个 chunk 就是一个完整事件。
 */

test("单包内的一个完整事件", () => {
  const r = parseSseChunk("", 'data: {"status":"running"}\n\n');
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].event, "message");
  assert.strictEqual(r.events[0].data, '{"status":"running"}');
  assert.strictEqual(r.remainder, "");
});

test("keepalive 注释行必须被忽略", () => {
  const r = parseSseChunk("", ": ka\n\n");
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.remainder, "");
});

test("一个事件跨三个 chunk 到达", () => {
  let r = parseSseChunk("", 'data: {"sta');
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.remainder, 'data: {"sta');

  r = parseSseChunk(r.remainder, 'tus":"run');
  assert.strictEqual(r.events.length, 0);

  r = parseSseChunk(r.remainder, 'ning"}\n');
  assert.strictEqual(r.events.length, 0);

  r = parseSseChunk(r.remainder, "\n");
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].data, '{"status":"running"}');
  assert.strictEqual(r.remainder, "");
});

test("end 事件带自定义 event 名", () => {
  const r = parseSseChunk("", "event: end\ndata: {}\n\n");
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].event, "end");
  assert.strictEqual(r.events[0].data, "{}");
});

test("同一次调用里多个事件", () => {
  const r = parseSseChunk("", 'data: {"n":1}\n\ndata: {"n":2}\n\n');
  assert.strictEqual(r.events.length, 2);
  assert.strictEqual(r.remainder, "");
});

test("末尾不完整的块留在 remainder 里", () => {
  const r = parseSseChunk("", 'data: {"n":1}\n\ndata: {"n":2');
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.remainder, 'data: {"n":2');
});

test("多行 data 用换行拼接（按 SSE 规范）", () => {
  const r = parseSseChunk("", "data: a\ndata: b\n\n");
  assert.strictEqual(r.events[0].data, "a\nb");
});

test("没有前导空格的值也能取到", () => {
  const r = parseSseChunk("", "data:{\"n\":1}\n\n");
  assert.strictEqual(r.events[0].data, '{"n":1}');
});
```

- [ ] **Step 2: 运行测试，确认因模块不存在而失败**

Run: `cd apps/desktop && node --test js/sse-parser.test.cjs`

Expected: FAIL，报 `Cannot find module './sse-parser.js'`

- [ ] **Step 3: 写实现**

创建 `apps/desktop/js/sse-parser.js`：

```js
"use strict";

/*
 * SSE 分片解析：从 TCP 分片里还原完整事件。
 *
 * 为什么单独成文件而不是塞进 main.js：main.js 依赖 electron，node --test 里
 * require 不了；而"一条 data 跨两个 TCP 包到达"恰恰是最容易写错的地方，
 * 必须能脱离 Electron 直接单测。保持纯函数、不碰 http 对象。
 *
 * 服务端实际只发两种帧（见 D:\HTWCore.Web\Controllers\Api\V2\V2StreamController.cs）：
 *   data: {json}\n\n     —— 状态快照（默认 event: message）
 *   : ka\n\n             —— keepalive 注释，必须忽略，否则会被当成空事件推给界面
 * 结束时再补一帧 event: end\ndata: {}\n\n
 */

function parseBlock(block) {
  const lines = block.split("\n");
  let event = "message";
  const dataLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 空行与以 ':' 开头的注释行（含 keepalive）都不携带数据。
    if (!line || line.charAt(0) === ":") continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    // 规范里冒号后可选的单个空格要去掉，但只有一个 —— 值本身的前导空格要保留。
    if (value.charAt(0) === " ") value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  // 既没有 data 也没有自定义 event 名 ⇒ 这一整块是注释，不产出事件。
  if (!dataLines.length && event === "message") return null;
  return { event: event, data: dataLines.join("\n") };
}

function parseSseChunk(remainder, chunk) {
  const text = String(remainder || "") + (chunk == null ? "" : String(chunk));
  const events = [];
  let rest = text;
  for (;;) {
    const idx = rest.indexOf("\n\n");
    if (idx < 0) break;
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const ev = parseBlock(block);
    if (ev) events.push(ev);
  }
  return { events: events, remainder: rest };
}

module.exports = { parseSseChunk: parseSseChunk, parseBlock: parseBlock };
```

- [ ] **Step 4: 运行测试，确认全绿**

Run: `cd apps/desktop && node --test js/sse-parser.test.cjs`

Expected: PASS，`# pass 8`、`# fail 0`

- [ ] **Step 5: 登记到 test 脚本**

编辑 `apps/desktop/package.json` 的 `scripts.test`，改成：

```json
"test": "node --test js/api.test.cjs js/sse-parser.test.cjs js/skills/workflow.test.cjs js/skills/workflow.mount.test.cjs js/skills/batch.test.cjs js/skills/batch.mount.test.cjs js/app.panels.test.mjs",
```

（后续任务会继续往这个列表里加文件。）

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/js/sse-parser.js apps/desktop/js/sse-parser.test.cjs apps/desktop/package.json
git commit -m "桌面端：新增SSE 分片解析的纯函数与分包边界测试"
```

---

## Task 2: 主进程 SSE 连接池与 preload 桥接

服务端只认 `AuthKey` 头，且 CORS 白名单不含 `file://`，所以连接必须由主进程发起。preload 仍是信任边界（它持有 AuthKey 与来源白名单）。

**Files:**
- Modify: `apps/desktop/main.js`
- Modify: `apps/desktop/preload.js`

**Interfaces:**
- Consumes: `parseSseChunk(remainder, chunk)`（Task 1）
- Produces:
  - IPC `htw:allowBase (base: string)` — fire-and-forget，把 preload 已放行的 origin 同步给主进程
  - IPC `htw:subscribe ({streamId, domain, taskId, base, apiKey}) -> Promise<{ok: boolean, reused?: boolean, errMsg?: string}>`
  - IPC `htw:unsubscribe (streamId: string)` — fire-and-forget
  - 主进程 → 渲染进程 `htw:stream-event` `{streamId, type: "data"|"end"|"error", payload: string|object}`
  - `window.htw.subscribeTask(streamId, domain, taskId, apiKey, baseOverride) -> Promise<object>`
  - `window.htw.unsubscribeTask(streamId) -> void`
  - `window.htw.onStreamEvent(cb) -> function`（返回取消订阅函数）

- [ ] **Step 1: 改 main.js —— 补依赖与来源白名单**

在 `apps/desktop/main.js` 顶部，把第 1-3 行：

```js
const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
```

替换为：

```js
const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { parseSseChunk } = require("./js/sse-parser.js");
```

紧接着（`Menu.setApplicationMenu(null);` 之后）插入：

```js
// SSE 允许访问的来源。preload 是信任边界（它持有 AuthKey 与来源白名单），
// 但主进程自己也要有一份：preload 只把已放行的 origin 通过 htw:allowBase 同步过来，
// 主进程再独立校验一次。两处都查才不会出现"渲染层换个地址就让 preload 带密钥去连"。
const allowedOrigins = new Set();
function originOf(u) {
  try {
    const x = new URL(String(u));
    return x.protocol + "//" + x.host;
  } catch (e) { return ""; }
}
allowedOrigins.add(originOf(process.env.HTW_API_BASE || "https://htwmedia.dpdns.org"));
if (process.env.HTW_API_DIRECT) allowedOrigins.add(originOf(process.env.HTW_API_DIRECT));

// streamId -> { req }。同一 streamId 重复订阅复用既有连接，不重复发起。
const streams = new Map();
```

- [ ] **Step 2: 改 main.js —— 加三个 IPC 处理器**

在 `ipcMain.handle("htw:openExternal", ...)` 之后（`function createWindow()` 之前）插入：

```js
ipcMain.on("htw:allowBase", (_e, base) => {
  const o = originOf(base);
  if (o) allowedOrigins.add(o);
});

function emit(sender, msg) {
  try { sender.send("htw:stream-event", msg); } catch (e) { /* 窗口已销毁 */ }
}

ipcMain.handle("htw:subscribe", (e, opts) => {
  const streamId = String((opts && opts.streamId) || "");
  const domain = String((opts && opts.domain) || "");
  const taskId = String((opts && opts.taskId) || "");
  const base = String((opts && opts.base) || "");
  if (!streamId || !domain || !taskId) return { ok: false, errMsg: "订阅参数缺失" };
  if (streams.has(streamId)) return { ok: true, reused: true };

  const o = originOf(base);
  if (!o || !allowedOrigins.has(o)) return { ok: false, errMsg: "BASE_NOT_ALLOWED" };

  let target;
  try {
    target = new URL(base.replace(/\/+$/, "") + "/api/v2/stream/"
      + encodeURIComponent(domain) + "/" + encodeURIComponent(taskId));
  } catch (err) {
    return { ok: false, errMsg: "invalid url: " + err.message };
  }

  const sender = e.sender;
  const transport = target.protocol === "http:" ? http : https;
  const req = transport.request({
    method: "GET",
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: target.pathname + target.search,
    headers: {
      AuthKey: String((opts && opts.apiKey) || ""),
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  }, (res) => {
    // 非 200 = 认证失败或任务不存在。读掉响应体并断开，让客户端降级到轮询。
    if (res.statusCode !== 200) {
      res.resume();
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "error", payload: { status: res.statusCode } });
      return;
    }
    let remainder = "";
    res.setEncoding("utf-8");
    res.on("data", (chunk) => {
      const r = parseSseChunk(remainder, chunk);
      remainder = r.remainder;
      for (let i = 0; i < r.events.length; i++) {
        const ev = r.events[i];
        emit(sender, {
          streamId: streamId,
          type: ev.event === "end" ? "end" : "data",
          payload: ev.data,
        });
      }
    });
    const bail = (err) => {
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "error", payload: { message: String((err && err.message) || err || "") } });
    };
    res.on("end", () => { streams.delete(streamId); emit(sender, { streamId: streamId, type: "end", payload: "" }); });
    res.on("error", bail);
  });

  req.on("error", (err) => {
    streams.delete(streamId);
    emit(sender, { streamId: streamId, type: "error", payload: { message: String(err.message || err) } });
  });
  streams.set(streamId, { req: req });
  return { ok: true };
});

ipcMain.on("htw:unsubscribe", (_e, streamId) => {
  const s = streams.get(String(streamId || ""));
  if (!s) return;
  try { s.req.destroy(); } catch (e) { /* 已经断了 */ }
  streams.delete(String(streamId));
});

// 退出前把所有长连接断掉：进程不退的话，Cloudflare 侧的连接会一直挂到超时。
app.on("before-quit", () => {
  streams.forEach((s) => { try { s.req.destroy(); } catch (e) { /* ignore */ } });
  streams.clear();
});
```

- [ ] **Step 3: 改 preload.js —— registerBase 同步给主进程**

把 `apps/desktop/preload.js` 第 38-43 行：

```js
function registerBase(u) {
  const o = originOf(u);
  if (!o || !/^https?:\/\//.test(o)) return false;
  if (BASE_ORIGINS.indexOf(o) < 0) BASE_ORIGINS.push(o);
  return true;
}
```

替换为：

```js
function registerBase(u) {
  const o = originOf(u);
  if (!o || !/^https?:\/\//.test(o)) return false;
  if (BASE_ORIGINS.indexOf(o) < 0) {
    BASE_ORIGINS.push(o);
    // SSE 由主进程发起，那边有独立的一份白名单 —— 放行结果要同步过去。
    try { ipcRenderer.send("htw:allowBase", o); } catch (e) { /* 主进程还没起来 */ }
  }
  return true;
}
```

- [ ] **Step 4: 改 preload.js —— 暴露三个方法**

在 `apps/desktop/preload.js` 的 `contextBridge.exposeInMainWorld("htw", {` 对象里，紧接在 `openExternal` 之后（`// Generic V2 caller.` 那一行之前）插入：

```js
  // SSE 进度订阅。渲染层连不上服务端：它是 file:// 源，Origin 为 null，
  // 而服务端 CORS 白名单不含 file://；且 AuthKey 属非简单头会触发预检。
  // 两条路都堵死，所以连接一律由主进程发起，这里只做转发与白名单校验。
  subscribeTask: (streamId, domain, taskId, apiKey, baseOverride) => {
    const base = resolveBase(baseOverride);
    if (!isAllowedBase(base)) return Promise.resolve(baseRejected(base));
    return ipcRenderer
      .invoke("htw:subscribe", { streamId, domain, taskId, base, apiKey: apiKey || "" })
      .catch((e) => ({ ok: false, errMsg: String((e && e.message) || e) }));
  },
  unsubscribeTask: (streamId) => {
    try { ipcRenderer.send("htw:unsubscribe", String(streamId)); } catch (e) { /* ignore */ }
  },
  onStreamEvent: (cb) => {
    if (typeof cb !== "function") return function () {};
    const listener = (_e, msg) => { try { cb(msg); } catch (e) { /* 回调出错不能影响连接 */ } };
    ipcRenderer.on("htw:stream-event", listener);
    return function () {
      try { ipcRenderer.removeListener("htw:stream-event", listener); } catch (e) { /* ignore */ }
    };
  },
```

- [ ] **Step 5: 改 api.js —— 两个转发**

在 `apps/desktop/js/api.js` 的 `download` 函数之后（第 198 行附近）插入：

```js
  // SSE 订阅转发。streamId 用 "域:任务标识" 作键，主进程据此去重连接。
  function subscribeTask(domain, taskId) {
    const streamId = domain + ":" + taskId;
    if (!window.htw || !window.htw.subscribeTask) return null;
    window.htw.subscribeTask(streamId, domain, taskId, _key, _base);
    return streamId;
  }
  function unsubscribeTask(streamId) {
    if (window.htw && window.htw.unsubscribeTask) window.htw.unsubscribeTask(streamId);
  }
```

并把文件末尾的 `return { ... }` 展开为（保留原有全部条目，追加两个）：

```js
  return {
    setKey: setKey, setBase: setBase, setDirectBase: setDirectBase,
    hasKey: hasKey, authHeader: authHeader,
    call: call, get: get, post: post, upload: upload, download: download,
    normalize: normalize, pollTask: pollTask, onQuotaExceeded: onQuotaExceeded,
    subscribeTask: subscribeTask, unsubscribeTask: unsubscribeTask,
    get base() { return _base; }, get directBase() { return _directBase; },
  };
```

- [ ] **Step 6: 跑既有测试，确认没打破什么**

Run: `cd apps/desktop && npm test`

Expected: 全部通过（新增的 `js/sse-parser.test.cjs` 也应在内）。若 `js/api.test.cjs` 报 `subscribeTask is not a function`，说明末尾 `return` 没改成功。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/main.js apps/desktop/preload.js apps/desktop/js/api.js
git commit -m "桌面端：主进程新增进度推送连接池与订阅桥接"
```

---

## Task 3: 任务容器的纯逻辑

记录结构、域注册表、终态判定、状态归一、200 条淘汰。全部无 I/O，可独立单测（落盘节流与 watch 状态机在 Task 4）。

**Files:**
- Create: `apps/desktop/js/tasks.js`
- Create: `apps/desktop/js/tasks.test.cjs`
- Modify: `apps/desktop/package.json`（`test` 脚本）

**Interfaces:**
- Consumes: 无（`subscribeTask` / `unsubscribeTask` 在 Task 4 接入）
- Produces: `window.HTWTasks` / `module.exports`，含
  - `register({domain, taskId, panel, title, type}) -> task`
  - `list() -> task[]`
  - `get(id) -> task | null`
  - `onChange(fn) -> function`（取消订阅）
  - `clearFinished() -> void`
  - `restore() -> Promise`
  - `cancel(id) -> Promise`
  - `_internal`: `{ MAX_RECORDS, TERMINAL_STATUSES, POLL_MS, FIRST_EVENT_TIMEOUT_MS, SAVE_DEBOUNCE_MS, RECONNECT_MS, DOMAINS, isTerminal, normalizeStatus, applyPayload, evict, canCancel, cancelBody, newTask, createStore }`
    （`createStore` 属 Task 4，Step 3 之前不存在；其余为 Task 3 的纯逻辑导出）

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/js/tasks.test.cjs`：

```js
const test = require("node:test");
const assert = require("node:assert");
const T = require("./tasks.js");
const I = T._internal;

/* 字段名取自各面板现役的读法：
 *   agent       —— shortdrama.js:184/354/358 （status/progress/currentStep/cloudUrl||downloadUrl）
 *   marketvideo —— marketing.js:233-248        （status/progress/currentStep/error）
 *   voice/subtitle/image —— tools.js:34         （status/result）
 *   publish     —— PublishManager.GetTaskStatus（status/subTasks）
 * 其余四域的进度语义与上面不同，一律允许 progress 为 null，不许编。
 */

test("终态判定覆盖服务端全部终态值", () => {
  const terminal = ["success", "completed", "failed", "canceled", "cancelled",
    "error", "notfound", "partial_failed", "draft_saved", "awaiting_manual", "unconfirmed"];
  for (const s of terminal) assert.ok(I.isTerminal(s), s + " 应判为终态");
  // 大小写不敏感：服务端 PublishManager 写的是小写，但别的域可能给 done
  assert.ok(I.isTerminal("DONE"));
});

test("进行中的状态绝不能判为终态", () => {
  for (const s of ["pending", "running", "uploading", "processing", "", null, undefined]) {
    assert.strictEqual(I.isTerminal(s), false, JSON.stringify(s) + " 不该是终态");
  }
});

test("partial_failed 是终态 —— 它是最常见的发布结局", () => {
  // 抖音人工发布/存草稿/未取到证据都会被 FinalizeTask 归并成 partial_failed。
  // 漏了它，发布完成后连接会一直挂到 60 分钟上限。
  assert.ok(I.isTerminal("partial_failed"));
});

test("expired 是终态 —— batch 域的任务记录被服务端清掉后写的状态", () => {
  // BatchController.cs：任务状态先于批次记录被清理时（成片 1 小时、批次 6 小时），
  // 条目状态回落成 expired。它是终态，漏判就会把这条记录永远留在 running。
  assert.ok(I.isTerminal("expired"));
  assert.strictEqual(I.normalizeStatus("expired"), "interrupted");
});

test("expired 必须映射为已中断，绝不能显示成绿色成功", () => {
  // expired 的含义是「记录被服务端清掉了」，不是「做完了」：结局未知、产物也已不可达。
  // 顺着兜底分支落到 done 会把一条根本没结果的记录渲染成成功，用户点进去空空如也。
  // 与 notfound 同档 —— 两者都是「服务端那边已经没有这条任务了」。
  assert.strictEqual(I.normalizeStatus("expired"), "interrupted");
  assert.strictEqual(I.normalizeStatus("EXPIRED"), "interrupted");
  assert.strictEqual(I.normalizeStatus(" expired "), "interrupted");
  const t = I.newTask({ domain: "batch", taskId: "B1" });
  I.applyPayload(t, { status: "expired" });
  assert.strictEqual(t.status, "interrupted");
  assert.ok(t.endedAt, "落终态就必须记结束时间");
  // 它是终态，所以能被淘汰掉，不会变成永远淘汰不掉的僵尸
  assert.strictEqual(I.evict([t], 0).length, 0);
});

test("normalizeStatus：服务端词表映射到内部词表", () => {
  for (const [from, to] of [
    ["running", "running"], ["uploading", "running"], ["pending", "running"],
    ["success", "done"], ["completed", "done"], ["done", "done"],
    ["DONE", "done"], ["  Completed  ", "done"],
    ["expired", "interrupted"], ["draft_saved", "done"], ["awaiting_manual", "done"],
    ["failed", "failed"], ["error", "failed"], ["partial_failed", "failed"],
    ["canceled", "canceled"], ["cancelled", "canceled"],
    ["notfound", "interrupted"],
  ]) {
    assert.strictEqual(I.normalizeStatus(from), to, from + " 应映射为 " + to);
  }
  // 没有 status 就返回 null：「不知道」不等于「还在跑」，调用方要能分辨
  for (const s of ["", "   ", null, undefined]) {
    assert.strictEqual(I.normalizeStatus(s), null, JSON.stringify(s) + " 应映射为 null");
  }
});

test("partial_failed 映射为失败，不能显示成绿色成功", () => {
  // publish 域只有 partial_failed 这一个失败信号：FinalizeTask 只要有子任务非 success
  // 就写它，覆盖「所有平台 cookie 全失效」和「B站成功、抖音要人工点」两种结局。
  // 映射成 done 会让全平台失败也显示成功。
  const t = I.newTask({ domain: "publish", taskId: "P1" });
  I.applyPayload(t, { status: "partial_failed" });
  assert.strictEqual(t.status, "failed");
  assert.ok(t.endedAt, "落终态就必须记结束时间");
});

test("终态是粘滞的：迟到的 running 帧不能把已完成的任务拉回在跑", () => {
  // SSE 会乱序/重发。若允许回退，就会出现 status=running 而 endedAt 还留着的记录 ——
  // evict 按 status 分组，它既不显示完成、又因为算「在跑」而永远淘汰不掉。
  const t = I.newTask({ domain: "agent", taskId: "Z1" });
  I.applyPayload(t, { status: "completed" });
  assert.strictEqual(t.status, "done");
  const endedAt = t.endedAt;
  assert.ok(endedAt);

  I.applyPayload(t, { status: "running", progress: 30 });
  assert.strictEqual(t.status, "done", "已完成的任务不能被迟到的 running 帧复活");
  assert.strictEqual(t.endedAt, endedAt, "endedAt 不能被清掉");
  // 进度之类仍然照常更新，只是状态不动
  assert.strictEqual(t.progress, 30);

  // 而且它必须能被淘汰掉，否则就是个永久僵尸
  const list = I.evict([t], 0);
  assert.strictEqual(list.length, 0, "终态记录应该被淘汰");
});

test("终态粘滞只挡回退，不挡终态之间的修正", () => {
  const t = I.newTask({ domain: "agent", taskId: "Z2" });
  I.applyPayload(t, { status: "completed" });
  I.applyPayload(t, { status: "failed", error: "上传中断" });
  assert.strictEqual(t.status, "failed");
  assert.ok(t.endedAt);
});

test("在跑的记录仍可被非终态状态改写", () => {
  const t = I.newTask({ domain: "agent", taskId: "Z3" });
  I.applyPayload(t, { status: "uploading" });
  assert.strictEqual(t.status, "running");
  assert.strictEqual(t.endedAt, null);
  I.applyPayload(t, { status: "running" });
  assert.strictEqual(t.status, "running");
});

test("没有 status 的 payload 也必须盖 updatedAt", () => {
  // /api/v2/workflow/status 与 /api/v2/batch/status 压根不返回 status 字段。
  // 若在缺 status 时提前返回，这两个域的 updatedAt 永远不动，落盘节流就永远不触发。
  const t = I.newTask({ domain: "workflow", taskId: "W2" });
  t.updatedAt = 0;
  I.applyPayload(t, { stage: "compose" });
  assert.ok(t.updatedAt > 0, "没有 status 也要更新 updatedAt");
  assert.strictEqual(t.status, "running", "缺 status 不等于改状态");
});

test("applyPayload: agent 域取出进度与步骤", () => {
  const t = I.newTask({ domain: "agent", taskId: "A1", panel: "shortdrama", title: "短剧" });
  I.applyPayload(t, { status: "running", progress: 62, currentStep: "合成中" });
  assert.strictEqual(t.progress, 62);
  assert.strictEqual(t.step, "合成中");
  assert.strictEqual(t.status, "running");
});

test("applyPayload: cloudUrl 与 downloadUrl 都能作为产物地址", () => {
  const a = I.newTask({ domain: "agent", taskId: "A2" });
  I.applyPayload(a, { status: "completed", cloudUrl: "https://cdn/x.mp4" });
  assert.strictEqual(a.result && a.result.downloadUrl, "https://cdn/x.mp4");
});

test("applyPayload: 拿不到进度就留 null，绝不伪造 0", () => {
  const t = I.newTask({ domain: "workflow", taskId: "W1" });
  I.applyPayload(t, { stage: "compose" });
  assert.strictEqual(t.progress, null, "没有进度字段时必须是 null，不是 0");
  assert.strictEqual(t.step, "compose");
});

test("applyPayload: 进度是空串也算拿不到，绝不伪造 0", () => {
  // Number("") 是 0、空格串也是 0，而 p.progress != null 挡不住空串。
  // 「没有进度」和「进度真的是 0」必须分得开，否则界面会跳出一个凭空的 0%。
  for (const v of ["", "   "]) {
    const t = I.newTask({ domain: "agent", taskId: "E" + v.length });
    I.applyPayload(t, { status: "running", progress: v });
    assert.strictEqual(t.progress, null, JSON.stringify(v) + " 应留 null");
  }
  const p = I.newTask({ domain: "agent", taskId: "EP" });
  I.applyPayload(p, { status: "running", percent: "" });
  assert.strictEqual(p.progress, null, "percent 为空串同样留 null");
  // 真的 0% 还是要照实记
  const z = I.newTask({ domain: "agent", taskId: "EZ" });
  I.applyPayload(z, { status: "running", progress: 0 });
  assert.strictEqual(z.progress, 0);
});

test("applyPayload: notfound 直接落终态", () => {
  const t = I.newTask({ domain: "agent", taskId: "A3" });
  I.applyPayload(t, { status: "notfound" });
  assert.strictEqual(t.status, "interrupted");
});

test("applyPayload: 完成时记下产物文件名", () => {
  const t = I.newTask({ domain: "agent", taskId: "A4" });
  I.applyPayload(t, { status: "completed", fileName: "movie.mp4", downloadUrl: "/d/1" });
  assert.strictEqual(t.status, "done");
  assert.strictEqual(t.result.fileName, "movie.mp4");
});

test("淘汰：只丢最旧的终态，运行中的永不淘汰", () => {
  let tasks = [];
  for (let i = 0; i < 205; i++) {
    const t = I.newTask({ domain: "agent", taskId: "T" + i });
    t.status = i % 2 === 0 ? "done" : "running";   // 约一半终态、一半在跑
    t.createdAt = i;
    tasks.push(t);
  }
  tasks = I.evict(tasks, 200);
  assert.strictEqual(tasks.length, 200);
  const running = tasks.filter((t) => t.status === "running");
  assert.ok(running.length > 0, "运行中的任务不该被淘汰");
  // 最新的那个在跑的任务必须还在（i=204 是偶数、状态为 done，在跑的是 T203）
  assert.ok(tasks.some((t) => t.taskId === "T203" && t.status === "running"));
});

test("淘汰：终态不足时全部保留", () => {
  const tasks = [];
  for (let i = 0; i < 3; i++) {
    const t = I.newTask({ domain: "agent", taskId: "X" + i });
    t.status = "running";
    tasks.push(t);
  }
  assert.strictEqual(I.evict(tasks, 200).length, 3);
});

test("淘汰：在跑的超过预算时终态全丢，列表仍超预算", () => {
  // 上限是给终态留位置的；在跑的永远不丢，所以它们自己就能把列表撑爆。
  // 这时不能为了凑满上限去动在跑的，只能把终态全丢光并接受超预算。
  const tasks = [];
  for (let i = 0; i < 210; i++) {
    const t = I.newTask({ domain: "agent", taskId: "R" + i });
    t.status = "running";
    t.createdAt = i;
    tasks.push(t);
  }
  for (let i = 0; i < 5; i++) {
    const t = I.newTask({ domain: "agent", taskId: "F" + i });
    t.status = "done";
    t.endedAt = i;
    tasks.push(t);
  }
  const out = I.evict(tasks, 200);
  assert.strictEqual(out.length, 210, "210 条在跑的都不该被丢，终态却一条都挤不进去");
  assert.strictEqual(out.filter((t) => t.status === "done").length, 0);
  assert.ok(out.every((t) => t.status === "running"));
});

test("淘汰：max 缺省用 MAX_RECORDS", () => {
  const tasks = [];
  for (let i = 0; i < I.MAX_RECORDS + 10; i++) {
    const t = I.newTask({ domain: "agent", taskId: "D" + i });
    t.status = "done";
    t.endedAt = i;
    tasks.push(t);
  }
  assert.strictEqual(I.evict(tasks).length, I.MAX_RECORDS);
  // 不传 max 且没超上限时原样返回
  assert.strictEqual(I.evict(tasks.slice(0, 3)).length, 3);
});

test("淘汰：两条返回路径都返回新数组，不改也不返回入参本身", () => {
  // 调用方（Task 4）会把 store 里的数组整个换掉；混用「原地改」和「返回新数组」
  // 会让「有没有换成功」这件事没法判断。
  const under = [I.newTask({ domain: "agent", taskId: "U1" })];
  assert.notStrictEqual(I.evict(under, I.MAX_RECORDS), under);

  const over = [];
  for (let i = 0; i < 5; i++) {
    const t = I.newTask({ domain: "agent", taskId: "O" + i });
    t.status = "done";
    t.endedAt = i;
    over.push(t);
  }
  const out = I.evict(over, 2);
  assert.notStrictEqual(out, over);
  assert.strictEqual(over.length, 5, "入参不该被就地改短");
});

test("取消请求体必须是 PascalCase", () => {
  // 服务端 MVC 走 Newtonsoft，只认 PascalCase；api.js 的 camelize 只管响应。
  const body = I.cancelBody("marketvideo", "T1");
  assert.deepStrictEqual(body, { TaskId: "T1" });
  assert.deepStrictEqual(I.cancelBody("batch", "B1"), { BatchId: "B1" });
  assert.deepStrictEqual(I.cancelBody("workflow", "W1"), { WorkflowId: "W1" });
});

test("取消白名单只有三个域", () => {
  assert.ok(I.canCancel("marketvideo"));
  assert.ok(I.canCancel("batch"));
  assert.ok(I.canCancel("workflow"));
  for (const d of ["agent", "voice", "subtitle", "image", "creation", "edit", "publish"]) {
    assert.strictEqual(I.canCancel(d), false, d + " 不该有取消按钮");
  }
});

test("域注册表覆盖 8 个面板用到的全部域", () => {
  for (const d of ["agent", "marketvideo", "voice", "subtitle", "image",
    "publish", "creation", "workflow", "batch", "edit"]) {
    assert.ok(I.DOMAINS[d], "缺域：" + d);
  }
});

test("只有服务端已支持的六个域走 SSE", () => {
  assert.strictEqual(I.DOMAINS.agent.sse, true);
  assert.strictEqual(I.DOMAINS.marketvideo.sse, true);
  assert.strictEqual(I.DOMAINS.voice.sse, true);
  assert.strictEqual(I.DOMAINS.subtitle.sse, true);
  assert.strictEqual(I.DOMAINS.publish.sse, true);
  // 这五个后端还没有 SSE 域，注册表留了口子，但本次不接
  assert.strictEqual(I.DOMAINS.creation.sse, false);
  assert.strictEqual(I.DOMAINS.workflow.sse, false);
  assert.strictEqual(I.DOMAINS.batch.sse, false);
  assert.strictEqual(I.DOMAINS.edit.sse, false);
  assert.strictEqual(I.DOMAINS.image.sse, false);
});
```

- [ ] **Step 2: 运行测试，确认因模块不存在而失败**

Run: `cd apps/desktop && node --test js/tasks.test.cjs`

Expected: FAIL，报 `Cannot find module './tasks.js'`

- [ ] **Step 3: 写实现（纯逻辑部分）**

创建 `apps/desktop/js/tasks.js`：

```js
(function (root, factory) {
  const tasks = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = tasks;
  if (typeof window !== "undefined") window.HTWTasks = tasks;
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_RECORDS = 200;
  const POLL_MS = 3000;
  const FIRST_EVENT_TIMEOUT_MS = 8000;
  const RECONNECT_MS = 2000;
  const SAVE_DEBOUNCE_MS = 2000;

  // 终态集合。partial_failed 必须在内：PublishManager.FinalizeTask 的判定是
  // 「任一子任务非 success 即算」，抖音人工发布/存草稿/未取到证据全都归并成它 ——
  // 也就是说最常见的发布结局都在这里。
  // expired 在内：batch 域把「任务记录已被服务端清掉」的条目写成 expired
  // （BatchController.cs，成片 1 小时 / 批次 6 小时后清理），漏了它这条记录会被
  // 当成在跑、永远停在 running。目前 /api/v2/batch/status 顶层还没有 status 字段，
  // 走不到这里；但 Task 4 要从 summary/items 推导状态，那时就可达了，所以先补上。
  const TERMINAL_STATUSES = {
    success: 1, completed: 1, done: 1, failed: 1, canceled: 1, cancelled: 1,
    error: 1, notfound: 1, partial_failed: 1, expired: 1,
    draft_saved: 1, awaiting_manual: 1, unconfirmed: 1,
  };

  // 内部状态词表（记录里 status 字段的取值）里的终态。
  // 与服务端词表分开是因为两边的判定标准不同：服务端只要知道「结束了」，
  // 客户端还要知道该显示成绿/红/灰/中断哪一类。
  const INTERNAL_TERMINAL_STATUSES = {
    done: 1, failed: 1, canceled: 1, interrupted: 1,
  };

  function isTerminal(status) {
    if (!status) return false;
    return !!TERMINAL_STATUSES[String(status).toLowerCase()];
  }

  function isTerminalState(status) {
    return !!INTERNAL_TERMINAL_STATUSES[status];
  }

  // 把服务端状态映射到内部词表：running / done / failed / canceled / interrupted。
  // payload 里没有 status 时返回 null —— 「不知道」和「还在跑」是两回事，
  // 不能默认按在跑处理。
  function normalizeStatus(status) {
    if (status === null || status === undefined) return null;
    const s = String(status).trim().toLowerCase();
    if (!s) return null;
    if (!isTerminal(s)) return "running";
    // notfound 与 expired 是同一类：服务端那边已经没有这条任务记录了。
    if (s === "notfound") return "interrupted";
    // expired 必须单独点名、落到「已中断」，绝不能顺着结尾的兜底分支掉进 done。
    // 它的含义是「记录已被服务端的定期清理删掉」（BatchController 对成片 1 小时、
    // 批次 6 小时后清理，条目状态回落成 expired），不是「做完了」—— 结局未知、
    // 产物也已不可达，显示成绿色成功等于替服务端撒谎，用户点进去只会发现什么都没有。
    if (s === "expired") return "interrupted";
    if (s === "canceled" || s === "cancelled") return "canceled";
    // partial_failed 必须落到失败而不是成功：publish 域只有这一个失败信号
    // （FinalizeTask 一旦有子任务非 success 就写它），映射成 done 会让
    // 「所有平台都失败」「B站成功、抖音要人工点」这两种结局都显示成绿色成功。
    if (s === "failed" || s === "error" || s === "partial_failed") return "failed";
    return "done";
  }

  function num(v) {
    if (v === null || v === undefined) return null;
    // Number("") 是 0、Number("  ") 也是 0。空串当进度会凭空造出一个 0%，
    // 而「没有进度」和「进度是 0」对用户是两回事 —— 本项目的规矩是拿不到就留 null。
    if (typeof v === "string" && v.trim() === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function newTask(opts) {
    const now = Date.now();
    return {
      id: "t_" + Math.random().toString(16).slice(2, 10),
      domain: opts.domain,
      taskId: opts.taskId,
      type: opts.type || null,
      panel: opts.panel || "",
      title: opts.title || "",
      status: "running",
      unknown: false,
      progress: null,
      step: null,
      transport: "none",
      degraded: false,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
  }

  // 进度字段各域叫法不一；取不到就留 null —— 编一个 0% 比不给更糟。
  function applyPayload(task, payload) {
    if (!task || !payload || typeof payload !== "object") return task;
    const p = payload;
    const url = p.downloadUrl || p.cloudUrl || p.videoUrl || p.url || "";
    if (p.error) task.error = String(p.error);
    if (p.currentStep || p.step) task.step = String(p.currentStep || p.step);
    else if (p.stage) task.step = String(p.stage);
    const pr = num(p.progress != null ? p.progress : p.percent);
    if (pr != null) task.progress = Math.max(0, Math.min(100, pr));
    // 有地址就算产物：agent 域的云端产物常常只给 cloudUrl，不带文件名。
    const name = p.fileName || p.outputFile;
    if (name || url) task.result = { fileName: name ? String(name) : null, downloadUrl: url };

    // updatedAt 必须无条件盖：workflow 与 batch 的状态响应里压根没有 status 字段
    // （/api/v2/workflow/status、/api/v2/batch/status），若在缺 status 时提前返回，
    // 这两个域的 updatedAt 永远不动，Task 4 基于它的落盘节流就永远不会触发。
    task.updatedAt = Date.now();

    const next = normalizeStatus(p.status);
    if (!next) return task;

    // 终态粘滞：已经落到终态的记录，不许被后到的一帧拉回 running。
    // SSE 与轮询都可能乱序或重发，一旦发生就会得到「status=running 但 endedAt 还留着」
    // 的僵尸记录 —— evict 按 status 分组，它既不显示完成、又因为算「在跑」而永远
    // 淘汰不掉。服务端 AgentTaskManager 为了同一件事给终态写加了锁
    // （终态写必须与进度回调互斥），客户端是最后一跳，同一条规则必须在这里再实现一次。
    // 注意这不是「终态不可变」：迟到的另一条终态（done → failed）仍然照常覆盖。
    if (next === "running" && isTerminalState(task.status)) return task;

    task.status = next;
    task.endedAt = next === "running" ? null : Date.now();
    return task;
  }

  // 超过上限时丢最旧的终态；运行中的永不丢。
  // max 缺省为 MAX_RECORDS；两条返回路径都返回新数组 —— 调用方（Task 4）会把
  // 传入的 store 数组整个换掉，原地改与新建混用会让「有没有换成功」没法判断。
  function evict(list, max) {
    const limit = typeof max === "number" && isFinite(max) && max >= 0 ? max : MAX_RECORDS;
    if (list.length <= limit) return list.slice();
    const running = list.filter((t) => t.status === "running");
    const finished = list.filter((t) => t.status !== "running");
    finished.sort((a, b) => (a.endedAt || a.createdAt) - (b.endedAt || b.createdAt));
    // 在跑的比预算还多时 max - running.length 为负，drop 就会等于 finished 全量：
    // 既然一条终态都挤不进去，就全丢，宁可列表暂时超预算也不谎报完成的任务还在。
    const drop = finished.length - Math.max(0, limit - running.length);
    const kept = finished.slice(Math.max(0, drop));
    const out = kept.concat(running);
    out.sort((a, b) => a.createdAt - b.createdAt);
    return out;
  }

  function canCancel(domain) {
    const d = DOMAINS[domain];
    return !!(d && d.cancel);
  }

  // PascalCase：服务端 MVC 走 Newtonsoft，只认这套大小写。
  function cancelBody(domain, taskId) {
    if (domain === "marketvideo") return { TaskId: taskId };
    if (domain === "batch") return { BatchId: taskId };
    if (domain === "workflow") return { WorkflowId: taskId };
    return null;
  }

  const DOMAINS = {
    agent: { sse: true, cancel: false,
      status: (t) => "/api/v2/agent/status?taskId=" + encodeURIComponent(t.taskId) },
    marketvideo: { sse: true, cancel: true,
      cancelPath: "/api/v2/market-video/cancel",
      status: (t) => "/api/v2/market-video/status?taskId=" + encodeURIComponent(t.taskId) },
    voice: { sse: true, cancel: false,
      status: (t) => "/api/v2/voice/status/" + encodeURIComponent(t.taskId) },
    subtitle: { sse: true, cancel: false,
      status: (t) => "/api/v2/subtitle/status/" + encodeURIComponent(t.taskId) },
    publish: { sse: true, cancel: false,
      status: (t) => "/api/v2/publish/task-status?taskId=" + encodeURIComponent(t.taskId) },
    creation: { sse: false, cancel: false,
      status: (t) => "/api/v2/creation/status?sessionId=" + encodeURIComponent(t.taskId)
        + "&type=" + encodeURIComponent(t.type || "video") },
    workflow: { sse: false, cancel: true,
      cancelPath: "/api/v2/workflow/cancel",
      status: (t) => "/api/v2/workflow/status?workflowId=" + encodeURIComponent(t.taskId) },
    batch: { sse: false, cancel: true,
      cancelPath: "/api/v2/batch/cancel",
      status: (t) => "/api/v2/batch/status?batchId=" + encodeURIComponent(t.taskId) },
    edit: { sse: false, cancel: false,
      status: (t) => "/api/v2/edit/status/" + encodeURIComponent(t.taskId) },
    image: { sse: false, cancel: false,
      status: (t) => "/api/v2/image/status?taskId=" + encodeURIComponent(t.taskId) },
  };

  return {
    _internal: {
      MAX_RECORDS, POLL_MS, FIRST_EVENT_TIMEOUT_MS, RECONNECT_MS, SAVE_DEBOUNCE_MS,
      TERMINAL_STATUSES, DOMAINS,
      isTerminal, normalizeStatus, applyPayload, evict, canCancel, cancelBody, newTask,
    },
  };
});
```

**注意**：`evict` 的两条返回路径都返回新数组（`list.slice()` 与重新 `concat`/`sort` 后的 `out`），不要改成「直接返回入参」——Task 4 的调用方会把 store 里的数组整个换掉，混用原地改与新建会让「有没有换成功」没法判断。另外 `max` 缺省为 `MAX_RECORDS`。

- [ ] **Step 4: 运行测试，确认全绿**

Run: `cd apps/desktop && node --test js/tasks.test.cjs`

Expected: PASS，`# fail 0`。若 `evict` 相关用例失败，检查 `running`/`finished` 两个过滤器是否互补。

- [ ] **Step 5: 登记到 test 脚本**

把 `apps/desktop/package.json` 的 `scripts.test` 改成：

```json
"test": "node --test js/api.test.cjs js/sse-parser.test.cjs js/tasks.test.cjs js/skills/workflow.test.cjs js/skills/workflow.mount.test.cjs js/skills/batch.test.cjs js/skills/batch.mount.test.cjs js/app.panels.test.mjs",
```

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/js/tasks.js apps/desktop/js/tasks.test.cjs apps/desktop/package.json
git commit -m "桌面端：新增任务容器的记录模型、域注册表与终态判定"
```

---

## Task 4: 容器的观察层（watch / 降级 / 恢复 / 取消）

把 Task 3 的纯逻辑接上 I/O。所有外部依赖都从 `deps` 注入，测试用假实现。

**Files:**
- Create: `apps/desktop/js/tasks.watch.test.cjs`
- Modify: `apps/desktop/js/tasks.js`
- Modify: `apps/desktop/package.json`（`test` 脚本）

**Interfaces:**
- Consumes: Task 3 的 `_internal`；Task 2 的 `api.subscribeTask` / `api.unsubscribeTask` / `preload.onStreamEvent`
- Produces: `HTWTasks.register / list / get / onChange / clearFinished / restore / cancel`，以及 `_internal.createStore(deps)`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/js/tasks.watch.test.cjs`：

```js
const test = require("node:test");
const assert = require("node:assert");
const T = require("./tasks.js");
const I = T._internal;

/*
 * watch 的三条路径都要覆盖：SSE 正常、静默降级到轮询、重启后重新接上。
 * 用假依赖而不是真网络 —— 这些是状态机问题，不是网络问题。
 */

function fakeDeps(over) {
  const d = {
    api: {
      subscribeTask: () => "sid",
      unsubscribeTask: () => {},
      call: async () => ({ ok: true, data: { status: "running" } }),
      post: async () => ({ ok: true }),
    },
    saveJson: () => Promise.resolve(true),
    loadJson: () => Promise.resolve(null),
    // 与真实 preload 的 onStreamEvent 同形：订阅一个回调，回调收到 {streamId,type,payload}。
    subscribe: (cb) => { d._cbs.push(cb); return function () { d._cbs = d._cbs.filter((f) => f !== cb); }; },
    now: () => Date.now(),
    setTimeout: (fn, ms) => { d._timers.push({ fn, ms }); return d._timers.length; },
    clearTimeout: () => {},
    _timers: [],
    _cbs: [],
    // 主进程把事件按 streamId 广播给所有订阅者；容器自己按 streamId 过滤。
    emit: (streamId, type, payload) => { d._cbs.slice().forEach((cb) => cb({ streamId, type, payload })); },
  };
  return Object.assign(d, over || {});
}

test("SSE 域：收到事件就更新记录，不轮询", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A1", panel: "shortdrama", title: "短剧" });
  d.emit("agent:A1", "data", '{"status":"running","progress":40}');
  await new Promise((r) => setImmediate(r));
  const cur = store.get(t.id);
  assert.strictEqual(cur.progress, 40);
  assert.strictEqual(cur.transport, "sse");
  assert.strictEqual(cur.degraded, false);
});

test("载荷判定终态后自动停掉观察", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A2" });
  d.emit("agent:A2", "data", '{"status":"completed"}');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.get(t.id).status, "done");
});

test("partial_failed 也要收尾（发布域最常见的结局）", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "publish", taskId: "P1" });
  d.emit("publish:P1", "data", '{"status":"partial_failed"}');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.get(t.id).status, "failed", "partial_failed 属终态，不能让连接白挂到 60 分钟上限；且它必须落成失败而不是成功");
});

test("非 SSE 域：直接轮询，不订阅", async () => {
  const d = fakeDeps();
  let subscribed = 0;
  d.api.subscribeTask = () => { subscribed++; return "sid"; };
  const store = I.createStore(d);
  store.register({ domain: "batch", taskId: "B1", panel: "batch", title: "批量" });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(subscribed, 0, "batch 域服务端没有推送，不该发起订阅");
  assert.strictEqual(store.list()[0].transport, "poll");
});

test("订阅失败要静默降级，不能抛给界面", async () => {
  const d = fakeDeps();
  d.api.subscribeTask = () => { throw new Error("BASE_NOT_ALLOWED"); };
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A3" });
  await new Promise((r) => setImmediate(r));
  const cur = store.get(t.id);
  assert.strictEqual(cur.transport, "poll");
  assert.strictEqual(cur.degraded, true, "降级要被记住，用于排查实际降级率");
  assert.strictEqual(cur.status, "running", "降级不影响任务本身");
});

test("degraded 只增不减", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A4" });
  store.get(t.id).degraded = true;
  d.emit("agent:A4", "data", '{"status":"running"}');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.get(t.id).degraded, true, "degraded 是历史事实，恢复推送后也不能抹掉");
});

test("重启恢复：还在跑的任务重新接上", async () => {
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([
    { id: "t_old", domain: "batch", taskId: "B9", panel: "batch", title: "批量",
      status: "running", unknown: false, progress: 10, step: null,
      transport: "none", degraded: false, result: null, error: null,
      createdAt: 1, updatedAt: 2, endedAt: null, type: null },
  ]);
  d.api.call = async () => ({ ok: true, data: { status: "running", progress: 55 } });
  const store = I.createStore(d);
  await store.restore();
  const cur = store.get("t_old");
  assert.ok(cur, "记录应被载入");
  assert.strictEqual(cur.status, "running");
  assert.strictEqual(cur.progress, 55);
  assert.strictEqual(cur.transport, "poll");
});

test("重启恢复：服务端已无此任务 -> interrupted", async () => {
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([
    { id: "t_gone", domain: "agent", taskId: "A0", panel: "shortdrama", title: "短剧",
      status: "running", unknown: false, progress: null, step: null,
      transport: "none", degraded: false, result: null, error: null,
      createdAt: 1, updatedAt: 2, endedAt: null, type: null },
  ]);
  d.api.call = async () => ({ ok: true, data: { status: "notfound" } });
  const store = I.createStore(d);
  await store.restore();
  assert.strictEqual(store.get("t_gone").status, "interrupted");
});

test("重启恢复：网络故障不能误判任务已死", async () => {
  // 服务端的任务管理器多是进程内存态，客户端启动瞬间它可能还没就绪。
  // 此时把 running 改成 interrupted 就是误报，用户会以为白等了半小时。
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([
    { id: "t_net", domain: "agent", taskId: "A7", panel: "shortdrama", title: "短剧",
      status: "running", unknown: false, progress: null, step: null,
      transport: "none", degraded: false, result: null, error: null,
      createdAt: 1, updatedAt: 2, endedAt: null, type: null },
  ]);
  d.api.call = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
  const store = I.createStore(d);
  await store.restore();
  const cur = store.get("t_net");
  assert.strictEqual(cur.status, "running", "网络故障时必须保持 running");
  assert.strictEqual(cur.unknown, true);
});

test("取消：发 PascalCase 请求体，成功后置 canceled", async () => {
  const d = fakeDeps();
  const seen = [];
  d.api.post = async (p, body) => { seen.push([p, body]); return { ok: true }; };
  const store = I.createStore(d);
  const t = store.register({ domain: "marketvideo", taskId: "M1", panel: "marketing", title: "营销" });
  await store.cancel(t.id);
  assert.deepStrictEqual(seen[0][0], "/api/v2/market-video/cancel");
  assert.deepStrictEqual(seen[0][1], { TaskId: "M1" });
  assert.strictEqual(store.get(t.id).status, "canceled");
});

test("取消：不在白名单的域直接拒绝", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A8" });
  await assert.rejects(() => store.cancel(t.id));
});

test("清空已完成不影响运行中", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const a = store.register({ domain: "agent", taskId: "K1" });
  const b = store.register({ domain: "agent", taskId: "K2" });
  store.get(b.id).status = "done";
  store.clearFinished();
  const left = store.list().map((t) => t.id);
  assert.ok(left.includes(a.id));
  assert.ok(!left.includes(b.id));
});

test("落盘：状态变化触发写盘", async () => {
  const d = fakeDeps();
  let saves = 0;
  d.saveJson = (name, data) => { saves++; return Promise.resolve(true); };
  const store = I.createStore(d);
  store.register({ domain: "agent", taskId: "S1" });
  await new Promise((r) => setImmediate(r));
  assert.ok(saves >= 1, "登记时就该落一次盘");
});

test("落盘失败不得影响任务", async () => {
  const d = fakeDeps();
  d.saveJson = () => Promise.reject(new Error("ENOSPC"));
  const store = I.createStore(d);
  store.register({ domain: "agent", taskId: "S2" });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.list().length, 1, "写盘失败也要保住内存态");
});
```

- [ ] **Step 2: 运行测试，确认因函数不存在而失败**

Run: `cd apps/desktop && node --test js/tasks.watch.test.cjs`

Expected: FAIL，报 `Cannot read properties of undefined (reading 'createStore')`

- [ ] **Step 3: 补实现 —— 在 tasks.js 的 return 之前插入观察层**

把 Task 3 末尾的

```js
  return {
    _internal: {
```

改为下面这段（即在 `return` 之前插入 `createStore` 与默认依赖）：

```js
  function defaultDeps() {
    const api = (typeof window !== "undefined" && window.HTWApi) || {};
    const htw = (typeof window !== "undefined" && window.htw) || {};
    return {
      api: {
        subscribeTask: api.subscribeTask,
        unsubscribeTask: api.unsubscribeTask,
        call: api.call,
        post: api.post,
      },
      saveJson: htw.saveJson,
      loadJson: htw.loadJson,
      subscribe: htw.onStreamEvent,
      now: function () { return Date.now(); },
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimeout: function (id) { return clearTimeout(id); },
    };
  }

  function createStore(deps) {
    const d = deps || defaultDeps();
    let tasks = [];
    let saveTimer = null;
    const unsubs = {};        // streamId -> 取消订阅函数
    const timers = {};        // task.id -> {first, poll, reconnect}
    const listeners = [];

    function emitChange() {
      for (let i = 0; i < listeners.length; i++) {
        try { listeners[i](); } catch (e) { /* 单个订阅者出错不能影响其他 */ }
      }
    }

    function persist() {
      if (saveTimer) return;
      saveTimer = d.setTimeout(function () {
        saveTimer = null;
        // 写盘失败只吞掉：磁盘满不该让用户正在跑的任务崩掉。
        try {
          const r = d.saveJson("tasks", tasks);
          if (r && typeof r.catch === "function") r.catch(function () {});
        } catch (e) { /* ignore */ }
      }, SAVE_DEBOUNCE_MS);
    }

    function stopWatch(task) {
      const sid = task.domain + ":" + task.taskId;
      if (unsubs[sid]) { try { unsubs[sid](); } catch (e) { /* ignore */ } delete unsubs[sid]; }
      if (d.api && d.api.unsubscribeTask) { try { d.api.unsubscribeTask(sid); } catch (e) { /* ignore */ } }
      const t = timers[task.id];
      if (t) {
        [t.first, t.poll, t.reconnect].forEach(function (id) {
          if (id != null) { try { d.clearTimeout(id); } catch (e) { /* ignore */ } }
        });
        delete timers[task.id];
      }
    }

    function finish(task) {
      if (task.status === "running") return false;
      stopWatch(task);
      return true;
    }

    function schedulePoll(task) {
      const t = timers[task.id] || (timers[task.id] = {});
      t.poll = d.setTimeout(function () { pollOnce(task); }, POLL_MS);
    }

    async function pollOnce(task) {
      const cfg = DOMAINS[task.domain];
      if (!cfg || task.status !== "running") return;
      try {
        const r = await d.api.call("GET", cfg.status(task));
        if (task.status !== "running") return;
        if (r && r.ok) {
          task.unknown = false;
          applyPayload(task, r.data || {});
        } else if (r && r.status === 404) {
          task.status = "interrupted";
          task.error = "服务端已无此任务（Web 服务可能已重启）";
          task.endedAt = d.now();
        } else {
          // 其它失败（网络抖动 / 401）**不判死**：只是这次没查到。
          task.unknown = true;
        }
      } catch (e) {
        task.unknown = true;
      }
      task.updatedAt = d.now();
      finish(task);
      emitChange();
      persist();
      if (task.status === "running") schedulePoll(task);
    }

    function onStream(task, msg) {
      if (!msg || msg.streamId !== task.domain + ":" + task.taskId) return;
      const t = timers[task.id] || (timers[task.id] = {});
      // 收到第一个事件就说明连接活着，清掉首事件超时。
      if (t.first) { try { d.clearTimeout(t.first); } catch (e) { /* ignore */ } t.first = null; }
      if (msg.type === "error") { degrade(task); return; }
      // 服务端发 end 但载荷始终没进终态（代理截断、终态事件丢失）：不能就此收工，
      // 否则记录会永远停在"进行中"。降级到轮询，让它有机会自己收敛。
      if (msg.type === "end") { if (!finish(task)) degrade(task); emitChange(); persist(); return; }
      let payload = msg.payload;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (e) { return; } }
      applyPayload(task, payload || {});
      finish(task);
      emitChange();
      persist();
    }

    // 降级是静默的：面板本来就在用自己的轮询，容器降级只是它自己从推送切回轮询。
    function degrade(task) {
      if (task.degraded) return;
      task.degraded = true;
      stopWatch(task);
      task.transport = "poll";
      task.updatedAt = d.now();
      emitChange();
      persist();
      if (task.status === "running") schedulePoll(task);
    }

    function watch(task) {
      const cfg = DOMAINS[task.domain];
      if (!cfg) return;
      if (!cfg.sse) { task.transport = "poll"; pollOnce(task); return; }
      task.transport = "sse";
      const sid = task.domain + ":" + task.taskId;
      if (d.subscribe) {
        try { unsubs[sid] = d.subscribe(function (msg) { onStream(task, msg); }) || null; } catch (e) { /* ignore */ }
      }
      try {
        d.api.subscribeTask(task.domain, task.taskId);
      } catch (e) { degrade(task); return; }
      const t = timers[task.id] || (timers[task.id] = {});
      // 8 秒还没收到任何事件，就当这条路不通，静默切轮询。
      t.first = d.setTimeout(function () {
        const tt = timers[task.id];
        if (tt) tt.first = null;
        if (task.transport === "sse" && task.status === "running") degrade(task);
      }, FIRST_EVENT_TIMEOUT_MS);
    }

    const store = {
      register: function (opts) {
        const task = newTask(opts);
        tasks = evict(tasks.concat([task]), MAX_RECORDS);
        emitChange();
        persist();
        watch(task);
        return task;
      },
      list: function () { return tasks.slice(); },
      get: function (id) { return tasks.filter((t) => t.id === id)[0] || null; },
      onChange: function (fn) {
        listeners.push(fn);
        return function () { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
      },
      clearFinished: function () {
        tasks = tasks.filter((t) => t.status === "running");
        emitChange();
        persist();
      },
      cancel: function (id) {
        const task = store.get(id);
        if (!task) return Promise.reject(new Error("任务不存在"));
        if (!canCancel(task.domain)) return Promise.reject(new Error("该任务不支持中途取消"));
        const cfg = DOMAINS[task.domain];
        return Promise.resolve(d.api.post(cfg.cancelPath, cancelBody(task.domain, task.taskId)))
          .then(function (r) {
            if (r && r.ok === false) throw new Error(r.message || "取消失败");
            task.status = "canceled";
            task.endedAt = d.now();
            stopWatch(task);
            emitChange();
            persist();
            return true;
          });
      },
      restore: function () {
        return Promise.resolve(d.loadJson("tasks"))
          .then(function (saved) {
            tasks = Array.isArray(saved) ? saved.filter((t) => t && t.id) : [];
            const pending = tasks.filter((t) => t.status === "running");
            // 逐个各查一次，不并发、不轮询：启动时服务端可能还没就绪。
            return pending.reduce(function (chain, task) {
              return chain.then(function () {
                return pollOnce(task).then(function () {
                  // 查完可能已经是终态了（notfound / 失败），这时再 watch 会白订阅一条流。
                  if (task.status === "running") watch(task);
                });
              });
            }, Promise.resolve());
          })
          .then(function () { emitChange(); persist(); })
          .catch(function () { emitChange(); });
      },
    };
    return store;
  }

  const _singleton = createStore(null);

  return {
    register: (o) => _singleton.register(o),
    list: () => _singleton.list(),
    get: (id) => _singleton.get(id),
    onChange: (fn) => _singleton.onChange(fn),
    clearFinished: () => _singleton.clearFinished(),
    cancel: (id) => _singleton.cancel(id),
    restore: () => _singleton.restore(),
    _internal: {
      MAX_RECORDS, POLL_MS, FIRST_EVENT_TIMEOUT_MS, RECONNECT_MS, SAVE_DEBOUNCE_MS,
      TERMINAL_STATUSES, DOMAINS,
      isTerminal, normalizeStatus, applyPayload, evict, canCancel, cancelBody, newTask, createStore,
    },
  };
```

**注意**：Task 3 写的 return 里只带了纯逻辑的 `_internal`，本步要把它替换成上面这一整段（这样 `_internal` 才会同时含 `createStore` 与全部纯函数）。

- [ ] **Step 4: 运行测试，确认全绿**

Run: `cd apps/desktop && node --test js/tasks.test.cjs js/tasks.watch.test.cjs`

Expected: PASS，`# fail 0`

- [ ] **Step 5: 登记到 test 脚本**

把 `apps/desktop/package.json` 的 `scripts.test` 改成：

```json
"test": "node --test js/api.test.cjs js/sse-parser.test.cjs js/tasks.test.cjs js/tasks.watch.test.cjs js/skills/workflow.test.cjs js/skills/workflow.mount.test.cjs js/skills/batch.test.cjs js/skills/batch.mount.test.cjs js/app.panels.test.mjs",
```

- [ ] **Step 6: 全量回归**

Run: `cd apps/desktop && npm test`

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/js/tasks.js apps/desktop/js/tasks.watch.test.cjs apps/desktop/package.json
git commit -m "桌面端：任务容器接入推送观察、轮询降级、重启恢复与取消"
```

---

## Task 5: 任务中心面板

第 13 个面板。三处注册缺任何一处都会「点了没反应」，`app.panels.test.mjs` 会替我们守住。

**Files:**
- Create: `apps/desktop/js/skills/tasks-panel.js`
- Create: `apps/desktop/js/skills/tasks-panel.mount.test.cjs`
- Modify: `apps/desktop/index.html`
- Modify: `apps/desktop/js/app.js`
- Modify: `apps/desktop/package.json`（`test` 脚本）

**Interfaces:**
- Consumes: `window.HTWTasks`（Task 3/4）、`window.UI`、`window.App.showPanel`
- Produces: `window.Skills.tasks = { mount }`，对应 `<section id="panel-tasks">` 与 `data-skill="tasks"`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/js/skills/tasks-panel.mount.test.cjs`：

```js
const test = require("node:test");
const assert = require("node:assert");

/*
 * 挂载冒烟：挡住"面板一挂载就抛异常、整个 app 白屏"这类最贵的错误。
 * DOM 替身与 batch.mount.test.cjs 同一套。
 */

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    _attrs: {},
    children: [],
    parentNode: null,
    style: {},
    set textContent(v) { this._text = String(v == null ? "" : v); this.children = []; },
    get textContent() {
      if (this._text != null && !this.children.length) return this._text;
      return this.children.map((c) => c.textContent || "").join("");
    },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ""; },
    appendChild(child) {
      if (child == null) return child;
      if (Array.isArray(child)) { child.forEach((c) => this.appendChild(c)); return child; }
      if (typeof child === "string") { this.children.push({ textContent: child, children: [] }); return child; }
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    addEventListener() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, "");
      const out = [];
      (function walk(n) {
        (n.children || []).forEach((c) => {
          if (c.className && String(c.className).split(/\s+/).indexOf(cls) >= 0) out.push(c);
          walk(c);
        });
      })(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  return node;
}

function withDom(tasks, fn) {
  const doc = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const prevDoc = global.document;
  const prevWin = global.window;
  global.document = doc;
  global.window = {
    HTWTasks: {
      list: () => tasks,
      onChange: () => function () {},
      clearFinished: () => {},
      cancel: () => Promise.resolve(true),
    },
    App: { showPanel: () => {} },
  };
  global.UI = {
    el: (tag, attrs, kids) => {
      const n = makeNode(tag);
      if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else n._attrs[k] = v;
      }
      if (kids != null) n.appendChild(kids);
      return n;
    },
    clear: (n) => { while (n && n.children.length) n.removeChild(n.children[0]); return n; },
  };
  try { return fn(); } finally {
    global.document = prevDoc;
    global.window = prevWin;
  }
}

function mount(tasks) {
  withDom(tasks, () => {
    const mod = require("./tasks-panel.js");
    const panel = makeNode("section");
    mod.mount(panel);
    return panel;
  });
}

test("mount: 挂载不抛异常且渲染出内容", () => {
  const panel = mount([]);
  assert.ok(panel.children.length > 0, "面板挂载后应有内容");
});

test("mount: 重复挂载不叠加（切导航回来时）", () => {
  const panel = mount([]);
  const first = panel.children.length;
  const mod = require("./tasks-panel.js");
  mod.mount(panel);
  assert.strictEqual(panel.children.length, first);
});

test("有任务时能看到标题", () => {
  const panel = mount([{
    id: "t1", title: "短剧创作 · 都市逆袭", panel: "shortdrama", status: "running",
    progress: 62, step: "合成中", transport: "sse", degraded: true,
    domain: "agent", unknown: false, error: null, result: null, updatedAt: 0,
  }]);
  assert.ok(panel.textContent.indexOf("短剧创作") >= 0, "应显示任务标题");
});

test("progress 为 null 不崩，也不画进度条", () => {
  const panel = mount([{
    id: "t2", title: "批量 · 商品A", panel: "batch", status: "running",
    progress: null, step: "处理中", transport: "poll", degraded: false,
    domain: "batch", unknown: false, error: null, result: null, updatedAt: 0,
  }]);
  assert.ok(panel.textContent.indexOf("批量") >= 0);
  assert.strictEqual(panel.querySelectorAll("tk-bar").length, 0, "没有进度就不该画条");
});
```

- [ ] **Step 2: 运行测试，确认因模块不存在而失败**

Run: `cd apps/desktop && node --test js/skills/tasks-panel.mount.test.cjs`

Expected: FAIL，报 `Cannot find module './tasks-panel.js'`

- [ ] **Step 3: 写面板实现**

创建 `apps/desktop/js/skills/tasks-panel.js`：

```js
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") {
    window.Skills = window.Skills || {};
    window.Skills.tasks = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const I = (typeof window !== "undefined" && window.HTWTasks && window.HTWTasks._internal) || {};
  const GROUPS = [
    { key: "running", label: "进行中", match: (t) => t.status === "running" },
    { key: "failed", label: "失败", match: (t) => t.status === "failed" || t.status === "interrupted", fold: true },
    { key: "done", label: "已完成", match: (t) => t.status === "done" || t.status === "canceled", fold: true },
  ];
  const FOLD_LIMIT = 20;

  function fmtTime(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n) => (n < 10 ? "0" + n : String(n));
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function statusText(t) {
    if (t.status === "running") return t.unknown ? "状态未确认" : "进行中";
    if (t.status === "failed") return "失败";
    if (t.status === "interrupted") return "已中断";
    if (t.status === "canceled") return "已取消";
    return "已完成";
  }

  function row(t) {
    const node = UI.el("div", { class: "card tk-row" });

    const head = UI.el("div", { class: "row" }, [
      UI.el("strong", { text: t.title || t.taskId }),
      UI.el("span", { class: "badge " + t.status, text: statusText(t) }),
      // 「已降级」是排查实际降级率的唯一线索，必须显眼。
      t.degraded ? UI.el("span", { class: "badge", text: "已降级" }) : null,
    ]);
    node.appendChild(head);

    // progress 允许为 null —— 创作/工作流/批量三域的进度语义不同，编一个百分比是在骗人。
    if (t.progress != null) {
      node.appendChild(UI.el("div", { class: "tk-bar" }, [
        UI.el("div", { class: "tk-bar-fill", style: "width:" + t.progress + "%" }),
      ]));
    }
    const detail = [t.progress != null ? t.progress + "%" : null, t.step].filter(Boolean).join(" · ");
    if (detail) node.appendChild(UI.el("div", { class: "hintline", text: detail }));
    if (t.error) node.appendChild(UI.el("div", { class: "wf-error", text: String(t.error) }));

    const acts = [];
    if (t.panel && window.App && window.App.showPanel) {
      acts.push(UI.el("button", {
        class: "btn btn-ghost", text: "回到面板",
        onclick: function () { window.App.showPanel(t.panel); },
      }));
    }
    if (I.canCancel && I.canCancel(t.domain)) {
      const btn = UI.el("button", { class: "btn btn-ghost", text: "取消" });
      btn.addEventListener("click", function () {
        btn.disabled = true;
        btn.textContent = "取消中…";
        Promise.resolve(window.HTWTasks.cancel(t.id)).catch(function (e) {
          btn.disabled = false;
          btn.textContent = "取消";
          node.appendChild(UI.el("div", { class: "wf-error", text: String((e && e.message) || e) }));
        });
      });
      acts.push(btn);
    }
    // 「重试」不自动重发：自动重发会二次扣减额度，必须由人确认。
    // 行为是切回来源面板让人自己来。
    if (t.status === "failed" && t.panel && window.App && window.App.showPanel) {
      acts.push(UI.el("button", {
        class: "btn btn-ghost", text: "重试",
        onclick: function () { window.App.showPanel(t.panel); },
      }));
    }
    if (t.result && t.result.fileName && t.status === "done") {
      acts.push(UI.el("button", {
        class: "btn btn-ghost", text: "下载",
        onclick: function () {
          const url = t.result.downloadUrl;
          if (url && /^https?:/i.test(url) && window.htw && window.htw.openExternal) window.htw.openExternal(url);
          else if (t.panel && window.App && window.App.showPanel) window.App.showPanel(t.panel);
        },
      }));
    }
    if (acts.length) node.appendChild(UI.el("div", { class: "row" }, acts));
    if (t.endedAt) node.appendChild(UI.el("div", { class: "hint", text: fmtTime(t.endedAt) }));
    return node;
  }

  function mount(panel) {
    UI.clear(panel);
    panel.appendChild(UI.el("h2", { text: "任务中心" }));
    const body = UI.el("div", { class: "tk-body" });
    panel.appendChild(body);

    const clearBtn = UI.el("button", { class: "btn btn-ghost", text: "清空已完成" });
    clearBtn.addEventListener("click", function () {
      window.HTWTasks.clearFinished();
      render();
    });
    panel.appendChild(UI.el("div", { class: "row" }, [clearBtn]));

    function render() {
      UI.clear(body);
      const all = (window.HTWTasks.list && window.HTWTasks.list()) || [];
      const counts = {};
      GROUPS.forEach(function (g) {
        const hit = all.filter(g.match);
        counts[g.key] = hit.length;
        if (!hit.length) return;
        body.appendChild(UI.el("div", { class: "section-title", text: g.label + " " + hit.length }));
        const shown = g.fold ? hit.slice(-FOLD_LIMIT) : hit;
        for (let i = shown.length - 1; i >= 0; i--) body.appendChild(row(shown[i]));
        if (hit.length > shown.length) {
          body.appendChild(UI.el("div", { class: "hint", text: "仅显示最近 " + FOLD_LIMIT + " 条，共 " + hit.length + " 条" }));
        }
      });
      if (!all.length) body.appendChild(UI.el("div", { class: "hint", text: "还没有任务记录。" }));
    }

    render();
    // 容器每次变更都会回调；面板重挂时用标记避免重复订阅。
    if (!panel._tkBound && window.HTWTasks.onChange) {
      panel._tkBound = true;
      window.HTWTasks.onChange(render);
    }
  }

  return { mount: mount };
});
```

- [ ] **Step 4: 加两处样式**

在 `apps/desktop/css/app.css` 末尾追加（不要改动文件里既有内容，避免与他人未提交的改动冲突）：

```css
/* 任务中心 */
.tk-row { margin-bottom: 10px; }
.tk-bar { height: 6px; background: var(--panel-2); border-radius: 3px; overflow: hidden; margin: 6px 0; }
.tk-bar-fill { height: 6px; background: var(--accent); border-radius: 3px; }
.tk-body { margin-bottom: 12px; }
.badge.interrupted { background: #2f2a12; color: #d6c07a; }
.badge.canceled { background: #26262a; color: var(--muted); }
.badge.done { background: #14342a; color: #3ecf8e; }
```

**注意**：`css/app.css` 目前有他人未提交的改动。追加前先确认 `git diff apps/desktop/css/app.css` 的内容不含你打算写的行，**只追加、不修改既有行**。

- [ ] **Step 5: 三处注册 —— index.html**

在 `apps/desktop/index.html` 中：

第一处，在 `<button class="nav-item" data-skill="assistant">` 那行之后插入：

```html
      <button class="nav-item" data-skill="tasks"><i class="fa-solid fa-list-check"></i>任务中心 Tasks</button>
```

第二处，在 `<section class="panel" id="panel-workflow"></section>` 之后插入：

```html
      <section class="panel" id="panel-tasks"></section>
```

第三处，在 `<script src="js/skills/shortdrama.js"></script>` 之后插入：

```html
  <script src="js/skills/tasks-panel.js"></script>
```

（顺序要求：`tasks-panel.js` 必须在 `js/app.js` 之前，否则 `mountSkills()` 时 `Skills.tasks` 还不存在。）

- [ ] **Step 6: 三处注册 —— app.js**

把 `apps/desktop/js/app.js` 第 5 行：

```js
  const SKILLS = ["insight", "topics", "edit", "tools", "publish", "assistant", "create", "marketing", "batch", "shortdrama", "workflow"];
```

改为：

```js
  const SKILLS = ["insight", "topics", "edit", "tools", "publish", "assistant", "create", "marketing", "batch", "shortdrama", "workflow", "tasks"];
```

再在 `boot()` 里，把这两行：

```js
    wireNav();
    mountSkills();
```

改为：

```js
    wireNav();
    mountSkills();
    // 任务恢复要等配置与 AuthKey 就绪，所以排在 mountSkills 之后 —— 但要在
    // 面板首次渲染前把记录灌进去，否则任务中心会先闪一次空列表。
    if (window.HTWTasks && window.HTWTasks.restore) {
      try { window.HTWTasks.restore(); } catch (e) { /* 恢复失败不该挡住启动 */ }
    }
```

- [ ] **Step 7: 登记到 test 脚本并运行**

把 `apps/desktop/package.json` 的 `scripts.test` 末尾加上新文件（完整值）：

```json
"test": "node --test js/api.test.cjs js/sse-parser.test.cjs js/tasks.test.cjs js/tasks.watch.test.cjs js/skills/workflow.test.cjs js/skills/workflow.mount.test.cjs js/skills/batch.test.cjs js/skills/batch.mount.test.cjs js/skills/tasks-panel.mount.test.cjs js/app.panels.test.mjs",
```

Run: `cd apps/desktop && npm test`

Expected: 全部通过。`app.panels.test.mjs` 会校验三处注册齐全 —— 若报「导航项 tasks 不在白名单」或「SKILLS 里有 tasks 但 index.html 没有 panel-tasks」，说明 Step 5/6 漏了。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/js/skills/tasks-panel.js apps/desktop/js/skills/tasks-panel.mount.test.cjs apps/desktop/index.html apps/desktop/js/app.js apps/desktop/package.json apps/desktop/css/app.css
git commit -m "桌面端：新增任务中心面板"
```

---

## Task 6: 8 个面板接入登记

面板渲染逻辑**一律不改**，只在拿到任务标识后多调一次 `registerTask`。

**Files:**
- Modify: `apps/desktop/js/skills/shortdrama.js`
- Modify: `apps/desktop/js/skills/marketing.js`
- Modify: `apps/desktop/js/skills/tools.js`
- Modify: `apps/desktop/js/skills/publish.js`
- Modify: `apps/desktop/js/skills/create.js`
- Modify: `apps/desktop/js/skills/workflow.js`
- Modify: `apps/desktop/js/skills/batch.js`
- Modify: `apps/desktop/js/skills/edit.js`
- Modify: `apps/desktop/index.html`（加 `js/tasks.js` 的 script 标签）

**Interfaces:**
- Consumes: `window.HTWTasks.register({domain, taskId, panel, title, type})`
- Produces: 无新接口

- [ ] **Step 1: 先加 tasks.js 的 script 标签**

在 `apps/desktop/index.html` 中，把：

```html
  <script src="js/api.js"></script>
```

改为：

```html
  <script src="js/api.js"></script>
  <script src="js/tasks.js"></script>
```

（必须在 `js/skills/*.js` 与 `js/app.js` 之前。）

- [ ] **Step 2: 加一个统一的登记入口，避免 8 处重复判空**

在 `apps/desktop/js/tasks.js` 的返回对象上补一个便捷方法。把文件末尾 `return {` 起的部分改为：

```js
  return {
    register: (o) => _singleton.register(o),
    // 面板里统一走这个：容器的存在与否、以及 window.htw 未就绪，都不该让面板崩掉。
    track: function (o) {
      try {
        if (typeof o === "object" && o && o.domain && o.taskId) return _singleton.register(o);
      } catch (e) { /* 登记失败绝不能影响面板自己的流程 */ }
      return null;
    },
    list: () => _singleton.list(),
```

- [ ] **Step 3: 短剧创作（agent 域）**

在 `apps/desktop/js/skills/shortdrama.js` 中，找到生成任务并拿到 taskId 的那一行（`/api/v2/agent/start` 的响应处理处，形如 `var taskId = ...`），在其后**立即插入**：

```js
        window.HTWTasks.track({ domain: "agent", taskId: taskId, panel: "shortdrama", title: "短剧创作" });
```

若该文件的响应解包后变量名不是 `taskId`，按实际变量名替换。

- [ ] **Step 4: 营销成片（marketvideo 域）**

在 `apps/desktop/js/skills/marketing.js` 中，`/api/v2/market-video/submit` 成功、拿到 taskId 之后、开始轮询之前插入：

```js
        window.HTWTasks.track({ domain: "marketvideo", taskId: taskId, panel: "marketing", title: "营销成片" });
```

- [ ] **Step 5: 工具面板（voice / subtitle / agent / image 四域）**

在 `apps/desktop/js/skills/tools.js` 中，四处轮询发起点各自提交成功后插入。形如：

```js
        window.HTWTasks.track({ domain: "voice", taskId: id, panel: "tools", title: "语音转写" });
```

四处的 `domain` / `title` 依次为：`voice`（语音转写）、`subtitle`（字幕提取）、`agent`（一键成片）、`image`（图片生成）。

- [ ] **Step 6: 发布（publish 域）**

在 `apps/desktop/js/skills/publish.js` 中，`/api/v2/publish/submit` 成功、拿到 taskId 之后插入：

```js
        window.HTWTasks.track({ domain: "publish", taskId: taskId, panel: "publish", title: "多平台发布" });
```

- [ ] **Step 7: 创作（creation 域，需带 type）**

在 `apps/desktop/js/skills/create.js` 中，`/api/v2/creation/start` 返回 sessionId 之后插入：

```js
        window.HTWTasks.track({ domain: "creation", taskId: sessionId, panel: "create", title: "创作", type: tab });
```

`tab` 用该面板当前标签页的值（`video` / `image` / `article`）—— `/api/v2/creation/status` 需要它作为查询参数。

- [ ] **Step 8: 工作流（workflow 域）**

在 `apps/desktop/js/skills/workflow.js` 中，`/api/v2/workflow/create` 返回 workflowId 之后插入：

```js
        window.HTWTasks.track({ domain: "workflow", taskId: workflowId, panel: "workflow", title: "工作流" });
```

- [ ] **Step 9: 批量（batch 域）**

在 `apps/desktop/js/skills/batch.js` 中，三类批次（营销成片 / 剪同款 / 智能包装）各自提交成功、拿到 batchId 之后插入：

```js
        window.HTWTasks.track({ domain: "batch", taskId: batchId, panel: "batch", title: "批量任务" });
```

- [ ] **Step 10: 剪辑（edit 域）**

在 `apps/desktop/js/skills/edit.js` 中，`/api/v2/edit/*` 提交成功、拿到 taskId 之后插入：

```js
        window.HTWTasks.track({ domain: "edit", taskId: taskId, panel: "edit", title: "剪辑处理" });
```

- [ ] **Step 11: 全量回归**

Run: `cd apps/desktop && npm test`

Expected: 全部通过。`workflow.js` 与 `batch.js` 有既有测试，若因插入位置选错而破坏了它们的自有流程，测试会红 —— 那说明插入点不对，要往「已拿到标识、尚未开始轮询」处挪。

- [ ] **Step 12: 人工冒烟**

Run: `cd apps/desktop && npm start`

逐项确认：
1. 侧边栏出现「任务中心 Tasks」，能点开。
2. 在「工具」里跑一次语音转写，切到任务中心，能看到它且进度在动。
3. 关掉应用重开，任务中心的记录仍在。
4. 若任务已结束，记录仍在「已完成」分组里。

- [ ] **Step 13: 提交**

```bash
git add apps/desktop/index.html apps/desktop/js/tasks.js apps/desktop/js/skills/shortdrama.js apps/desktop/js/skills/marketing.js apps/desktop/js/skills/tools.js apps/desktop/js/skills/publish.js apps/desktop/js/skills/create.js apps/desktop/js/skills/workflow.js apps/desktop/js/skills/batch.js apps/desktop/js/skills/edit.js
git commit -m "桌面端：各面板把长任务登记进任务中心"
```

---

## Self-Review

**1. 设计文档覆盖核对**

| 设计文档章节 | 对应任务 |
|---|---|
| §3.2 域注册表（10 域） | Task 3（`DOMAINS`）、Task 4（消费） |
| §3.3 面板→域映射（8 面板） | Task 6 |
| §4 数据模型 + `progress` 可为 null | Task 3（`newTask` / `applyPayload`） |
| §4.1 `degraded` 与 `transport` 分离 | Task 3、Task 4（`degrade`） |
| §5.1 watch 状态机 + 8s 首事件超时 + 静默降级 | Task 4 |
| §5.2 客户端自行判终态 | Task 3（`TERMINAL_STATUSES` 含 `partial_failed` 等） |
| §5.3 服务端已修（本次不动服务端） | Global Constraints 声明 |
| §6.1 启动恢复，网络故障不误判 | Task 4（`restore` + `unknown`） |
| §6.2 取消白名单 + PascalCase | Task 3（`cancelBody`）、Task 4（`cancel`） |
| §6.3 不缓存下载地址 | Task 3（`result` 随载荷现取，面板点击时才用） |
| §7 面板布局与交互规则 | Task 5 |
| §8 主进程 SSE + 纯函数解析 + IPC | Task 1（解析）、Task 2（连接池与桥接） |
| §9 错误处理表 | Task 4（降级/401 走既有横幅/402 复用 `onQuotaExceeded`/写盘失败吞掉）、Task 5（取消失败显示在行内） |
| §10 测试三件套 | Task 3/4/5 共 4 个测试文件 |
| §12 交付顺序 1-5 | Task 1→2→3→4→5，Task 6 为第 5 步 |

无遗漏。

**2. 占位符扫描** —— 无 TBD / TODO / 「类似 Task N」。所有代码块均为可直接粘贴的完整代码。

**3. 类型一致性核对**

- `parseSseChunk(remainder, chunk) -> {events, remainder}`：Task 1 定义，Task 2 在 `res.on("data")` 中按此调用，一致。
- IPC `htw:subscribe` 入参 `{streamId, domain, taskId, base, apiKey}`：Task 2 的 preload 与 main 两侧字段名一致。
- `htw:stream-event` 出参 `{streamId, type, payload}`：Task 2 主进程 `emit()` 产出，Task 4 的 `onStream()` 按 `msg.type` / `msg.payload` 消费，一致。
- `HTWTasks.track({domain, taskId, panel, title, type})`：Task 6 全部 9 处调用，与 Task 6 Step 2 里包在 `register` 外面的 `track` 便捷方法一致（Task 4 只提供 `register`）。
- `_internal.canCancel(domain)` / `cancelBody(domain, taskId)`：Task 3 定义，Task 4、Task 5 消费，一致。
- `createStore(deps)` 的 deps 字段名（`api` / `saveJson` / `loadJson` / `subscribe` / `now` / `setTimeout` / `clearTimeout`）：Task 4 测试与实现一致。

**已修正的三处**（自审时发现，均为会导致测试假绿或线上跑飞的缺陷）：

1. **测试替身与 `subscribe` 契约不符** —— 初稿的假依赖用 `d.events[streamId]` 存回调，但 `subscribe(cb)` 根本收不到 streamId（真实 `preload.onStreamEvent` 也只是把回调挂在一个通道上）。改为 `_cbs` 数组 + `emit(streamId, type, payload)` 广播，由容器自己按 streamId 过滤 —— 与真实链路同形。
2. **`restore` 会给已终态的任务白订阅一条流** —— `pollOnce` 可能已把任务置为 `interrupted`，初稿仍无条件 `watch`。已加 `if (task.status === "running")`。
3. **服务端 `end` 但载荷未进终态时任务会永远卡住** —— 初稿 `finish(task)` 返回 false 也只是收工，记录停在「进行中」且再无任何人推进。已改为降级到轮询。

另有一处笔误已就地更正：`evict` 初稿的 `running` 过滤表达式含无意义的 `|| t.status === "canceled" && false`；Task 3 Step 3 的代码块里已直接给出语义等价的 `t.status === "running"`。

**订正记录**：Task 3 已实现并通过评审，其代码块与用例块后来被逐字替换为实际入库的 `apps/desktop/js/tasks.js` 与 `js/tasks.test.cjs`（`expired` 终态、`normalizeStatus` 的 `partial_failed → failed`、终态粘滞守卫、无条件 `updatedAt`、`num` 空串守卫、`evict` 缺省与新数组返回等差异均为实现期的修正）。Task 4 的 `partial_failed` 用例断言同步改为 `failed`。跑 Task 4 时以代码块为准。
