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
    addEventListener(type, fn) {
      // 🔴 必须**追加**而不是覆盖：真实的 addEventListener 不会替换旧处理器，
      // 而「同一个按钮被绑了两次」正是 M6 要防的那类重复绑定 ——
      // 用覆盖式替身的话，那个 bug 在测试里根本显形不出来。
      if (!this._handlers[type]) this._handlers[type] = [];
      this._handlers[type].push(fn);
    },
    fire(type) {
      const fns = this._handlers[type];
      if (!fns || !fns.length) return undefined;
      let out;
      for (const fn of fns) out = fn({ type: type, target: this });
      return out;
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
    // 本地实例的启停块（id 与 index.html 一致）。
    "local-binary": makeNode("input"),
    "local-toggle": makeNode("button"),
    "local-state": makeNode("div"),
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

// 首配对时的状态：还没配过对，正是要「一键配对」的那一种。
const NOT_PAIRED_HEALTH = {
  status: 200,
  ok: true,
  data: { ok: true, mode: "local", state: "notPaired", credentialsUnlocked: false, version: "1.0.0" },
};

// 启动整个 app（真实 js/app.js），返回 { els, calls, saved }。
// htw.call 按 path 分派，测试要改行为时传 route 覆盖。
async function bootApp(opts) {
  opts = opts || {};
  const els = opts.els || makeLocalEls();
  const calls = [];
  const saved = [];
  const registered = [];
  // 本地实例监督器的桩：记录启停调用，收集状态事件的订阅者。
  const localCalls = { start: [], stop: 0, status: 0 };
  const localEventSubs = [];
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
    htw: {
      apiBase: "https://htwmedia.dpdns.org",
      localBase: "",
      registerBase: (b) => {
        registered.push(b);
        return opts.registerBase ? opts.registerBase(b) : true;
      },
      loadConfig: async () => (opts.config || { apiBase: els["api-base"].value, apiKey: els["api-key"].value, localBase: "" }),
      saveConfig: (cfg) => { saved.push(cfg); return true; },
      call: async (method, path, body, apiKey, base) => {
        calls.push({ method: method, path: path, body: body, apiKey: apiKey, base: base });
        return route(method, path, body, apiKey, base);
      },
      // ---- 本地实例（监督器）----
      // 形态照 preload：启动带上可执行文件路径；失败载荷是 { ok:false, errMsg }，
      // **不含** state/base/pid/reason（渲染层不能把它当状态读）。
      localStart: async (binaryPath) => {
        localCalls.start.push(binaryPath);
        return opts.localStartResult ||
          { ok: true, state: "starting", base: "", reason: "", attempt: 0, pid: 4242 };
      },
      localStop: async () => {
        localCalls.stop += 1;
        return opts.localStopResult ||
          { ok: true, state: "stopped", base: "", reason: "", attempt: 0, pid: null };
      },
      localStatus: async () => {
        localCalls.status += 1;
        return opts.localStatusResult ||
          { state: "idle", base: "", reason: "", attempt: 0, pid: null };
      },
      onLocalEvent: (cb) => {
        localEventSubs.push(cb);
        return function () {
          const i = localEventSubs.indexOf(cb);
          if (i >= 0) localEventSubs.splice(i, 1);
        };
      },
    },
    addEventListener: () => {},
  };
  // omitLocal：窗口里**没有**本地模式模块（模拟模块没加载 / 加载顺序不对）。
  if (!opts.omitLocal) win.HTWLocal = Local;

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
    // 登记进 preload 白名单的地址（闸门放行的那些）。
    registered: registered,
    // 本地实例监督器的调用记录（start 的入参、stop 的次数、status 的次数）。
    localCalls: localCalls,
    // 模拟主进程推送一次监督器状态事件。
    emitLocalEvent: function (payload) {
      localEventSubs.forEach((cb) => cb(payload));
    },
    // app.js 暴露的 window.App（本地模式接线在 App.local 下）。
    App: win.App,
    restore: function () {
      global.document = prevDoc;
      global.window = prevWin;
    },
  };
}

test("本地模式块: 探活 ready → 状态行显示本地模式就绪（已就绪无需配对，按钮保持禁用）", async () => {
  const app = await bootApp();
  try {
    assert.strictEqual(app.els["local-pair"].disabled, true, "初始状态下配对按钮应禁用");

    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地模式就绪");
    // 已就绪的实例不需要再配对：按钮保持禁用。
    assert.strictEqual(app.els["local-pair"].disabled, true, "已就绪时配对按钮应保持禁用");

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
    // 500 是"实例回了错误"，不是"连不上"：两者文案必须能区分开。
    assert.strictEqual(app.els["local-status"].textContent, "本地实例返回错误，请检查本地实例状态。");
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
  // 首配对的前提是"还没配过对"（notPaired）；配对成功后实例转入就绪态。
  let paired = false;
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/enroll")
        return { status: 200, ok: true, data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } } };
      if (path === "/api/local/pair") {
        paired = true;
        return { status: 200, ok: true, data: { ok: true, data: { keyId: "aid-1" } } };
      }
      return paired ? READY_HEALTH : NOT_PAIRED_HEALTH;
    },
  });
  try {
    await app.els["local-apply"].fire("click");
    assert.strictEqual(app.els["local-status"].textContent, "本地实例未配对");
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
        return { status: 200, ok: true, data: { Ok: true, Data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "a@x.com" } } };
      if (path === "/api/local/pair")
        return { status: 403, ok: false, data: { errCode: 403, errMsg: "本进程不是本地实例，不接受配对。" } };
      return NOT_PAIRED_HEALTH;
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

// 失败壳判定（无 ok/Ok 字段的 {errCode, errMsg}）落到界面上：
// HTTP 200 + 失败壳不能被当成"配对成功"。
test("本地模式块: 配对返 HTTP 200 + 失败壳 → 结果行显示失败原文，不算成功", async () => {
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/enroll")
        return { status: 200, ok: true, data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } } };
      if (path === "/api/local/pair")
        return { status: 200, ok: true, data: { errCode: 403, errMsg: "本进程不是本地实例，不接受配对。" } };
      return NOT_PAIRED_HEALTH;
    },
  });
  try {
    await app.els["local-apply"].fire("click");
    await app.els["local-pair"].fire("click");

    assert.notStrictEqual(app.els["local-pair-result"].textContent, "配对成功。", "失败壳不能被当成配对成功");
    assert.strictEqual(app.els["local-pair-result"].textContent, "本进程不是本地实例，不接受配对。");
  } finally {
    app.restore();
  }
});

// 地址落盘口径：只有「保存并探活」确认过的地址才算数。
// 输入框里还没探活的值不能随着 AuthKey 的每次按键写进配置。
test("本地模式块: 输入框里的未探活地址不随 AuthKey 按键落盘", async () => {
  const app = await bootApp({
    config: { apiBase: "https://htwmedia.dpdns.org", apiKey: "test-key", localBase: "http://127.0.0.1:51111" },
  });
  try {
    // 启动时读回的已配置地址要被保留下来（applyAuth 整份写回时不能丢）。
    const bootCfg = app.saved[app.saved.length - 1];
    assert.strictEqual(bootCfg.localBase, "http://127.0.0.1:51111");

    // 用户在输入框里改了一个还没探活的地址，又敲了一下 AuthKey。
    app.els["local-base"].value = "http://127.0.0.1:52222";
    await app.els["api-key"].fire("input");

    const afterKey = app.saved[app.saved.length - 1];
    assert.strictEqual(afterKey.localBase, "http://127.0.0.1:51111", "未探活的地址不该被写进配置");

    // 「保存并探活」之后，确认过的地址才落盘。
    await app.els["local-apply"].fire("click");
    const afterApply = app.saved[app.saved.length - 1];
    assert.strictEqual(afterApply.localBase, "http://127.0.0.1:52222");
    assert.strictEqual(app.els["local-status"].textContent, "本地模式就绪");
  } finally {
    app.restore();
  }
});

// 清空地址的按钮动作要把已确认的地址缓存一起清掉。
test("本地模式块: 地址清空 → 已确认地址缓存被清空并落盘", async () => {
  const app = await bootApp({
    config: { apiBase: "https://htwmedia.dpdns.org", apiKey: "test-key", localBase: "http://127.0.0.1:51111" },
  });
  try {
    app.els["local-base"].value = "";
    await app.els["local-apply"].fire("click");

    const cfg = app.saved[app.saved.length - 1];
    assert.strictEqual(cfg.localBase, "");
    assert.strictEqual(app.els["local-status"].textContent, "本地模式未配置");

    // 缓存清了之后，配对要被状态自检拦下（不再拿旧地址去配对）。
    await app.els["local-pair"].fire("click");
    assert.strictEqual(app.els["local-pair-result"].textContent, "本地实例尚未就绪，请先保存并探活。");
  } finally {
    app.restore();
  }
});

// key 口径：输入框为空就直接失败，不发请求 ——
// 否则配对体会带着空 AuthKey 出去，而登记用的却是另一个 key。
test("本地模式块: AuthKey 为空 → 配对直接失败，不发任何请求", async () => {
  const app = await bootApp({ route: () => NOT_PAIRED_HEALTH });
  try {
    await app.els["local-apply"].fire("click");
    app.els["api-key"].value = "";
    const before = app.calls.length;
    await app.els["local-pair"].fire("click");

    assert.strictEqual(app.els["local-pair-result"].textContent, "请先填写 AuthKey");
    const sent = app.calls.slice(before).filter((c) => c.path === "/api/v2/local/enroll" || c.path === "/api/local/pair");
    assert.strictEqual(sent.length, 0, "AuthKey 为空时不该发出登记或配对请求");
  } finally {
    app.restore();
  }
});

// 状态自检：配对流程自己也要判状态，不能只靠按钮 disabled 兜底。
test("本地模式块: 未探活就点配对 → 状态自检拦下，不发任何请求", async () => {
  const app = await bootApp();
  try {
    const before = app.calls.length;
    await app.els["local-pair"].fire("click");

    assert.strictEqual(app.els["local-pair-result"].textContent, "本地实例尚未就绪，请先保存并探活。");
    const sent = app.calls.slice(before).filter((c) => c.path === "/api/v2/local/enroll" || c.path === "/api/local/pair");
    assert.strictEqual(sent.length, 0, "状态不满足时不该发出登记或配对请求");
  } finally {
    app.restore();
  }
});

// ---- 首配对闸门（notPaired 才是要配对的那一种）----

// 首配对：实例还没配过对（notPaired）→ 配对按钮必须可用，
// 点下去要真的发出登记 + 配对两条请求，并显示配对成功。
test("本地模式块: 首配对（notPaired）→ 配对按钮可用，点击后发出登记与配对请求并成功", async () => {
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/enroll")
        return { status: 200, ok: true, data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } } };
      if (path === "/api/local/pair")
        return { status: 200, ok: true, data: { ok: true, data: { keyId: "aid-1" } } };
      return NOT_PAIRED_HEALTH;
    },
  });
  try {
    await app.els["local-apply"].fire("click");
    assert.strictEqual(app.els["local-status"].textContent, "本地实例未配对");
    assert.strictEqual(app.els["local-pair"].disabled, false, "首配对时配对按钮应可用");

    const before = app.calls.length;
    await app.els["local-pair"].fire("click");

    assert.strictEqual(app.els["local-pair-result"].textContent, "配对成功。");
    const sent = app.calls.slice(before);
    const enroll = sent.find((c) => c.path === "/api/v2/local/enroll");
    const pair = sent.find((c) => c.path === "/api/local/pair");
    assert.ok(enroll, "首配对应发出登记请求");
    assert.ok(pair, "首配对应发出配对请求");
    assert.strictEqual(enroll.base, "https://htwmedia.dpdns.org", "登记走服务端地址");
    assert.strictEqual(pair.base, "http://127.0.0.1:51111", "配对走本地实例地址");
  } finally {
    app.restore();
  }
});

// 已就绪：实例已经配好且解锁了，不需要（也不该）再配一次 ——
// 按钮禁用，流程自身也要拒绝，且一条请求都不发。
test("本地模式块: 已就绪（ready）→ 配对按钮禁用，点击被拒且不发任何请求", async () => {
  const app = await bootApp();
  try {
    await app.els["local-apply"].fire("click");
    assert.strictEqual(app.els["local-status"].textContent, "本地模式就绪");
    assert.strictEqual(app.els["local-pair"].disabled, true, "已就绪时配对按钮应禁用");

    const before = app.calls.length;
    await app.els["local-pair"].fire("click");

    assert.strictEqual(app.els["local-pair-result"].textContent, "本地实例已就绪，无需配对。");
    const sent = app.calls.slice(before).filter((c) => c.path === "/api/v2/local/enroll" || c.path === "/api/local/pair");
    assert.strictEqual(sent.length, 0, "已就绪时不该发出登记或配对请求");
  } finally {
    app.restore();
  }
});

// 实例重启后待解锁（pairedNotUnlocked）→ 允许重新配对（要出示当前 AuthKey）。
test("本地模式块: 待解锁（pairedNotUnlocked）→ 配对按钮可用", async () => {
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/enroll")
        return { status: 200, ok: true, data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } } };
      if (path === "/api/local/pair")
        return { status: 200, ok: true, data: { ok: true, data: { keyId: "aid-1" } } };
      return { status: 200, ok: true, data: { ok: true, mode: "local", state: "pairedNotUnlocked", credentialsUnlocked: false, version: "1.0.0" } };
    },
  });
  try {
    await app.els["local-apply"].fire("click");
    assert.strictEqual(app.els["local-pair"].disabled, false, "待解锁时配对按钮应可用");

    await app.els["local-pair"].fire("click");
    assert.strictEqual(app.els["local-pair-result"].textContent, "配对成功。");
  } finally {
    app.restore();
  }
});

// 改了地址没保存：上一次探活的结果立刻作废 ——
// 否则用户会拿旧地址的状态去配对新地址（实际配到的还是旧地址）。
test("本地模式块: 改了地址没保存 → 探活状态作废，配对按钮禁用且不发请求", async () => {
  const app = await bootApp();
  try {
    await app.els["local-apply"].fire("click");
    assert.strictEqual(app.els["local-status"].textContent, "本地模式就绪");

    // 用户改了地址，但没点「保存并探活」。
    app.els["local-base"].value = "http://127.0.0.1:52222";
    app.els["local-base"].fire("change");

    assert.strictEqual(app.els["local-status"].textContent, "地址已修改，请重新探活");
    assert.strictEqual(app.els["local-pair"].disabled, true, "地址改了以后配对按钮应禁用");

    const before = app.calls.length;
    await app.els["local-pair"].fire("click");
    const sent = app.calls.slice(before).filter((c) => c.path === "/api/v2/local/enroll" || c.path === "/api/local/pair");
    assert.strictEqual(sent.length, 0, "没探活过的地址不该被配对");
  } finally {
    app.restore();
  }
});

// ---- 本地实例地址：归一化与回环限制 ----

// 用户粘贴带尾斜杠的地址（从浏览器地址栏复制最常见）时，
// preload 是 base + path 直接拼的，尾斜杠会拼出 "//api/v2/local/health" → 404。
// 保存时必须把尾斜杠归一化掉，探活才能打到正确的路径上。
test("本地模式块: 地址带尾斜杠 → 归一化后探活打到正确路径并到达 notPaired", async () => {
  const app = await bootApp({ route: () => NOT_PAIRED_HEALTH });
  try {
    app.els["local-base"].value = "http://127.0.0.1:51111/";
    await app.els["local-apply"].fire("click");

    const health = app.calls.find((c) => c.path === "/api/v2/local/health");
    assert.ok(health, "应发出一次探活请求");
    // base + path 拼起来必须是单斜杠：这里钉住的是"拼出来的那一串"。
    assert.strictEqual(health.base + health.path, "http://127.0.0.1:51111/api/v2/local/health");
    assert.strictEqual(health.base, "http://127.0.0.1:51111", "登记/落盘的地址必须已归一化");

    // 探活真的打通了：状态行显示的是实例回的三态，不是"连不上"。
    assert.strictEqual(app.els["local-status"].textContent, "本地实例未配对");

    // 落盘的也是归一化后的地址。
    const cfg = app.saved[app.saved.length - 1];
    assert.strictEqual(cfg.localBase, "http://127.0.0.1:51111");
  } finally {
    app.restore();
  }
});

// 配对请求会把 AuthKey + 账号级 KEK 材料发往本地地址，
// 所以本地地址**必须**是本机回环：外部地址一律拒掉，一个请求都不发。
test("本地模式块: 非回环地址 → 拒绝，不发请求、不落盘", async () => {
  const app = await bootApp({ route: () => NOT_PAIRED_HEALTH });
  try {
    app.els["local-base"].value = "http://example.com:51111";
    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地实例地址必须是本机回环地址。");
    assert.strictEqual(app.els["local-pair"].disabled, true, "地址不合格时不该允许配对");

    // 一个请求都不该发出去（连探活都不该有）。
    const probes = app.calls.filter((c) => c.path === "/api/v2/local/health");
    assert.strictEqual(probes.length, 0, "非回环地址不该被探活");

    // 更要紧的：这个地址不许落盘。
    assert.ok(
      !app.saved.some((c) => c.localBase === "http://example.com:51111"),
      "非回环地址不该被写进配置"
    );
  } finally {
    app.restore();
  }
});

// 带路径的本地地址同样是根地址口径之外的写法：拒绝并说清原因。
test("本地模式块: 带路径的地址 → 拒绝（根地址口径）", async () => {
  const app = await bootApp({ route: () => NOT_PAIRED_HEALTH });
  try {
    app.els["local-base"].value = "http://127.0.0.1:51111/api";
    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地实例地址必须是根地址（不允许带路径）。");
    const probes = app.calls.filter((c) => c.path === "/api/v2/local/health");
    assert.strictEqual(probes.length, 0, "带路径的地址不该被探活");
    assert.ok(!app.saved.some((c) => c.localBase === "http://127.0.0.1:51111/api"));
  } finally {
    app.restore();
  }
});

// 🔴 闸门 fail-closed（安全面）：本地模式模块没就位时，地址准入必须**拒绝**。
// 兜底分支若只去尾斜杠就放行，就跳过了「必须是本机回环」「必须是根地址」两条硬约束 ——
// 于是外部地址会被登记进 preload 白名单，而配对请求会把 AuthKey + 账号级材料发往那个地址。
// 缺模块时宁可不配置，也不放行：不登记、不落盘、连探活都不发。
test("本地模式块: 模块未就绪 → 非回环地址被拒，不登记、不落盘、不探活", async () => {
  const app = await bootApp({ omitLocal: true, route: () => NOT_PAIRED_HEALTH });
  try {
    app.els["local-base"].value = "http://example.com:51111";
    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地模式组件未就绪，请重启应用后再试。");
    assert.strictEqual(app.els["local-pair"].disabled, true, "地址没通过准入时不该允许配对");

    // 一个请求都不该发出去（连探活都不该有）。
    const probes = app.calls.filter((c) => c.path === "/api/v2/local/health");
    assert.strictEqual(probes.length, 0, "模块未就绪时不该探活");

    // 更要紧的两条：不许登记、不许落盘。
    // （登记名单里另有云端地址 —— 那是 applyAuth 登记的服务端地址，与本地地址无关。）
    assert.ok(
      !app.registered.includes("http://example.com:51111"),
      "没过准入的本地地址不许登记进 preload 白名单"
    );
    assert.ok(
      !app.saved.some((c) => c.localBase === "http://example.com:51111"),
      "没过准入的地址不许被写进配置"
    );
  } finally {
    app.restore();
  }
});

// 🔴 观感一致性：登记**失败**时输入框不许被改写。
// 原来归一化后的地址在登记之前就回填了输入框，于是登记失败时状态行说着
// 「地址格式无效」，输入框却已经换成了另一串字面量 —— 两边对不上。
// 回填必须挪到登记成功之后。
test("本地模式块: 登记失败 → 输入框保持用户填的原样，不被改写", async () => {
  const app = await bootApp({
    route: () => NOT_PAIRED_HEALTH,
    registerBase: () => false, // preload 侧拒绝这个地址
  });
  try {
    // 用户填的是带尾斜杠的同一个地址：归一化会把它变成不带尾斜杠的那一串。
    app.els["local-base"].value = "http://127.0.0.1:51111/";
    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "地址格式无效，请以 http:// 开头填写。");
    assert.strictEqual(app.els["local-base"].value, "http://127.0.0.1:51111/",
      "登记失败时输入框不许被改写");
    assert.ok(
      !app.saved.some((c) => c.localBase === "http://127.0.0.1:51111"),
      "登记失败时地址不许落盘"
    );
  } finally {
    app.restore();
  }
});

// M6：boot() 的成功路径与失败路径都会调 wireLocal，
// 不加防重的话同一个按钮会绑上两个处理器 —— 点一次探活两次，
// 而且两次是交错的异步探活，状态行显示的是后到的那次。
test("本地模式块: 重复接线不叠加处理器 → 点一次只探活一次", async () => {
  const app = await bootApp({ route: () => NOT_PAIRED_HEALTH });
  try {
    // 模拟 boot 中途抛异常后 catch 分支又调了一次 wireLocal。
    app.App.local.wire();
    app.App.local.wire();

    await app.els["local-apply"].fire("click");

    const probes = app.calls.filter((c) => c.path === "/api/v2/local/health");
    assert.strictEqual(probes.length, 1, "一次点击只该探活一次");
  } finally {
    app.restore();
  }
});

// 归一化口径要在「探活状态作废」与「配对地址自检」两处**一致**：
// 尾斜杠只是同一个地址的另一种写法，不该让上一次的探活结果作废，
// 也不该让配对被「地址已修改」拦下（配对必须走保存过的那个地址）。
test("本地模式块: 保存后只多打一个尾斜杠 → 探活状态不作废，配对仍走保存过的地址", async () => {
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/enroll")
        return { status: 200, ok: true, data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } } };
      if (path === "/api/local/pair")
        return { status: 200, ok: true, data: { ok: true, data: { keyId: "aid-1" } } };
      return NOT_PAIRED_HEALTH;
    },
  });
  try {
    await app.els["local-apply"].fire("click");
    assert.strictEqual(app.els["local-status"].textContent, "本地实例未配对");

    // 用户在输入框里多打了一个尾斜杠（同一个地址的另一种写法）。
    app.els["local-base"].value = "http://127.0.0.1:51111/";
    app.els["local-base"].fire("change");
    assert.strictEqual(app.els["local-status"].textContent, "本地实例未配对", "写法差异不该让探活结果作废");

    await app.els["local-pair"].fire("click");
    assert.strictEqual(app.els["local-pair-result"].textContent, "配对成功。");

    const pair = app.calls.find((c) => c.path === "/api/local/pair");
    assert.ok(pair, "应发出配对请求");
    assert.strictEqual(pair.base, "http://127.0.0.1:51111", "配对必须走保存过的（归一化后的）地址");
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

// 专用块的文案口径：**客户端实际产出的那一句**。
// 服务器侧回的是长版（"本地执行不可用：无法确认额度，请检查网络或服务器状态。"），
// 但 api.js 的 normalize 会把它改写成短版再交给界面 —— 内部细节不外泄给用户。
// 长版的文案由服务器侧自己的测试钉着，这里钉的是**客户端真实产出**的那一句。
test("UI.showError: 本地执行不可用 → 专用块标题，详情剥掉代码前缀", () => {
  withDom(() => {
    const UI = require("./ui.js");
    const region = makeNode("div");
    UI.showError(region, "[4007] 本地执行不可用，请检查网络或服务器状态。");

    assert.strictEqual(region.children.length, 1);
    const box = region.children[0];
    assert.strictEqual(box.className, "error-box");
    assert.strictEqual(box.children[0].tagName, "STRONG");
    assert.strictEqual(box.children[0].textContent, "本地执行不可用");
    assert.strictEqual(box.children[1].className, "error-detail");
    assert.strictEqual(box.children[1].textContent, "本地执行不可用，请检查网络或服务器状态。");
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

// ---- 本地实例：启停与状态 ----
//
// 三条硬口径钉在这几个用例里：
//  ① 失败载荷 { ok:false, errMsg } **不是状态** —— 当状态读会显示成"未启动"这类假状态；
//  ② 地址来源：监督器发现的地址优先（那才是实例真正的地址），否则用用户保存过的；
//  ③ 状态行必须显式区分「实例在跑」与「业务走本地」——本轮不切业务流量。

// 点「启动本地实例」→ 监督器收到的是输入框里那个路径。
// 什么使其变红：启动入参不取输入框的值（或干脆不传路径）→ start 记录里就不是那串路径。
test("本地实例: 点启动按钮 → 以输入框里的可执行文件路径调用启动", async () => {
  const app = await bootApp();
  try {
    app.els["local-binary"].value = "C:\\tools\\local-instance.exe";
    await app.els["local-toggle"].fire("click");

    assert.deepStrictEqual(app.localCalls.start, ["C:\\tools\\local-instance.exe"],
      "启动必须带上输入框里的可执行文件路径");
  } finally {
    app.restore();
  }
});

// 监督器报 running → 状态行说"本地实例运行中"，且探活/配对都改用它给的地址。
// 什么使其变红：地址来源不优先用监督器的 base（或探活/配对仍走用户填的地址）
//   → health.base / pair.base 就不是 127.0.0.1:51234。
test("本地实例: 收到运行中事件 → 状态行显示运行中，探活与配对改用监督器给的地址", async () => {
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/enroll")
        return { status: 200, ok: true, data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } } };
      if (path === "/api/local/pair")
        return { status: 200, ok: true, data: { ok: true, data: { keyId: "aid-1" } } };
      return NOT_PAIRED_HEALTH;
    },
  });
  try {
    app.emitLocalEvent({ state: "running", base: "http://127.0.0.1:51234", reason: "", attempt: 0, pid: 4321 });

    const text = app.els["local-state"].textContent;
    assert.ok(text.includes("本地实例运行中"), "状态行应显示本地实例运行中，实际：" + text);

    await app.els["local-apply"].fire("click");
    const health = app.calls.find((c) => c.path === "/api/v2/local/health");
    assert.ok(health, "应发出一次探活请求");
    assert.strictEqual(health.base, "http://127.0.0.1:51234", "探活必须走监督器发现的地址");

    await app.els["local-pair"].fire("click");
    const pair = app.calls.find((c) => c.path === "/api/local/pair");
    assert.ok(pair, "应发出一次配对请求");
    assert.strictEqual(pair.base, "http://127.0.0.1:51234", "配对必须走监督器发现的地址");
  } finally {
    app.restore();
  }
});

// 失败事件带原因 → 状态行给出中文原因（不是把 reason 原样透给用户）。
// 什么使其变红：failed 分支不翻译原因（或干脆不渲染）→ 状态行里没有那串中文。
test("本地实例: 收到失败事件 → 状态行给出失败原因的中文", async () => {
  const app = await bootApp();
  try {
    app.emitLocalEvent({ state: "failed", reason: "noAddress", base: "", attempt: 0, pid: null });

    const text = app.els["local-state"].textContent;
    assert.ok(text.includes("本地实例启动失败"), "状态行应说明启动失败，实际：" + text);
    assert.ok(text.includes("未发现它的地址"), "状态行应给出失败原因的中文，实际：" + text);
  } finally {
    app.restore();
  }
});

// 状态行不得暗示"业务流量已切到本地"。
// 什么使其变红：运行中的文案改成"已切换本地 / 业务走本地"之类 → 下面的禁用说法断言变红。
test("本地实例: 状态行不暗示业务流量已切本地", async () => {
  const app = await bootApp();
  try {
    app.emitLocalEvent({ state: "running", base: "http://127.0.0.1:51234", reason: "", attempt: 0, pid: 4321 });

    const text = app.els["local-state"].textContent;
    assert.ok(text.includes("实例"), "状态行应说明这是本地实例，实际：" + text);
    for (const bad of ["业务走本地", "已切换本地", "切到本地", "走本地", "流量已切", "已接本地"]) {
      assert.ok(!text.includes(bad), "状态行不该出现暗示流量已切的说法（" + bad + "），实际：" + text);
    }
    // 反过来：必须显式说清业务请求仍走云端（本轮不切流量）。
    assert.ok(text.includes("业务请求仍走云端"), "运行中应写明业务请求仍走云端，实际：" + text);
  } finally {
    app.restore();
  }
});

// 崩溃退避期：没有单独的"退避中"状态，是 stopped + attempt>0 + pid===null。
// 什么使其变红：退避判定去掉 attempt/pid 条件（或把退避期当成普通 stopped）
//   → 状态行里就没有"退避"两个字。
test("本地实例: 崩溃退避期（stopped + attempt>0 + 无进程）→ 状态行显示退避中", async () => {
  const app = await bootApp();
  try {
    // 普通停止（没有崩溃重试计数）不该说"退避"。
    app.emitLocalEvent({ state: "stopped", base: "", reason: "", attempt: 0, pid: null });
    const plain = app.els["local-state"].textContent;
    assert.ok(!plain.includes("退避"), "普通停止不该显示退避中，实际：" + plain);

    app.emitLocalEvent({ state: "stopped", base: "", reason: "", attempt: 2, pid: null });
    const text = app.els["local-state"].textContent;
    assert.ok(text.includes("退避"), "崩溃退避期应显示退避中，实际：" + text);
  } finally {
    app.restore();
  }
});

// 启动失败（IPC 失败载荷 { ok:false, errMsg }）→ 按"操作失败"显示 errMsg。
// 什么使其变红：不判 ok===false（把失败载荷当状态读）→ 状态行会显示成"未启动"这类假状态。
test("本地实例: 启动失败载荷 { ok:false } → 按操作失败显示 errMsg，不当状态读", async () => {
  const app = await bootApp({
    localStartResult: { ok: false, errMsg: "主进程通道不可用", error: "主进程通道不可用" },
  });
  try {
    app.els["local-binary"].value = "C:\\tools\\local-instance.exe";
    await app.els["local-toggle"].fire("click");

    const text = app.els["local-state"].textContent;
    assert.ok(text.includes("操作失败"), "失败载荷应按操作失败处理，实际：" + text);
    assert.ok(text.includes("主进程通道不可用"), "应显示 errMsg 原文，实际：" + text);
    assert.ok(!text.includes("未启动"), "失败载荷不该被当成「未启动」这类假状态，实际：" + text);
  } finally {
    app.restore();
  }
});

// 事件里的失败载荷同样按"操作失败"处理。
// 什么使其变红：事件处理不判 ok===false → 失败载荷会被当成没有 state 的事件丢掉，
//   状态行停在上一句（断言里的 errMsg 就不出现）。
test("本地实例: 事件载荷 { ok:false } → 按操作失败显示 errMsg", async () => {
  const app = await bootApp();
  try {
    app.emitLocalEvent({ ok: false, errMsg: "监督器通道断了" });

    const text = app.els["local-state"].textContent;
    assert.ok(text.includes("操作失败"), "失败载荷应按操作失败处理，实际：" + text);
    assert.ok(text.includes("监督器通道断了"), "应显示 errMsg 原文，实际：" + text);
  } finally {
    app.restore();
  }
});

// 实例在跑时点同一个按钮 → 停止，而不是再启动一次。
// 什么使其变红：按钮不按状态分流（永远走启动）→ stop 次数为 0、start 里多一条。
test("本地实例: 实例在跑时点按钮 → 调停止，不调启动", async () => {
  const app = await bootApp();
  try {
    app.emitLocalEvent({ state: "running", base: "http://127.0.0.1:51234", reason: "", attempt: 0, pid: 4321 });
    app.els["local-binary"].value = "C:\\tools\\local-instance.exe";
    await app.els["local-toggle"].fire("click");

    assert.strictEqual(app.localCalls.stop, 1, "运行中点按钮应调停止");
    assert.deepStrictEqual(app.localCalls.start, [], "运行中点按钮不该再调启动");
  } finally {
    app.restore();
  }
});
