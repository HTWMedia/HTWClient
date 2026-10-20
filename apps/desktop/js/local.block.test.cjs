const test = require("node:test");
const assert = require("node:assert");
const api = require("./api.js");
const Local = require("./local.js");

/*
 * 本地模式设置块冒烟测试。
 *
 * 形态照 js/skills/batch.mount.test.cjs：极小 DOM 替身 + global.document/global.window 换元，
 * 跑真实的 js/app.js 接线（boot → wireLocal → 按钮 → 状态行）。
 * 挡住两类最贵的错误：
 *   ① 接线一挂载就抛异常，整个设置面板废掉；
 *   ② 状态行/配对按钮不按预期变化（探活 500 被当成"就绪"、配对按钮永远禁用）。
 */

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    _attrs: {},
    _text: null,
    _handlers: {},
    children: [],
    parentNode: null,
    style: {},
    disabled: false,
    value: "",
    set textContent(v) { this._text = String(v == null ? "" : v); this.children = []; },
    get textContent() {
      if (this._text != null && !this.children.length) return this._text;
      return this.children.map((c) => c.textContent || "").join("");
    },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ""; },
    get firstChild() { return this.children.length ? this.children[0] : null; },
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
    addEventListener(type, fn) { this._handlers[type] = fn; },
    fire(type) {
      const fn = this._handlers[type];
      if (typeof fn !== "function") return undefined;
      return fn({ type: type, target: this });
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    closest() { return null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  return node;
}

// 设置页里与本地模式相关的元素（id 与 index.html 一致）。
function makeLocalEls() {
  const els = {
    "api-base": makeNode("input"),
    "api-key": makeNode("input"),
    "local-base": makeNode("input"),
    "local-status": makeNode("div"),
    "local-apply": makeNode("button"),
    "local-pair": makeNode("button"),
    "local-pair-result": makeNode("div"),
  };
  els["api-base"].value = "https://htwmedia.dpdns.org";
  els["api-key"].value = "test-key";
  els["local-base"].value = "http://127.0.0.1:51111";
  els["local-pair"].disabled = true;
  return els;
}

const READY_HEALTH = {
  status: 200,
  ok: true,
  data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true, version: "1.0.0" },
};

// 启动整个 app（真实 js/app.js），返回 { els, calls, saved }。
// htw.call 按 path 分派，测试要改行为时传 route 覆盖。
async function bootApp(opts) {
  opts = opts || {};
  const els = opts.els || makeLocalEls();
  const calls = [];
  const saved = [];
  const route = opts.route || (() => READY_HEALTH);

  const docHandlers = {};
  const doc = {
    createElement: makeNode,
    createTextNode: (t) => ({ textContent: String(t), children: [] }),
    addEventListener: (type, fn) => { docHandlers[type] = fn; },
    getElementById: (id) => (els[id] || null),
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  const win = {
    HTWApi: api,
    HTWLocal: Local,
    htw: {
      apiBase: "https://htwmedia.dpdns.org",
      localBase: "",
      registerBase: () => true,
      loadConfig: async () => ({ apiBase: els["api-base"].value, apiKey: els["api-key"].value, localBase: "" }),
      saveConfig: (cfg) => { saved.push(cfg); return true; },
      call: async (method, path, body, apiKey, base) => {
        calls.push({ method: method, path: path, body: body, apiKey: apiKey, base: base });
        return route(method, path, body, apiKey, base);
      },
    },
    addEventListener: () => {},
  };

  const prevDoc = global.document;
  const prevWin = global.window;
  global.document = doc;
  global.window = win;
  delete require.cache[require.resolve("./app.js")];
  require("./app.js");
  // 触发 DOMContentLoaded → boot()（异步，等一拍让配置读取走完）
  if (docHandlers["DOMContentLoaded"]) docHandlers["DOMContentLoaded"]();
  await new Promise((r) => setTimeout(r, 0));

  return {
    els: els,
    calls: calls,
    saved: saved,
    restore: function () {
      global.document = prevDoc;
      global.window = prevWin;
    },
  };
}

test("本地模式块: 探活 ready → 状态行显示本地模式就绪，配对按钮解禁", async () => {
  const app = await bootApp();
  try {
    assert.strictEqual(app.els["local-pair"].disabled, true, "初始状态下配对按钮应禁用");

    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地模式就绪");
    assert.strictEqual(app.els["local-pair"].disabled, false, "探活就绪后配对按钮应解禁");

    // 探活走本地地址，且不带 AuthKey（健康检查不需要登录）。
    const health = app.calls.find((c) => c.path === "/api/v2/local/health");
    assert.ok(health, "应发出一次探活请求");
    assert.strictEqual(health.base, "http://127.0.0.1:51111");
    assert.strictEqual(health.apiKey, undefined, "探活不应把 AuthKey 递给本机进程");

    // 配置三个键一起写，别把既有键丢掉。
    const cfg = app.saved[app.saved.length - 1];
    assert.deepStrictEqual(Object.keys(cfg).sort(), ["apiBase", "apiKey", "localBase"]);
    assert.strictEqual(cfg.localBase, "http://127.0.0.1:51111");
    assert.strictEqual(cfg.apiBase, "https://htwmedia.dpdns.org");
    assert.strictEqual(cfg.apiKey, "test-key");
  } finally {
    app.restore();
  }
});

test("本地模式块: 探活 500 → 不算就绪，状态行给失败文案，配对按钮保持禁用", async () => {
  const app = await bootApp({
    route: () => ({ status: 500, ok: false, data: { ok: true, mode: "local", state: "ready" } }),
  });
  try {
    await app.els["local-apply"].fire("click");

    assert.notStrictEqual(app.els["local-status"].textContent, "本地模式就绪", "500 不能被当成探活成功");
    assert.strictEqual(app.els["local-status"].textContent, "无法连接本地实例，请先启动或检查地址。");
    assert.strictEqual(app.els["local-pair"].disabled, true, "探活失败时配对按钮应保持禁用");
  } finally {
    app.restore();
  }
});

test("本地模式块: 地址为空 → 状态行显示本地模式未配置，配对按钮禁用", async () => {
  const app = await bootApp();
  try {
    app.els["local-base"].value = "";
    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地模式未配置");
    assert.strictEqual(app.els["local-pair"].disabled, true);
    const cfg = app.saved[app.saved.length - 1];
    assert.strictEqual(cfg.localBase, "");
  } finally {
    app.restore();
  }
});

test("本地模式块: 一键配对成功 → 结果行提示成功，状态行刷新为就绪", async () => {
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/enroll")
        return { status: 200, ok: true, data: { Ok: true, Data: { KeyMaterial: "AAAABBBBCCCCDDDD", KeyId: "aid-1", Account: "a@x.com" } } };
      if (path === "/api/local/pair")
        return { status: 200, ok: true, data: { ok: true, data: { keyId: "aid-1" } } };
      return READY_HEALTH;
    },
  });
  try {
    await app.els["local-apply"].fire("click");
    await app.els["local-pair"].fire("click");

    assert.strictEqual(app.els["local-pair-result"].textContent, "配对成功。");
    assert.strictEqual(app.els["local-status"].textContent, "本地模式就绪");

    const enroll = app.calls.find((c) => c.path === "/api/v2/local/enroll");
    assert.ok(enroll, "应发出一次登记请求");
    assert.strictEqual(enroll.base, "https://htwmedia.dpdns.org", "登记走服务端地址");
    assert.strictEqual(enroll.apiKey, "test-key", "登记请求带 AuthKey");

    const pair = app.calls.find((c) => c.path === "/api/local/pair");
    assert.ok(pair, "应发出一次配对请求");
    assert.strictEqual(pair.base, "http://127.0.0.1:51111", "配对走本地实例地址");
    assert.strictEqual(pair.body.ServerUrl, "https://htwmedia.dpdns.org");
    assert.strictEqual(pair.body.Account, "a@x.com", "账号以登记响应回带值为准");
    assert.strictEqual(pair.body.AuthKey, "test-key");
    assert.strictEqual(pair.body.KeyMaterial, "AAAABBBBCCCCDDDD");
    assert.strictEqual(pair.body.AuthorizeWith, "test-key");
  } finally {
    app.restore();
  }
});

test("本地模式块: 配对失败 → 结果行显示失败原文", async () => {
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/enroll")
        return { status: 200, ok: true, data: { Ok: true, Data: { KeyMaterial: "AAAA====", KeyId: "aid-1", Account: "a@x.com" } } };
      if (path === "/api/local/pair")
        return { status: 403, ok: false, data: { errCode: 403, errMsg: "本进程不是本地实例，不接受配对。" } };
      return READY_HEALTH;
    },
  });
  try {
    await app.els["local-apply"].fire("click");
    await app.els["local-pair"].fire("click");

    assert.strictEqual(app.els["local-pair-result"].textContent, "本进程不是本地实例，不接受配对。");
  } finally {
    app.restore();
  }
});

// ---- 错误提示专用块 ----

function withDom(fn) {
  const prevDoc = global.document;
  const prevWin = global.window;
  global.document = {
    createElement: makeNode,
    createTextNode: (t) => ({ textContent: String(t), children: [] }),
    addEventListener: () => {},
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  global.window = {};
  try { return fn(); } finally {
    global.document = prevDoc;
    global.window = prevWin;
  }
}

test("UI.showError: 本地执行不可用 → 专用块标题，详情剥掉代码前缀", () => {
  withDom(() => {
    const UI = require("./ui.js");
    const region = makeNode("div");
    UI.showError(region, "[4007] 本地执行不可用：无法确认额度，请检查网络或服务器状态。");

    assert.strictEqual(region.children.length, 1);
    const box = region.children[0];
    assert.strictEqual(box.className, "error-box");
    assert.strictEqual(box.children[0].tagName, "STRONG");
    assert.strictEqual(box.children[0].textContent, "本地执行不可用");
    assert.strictEqual(box.children[1].className, "error-detail");
    assert.strictEqual(box.children[1].textContent, "本地执行不可用：无法确认额度，请检查网络或服务器状态。");
  });
});

test("UI.showError: 其它错误仍是通用标题", () => {
  withDom(() => {
    const UI = require("./ui.js");
    const region = makeNode("div");
    UI.showError(region, "网络超时");

    const box = region.children[0];
    assert.strictEqual(box.children[0].textContent, "出错了");
    assert.strictEqual(box.children[1].textContent, "网络超时");
  });
});
