const test = require("node:test");
const assert = require("node:assert");

/*
 * 批量面板挂载冒烟测试：与 workflow.mount.test.cjs 同一套极小 DOM 替身，
 * 挡住"面板一挂载就抛异常、整个 app 白屏"这类最贵的错误。
 * 后半部分是交互测试：用同一套替身驱动「提交批次」的四条结果路径
 * （失败 / 全拒 / 成功切页 / 响应异常），锁死"按钮消失、没有进度"这类回归。
 * flush/settle 与 mock.timers 的口径：settle 只用 setImmediate + 微任务，
 * 绝不依赖 setTimeout —— mock.timers 接管计时器后测试节奏不受干扰。
 */

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    _attrs: {},
    _handlers: {},
    children: [],
    parentNode: null,
    isConnected: true,
    style: {},
    disabled: undefined,
    set textContent(v) { this._text = String(v == null ? "" : v); this.children = []; },
    get textContent() {
      if (this._text != null && !this.children.length) return this._text;
      return this.children.map((c) => c.textContent || "").join("");
    },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ""; },
    get childNodes() { return this.children; },
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
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    dispatch(type) {
      (this._handlers[type] || []).forEach((fn) => fn({}));
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    closest() { return null; },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, "");
      const out = [];
      (function walk(n) {
        (n.children || []).forEach((c) => {
          if (c.className && String(c.className).split(/\s+/).indexOf(cls) >= 0) out.push(c);
          if (c.querySelectorAll) walk(c);
        });
      })(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  node.classList = {
    add(c) { const s = new Set(String(node.className || "").split(/\s+/).filter(Boolean)); s.add(c); node.className = [...s].join(" "); },
    remove(c) { const s = new Set(String(node.className || "").split(/\s+/).filter(Boolean)); s.delete(c); node.className = [...s].join(" "); },
    contains(c) { return String(node.className || "").split(/\s+/).indexOf(c) >= 0; },
  };
  return node;
}

function withDom(fn) {
  const doc = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const prevDoc = global.document;
  const prevWin = global.window;
  const prevUI = global.UI;
  global.document = doc;
  global.window = { HTWApi: { call: () => Promise.resolve({ ok: true, data: {} }) } };
  // 交互测试是异步的：必须等 fn 跑完再还原全局，否则异步段里 window/document 已被拆掉
  return Promise.resolve(fn()).finally(() => {
    global.document = prevDoc;
    global.window = prevWin;
    global.UI = prevUI;
  });
}

// 语义与真实 ui.js 对齐的最小 UI 替身（showError 先 clear 再挂 error-box，与 ui.js 一致）
function installUi() {
  global.UI = {
    el: (tag, attrs, kids) => {
      const n = makeNode(tag);
      if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else if (k === "onclick") n.addEventListener("click", v);
        else n[k] = v;
      }
      if (kids != null) n.appendChild(kids);
      return n;
    },
    clear: (n) => { while (n && n.children.length) n.removeChild(n.children[0]); return n; },
    showError: (region, message) => {
      UI.clear(region);
      region.appendChild(UI.el("div", { class: "error-box" }, [
        UI.el("strong", { text: "出错了" }),
        UI.el("div", { class: "error-detail", text: String(message || "") }),
      ]));
      return region;
    },
    withLoading: (btn, fn) => fn(),
    fileInput: () => {
      const wrap = makeNode("label");
      wrap.input = makeNode("input");
      return wrap;
    },
    platformName: (p) => String(p || ""),
  };
}

function mountPanel() {
  installUi();
  const batch = require("./batch.js");
  const panel = makeNode("section");
  batch.mount(panel);
  return panel;
}

// ── 交互测试工具 ──

function findBtn(root, re) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach((c) => {
      if (c.tagName === "BUTTON" && re.test(c.textContent || "")) out.push(c);
      if (c.querySelectorAll) walk(c);
    });
  })(root);
  return out;
}

function connectedToRoot(node, root) {
  let p = node;
  while (p) { if (p === root) return true; p = p.parentNode; }
  return false;
}

function bodyText(panel) {
  const body = panel.querySelectorAll("wf-body")[0] || panel;
  return body.textContent || "";
}

function tabFor(panel, text) {
  return panel.querySelectorAll("wf-tab").find((t) => (t.textContent || "").indexOf(text) >= 0);
}

const flush = () => Promise.resolve().then(() => new Promise((r) => setImmediate(r)));
async function settle() { for (let i = 0; i < 6; i++) await flush(); }

function tplCard() {
  return {
    name: "模板A", available: true, draftPackageUrl: "https://x/t.zip",
    fragmentCount: 3, durationMs: 15000, usageAmount: 5,
  };
}

// HTTP 桩：搜索 / 提交（POST /api/v2/batch/*）/ 状态查询都走这里，便于按场景给剧本
function apiStub(spec) {
  const calls = [];
  let statusN = 0;
  const stub = {
    calls,
    statusSeen: () => statusN,
    upload: (method, path) => {
      calls.push(["upload", path]);
      return Promise.resolve({ ok: true, data: { materialId: "mat-" + calls.length } });
    },
    call: (method, path) => {
      calls.push(["call", method, path]);
      if (method === "GET" && path.indexOf("/api/v2/edit/cutsame/search") >= 0) {
        return Promise.resolve({ ok: true, data: { templates: [tplCard()] } });
      }
      if (method === "POST" && path.indexOf("/api/v2/batch/") >= 0) {
        return Promise.resolve(spec.submit);
      }
      if (method === "GET" && path.indexOf("/api/v2/batch/status") >= 0) {
        statusN++;
        const script = spec.status || [];
        const at = Math.min(statusN - 1, script.length - 1);
        const r = script[at] || { ok: false, code: 500, message: "(status stub 未定义)" };
        return Promise.resolve(r);
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + method + " " + path });
    },
  };
  return stub;
}

// 走完整「批量剪同款」提交流程：切类型 → 搜模板 → 选模板 → 选 2 个文件 → 点提交
async function submitCutSame(panel) {
  const kindBtn = findBtn(panel, /^剪同款$/)[0];
  assert.ok(kindBtn, "应能找到「剪同款」类型按钮");
  kindBtn.dispatch("click"); await settle();
  const kw = (function findKw() {
    let hit = null;
    (function walk(n) { (n.children || []).forEach((c) => { if (c.tagName === "INPUT" && c.placeholder === "模板关键词") hit = c; if (c.querySelectorAll) walk(c); }); })(panel);
    return hit;
  })();
  kw.value = "旅行";
  findBtn(panel, /搜模板/)[0].dispatch("click"); await settle();
  const topic = panel.querySelectorAll("wf-topic")[0];
  assert.ok(topic, "搜索后应出现模板卡片");
  topic.dispatch("click"); await settle();
  const wraps = [];
  (function walk(n) { (n.children || []).forEach((c) => { if (c.input) wraps.push(c); if (c.querySelectorAll) walk(c); }); })(panel);
  assert.ok(wraps.length >= 2, "应有商品素材与视频文件两个文件控件");
  wraps.forEach((w) => {
    w.input.files = [
      { name: "v1.mp4", arrayBuffer: async () => new ArrayBuffer(8) },
      { name: "v2.mp4", arrayBuffer: async () => new ArrayBuffer(8) },
    ];
  });
  findBtn(panel, /提交批次/)[0].dispatch("click");
  await settle();
}

// ── 挂载冒烟（原有） ──

test("mount: 挂载不抛异常，且渲染出内容", () => {
  withDom(() => {
    const panel = mountPanel();
    assert.ok(panel.children.length > 0, "面板挂载后应有内容");
    const tabs = panel.querySelectorAll("wf-tab");
    assert.strictEqual(tabs.length, 2, "应有 2 个 tab（发起批次/批次状态）");
  });
});

test("mount: 同一个 panel 重复挂载不会叠加（切导航回来时）", () => {
  withDom(() => {
    installUi();
    const panel = makeNode("section");
    const batch = require("./batch.js");
    batch.mount(panel);
    const first = panel.children.length;
    batch.mount(panel);
    assert.strictEqual(panel.children.length, first);
  });
});

// ── 提交结果四条路径 ──

test("提交失败（ok=false）：错误写入提示区，「提交批次」按钮保留", async () => {
  await withDom(async () => {
    const api = apiStub({ submit: { ok: false, code: 400, message: "模板地址不合法，请重新选择模板" } });
    const panel = mountPanel();
    global.window.HTWApi = api;
    await submitCutSame(panel);
    const go = findBtn(panel, /提交批次/)[0];
    assert.ok(go, "提交失败后「提交批次」按钮应还在页面上（不得整区被清）");
    assert.ok(connectedToRoot(go, panel), "按钮必须仍连接在面板上");
    const detail = panel.querySelectorAll("error-detail")[0];
    assert.ok(detail && /模板地址不合法/.test(detail.textContent || ""), "错误原因应可见");
  });
});

test("提交成功但全部被拒（accepted=0）：原因摊开在提示区，按钮保留", async () => {
  await withDom(async () => {
    const api = apiStub({
      submit: {
        ok: true, data: {
          batchId: "B1", accepted: 0, total: 2,
          rejected: [{ index: 0, error: "批量剪同款需要工作室档位" }, { index: 1, error: "批量剪同款需要工作室档位" }],
        },
      },
    });
    const panel = mountPanel();
    global.window.HTWApi = api;
    await submitCutSame(panel);
    const go = findBtn(panel, /提交批次/)[0];
    assert.ok(go && connectedToRoot(go, panel), "全拒后「提交批次」按钮应还在页面上");
    assert.ok(/批量剪同款需要工作室档位/.test(bodyText(panel)), "被拒原因应对用户可见");
    assert.ok(tabFor(panel, "发起批次").classList.contains("active"), "不应切到批次状态页");
  });
});

test("提交成功 accepted>0：切到批次状态页且页签高亮同步，进度渲染出来", async () => {
  await withDom(async () => {
    const api = apiStub({
      submit: { ok: true, data: { batchId: "B123", accepted: 2, total: 2, rejected: [] } },
      status: [{
        ok: true, data: {
          batchId: "B123", name: "", kind: "cut-same", createdAt: "2026-10-28T10:00:00",
          total: 2, summary: { pending: 1, running: 1 },
          items: [{ index: 0, status: "running", progress: 30, productName: "v1" }, { index: 1, status: "pending", productName: "v2" }],
        },
      }],
    });
    const panel = mountPanel();
    global.window.HTWApi = api;
    // 成功路径会起 6 秒轮询；用 mock 计时器接住，reset 时一并丢弃，免得真实 interval 拖住 runner
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    try {
      await submitCutSame(panel);
      assert.ok(tabFor(panel, "批次状态").classList.contains("active"), "切到批次状态页后，该页签应高亮");
      assert.ok(!tabFor(panel, "发起批次").classList.contains("active"), "发起批次页签不应再高亮");
      assert.ok(panel.querySelectorAll("wf-acct").length === 2, "状态页应渲染出 2 个条目行（进度可见）");
      assert.ok(/处理中/.test(bodyText(panel)), "条目阶段文案可见");
    } finally {
      mock.timers.reset();
    }
  });
});

test("提交成功但响应缺批次 ID：留在发起页说明情况，按钮保留", async () => {
  await withDom(async () => {
    const api = apiStub({ submit: { ok: true, data: { accepted: 2, total: 2, rejected: [] } } });
    const panel = mountPanel();
    global.window.HTWApi = api;
    await submitCutSame(panel);
    const go = findBtn(panel, /提交批次/)[0];
    assert.ok(go && connectedToRoot(go, panel), "缺批次 ID 时不该把按钮清掉");
    assert.ok(tabFor(panel, "发起批次").classList.contains("active"), "没有批次 ID 就不该切页出去");
    assert.ok(/批次 ID/.test(bodyText(panel)), "提示里应说明批次 ID 的情况");
  });
});

test("提交成功但响应没有批次信息（ok 无 data）：留在发起页，按钮保留", async () => {
  await withDom(async () => {
    const api = apiStub({ submit: { ok: true, data: null } });
    const panel = mountPanel();
    global.window.HTWApi = api;
    await submitCutSame(panel);
    const go = findBtn(panel, /提交批次/)[0];
    assert.ok(go && connectedToRoot(go, panel), "响应异常不该把按钮清掉，也不能把成功误报成「已启动 0 条」");
    assert.ok(!/已启动 0 条/.test(bodyText(panel)), "响应异常不得显示「已启动 0 条」的误导文案");
  });
});

test("状态查询首查失败：自动重试，成功后进度照常渲染", async () => {
  await withDom(async () => {
    const api = apiStub({
      submit: { ok: true, data: { batchId: "B999", accepted: 2, total: 2, rejected: [] } },
      status: [
        { ok: false, code: 404, message: "批次不存在或已过期" },
        {
          ok: true, data: {
            batchId: "B999", name: "", kind: "cut-same", createdAt: "2026-10-28T10:00:00",
            total: 2, summary: { running: 2 },
            items: [{ index: 0, status: "running", progress: 10, productName: "v1" }, { index: 1, status: "running", progress: 5, productName: "v2" }],
          },
        },
      ],
    });
    const panel = mountPanel();
    global.window.HTWApi = api;
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    try {
      await submitCutSame(panel);
      assert.strictEqual(api.statusSeen(), 1, "首查只发一次");
      assert.ok(!panel.querySelectorAll("wf-acct").length, "首查失败时还没有条目行");
      assert.ok(/自动重试/.test(bodyText(panel)), "首查失败应显示自动重试提示，而不是死错误框");
      mock.timers.tick(2000);
      await settle();
      assert.ok(api.statusSeen() >= 2, "应自动发出第二次状态查询");
      assert.ok(panel.querySelectorAll("wf-acct").length === 2, "重试成功后条目行（进度）应渲染出来");
    } finally {
      mock.timers.reset();
    }
  });
});

test("自动重试挂起时手动点「查询」：旧的重试轮次作废，不并发骚扰", async () => {
  await withDom(async () => {
    const api = apiStub({
      submit: { ok: true, data: { batchId: "B888", accepted: 2, total: 2, rejected: [] } },
      status: [
        { ok: false, code: 404, message: "批次不存在或已过期" },
        {
          ok: true, data: {
            batchId: "B888", name: "", kind: "cut-same", createdAt: "2026-10-28T10:00:00",
            total: 2, summary: { running: 2 },
            items: [{ index: 0, status: "running", progress: 10, productName: "v1" }, { index: 1, status: "running", progress: 5, productName: "v2" }],
          },
        },
      ],
    });
    const panel = mountPanel();
    global.window.HTWApi = api;
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    try {
      await submitCutSame(panel);
      assert.ok(/自动重试/.test(bodyText(panel)), "前提：首查失败在等自动重试");
      // 用户不等重试，手动点「查询」
      const atManual = api.calls.length;
      findBtn(panel, /查询/)[0].dispatch("click");
      await settle();
      assert.ok(api.calls.length > atManual, "手动查询应立即发出请求");
      assert.ok(panel.querySelectorAll("wf-acct").length === 2, "手动查询成功后条目行应渲染");
      const seenAfterManual = api.statusSeen();
      mock.timers.tick(2000);
      await settle();
      mock.timers.tick(2000);
      await settle();
      assert.strictEqual(api.statusSeen(), seenAfterManual, "旧的重试轮次不得在手动成功后再发请求");
      assert.ok(panel.querySelectorAll("wf-acct").length === 2, "成功渲染不应被迟到的旧重试覆盖");
    } finally {
      mock.timers.reset();
    }
  });
});

test("轮询不叠加：重查（取消后）后同一状态区仍是单个轮询计时器", async () => {
  await withDom(async () => {
    const running = (p1, p2) => ({
      ok: true, data: {
        batchId: "B777", name: "", kind: "cut-same", createdAt: "2026-10-28T10:00:00",
        total: 2, summary: { running: 2 },
        items: [{ index: 0, status: "running", progress: p1, productName: "v1" }, { index: 1, status: "running", progress: p2, productName: "v2" }],
      },
    });
    const api = apiStub({
      submit: { ok: true, data: { batchId: "B777", accepted: 2, total: 2, rejected: [] } },
      status: [
        { ok: false, code: 404, message: "首次没查到" },
        running(10, 5),     // 重试成功 → renderBatch → 第 1 个轮询
        running(20, 15),    // 取消后 loadStatus 重查 → renderBatch → 第 2 个轮询（若无去重则会叠加）
      ],
    });
    api.call = (function (orig) {
      return function (method, path) {
        if (method === "POST" && path.indexOf("/api/v2/batch/cancel") >= 0) {
          api.calls.push(["call", method, path]);
          return Promise.resolve({ ok: true, data: {} });
        }
        return orig.call(null, method, path);
      };
    })(api.call);
    const panel = mountPanel();
    global.window.HTWApi = api;
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    try {
      await submitCutSame(panel);
      mock.timers.tick(2000); // 自动重试 → 成功 → renderBatch → track
      await settle();
      assert.ok(api.statusSeen() === 2, "前提：首查失败 + 重试成功共两次查询");
      // 取消整批：整批按钮在状态卡片下
      findBtn(panel, /取消整批/)[0].dispatch("click");
      await settle();
      assert.ok(api.statusSeen() === 3, "取消成功后应立即重查一次");
      const seenAtStart = api.statusSeen();
      mock.timers.tick(6000);
      await settle();
      assert.ok(api.statusSeen() - seenAtStart === 1, "6 秒应恰好一次轮询查询，而不是多个计时器并发查询");
    } finally {
      mock.timers.reset();
    }
  });
});
