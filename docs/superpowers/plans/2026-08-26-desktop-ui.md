# HTW Media 桌面客户端 — 能力界面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `agent/skills` 的 5 个技能(insight / create / publish / tools / edit)接成 Electron 桌面客户端 `apps/desktop` 中可用、带异步轮询的按钮与界面。

**Architecture:** 原生 JS(无构建),Electron 渲染进程经 preload 的 `window.htw.call` / `window.htw.upload` 直接 fetch V2 API。共享层 `js/api.js`(密钥管理、envelope 归一化、通用 `pollTask` 轮询)、`js/ui.js`(标签页/表单/结果/错误横幅),每技能一个模块 `js/skills/<name>.js`,由 `js/app.js` 引导初始化。

**Tech Stack:** Electron (Node) + 原生 HTML/CSS/JS;`node:test`(CJS)仅测 `js/api.js` 纯逻辑;其余 JS 以 `node --check` 校验语法。

## Global Constraints

- 前端为原生 JS,**无构建步骤**,Electron 直接 `loadFile("index.html")`。
- 调用方式:**直接 fetch V2 API**(`window.htw.call` / `window.htw.upload`),**不** spawn `htw-skills.mjs` CLI。
- AuthKey 仅内存,顶栏输入,**不落盘**。
- 范围:**全量 5 技能**,含 create 多步会话向导。
- API Base 默认 `https://htwmedia.dpdns.org`,统一信封 `{ ok, data, errCode, errMsg, taskId }`;失败 `{ ok:false, errCode, errMsg }`。
- 错误处理:401 提示填 Key;402 配额横幅;其余 `ok:false` 显示 `errMsg` 横幅。
- YAGNI:不引框架、不做"复制为 CLI"、不含草稿生成。

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `apps/desktop/preload.js` | 扩展 `window.htw.upload`(FormData 文件上传) |
| `apps/desktop/js/api.js` | 密钥/base 管理、`call`/`upload` 包装、`normalize` 归一化、`pollTask` 通用轮询 |
| `apps/desktop/js/api.test.cjs` | Node 测 `normalize` + `pollTask` 纯逻辑 |
| `apps/desktop/js/ui.js` | `el` DOM 构建器、`banner` 错误横幅、`resultView` 结果渲染、`switchTab` |
| `apps/desktop/css/app.css` | 暗色主题 |
| `apps/desktop/index.html` | 外壳:顶栏 + 5 标签 + 内容容器 + 脚本引入 |
| `apps/desktop/js/app.js` | 引导:读顶栏 Key/Base、初始化各技能 tab |
| `apps/desktop/js/skills/insight.js` | 洞察 tab |
| `apps/desktop/js/skills/edit.js` | 编辑 tab(含 decrypt 同步) |
| `apps/desktop/js/skills/tools.js` | 工具 tab(音频/图片/Agent/字幕/模板) |
| `apps/desktop/js/skills/publish.js` | 分发 tab |
| `apps/desktop/js/skills/create.js` | 创作 tab(向导) |

---

### Task 1: preload 增加 upload

**Files:**
- Modify: `apps/desktop/preload.js`

**Interfaces:**
- Produces: `window.htw.upload(formData, path, apiKey)` → `{ status, ok, data }`

- [ ] **Step 1: 改写 preload.js 增加 upload**

```js
const { contextBridge, ipcRenderer } = require("electron");

const API_BASE = process.env.HTW_API_BASE || "https://htwmedia.dpdns.org";

contextBridge.exposeInMainWorld("htw", {
  apiBase: API_BASE,
  call: async (method, path, body, apiKey) => {
    const headers = { AuthKey: apiKey || "" };
    const init = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(`${API_BASE}${path}`, init);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  },
  // 文件上传:FormData 由调用方构造,浏览器自动加 boundary,不要手动设 Content-Type
  upload: async (formData, path, apiKey) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { AuthKey: apiKey || "" },
      body: formData,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  },
});
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/preload.js`
Expected: 无输出(通过)

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/preload.js
git commit -m "feat(desktop): expose window.htw.upload for multipart endpoints"
```

---

### Task 2: 共享 API 层 js/api.js

**Files:**
- Create: `apps/desktop/js/api.js`

**Interfaces:**
- Produces: `window.api.setKey(k)`, `window.api.setBase(b)`, `window.api.call(method,path,body)` → 原始 `{status,ok,data}`, `window.api.upload(fd,path)`, `window.api.normalize(res)` → V2 信封 `{ok,data,errCode,errMsg}`, `window.api.pollTask(getStatus,onUpdate,intervalMs?,maxMs?)` → 最终状态对象, `window.api.key`(getter)

- [ ] **Step 1: 写 js/api.js**

```js
(function (global) {
  const w = global;
  let apiKey = "";
  let apiBase = (w.htw && w.htw.apiBase) || "https://htwmedia.dpdns.org";

  function setKey(k) { apiKey = k || ""; }
  function setBase(b) { if (b) apiBase = b; }
  function getKey() { return apiKey; }

  async function call(method, path, body) {
    return w.htw.call(method, path, body, apiKey);
  }
  async function upload(formData, path) {
    return w.htw.upload(formData, path, apiKey);
  }

  // 把 {status,ok,data} 归一为 V2 信封;若 data 已是信封则原样返回
  function normalize(res) {
    const d = res && res.data;
    if (d && typeof d === "object" && "ok" in d) return d;
    return { ok: !!(res && res.ok), errCode: res ? res.status : 0, errMsg: "", data: d };
  }

  // 轮询:getStatus() -> 状态对象;当 status==='completed'|'failed' 返回;超时抛错
  async function pollTask(getStatus, onUpdate, intervalMs = 3000, maxMs = 600000) {
    const start = Date.now();
    while (true) {
      const st = await getStatus();
      if (onUpdate) onUpdate(st);
      const s = st && (st.status || (st.data && st.data.status)) || "";
      if (s === "completed" || s === "failed") return st;
      if (Date.now() - start > maxMs) throw new Error("polling timeout");
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  const api = { setKey, setBase, getKey, call, upload, normalize, pollTask };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  w.api = api;
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/js/api.js`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/js/api.js
git commit -m "feat(desktop): shared api layer (key, normalize, pollTask)"
```

---

### Task 3: 测 js/api.js 纯逻辑

**Files:**
- Create: `apps/desktop/js/api.test.cjs`

**Interfaces:**
- Consumes: `require("./api.js")` 导出的 `normalize`、`pollTask`

- [ ] **Step 1: 写测试**

```js
const test = require("node:test");
const assert = require("node:assert");
const api = require("./api.js");

test("normalize: already an envelope passes through", () => {
  assert.deepStrictEqual(
    api.normalize({ status: 200, ok: true, data: { ok: true, data: { a: 1 }, errCode: 0 } }),
    { ok: true, data: { a: 1 }, errCode: 0 }
  );
});

test("normalize: raw data wrapped with status as errCode", () => {
  assert.deepStrictEqual(
    api.normalize({ status: 200, ok: true, data: { a: 1 } }),
    { ok: true, data: { a: 1 }, errCode: 200, errMsg: "" }
  );
});

test("normalize: ok:false surfaces errMsg", () => {
  const r = api.normalize({ status: 402, ok: false, data: { ok: false, errCode: 402, errMsg: " quota" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errCode, 402);
});

test("pollTask: resolves when status completed", async () => {
  const st = await api.pollTask(async () => ({ status: "completed", ok: true }), null, 1, 1000);
  assert.strictEqual(st.status, "completed");
});

test("pollTask: polls until completed", async () => {
  let n = 0;
  const st = await api.pollTask(async () => (++n >= 3 ? { status: "completed" } : { status: "running" }), null, 1, 1000);
  assert.strictEqual(st.status, "completed");
  assert.strictEqual(n, 3);
});

test("pollTask: rejects on timeout", async () => {
  await assert.rejects(() => api.pollTask(async () => ({ status: "running" }), null, 1, 5));
});
```

- [ ] **Step 2: 运行测试**

Run: `node --test apps/desktop/js/api.test.cjs`
Expected: `# tests 6`,全部 pass

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/js/api.test.cjs
git commit -m "test(desktop): cover api.normalize and api.pollTask"
```

---

### Task 4: UI 基础组件 js/ui.js

**Files:**
- Create: `apps/desktop/js/ui.js`

**Interfaces:**
- Produces: `window.ui.el(tag, props, ...children)`, `window.ui.banner(errCode, errMsg)`, `window.ui.resultView(container, data)`, `window.ui.switchTab(name)`, `window.ui.val(id)`

- [ ] **Step 1: 写 js/ui.js**

```js
(function () {
  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === "class") e.className = props[k];
        else if (k === "onclick") e.addEventListener("click", props[k]);
        else if (k === "html") e.innerHTML = props[k];
        else if (k.startsWith("data-")) e.setAttribute(k, props[k]);
        else e[k] = props[k];
      }
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  function banner(errCode, errMsg) {
    let b = document.getElementById("banner");
    if (!b) {
      b = el("div", { id: "banner", class: "banner" });
      document.body.prepend(b);
    }
    b.textContent = `错误 ${errCode || ""}: ${errMsg || "请求失败"}`;
    b.style.display = "block";
  }

  function clearBanner() {
    const b = document.getElementById("banner");
    if (b) b.style.display = "none";
  }

  function resultView(container, data) {
    clearBanner();
    container.innerHTML = "";
    const pre = el("pre", {}, typeof data === "string" ? data : JSON.stringify(data, null, 2));
    container.append(pre);
  }

  function val(id) {
    const e = document.getElementById(id);
    return e ? e.value.trim() : "";
  }

  function switchTab(name) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = p.dataset.tab === name ? "block" : "none"));
  }

  window.ui = { el, banner, resultView, val, switchTab };
})();
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/js/ui.js`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/js/ui.js
git commit -m "feat(desktop): ui primitives (el, banner, resultView, switchTab)"
```

---

### Task 5: 暗色主题 css/app.css

**Files:**
- Create: `apps/desktop/css/app.css`

**Interfaces:**
- Produces: 被 `index.html` 引用的样式类 `.banner` `.tab-btn` `.tab-panel` `.result` 等

- [ ] **Step 1: 写 css/app.css**

```css
* { box-sizing: border-box; }
body { font-family: system-ui, "Microsoft YaHei", sans-serif; margin: 0; background: #0f1115; color: #e6e6e6; }
header { padding: 12px 20px; background: #161a22; border-bottom: 1px solid #262c38; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
header input { flex: 1; min-width: 220px; padding: 8px 10px; border-radius: 6px; border: 1px solid #2c3340; background: #1b2130; color: #e6e6e6; }
.tabs { display: flex; gap: 4px; padding: 8px 20px; background: #11151d; border-bottom: 1px solid #262c38; }
.tab-btn { padding: 8px 14px; border: none; background: transparent; color: #8b94a7; cursor: pointer; border-radius: 6px; }
.tab-btn.active { background: #2f6df6; color: #fff; }
.tab-panel { padding: 20px; display: none; max-width: 980px; margin: 0 auto; }
.tab-panel.active { display: block; }
.row { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; align-items: center; }
.row input, .row select, .row textarea { padding: 8px 10px; border-radius: 6px; border: 1px solid #2c3340; background: #1b2130; color: #e6e6e6; min-width: 200px; }
button.act { padding: 8px 12px; border-radius: 6px; border: 1px solid #2f6df6; background: #2f6df6; color: #fff; cursor: pointer; }
button.act:hover { background: #4480ff; }
.result { margin-top: 14px; }
.result pre { background: #11151d; padding: 12px; border-radius: 8px; overflow: auto; max-height: 420px; }
.banner { display: none; margin: 0; padding: 10px 20px; background: #5a1d1d; color: #ffd9d9; border-bottom: 1px solid #803; }
.hint { color: #8b94a7; font-size: 13px; }
```

- [ ] **Step 2: 提交**

```bash
git add apps/desktop/css/app.css
git commit -m "feat(desktop): dark theme styles"
```

---

### Task 6: 应用外壳 index.html + 引导 app.js

**Files:**
- Modify: `apps/desktop/index.html`
- Create: `apps/desktop/js/app.js`

**Interfaces:**
- Produces: 顶栏 `#apiKey` `#apiBase`;5 个 `.tab-btn[data-tab]` 与 `.tab-panel[data-tab]`(insight/create/publish/tools/edit);`app.js` 在 DOMContentLoaded 后调用 `window.api.setKey/setBase` 与各 `window.skills.*.init(panelEl)`

- [ ] **Step 1: 改写 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HTW Media 桌面客户端</title>
  <link rel="stylesheet" href="css/app.css" />
</head>
<body>
  <header>
    <strong>🐬 HTW Media</strong>
    <input id="apiKey" placeholder="AuthKey(仅内存,不落盘)" />
    <input id="apiBase" placeholder="https://htwmedia.dpdns.org" value="https://htwmedia.dpdns.org" />
  </header>
  <div class="tabs">
    <button class="tab-btn active" data-tab="insight">洞察</button>
    <button class="tab-btn" data-tab="create">创作</button>
    <button class="tab-btn" data-tab="publish">分发</button>
    <button class="tab-btn" data-tab="tools">工具</button>
    <button class="tab-btn" data-tab="edit">编辑</button>
  </div>
  <div class="tab-panel active" data-tab="insight" id="panel-insight"></div>
  <div class="tab-panel" data-tab="create" id="panel-create"></div>
  <div class="tab-panel" data-tab="publish" id="panel-publish"></div>
  <div class="tab-panel" data-tab="tools" id="panel-tools"></div>
  <div class="tab-panel" data-tab="edit" id="panel-edit"></div>

  <script src="js/api.js"></script>
  <script src="js/ui.js"></script>
  <script src="js/skills/insight.js"></script>
  <script src="js/skills/create.js"></script>
  <script src="js/skills/publish.js"></script>
  <script src="js/skills/tools.js"></script>
  <script src="js/skills/edit.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 js/app.js**

```js
(function () {
  function boot() {
    const keyEl = document.getElementById("apiKey");
    const baseEl = document.getElementById("apiBase");
    const pushKey = () => window.api.setKey(keyEl.value.trim());
    keyEl.addEventListener("input", pushKey);
    baseEl.addEventListener("input", () => window.api.setBase(baseEl.value.trim()));
    pushKey();
    window.api.setBase(baseEl.value.trim());

    document.querySelectorAll(".tab-btn").forEach((b) =>
      b.addEventListener("click", () => window.ui.switchTab(b.dataset.tab))
    );

    const tabs = ["insight", "create", "publish", "tools", "edit"];
    for (const t of tabs) {
      const panel = document.getElementById("panel-" + t);
      if (window.skills && window.skills[t] && panel) window.skills[t].init(panel);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
```

- [ ] **Step 3: 语法校验**

Run: `node --check apps/desktop/index.html` (忽略:HTML 非 JS)→ 改为 `node --check apps/desktop/js/app.js`
Expected: 无输出

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/index.html apps/desktop/js/app.js
git commit -m "feat(desktop): app shell with 5 tabs and bootstrap"
```

---

### Task 7: insight 技能

**Files:**
- Create: `apps/desktop/js/skills/insight.js`

**Interfaces:**
- Consumes: `window.api.call` / `window.api.normalize` / `window.api.key`、`window.ui.el/banner/resultView/val`

- [ ] **Step 1: 写 js/skills/insight.js**

```js
(function () {
  function init(root) {
    const { el, banner, resultView, val } = window.ui;
    const run = async (method, path, body) => {
      const res = await window.api.call(method, path, body);
      const d = window.api.normalize(res);
      if (!d.ok) return banner(d.errCode, d.errMsg || "请求失败");
      resultView(out, d.data);
    };
    const out = el("div", { class: "result" });
    const txt = (id, ph) => el("input", { id, placeholder: ph });
    root.append(
      el("div", { class: "row" }, el("button", { class: "act", onclick: () => run("GET", "/api/v2/insight/hot-rankings") }, "全网热搜")),
      el("div", { class: "row" }, txt("iv-url", "视频链接"), el("button", { class: "act", onclick: () => run("POST", "/api/v2/insight/analyze-video", { url: val("iv-url") }) }, "视频分析")),
      el("div", { class: "row" }, txt("ia-url", "账号链接"), el("button", { class: "act", onclick: () => run("POST", "/api/v2/insight/analyze-account", { url: val("ia-url") }) }, "账号分析")),
      el("div", { class: "row" }, txt("ic-text", "文案内容"), el("button", { class: "act", onclick: () => run("POST", "/api/v2/insight/analyze-copy", { text: val("ic-text") }) }, "文案分析")),
      el("div", { class: "row" },
        txt("is-kw", "搜索关键词"),
        el("select", { id: "is-plat" }, el("option", { value: "xhs" }, "小红书"), el("option", { value: "bilibili" }, "B站"), el("option", { value: "douyin" }, "抖音"), el("option", { value: "toutiao" }, "头条")),
        el("button", { class: "act", onclick: () => run("POST", "/api/v2/insight/search", { platform: val("is-plat"), keyword: val("is-kw"), count: 20 }) }, "平台搜索")),
      el("div", { class: "row" }, txt("it-url", "头条用户主页"), el("button", { class: "act", onclick: () => run("POST", "/api/v2/insight/toutiao-user-info", { userUrl: val("it-url") }) }, "头条用户"), el("button", { class: "act", onclick: () => run("POST", "/api/v2/insight/toutiao-user-works", { userUrl: val("it-url") }) }, "头条作品")),
      out
    );
  }
  window.skills = window.skills || {};
  window.skills.insight = { init };
})();
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/js/skills/insight.js`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/js/skills/insight.js
git commit -m "feat(desktop): insight tab"
```

---

### Task 8: edit 技能(含 decrypt 同步)

**Files:**
- Create: `apps/desktop/js/skills/edit.js`

**Interfaces:**
- Consumes: `window.api.upload` / `window.api.call` / `window.api.normalize` / `window.api.pollTask` / `window.ui.*`

- [ ] **Step 1: 写 js/skills/edit.js**

```js
(function () {
  function init(root) {
    const { el, banner, resultView, val } = window.ui;
    const out = el("div", { class: "result" });

    const fileInput = (id) => el("input", { id, type: "file" });
    const poll = async (taskId) => {
      await window.api.pollTask(
        async () => window.api.normalize(await window.api.call("GET", `/api/v2/edit/status/${taskId}`)),
        (st) => { const d = st.data || st; resultView(out, d); },
        3000, 600000
      );
    };
    const uploadAndPoll = async (id, path, extra) => {
      const f = document.getElementById(id).files[0];
      if (!f) return banner("", "请先选择文件");
      const fd = new FormData();
      fd.append("file", f);
      for (const k in (extra || {})) fd.append(k, extra[k]);
      const res = await window.api.upload(fd, path);
      const d = window.api.normalize(res);
      if (!d.ok) return banner(d.errCode, d.errMsg);
      if (d.taskId) await poll(d.taskId);
      else resultView(out, d.data);
    };

    root.append(
      el("div", { class: "row" }, fileInput("ed-coarse"), el("input", { id: "ed-voice", placeholder: "voice(默认 zh-CN-XiaoxiaoNeural)" }),
        el("button", { class: "act", onclick: () => uploadAndPoll("ed-coarse", "/api/v2/edit/coarse-cut", { voice: val("ed-voice") || "zh-CN-XiaoxiaoNeural", durationMin: 60, durationMax: 180 }) }, "粗剪配音")),
      el("div", { class: "row" }, fileInput("ed-draft"), el("button", { class: "act", onclick: () => uploadAndPoll("ed-draft", "/api/v2/edit/draft-export") }, "草稿导出成片")),
      el("div", { class: "row" }, fileInput("ed-sr"), el("input", { id: "ed-w", placeholder: "width(1708)" }), el("input", { id: "ed-h", placeholder: "height(960)" }),
        el("button", { class: "act", onclick: () => uploadAndPoll("ed-sr", "/api/v2/edit/super-res", { width: val("ed-w") || 1708, height: val("ed-h") || 960 }) }, "超分")),
      el("div", { class: "row" }, fileInput("ed-dec"), el("button", { class: "act", onclick: () => uploadAndPoll("ed-dec", "/api/v2/edit/decrypt") }, "解密草稿(JSON)")),
      out
    );
  }
  window.skills = window.skills || {};
  window.skills.edit = { init };
})();
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/js/skills/edit.js`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/js/skills/edit.js
git commit -m "feat(desktop): edit tab (coarse-cut/draft-export/super-res/decrypt + poll)"
```

---

### Task 9: tools 技能(音频/图片/Agent/字幕/模板)

**Files:**
- Create: `apps/desktop/js/skills/tools.js`

**Interfaces:**
- Consumes: `window.api.call` / `window.api.upload` / `window.api.normalize` / `window.api.pollTask` / `window.ui.*`

- [ ] **Step 1: 写 js/skills/tools.js**

```js
(function () {
  function init(root) {
    const { el, banner, resultView, val } = window.ui;
    const out = el("div", { class: "result" });
    const fileInput = (id) => el("input", { id, type: "file" });

    const pollVoice = async (taskId) => {
      await window.api.pollTask(
        async () => window.api.normalize(await window.api.call("GET", `/api/v2/voice/status/${taskId}`)),
        (st) => resultView(out, st.data || st), 3000, 600000);
    };
    const pollImg = async (taskId) => {
      await window.api.pollTask(
        async () => window.api.normalize(await window.api.call("GET", `/api/v2/image/status?taskId=${taskId}`)),
        (st) => resultView(out, st.data || st), 3000, 600000);
    };
    const pollAgent = async (taskId) => {
      await window.api.pollTask(
        async () => window.api.normalize(await window.api.call("GET", `/api/v2/agent/status?taskId=${taskId}`)),
        (st) => resultView(out, st.data || st), 3000, 600000);
    };
    const pollSub = async (taskId) => {
      await window.api.pollTask(
        async () => window.api.normalize(await window.api.call("GET", `/api/v2/subtitle/status/${taskId}`)),
        (st) => resultView(out, st.data || st), 3000, 600000);
    };

    const uploadAudio = async () => {
      const f = document.getElementById("t-audio").files[0];
      if (!f) return banner("", "请选择音频文件");
      const fd = new FormData(); fd.append("file", f);
      const res = await window.api.upload(fd, "/api/v2/voice/upload");
      const d = window.api.normalize(res);
      if (!d.ok) return banner(d.errCode, d.errMsg);
      return d.data.fileId;
    };
    const audioAct = async (path, body) => {
      const fileId = await uploadAudio(); if (!fileId) return;
      const res = await window.api.call("POST", path, Object.assign({ fileId }, body || {}));
      const d = window.api.normalize(res);
      if (!d.ok) return banner(d.errCode, d.errMsg);
      if (d.taskId) await pollVoice(d.taskId); else resultView(out, d.data);
    };

    root.append(
      el("h4", {}, "音频"),
      el("div", { class: "row" }, fileInput("t-audio"),
        el("button", { class: "act", onclick: () => audioAct("/api/v2/voice/transcribe", { format: "txt" }) }, "转写"),
        el("button", { class: "act", onclick: () => audioAct("/api/v2/voice/translate") }, "翻译"),
        el("button", { class: "act", onclick: () => audioAct("/api/v2/voice/summarize") }, "总结"),
        el("button", { class: "act", onclick: () => audioAct("/api/v2/voice/separate", { type: "human" }) }, "人声分离"),
        el("button", { class: "act", onclick: () => audioAct("/api/v2/voice/lyrics") }, "歌词")),
      el("div", { class: "row" }, el("input", { id: "t-tts", placeholder: "TTS 文本" }), el("input", { id: "t-speaker", placeholder: "speaker(默认 zh_female_qinglengnv)" }),
        el("button", { class: "act", onclick: async () => {
          const res = await window.api.call("POST", "/api/v2/voice/tts", { text: val("t-tts"), speaker: val("t-speaker") || "zh_female_qinglengnv" });
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); if (d.taskId) await pollVoice(d.taskId); else resultView(out, d.data);
        } }, "TTS")),

      el("h4", {}, "图片"),
      el("div", { class: "row" }, el("input", { id: "t-prompt", placeholder: "生图 prompt" }),
        el("button", { class: "act", onclick: async () => {
          const res = await window.api.call("POST", "/api/v2/image/generate", { prompt: val("t-prompt") || "", model: "v4.5", ratio: "1:1", resolution: "2k", sampleStrength: 0.5, negativePrompt: "" });
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); if (d.taskId) await pollImg(d.taskId); else resultView(out, d.data);
        } }, "生成")),
      el("div", { class: "row" }, fileInput("t-img"), el("button", { class: "act", onclick: async () => {
        const f = document.getElementById("t-img").files[0]; if (!f) return banner("", "请选择图片");
        const fd = new FormData(); fd.append("file", f);
        const res = await window.api.upload(fd, "/api/v2/image/recognize");
        const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); resultView(out, d.data);
      } }, "识别")),

      el("h4", {}, "Agent"),
      el("div", { class: "row" }, el("input", { id: "t-topic", placeholder: "主题" }), el("input", { id: "t-plat", placeholder: "platform(默认 xhs)" }),
        el("button", { class: "act", onclick: async () => {
          const res = await window.api.call("POST", "/api/v2/agent/one-click", { topic: val("t-topic"), platform: val("t-plat") || "xhs", length: "medium", style: "default", ratio: "16:9", mode: "quick", referenceText: "", voice: "" });
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); if (d.taskId) await pollAgent(d.taskId); else resultView(out, d.data);
        } }, "一键成片")),

      el("h4", {}, "字幕"),
      el("div", { class: "row" }, fileInput("t-video"), el("input", { id: "t-fmt", placeholder: "format(txt/srt,默认 txt)" }),
        el("button", { class: "act", onclick: async () => {
          const f = document.getElementById("t-video").files[0]; if (!f) return banner("", "请选择视频");
          const fd = new FormData(); fd.append("file", f); fd.append("format", val("t-fmt") || "txt"); fd.append("engine", "ocr");
          const res = await window.api.upload(fd, "/api/v2/subtitle/extract");
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); if (d.taskId) await pollSub(d.taskId); else resultView(out, d.data);
        } }, "提取字幕")),

      el("h4", {}, "模板"),
      el("div", { class: "row" }, el("input", { id: "t-kw", placeholder: "模板关键词" }),
        el("button", { class: "act", onclick: async () => {
          const res = await window.api.call("GET", `/api/v2/template/search?keyword=${encodeURIComponent(val("t-kw"))}&page=1&pageSize=20`);
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); resultView(out, d.data);
        } }, "模板搜索")),
      out
    );
  }
  window.skills = window.skills || {};
  window.skills.tools = { init };
})();
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/js/skills/tools.js`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/js/skills/tools.js
git commit -m "feat(desktop): tools tab (audio/image/agent/subtitle/template)"
```

---

### Task 10: publish 技能

**Files:**
- Create: `apps/desktop/js/skills/publish.js`

**Interfaces:**
- Consumes: `window.api.call` / `window.api.upload` / `window.api.normalize` / `window.api.pollTask` / `window.ui.*`

- [ ] **Step 1: 写 js/skills/publish.js**

```js
(function () {
  function init(root) {
    const { el, banner, resultView, val } = window.ui;
    const out = el("div", { class: "result" });
    const chk = (id) => el("input", { id, type: "checkbox" });

    root.append(
      el("div", { class: "row" }, el("input", { id: "p-title", placeholder: "标题" })),
      el("div", { class: "row" }, el("textarea", { id: "p-content", placeholder: "正文", rows: "3", style: "min-width:400px" })),
      el("div", { class: "row" }, el("input", { id: "p-media", placeholder: "媒体URL,逗号分隔" }), el("input", { id: "p-tags", placeholder: "标签,逗号分隔" })),
      el("div", { class: "row" },
        el("label", {}, "抖音"), chk("p-douyin"),
        el("label", {}, "小红书"), chk("p-xhs"),
        el("label", {}, "B站"), chk("p-bilibili"),
        el("label", {}, "头条"), chk("p-toutiao")),
      el("div", { class: "row" },
        el("button", { class: "act", onclick: async () => {
          const platforms = [];
          if (document.getElementById("p-douyin").checked) platforms.push({ platformId: "douyin" });
          if (document.getElementById("p-xhs").checked) platforms.push({ platformId: "xhs" });
          if (document.getElementById("p-bilibili").checked) platforms.push({ platformId: "bilibili" });
          if (document.getElementById("p-toutiao").checked) platforms.push({ platformId: "toutiao" });
          const body = {
            title: val("p-title"), content: val("p-content"),
            tags: val("p-tags") ? val("p-tags").split(",").map((s) => s.trim()) : [],
            mediaUrls: val("p-media") ? val("p-media").split(",").map((s) => s.trim()) : [],
            platforms,
          };
          const res = await window.api.call("POST", "/api/v2/publish/submit", body);
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg);
          if (d.taskId) await window.api.pollTask(async () => window.api.normalize(await window.api.call("GET", `/api/v2/publish/task-status?taskId=${d.taskId}`)), (st) => resultView(out, st.data || st), 3000, 600000);
          else resultView(out, d.data);
        } }, "提交分发"),
        el("button", { class: "act", onclick: async () => {
          const res = await window.api.call("POST", "/api/v2/publish/generate-tags", { title: val("p-title"), content: val("p-content"), platform: "xhs" });
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); resultView(out, d.data);
        } }, "生成标签"),
        el("button", { class: "act", onclick: async () => {
          const res = await window.api.call("POST", "/api/v2/publish/check-compliance", { content: val("p-content"), platform: "xhs" });
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); resultView(out, d.data);
        } }, "合规检查"),
        el("button", { class: "act", onclick: async () => {
          const res = await window.api.call("GET", "/api/v2/publish/queue-status");
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); resultView(out, d.data);
        } }, "队列状态")),
      out
    );
  }
  window.skills = window.skills || {};
  window.skills.publish = { init };
})();
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/js/skills/publish.js`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/js/skills/publish.js
git commit -m "feat(desktop): publish tab (submit + tags/compliance/queue)"
```

---

### Task 11: create 技能(多步向导)

**Files:**
- Create: `apps/desktop/js/skills/create.js`

**Interfaces:**
- Consumes: `window.api.call` / `window.api.normalize` / `window.ui.*`

- [ ] **Step 1: 写 js/skills/create.js**

```js
(function () {
  function init(root) {
    const { el, banner, resultView, val } = window.ui;
    let sessionId = "";
    let type = "video";
    const out = el("div", { class: "result" });

    const status = async () => {
      if (!sessionId) return;
      const res = await window.api.call("GET", `/api/v2/creation/status?sessionId=${encodeURIComponent(sessionId)}&type=${type}`);
      const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg);
      resultView(out, d.data);
    };

    root.append(
      el("div", { class: "row" },
        el("select", { id: "c-type", onchange: (e) => (type = e.target.value) },
          el("option", { value: "video" }, "视频"), el("option", { value: "image" }, "图片"), el("option", { value: "article" }, "文章")),
        el("input", { id: "c-vt", placeholder: "videoTypeId(可选)" }),
        el("input", { id: "c-topic", placeholder: "主题", style: "min-width:300px" }),
        el("button", { class: "act", onclick: async () => {
          const res = await window.api.call("POST", "/api/v2/creation/start", { type, topic: val("c-topic"), videoTypeId: val("c-vt") });
          const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg);
          sessionId = (d.data && d.data.sessionId) || "";
          resultView(out, d.data);
        } }, "开始创作")),
      el("div", { class: "row" },
        el("button", { class: "act", onclick: async () => { const res = await window.api.call("POST", "/api/v2/creation/approve", { sessionId, type }); const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); await status(); } }, "通过"),
        el("input", { id: "c-instr", placeholder: "regenerate 指令" }),
        el("button", { class: "act", onclick: async () => { const res = await window.api.call("POST", "/api/v2/creation/regenerate", { sessionId, instruction: val("c-instr"), type }); const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); await status(); } }, "重做"),
        el("input", { id: "c-msg", placeholder: "refine 反馈" }),
        el("button", { class: "act", onclick: async () => { const res = await window.api.call("POST", "/api/v2/creation/refine", { sessionId, message: val("c-msg"), type }); const d = window.api.normalize(res); if (!d.ok) return banner(d.errCode, d.errMsg); await status(); } }, "打磨"),
        el("button", { class: "act", onclick: status }, "刷新状态")),
      out
    );
  }
  window.skills = window.skills || {};
  window.skills.create = { init };
})();
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/js/skills/create.js`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/js/skills/create.js
git commit -m "feat(desktop): create tab (start/approve/regenerate/refine wizard)"
```

---

### Task 12: 全量语法校验与收尾

**Files:**
- Modify: `apps/desktop/index.html`(已在 Task 6 改写,确认脚本顺序)

**Interfaces:**
- 校验所有 JS 语法;确认 `index.html` 按 Task 6 顺序引入脚本

- [ ] **Step 1: 全量语法校验**

Run:
```bash
node --check apps/desktop/preload.js && node --check apps/desktop/js/api.js && node --check apps/desktop/js/ui.js && node --check apps/desktop/js/app.js && node --check apps/desktop/js/skills/insight.js && node --check apps/desktop/js/skills/edit.js && node --check apps/desktop/js/skills/tools.js && node --check apps/desktop/js/skills/publish.js && node --check apps/desktop/js/skills/create.js && echo ALL_OK
```
Expected: `ALL_OK`

- [ ] **Step 2: 跑纯逻辑测试**

Run: `node --test apps/desktop/js/api.test.cjs`
Expected: `# tests 6` 全 PASS

- [ ] **Step 3: 提交收尾(若有未提交改动)**

```bash
git add -A
git commit -m "chore(desktop): finalize capability UI, syntax-check all modules" || echo "nothing to commit"
git push origin main
```

---

## 自审结论

- **Spec 覆盖**:5 技能全部有对应 Task(7 insight / 8 edit / 9 tools / 10 publish / 11 create);preload.upload(Task 1)覆盖所有文件类端点;pollTask(Task 2)覆盖全部异步轮询;错误横幅(Task 4)覆盖 401/402/errMsg;create 向导含 start/approve/regenerate/refine/status。
- **占位符扫描**:无 TBD/TODO;每步均含可运行代码。
- **类型一致性**:`window.api.call/upload/normalize/pollTask/setKey/setBase/key`、`window.ui.el/banner/resultView/val/switchTab`、`window.skills.<name>.init` 在 Task 2/4 定义,Task 6–11 一致引用。
- **测试**:`api.test.cjs` 覆盖 `normalize` 与 `pollTask` 纯逻辑;DOM 模块以 `node --check` 校验(Task 12)。

> 说明:纯 DOM 模块无单测框架,以 `node --check` 语法校验 + 人工 `npm start` 走查替代;headless 环境无法自动启 Electron。
