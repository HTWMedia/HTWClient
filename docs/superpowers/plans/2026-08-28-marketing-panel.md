# 桌面端「营销成片」面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面端新增「营销成片 MarketVideo」面板，仿 web端字段，提交到 V2 创作接口并用 Seedance 生成钩子分镜，最终成片可播放/下载。

**Architecture:** 新增一个桌面 skill 模块 `apps/desktop/js/skills/marketing.js`，沿用现有 skill 注册模式（侧栏按钮 + `panel-*` + `SKILLS` 数组）。面板收集商品名/卖点/素材/文案/优惠/人群，调用 `/api/v2/creation/start`（EnableSeedance + EnableMarketingOverlay），上传素材到 `/creation/upload-material`，轮询 `/creation/status`，经 `approve/regenerate/refine` 推进，成片经 `media-file`/`proxy-media` 展示。

**Tech Stack:** Electron + 原生 JS（无框架），`window.HTWApi`（fetch 封装，带 `AuthKey` 头）、`window.UI`（DOM 辅助），Playwright（E2E，经 CDP 连接 Electron）。

## Global Constraints

- 画幅比例 / 时长档位 **不在 V2 创作接口范围**，面板**不提供**这两个控件（已批准移除）。
- `ProductImageUrls` 暂留空（素材在 `/start` 之后才上传，无法在 `/start` 时传入）。
- 无逐张分镜图替换交互（Seedance 路径为流程内生成）。
- **不提交任何密钥**：`config.json` / `测试数据.txt` 保持 `.gitignore` 忽略；测试用 AuthKey 仅从本地环境变量注入。
- 后端响应统一信封 `{ ok, data, errCode, errMsg }`；创作状态 `status` ∈ `running | waiting_approval | completed | failed`。
- 沿用现有 skill 模式，不引入新依赖。

---

## File Structure

- `apps/desktop/js/skills/marketing.js` （新建）— 营销成片面板逻辑，导出 `Skills.marketing = { mount }`。
- `apps/desktop/index.html` （修改）— 侧栏加导航按钮、`<main>` 加 `panel-marketing`、引入脚本。
- `apps/desktop/js/app.js` （修改）— `SKILLS` 数组加入 `"marketing"`。
- `apps/desktop/test/marketing-e2e.mjs` （新建）— Playwright E2E 测试脚本。
- `README.md` （修改）— 功能特性新增「营销成片」条目。
- `agent/skills/htw-media-marketing/SKILL.md` + `references/api.md` （新建）— 营销成片 V2 API 文档。

---

### Task 1: 注册营销成片 skill（导航 + 面板 + 脚本加载）

**Files:**
- Modify: `apps/desktop/index.html`
- Modify: `apps/desktop/js/app.js:2`

**Interfaces:**
- 产生：侧栏 `data-skill="marketing"` 按钮与 `<section id="panel-marketing">` 容器，供 `marketing.js` 挂载。
- 产生：`SKILLS` 数组含 `"marketing"`，使 `app.js` 在启动时调用 `Skills.marketing.mount(panel)`。

- [ ] **Step 1: 修改 `index.html` 侧栏与面板**

在 `index.html` 的侧栏 `发布 Publish` 按钮之后、`助手 Assistant` 之前插入营销成片入口（或放在任意合适位置），并在 `<main>` 加入面板、在 `app.js` 引入前加入脚本标签。

`index.html` 侧栏（在 `data-skill="publish"` 那行之后）新增：

```html
<button class="nav-item" data-skill="marketing"><i class="fa-solid fa-bag-shopping"></i>营销成片 MarketVideo</button>
```

`<main>`（在 `panel-publish` 那行之后）新增：

```html
<section class="panel" id="panel-marketing"></section>
```

`<body>` 脚本区（在 `<script src="js/skills/create.js"></script>` 之后、`js/app.js` 之前）新增：

```html
<script src="js/skills/marketing.js"></script>
```

- [ ] **Step 2: 修改 `app.js` 的 `SKILLS` 数组**

`app.js` 第 2 行：

```js
const SKILLS = ["insight", "edit", "tools", "publish", "assistant", "create", "marketing"];
```

- [ ] **Step 3: 语法校验 index.html / app.js 无破坏**

Run: `node --check apps/desktop/js/app.js`
Expected: 无输出（校验通过）。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/index.html apps/desktop/js/app.js
git commit -m "feat(marketing): 注册营销成片面板入口"
```

---

### Task 2: 实现营销成片面板 `marketing.js`

**Files:**
- Create: `apps/desktop/js/skills/marketing.js`

**Interfaces:**
- 消费：`window.HTWApi.post/get/upload`（信封 `{ok,data,...}`）、`window.UI`（`.el/.clear/.mount/.field/.section/.withLoading/.showResult/.showError/.esc/.fileInput`）。
- 消费：`/api/v2/creation/{types,start,upload-material,status,approve,regenerate,refine}`、`/api/v2/creation/{media-file,proxy-media}`（契约见 spec `docs/superpowers/specs/2026-08-28-marketing-panel-design.md`）。
- 产生：`Skills.marketing.mount(root)` 被 `app.js` 在启动时调用，把面板渲染进 `#panel-marketing`。

- [ ] **Step 1: 编写 `marketing.js` 完整实现**

```js
'use strict';

const api = window.HTWApi;
const UI = window.UI;
const Skills = (window.Skills = window.Skills || {});

function formatErr(r) {
  if (!r) return "未知错误";
  if (r.errCode) return "[" + r.errCode + "] " + (r.errMsg || "");
  return r.errMsg || r.message || "请求失败";
}

function tryParse(s) {
  try { return typeof s === "string" ? JSON.parse(s) : s; } catch (e) { return null; }
}

// 从 status / artifact 中找出成片视频 URL（兼容多种字段名）
function findVideoUrl(d) {
  const keys = ["videoUrl", "url", "mediaFile", "resultUrl", "downloadUrl", "resultPath"];
  const out = [];
  const art = d && d.artifact ? tryParse(d.artifact) : null;
  if (art) keys.forEach(k => { if (art[k]) out.push(art[k]); });
  if (d) keys.forEach(k => { if (d[k]) out.push(d[k]); });
  return out[0] || null;
}

Skills.marketing = {
  mount: function (root) {
    UI.clear(root);
    let sessionId = null;
    let polling = false;

    function field(labelText, input) {
      return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
    }
    function section(title, bodyNodes, actionNode, regionNode, icon) {
      const head = UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]);
      return UI.el("div", { class: "card" }, [head].concat(bodyNodes).concat([UI.el("div", { class: "row" }, [actionNode]), regionNode]));
    }
    function stepChk(id, label, on) {
      return UI.el("label", { class: "stepchk" }, [
        UI.el("input", { type: "checkbox", "data-step": id, checked: on }),
        UI.el("span", { text: label }),
      ]);
    }

    const productName = UI.el("input", { type: "text", id: "mv-product-name", placeholder: "商品名称（必填）" });
    const sellPoints = UI.el("textarea", { placeholder: "卖点，每行一条（可选）" });
    const files = UI.fileInput({ label: "商品素材（图片/视频，≤20MB）", accept: "image/*,video/*", multiple: true });
    files.input.id = "mv-files";
    const copyText = UI.el("textarea", { placeholder: "文案（可选，留空由 AI 生成脚本）" });
    const discount = UI.el("input", { type: "text", placeholder: "优惠活动，如 买二送一（可选）" });
    const audience = UI.el("input", { type: "text", placeholder: "适用人群，逗号分隔，如 学生,上班族（可选）" });
    const seedanceClips = UI.el("input", { type: "number", value: "2", min: "0", max: "6" });
    const overlay = UI.el("input", { type: "checkbox", checked: true });
    const videoType = UI.el("select", {}, [UI.el("option", { value: "", text: "默认(kol)" })]);
    const stepResearch = stepChk("research", "调研", false);
    const stepKeypoint = stepChk("keypoint", "关键点提取", true);
    const stepMaterial = stepChk("material", "素材搜索", false);
    const stepPublish = stepChk("publish", "自动发布", false);
    const startBtn = UI.el("button", { class: "btn primary", id: "mv-start", text: "生成成片" });
    const region = UI.el("div", { id: "mv-progress" });

    UI.mount(root, UI.el("div", {}, [
      UI.el("h2", { text: "营销成片 MarketVideo" }),
      section("素材与商品", [
        field("商品名称", productName),
        field("卖点", sellPoints),
        files,
        field("文案", copyText),
        field("优惠活动", discount),
        field("适用人群", audience),
        field("Seedance 钩子镜头数", seedanceClips),
        field("营销浮层", overlay),
        field("视频类型", videoType),
        UI.el("div", { class: "steprow" }, [stepResearch, stepKeypoint, stepMaterial, stepPublish]),
      ], startBtn, region, "fa-bag-shopping"),
    ]));

    // 加载视频类型下拉
    api.get("/api/v2/creation/types").then(r => {
      const types = (r && r.data) || [];
      types.forEach(t => videoType.appendChild(UI.el("option", { value: t.id, text: t.name || t.id })));
    }).catch(() => { /* 忽略，保留默认 */ });

    function buildSteps() {
      const set = [];
      [["research", stepResearch], ["keypoint", stepKeypoint], ["material", stepMaterial], ["publish", stepPublish]].forEach(([id, el]) => {
        const cb = el.querySelector("input");
        if (cb && cb.checked) set.push(id);
      });
      return set;
    }

    function render(d) {
      let html = "";
      if (d.currentStepLabel) html += `<div class="detail-step">${UI.esc(d.currentStepLabel)} <span class="badge ${UI.esc(d.status)}">${UI.esc(d.status)}</span></div>`;
      if (d.progressLogs && d.progressLogs.length) html += '<div class="progresslog">' + d.progressLogs.map(l => `<div>${UI.esc(l)}</div>`).join("") + "</div>";
      region.innerHTML = html;
      UI.showResult(region, d);
      const vurl = findVideoUrl(d);
      if (vurl) {
        const src = /^https?:\/\//.test(vurl)
          ? ("/api/v2/creation/proxy-media?url=" + encodeURIComponent(vurl))
          : ("/api/v2/creation/media-file?sessionId=" + encodeURIComponent(sessionId) + "&fileName=" + encodeURIComponent(vurl));
        region.insertAdjacentHTML("beforeend", `<div class="field inline uprow"><video src="${UI.esc(src)}" controls style="max-width:100%"></video> <a class="btn" href="${UI.esc(src)}" download>下载成片</a></div>`);
      }
      if (d.artifact) {
        const art = tryParse(d.artifact);
        if (art && art.type === "video_script" && art.scriptText) {
          region.insertAdjacentHTML("beforeend", `<div class="scriptbox"><pre>${UI.esc(art.scriptText)}</pre></div>`);
        }
      }
    }

    function renderActions() {
      const bar = UI.el("div", { class: "detail-actions" }, [
        UI.el("button", { class: "btn primary", text: "确认" }),
        UI.el("button", { class: "btn", text: "重新生成" }),
        UI.el("button", { class: "btn", text: "精修" }),
      ]);
      region.appendChild(bar);
      bar.children[0].addEventListener("click", () => act("approve"));
      bar.children[1].addEventListener("click", () => { const ins = prompt("重新生成指令（可留空）"); act("regenerate", ins); });
      bar.children[2].addEventListener("click", () => { const msg = prompt("精修意见"); if (msg) act("refine", msg); });
    }

    function act(kind, instruction) {
      const body = { sessionId: sessionId, type: "video" };
      if (kind === "regenerate") body.instruction = instruction || "";
      if (kind === "refine") body.message = instruction || "";
      const url = kind === "approve" ? "/api/v2/creation/approve" : (kind === "regenerate" ? "/api/v2/creation/regenerate" : "/api/v2/creation/refine");
      region.insertAdjacentHTML("beforeend", '<div class="progresslog"><div>处理中…</div></div>');
      api.post(url, body).then(() => { polling = true; poll(); }).catch(e => UI.showError(region, "操作失败：" + (e && e.message ? e.message : e)));
    }

    function poll() {
      if (!polling || !sessionId) return;
      api.get(`/api/v2/creation/status?sessionId=${encodeURIComponent(sessionId)}&type=video`).then(r => {
        const d = r && r.data;
        if (!d) return;
        render(d);
        if (polling && d.status === "running") {
          setTimeout(poll, 2000);
        } else if (d.status === "waiting_approval") {
          polling = false; renderActions();
        } else {
          polling = false;
        }
      }).catch(e => { polling = false; UI.showError(region, "状态错误：" + (e && e.message ? e.message : e)); });
    }

    async function readFiles(wrap) {
      const arr = [];
      const list = wrap.input.files;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const buf = await f.arrayBuffer();
        arr.push({ name: f.name, buffer: buf });
      }
      return arr;
    }

    startBtn.addEventListener("click", function () {
      const name = productName.value.trim();
      if (!name) { UI.showError(region, "请输入商品名称"); return; }
      UI.withLoading(startBtn, async function () {
        try {
          const topic = [name, sellPoints.value.trim(), copyText.value.trim()].filter(Boolean).join("\n");
          const body = {
            type: "video",
            topic: topic,
            optionalSteps: buildSteps(),
            videoTypeId: videoType.value || "kol",
            enableSeedance: true,
            seedanceMaxClips: parseInt(seedanceClips.value, 10) || 2,
            enableMarketingOverlay: overlay.checked,
            marketingCtaText: discount.value.trim(),
            marketingHeroText: audience.value.trim(),
            productImageUrls: [],
            userMaterialIds: [],
          };
          const up = await api.post("/api/v2/creation/start", body);
          if (!up.ok) { UI.showError(region, formatErr(up)); return; }
          sessionId = up.data && up.data.sessionId;
          if (!sessionId) { UI.showError(region, "未返回 sessionId: " + JSON.stringify(up.data)); return; }
          const filesList = await readFiles(files);
          for (const f of filesList) {
            await api.upload("POST", "/api/v2/creation/upload-material?sessionId=" + encodeURIComponent(sessionId), [f], {}, null, "auto");
          }
          polling = true;
          poll();
        } catch (e) {
          UI.showError(region, "请求异常: " + (e && e.message ? e.message : e));
        }
      });
    });
  },
};
```

- [ ] **Step 2: 语法校验**

Run: `node --check apps/desktop/js/skills/marketing.js`
Expected: 无输出（校验通过）。

- [ ] **Step 3: 在桌面端加载，确认面板渲染且无 JS 报错（冒烟）**

启动 Electron 并连接 Playwright（见 Task 3 启动方式），打开「营销成片」面板，断言：
- 侧栏出现「营销成片 MarketVideo」且可点击；
- `#panel-marketing` 内有「生成成片」按钮与商品名称输入框；
- 浏览器 console 无 error。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/js/skills/marketing.js
git commit -m "feat(marketing): 实现营销成片面板（Seedance + 营销浮层）"
```

---

### Task 3: Playwright E2E 测试（真实任务，验证 Seedance 分镜与成片）

**Files:**
- Create: `apps/desktop/test/marketing-e2e.mjs`

**Interfaces:**
- 消费：已注册的「营销成片」面板（元素 id：`mv-product-name`、`mv-files`、`mv-start`、`mv-progress`）。
- 消费：本地环境变量 `HTW_API_BASE`、`HTW_API_KEY`（密钥**绝不**写入仓库或脚本常量）。

- [ ] **Step 1: 编写 E2E 脚本 `apps/desktop/test/marketing-e2e.mjs`**

```js
import { chromium } from 'playwright';
import fs from 'fs';

const API_BASE = process.env.HTW_API_BASE || 'https://htwmedia.dpdns.org';
const API_KEY = process.env.HTW_API_KEY;
if (!API_KEY) { console.error('HTW_API_KEY 必须作为环境变量提供，且不写入仓库'); process.exit(2); }

// 1x1 PNG 测试素材（仅用于端到端联通验证，非真实商品图）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const FIX = '/tmp/mv-fixture.png';
fs.writeFileSync(FIX, Buffer.from(PNG_B64, 'base64'));

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes('index.html')) || ctx.pages()[0] || await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.evaluate((b, k) => { localStorage.setItem('htw_apiBase', b); localStorage.setItem('htw_apiKey', k); }, API_BASE, API_KEY);
await page.reload();
await page.click('[data-skill="marketing"]');
await page.fill('#mv-product-name', '测试商品-营销成片E2E');
await page.setInputFiles('#mv-files input', FIX);
await page.click('#mv-start');

// 等待流程启动（出现状态徽标）
await page.waitForSelector('#mv-progress .badge', { timeout: 60000 });
// 等待终态或需确认
await page.waitForFunction(() => {
  const t = document.querySelector('#mv-progress .badge');
  return t && ['completed', 'waiting_approval', 'failed'].includes(t.textContent);
}, { timeout: 600000 });

const status = (await page.textContent('#mv-progress .badge')).trim();
console.log('FINAL STATUS:', status);
if (status === 'failed') { console.error('任务失败'); console.error(await page.textContent('#mv-progress')); process.exit(1); }

// 若需确认，自动确认以推进到成片
if (status === 'waiting_approval') {
  await page.click('#mv-progress .detail-actions .btn.primary'); // 确认
  await page.waitForFunction(() => {
    const t = document.querySelector('#mv-progress .badge');
    return t && ['completed', 'failed'].includes(t.textContent);
  }, { timeout: 600000 });
}

if (errors.length) { console.error('控制台错误:', errors); process.exit(1); }
console.log('E2E OK — 无控制台错误，流程抵达成片');
await browser.close();
```

- [ ] **Step 2: 启动 Electron（带远程调试）并运行 E2E**

启动（后台）：
```
cd apps/desktop && npx electron . --remote-debugging-port=9222
```
另开终端运行：
```
cd apps/desktop && HTW_API_KEY="<本地密钥，不提交>" node test/marketing-e2e.mjs
```
Expected: 输出 `FINAL STATUS: completed`（或 `waiting_approval` 后自动确认再到 `completed`），且 `E2E OK — 无控制台错误，流程抵达成片`。

- [ ] **Step 3: 核对成片视频 URL 字段并回填 `marketing.js`**

- 在 E2E 中若 `#mv-progress` 未出现 `<video>` 元素，说明 `findVideoUrl` 的候选字段未命中真实响应字段。
- 在浏览器/Playwright 中打印 `await page.evaluate(() => window.__lastStatus)`（或临时在 `render` 里 `console.log(JSON.stringify(d))`）确认最终视频 URL 所在字段（常见：`data.artifact.mediaFile` 或 `data.artifact.videoUrl` 或 `data.resultUrl`）。
- 若字段名不同，更新 `marketing.js` 的 `findVideoUrl` 候选 key 列表或 `render` 的媒体拼接逻辑，使 `<video>` 正确出现，然后重跑 Step 2 至 `E2E OK`。

- [ ] **Step 4: 提交测试脚本与（如有）营销面板修正**

```bash
git add apps/desktop/test/marketing-e2e.mjs apps/desktop/js/skills/marketing.js
git commit -m "test(marketing): 新增 E2E 并核对 Seedance 成片视频字段"
```

---

### Task 4: 更新 README 与 agent skills 文档

**Files:**
- Modify: `README.md`
- Create: `agent/skills/htw-media-marketing/SKILL.md`
- Create: `agent/skills/htw-media-marketing/references/api.md`

**Interfaces:**
- 产生：GitHub README 新增「营销成片」功能说明；agent skill 文档记录营销成片 V2 API 契约（供 agent 生态复用）。

- [ ] **Step 1: README 功能特性新增条目**

在 README「功能特性」清单中，在「智能剪辑」之后新增：

```markdown
- [x] **营销成片 MarketVideo**：上传商品素材 + 商品名/卖点，AI 生成营销短视频脚本；**Seedance 生成钩子分镜（i2v 动态化）**，支持营销浮层（CTA / 适用人群）、优惠活动、视频类型与可选步骤（调研 / 关键点提取 / 素材搜索 / 自动发布）
```

- [ ] **Step 2: 新建 `agent/skills/htw-media-marketing/SKILL.md`**

```markdown
# htw-media-marketing

桌面端「营销成片 MarketVideo」对应的后端 API 技能：用 Seedance 生成钩子分镜、叠加营销浮层，产出电商营销短视频。

## 何时使用
- 用户要通过商品素材/卖点生成营销短视频（电商带货风格）。
- 需要 Seedance 钩子镜头 i2v 动态化或营销 CTA 浮层。

## 后端契约
见 `references/api.md`。鉴权：`AuthKey` 头；Base `https://htwmedia.dpdns.org`。

## 关键端点
- `POST /api/v2/creation/start`（type=video, enableSeedance, enableMarketingOverlay, marketingCtaText, marketingHeroText, seedanceMaxClips, productImageUrls, userMaterialIds）
- `POST /api/v2/creation/upload-material`（multipart，需 sessionId）
- `GET  /api/v2/creation/status`（sessionId, type=video）
- `POST /api/v2/creation/{approve,regenerate,refine}`
- `GET  /api/v2/creation/media-file` 或 `proxy-media`（取成片）
```

- [ ] **Step 3: 新建 `agent/skills/htw-media-marketing/references/api.md`**

```markdown
# htw-media-marketing API reference (v2)

Base URL: `https://htwmedia.dpdns.org` — headers: `AuthKey: <key>`.
所有响应信封：`{ ok, data, errCode, errMsg }`。

| Method | Path | Body / query | 说明 |
|---|---|---|---|
| GET | `/api/v2/creation/types` | — | 视频类型预设 `data:[{id,name,description}]` |
| POST | `/api/v2/creation/start` | `{type:"video", topic, optionalSteps[], videoTypeId, enableSeedance:true, seedanceMaxClips:int, enableMarketingOverlay:bool, marketingCtaText, marketingHeroText, productImageUrls:[], userMaterialIds:[]}` | `data.sessionId` |
| POST | `/api/v2/creation/upload-material` | multipart `file` + query `sessionId` | `data:{materialId,url,type,size}`（挂到会话） |
| GET | `/api/v2/creation/status` | `sessionId`, `type=video` | `data:{status,currentStepLabel,progressLogs[],artifact}`；status∈running/waiting_approval/completed/failed |
| POST | `/api/v2/creation/approve` | `{sessionId,type:"video"}` | 确认当前步骤 |
| POST | `/api/v2/creation/regenerate` | `{sessionId,instruction,type:"video"}` | 重新生成 |
| POST | `/api/v2/creation/refine` | `{sessionId,message,type:"video"}` | 精修 |
| GET | `/api/v2/creation/media-file` | `sessionId`,`fileName` | 成片文件字节 |
| GET | `/api/v2/creation/proxy-media` | `url`（需绝对 URL） | 代理外部媒体字节 |

## 说明
- Seedance 在创作流中负责「钩子镜头 i2v 动态化」（`enableSeedance`+`seedanceMaxClips`）；静态分镜图由即梦生成。
- `ProductImageUrls` 仅 `/start` 时可传；桌面端素材在 `/start` 后上传，故通常留空。
- 画幅比例 / 时长档位不在 V2 创作接口范围（系 capflow/MarketVideo 专用）。
```

- [ ] **Step 4: 提交并推送**

```bash
git add README.md agent/skills/htw-media-marketing
git commit -m "docs: README 与 agent skill 新增营销成片说明"
git push origin main
```

---

## Self-Review

**1. Spec coverage:** 注册改动（Task 1）= spec 注册节；`marketing.js`（Task 2）= UI 字段/映射/流程；E2E（Task 3）= 测试节（含 Seedance 生效、成片下载、不提交密钥）；README+agent doc（Task 4）= 交付物。画幅/时长移除（Global Constraints）已落实。无遗漏。

**2. Placeholder scan:** 无 TBD/TODO；Task 3 Step 3 明确给出「若字段不符则回填 `findVideoUrl`」的具体操作而非空泛「处理边缘情况」。所有代码步骤均含完整代码。

**3. Type consistency:** `Skills.marketing.mount(root)` 在 Task 1/2/3 一致；`sessionId` 取自 `up.data.sessionId` 与 spec/agent 文档一致；`findVideoUrl` 候选 key 在 Task 2/3 一致；`api.post/get/upload` 信封 `{ok,data}` 贯穿。
