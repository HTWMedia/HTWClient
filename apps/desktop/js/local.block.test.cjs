const test = require("node:test");
const assert = require("node:assert");
const api = require("./api.js");
const Local = require("./local.js");
const Caps = require("./local-capabilities.js");
// 请求头物化的**同一份**口径（preload.call 直接用这个模块）：
// 对请求头的断言建立在真实上线路径上，而不是在测试里另造一份规则。
const Headers = require("./call-headers.js");

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
// localBase 可覆盖：真实场景里用户可以什么都不填（地址由本地实例监督器发现），
// 所以测试必须能造出"地址输入框为空"这个前提 —— 预填写死的话，
// "空输入框 + 监督器已发现地址"这条路径在测试里根本走不到。
function makeLocalEls(opts) {
  opts = opts || {};
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
    // 本地模式总开关（id 与 index.html 一致）：默认**不勾选**（总开关默认关）。
    "local-enabled": makeNode("input"),
  };
  els["api-base"].value = "https://htwmedia.dpdns.org";
  els["api-key"].value = "test-key";
  els["local-base"].value = opts.localBase !== undefined ? opts.localBase : "http://127.0.0.1:51111";
  els["local-pair"].disabled = true;
  els["local-enabled"].checked = false;
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

// 带协议版本的 health 夹具（协议版本握手用）。
// protocolVersion 是客户端与实例之间的机器判据；state 用 notPaired ——
// 这样"没有做版本判定"的实现会把配对按钮放开，下面的断言才真的能变红。
function healthWithVersion(version) {
  return {
    status: 200,
    ok: true,
    data: { ok: true, mode: "local", state: "notPaired", credentialsUnlocked: false, version: "1.0.0", protocolVersion: version },
  };
}

// 启动整个 app（真实 js/app.js），返回 { els, calls, saved }。
// htw.call 按 path 分派，测试要改行为时传 route 覆盖。
async function bootApp(opts) {
  opts = opts || {};
  const els = opts.els || makeLocalEls(opts);
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
        // 用 preload 同一份逻辑把实参物化成请求头：探活这类匿名请求
        // 递下来的 apiKey 到底会不会变成AuthKey 头，由这份逻辑说了算。
        const headers = Headers.buildCallHeaders(apiKey, body);
        calls.push({ method: method, path: path, body: body, apiKey: apiKey, base: base, headers: headers });
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
  // 端点能力清单模块（渲染层靠它拉清单）。真实运行时由 index.html 的
  // <script src="js/local-capabilities.js"> 挂上 —— 缺了它就永远拉不到清单。
  win.HTWLocalCapabilities = Caps;

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

    // 探活走本地地址，且**请求头对象里没有 AuthKey 键**（健康检查不需要登录，
    // 也不该把云端密钥递给本机进程 —— 连"空值的头"都不许出现，
    // 断言建在真实上线的请求头上，不是实参形态上）。
    const health = app.calls.find((c) => c.path === "/api/v2/local/health");
    assert.ok(health, "应发出一次探活请求");
    assert.strictEqual(health.base, "http://127.0.0.1:51111");
    // 显式走省略通道：传 **null**（不是无意漏传的 undefined —— 那正是旧断言被骗过的原因）。
    assert.strictEqual(health.apiKey, null, "探活必须显式传 null（省略通道哨兵），实际：" + String(health.apiKey));
    assert.ok(!("AuthKey" in health.headers), "探活请求头不得带 AuthKey（空值头也不许），实际：" + JSON.stringify(health.headers));

    // 配置的键一起写，别把既有键丢掉（可执行文件路径是第 4 个键，
    // 「启用本地模式」总开关是第 5 个键）。
    const cfg = app.saved[app.saved.length - 1];
    assert.deepStrictEqual(Object.keys(cfg).sort(), ["apiBase", "apiKey", "localBase", "localBinary", "localEnabled"]);
    assert.strictEqual(cfg.localEnabled, false, "总开关默认关");
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

// 🔴 就绪判据也必须**跟着监督器走**：实例报非 running（停止/退避/失败）时，
// 之前探活得到的"就绪+已配对"立刻作废 —— 不然实例都停了，业务请求还往本机发。
test("本地模式块: 监督器报 stopped → 选路判据失效，端点回到云端", async () => {
  const app = await bootApp({
    route: (method, path) => {
      if (path === "/api/v2/local/capabilities")
        return { status: 200, ok: true, data: { protocolVersion: 1, endpoints: ["GET /api/v2/agent/voices"] } };
      return READY_HEALTH;
    },
  });
  try {
    // 先把前提立起来：总开关开 + 探活就绪 + 已配对 + 清单命中。
    app.App.local.setEnabled(true);
    await app.els["local-apply"].fire("click");
    assert.strictEqual(app.App.local.routing().ready, true, "前提：实例已就绪");
    assert.strictEqual(app.App.local.routing().paired, true, "前提：已配对且解锁");
    assert.strictEqual(api.resolveTarget("GET", "/api/v2/agent/voices"), "http://127.0.0.1:51111",
      "前提：清单内的端点走本地");
    // 监督器状态事件（真实上线路径：主进程推送）报 stopped。
    app.emitLocalEvent({ ok: true, state: "stopped", base: "", reason: "", attempt: 0, pid: null });
    assert.strictEqual(api.localRouting.ready, false, "监督器报非 running → 就绪判据必须失效");
    assert.strictEqual(api.localRouting.paired, false, "配对判据一并失效");
    assert.strictEqual(api.resolveTarget("GET", "/api/v2/agent/voices"), "https://htwmedia.dpdns.org",
      "端点回到云端");
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

    assert.strictEqual(app.els["local-pair-result"].textContent, "配对成功。（实际地址：http://127.0.0.1:51111）");
    assert.strictEqual(app.els["local-status"].textContent, "本地模式就绪");

    const enroll = app.calls.find((c) => c.path === "/api/v2/local/enroll");
    assert.ok(enroll, "应发出一次登记请求");
    assert.strictEqual(enroll.base, "https://htwmedia.dpdns.org", "登记走服务端地址");
    assert.strictEqual(enroll.apiKey, "test-key", "登记请求带 AuthKey");
    assert.ok("AuthKey" in enroll.headers && enroll.headers.AuthKey === "test-key",
      "登记的头仍带真 AuthKey（配对语义保持不变，实际：" + JSON.stringify(enroll.headers) + "）");

    const pair = app.calls.find((c) => c.path === "/api/local/pair");
    assert.ok(pair, "应发出一次配对请求");
    assert.ok("AuthKey" in pair.headers && pair.headers.AuthKey === "test-key",
      "配对的头仍带真 AuthKey（实际：" + JSON.stringify(pair.headers) + "）");
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

    assert.strictEqual(app.els["local-pair-result"].textContent, "本进程不是本地实例，不接受配对。（实际地址：http://127.0.0.1:51111）");
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
    assert.strictEqual(app.els["local-pair-result"].textContent, "本进程不是本地实例，不接受配对。（实际地址：http://127.0.0.1:51111）");
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

    assert.strictEqual(app.els["local-pair-result"].textContent, "配对成功。（实际地址：http://127.0.0.1:51111）");
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
    assert.strictEqual(app.els["local-pair-result"].textContent, "配对成功。（实际地址：http://127.0.0.1:51111）");
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
    assert.strictEqual(app.els["local-pair-result"].textContent, "配对成功。（实际地址：http://127.0.0.1:51111）");

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

// 监督器发现的地址**直接可用**：用户什么都没填（输入框为空），
// 点「保存并探活」不能报"本地模式未配置" —— 端口是系统随机分配的，
// 要用户手工抄进输入框，等于"地址发现"这个能力白做。
// 什么使其变红：applyLocal 只认输入框的值（不看监督器给的地址）→
//   输入框为空就早退"本地模式未配置"，一条探活请求都不发。
test("本地实例: 地址输入框为空 + 监督器已发现地址 → 点保存并探活要探活到监督器给的地址", async () => {
  const app = await bootApp({ localBase: "" });
  try {
    // 监督器自己发现地址并上报 running。
    app.emitLocalEvent({ state: "running", base: "http://127.0.0.1:51234", reason: "", attempt: 0, pid: 4321 });
    await new Promise((r) => setTimeout(r, 0));

    // 发现的地址要回填进输入框（用户不用把随机端口手工抄进去）。
    assert.strictEqual(app.els["local-base"].value, "http://127.0.0.1:51234",
      "监督器发现的地址应回填进地址输入框");

    const before = app.calls.length;
    await app.els["local-apply"].fire("click");

    const probes = app.calls.slice(before).filter((c) => c.path === "/api/v2/local/health");
    assert.ok(probes.length >= 1, "点保存并探活必须发出探活请求（不是'本地模式未配置'）");
    assert.strictEqual(probes[0].base, "http://127.0.0.1:51234", "探活必须走监督器发现的地址");
    assert.notStrictEqual(app.els["local-status"].textContent, "本地模式未配置",
      "监督器已经给出地址了，不该报'本地模式未配置'");
  } finally {
    app.restore();
  }
});

// 主流程也要握手：「点启动 → 实例起来」这条路上从没探过活，
// 于是不兼容的实例照样显示"本地实例运行中"。
// 什么使其变红：收到 running 事件后不自动探活 → 一条 health 请求都不发。
test("本地实例: 收到 running 事件（地址变化）→ 自动探活一次，不用手点按钮", async () => {
  const app = await bootApp();
  try {
    const before = app.calls.length;
    app.emitLocalEvent({ state: "running", base: "http://127.0.0.1:51234", reason: "", attempt: 0, pid: 4321 });
    await new Promise((r) => setTimeout(r, 0));

    const probes = app.calls.slice(before).filter((c) => c.path === "/api/v2/local/health");
    assert.strictEqual(probes.length, 1, "监督器报 running 后应自动探活一次");
    assert.strictEqual(probes[0].base, "http://127.0.0.1:51234", "自动探活必须走监督器发现的地址");

    // 同一个地址再报一次 running → 不重复探活（否则每次状态推送都打一次 health）。
    const before2 = app.calls.length;
    app.emitLocalEvent({ state: "running", base: "http://127.0.0.1:51234", reason: "", attempt: 0, pid: 4321 });
    await new Promise((r) => setTimeout(r, 0));
    const probes2 = app.calls.slice(before2).filter((c) => c.path === "/api/v2/local/health");
    assert.strictEqual(probes2.length, 0, "地址没变就不该重复探活");
  } finally {
    app.restore();
  }
});

// 地址输入框被清空（用户手动改的）时，只要监督器还握着实例的真地址，
// 探活就不能落空 —— 端口是系统随机分配的，用户没填不代表没有地址。
// 什么使其变红：applyLocal 只认输入框的值 → 直接报"本地模式未配置"，一条 health 都不发。
test("本地实例: 清空地址输入框但监督器有地址 → 仍按监督器给的地址探活", async () => {
  const app = await bootApp();
  try {
    app.emitLocalEvent({ state: "running", base: "http://127.0.0.1:51234", reason: "", attempt: 0, pid: 4321 });
    await new Promise((r) => setTimeout(r, 0));

    // 用户把地址框清空了（实例还在跑，地址还在监督器手里）。
    app.els["local-base"].value = "";

    const before = app.calls.length;
    await app.els["local-apply"].fire("click");

    const probes = app.calls.slice(before).filter((c) => c.path === "/api/v2/local/health");
    assert.ok(probes.length >= 1, "输入框为空但监督器有地址时也要探活");
    assert.strictEqual(probes[0].base, "http://127.0.0.1:51234", "探活必须走监督器发现的地址");
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

// ---- 协议版本握手 ----
//
// 口径：客户端钉住一个支持的协议版本；实例回的数字对不上 → 拒绝配对并说清。
// 老实例没有这个字段 → **不阻断**（按兼容处理，见报告）。

// 不支持的版本 → 状态行说"不兼容"，配对按钮保持禁用。
// 什么使其变红：不比版本（或比错了）→ 配对按钮会被放开、状态行显示的是实例的三态。
test("本地模式块: 实例协议版本不支持 → 提示不兼容，配对按钮保持禁用", async () => {
  const app = await bootApp({ route: () => healthWithVersion(2) });
  try {
    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地实例与客户端不兼容，请更新客户端或本地实例");
    assert.strictEqual(app.els["local-pair"].disabled, true, "版本不兼容时配对按钮应保持禁用");

    // 流程自身也要拦住：按钮禁用只是界面层的兜底，点了也不该发请求。
    const before = app.calls.length;
    await app.els["local-pair"].fire("click");
    const sent = app.calls.slice(before).filter((c) => c.path === "/api/v2/local/enroll" || c.path === "/api/local/pair");
    assert.strictEqual(sent.length, 0, "版本不兼容时不该发出登记或配对请求");
    assert.strictEqual(app.els["local-pair-result"].textContent, "本地实例与客户端不兼容，请更新客户端或本地实例");
  } finally {
    app.restore();
  }
});

// 支持的版本 → 行为与现在完全一致（状态行走实例的三态，配对按钮按状态开）。
// 什么使其变红：任何版本都当成不兼容（或者都当成兼容）→ 状态行/按钮状态不对。
test("本地模式块: 实例协议版本一致 → 正常，配对按钮按状态启用", async () => {
  const app = await bootApp({ route: () => healthWithVersion(1) });
  try {
    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地实例未配对");
    assert.strictEqual(app.els["local-pair"].disabled, false, "版本一致时首配对按钮应可用");
  } finally {
    app.restore();
  }
});

// 老实例没有 protocolVersion 字段 → **不阻断**（按兼容处理；老实例不做握手）。
// 什么使其变红：把"读不到"当成不兼容（于是老实例全都用不了本地模式）。
test("本地模式块: 老实例没有 protocolVersion → 不阻断（按兼容处理）", async () => {
  const app = await bootApp({ route: () => NOT_PAIRED_HEALTH }); // 夹具里没有 protocolVersion
  try {
    await app.els["local-apply"].fire("click");

    assert.strictEqual(app.els["local-status"].textContent, "本地实例未配对");
    assert.strictEqual(app.els["local-pair"].disabled, false, "老实例不该被拦住");
  } finally {
    app.restore();
  }
});

// ---- 可执行文件路径落盘 ----
//
// 口径：路径是用户显式填的（不是秘密，但每次启动重输不可接受），
// 所以要落盘、并在下次启动时回填输入框。

// 什么使其变红：启动时不回填（用户每次都要重输）/ 落盘时丢了这个键。
test("本地模式块: 可执行文件路径落盘 → 下次启动回填输入框", async () => {
  const app = await bootApp({
    config: {
      apiBase: "https://htwmedia.dpdns.org",
      apiKey: "test-key",
      localBase: "http://127.0.0.1:51111",
      localBinary: "C:\\tools\\local-instance.exe",
    },
  });
  try {
    // 启动时回填：上次用户填的路径还在输入框里。
    assert.strictEqual(app.els["local-binary"].value, "C:\\tools\\local-instance.exe");

    // 用户改了路径并保存 → 落盘（连同既有三键一起写）。
    app.els["local-binary"].value = "D:\\apps\\local-instance.exe";
    await app.els["local-apply"].fire("click");

    const cfg = app.saved[app.saved.length - 1];
    assert.strictEqual(cfg.localBinary, "D:\\apps\\local-instance.exe");
    // 既有三键不许被这次写入弄丢。
    assert.strictEqual(cfg.apiBase, "https://htwmedia.dpdns.org");
    assert.strictEqual(cfg.apiKey, "test-key");
    assert.strictEqual(cfg.localBase, "http://127.0.0.1:51111");
  } finally {
    app.restore();
  }
});

// 只接受用户**显式输入**的路径：输入框里没动过就不该凭空多出一个路径，
// 而且路径永远是本机的文件路径，不接受任何远端下发的值。
// 什么使其变红：路径不是从输入框取（或者从别处取）→ 落盘的值不对。
test("本地模式块: 可执行文件路径只认输入框里的用户输入", async () => {
  const app = await bootApp();
  try {
    app.els["local-binary"].value = "C:\\tools\\local-instance.exe";
    await app.els["local-apply"].fire("click");

    const cfg = app.saved[app.saved.length - 1];
    assert.strictEqual(cfg.localBinary, "C:\\tools\\local-instance.exe");
  } finally {
    app.restore();
  }
});

// ---- 本地模式总开关（config 第 5 键 localEnabled）----
//
// 四条口径钉在下面这几条用例里：
//  ① **默认关**：配置里没有 localEnabled 这个键 → 勾选框未选中、选路全走云端；
//  ② 勾选 / 取消勾选都要落盘（localEnabled: true / false），既有四键一字不动；
//  ③ 启动时读到 localEnabled:true → 勾选框选中，且选路判据里的 enabled 为真；
//  ④ 实例就绪后**自动拉一次**端点能力清单并喂给 api.js；拉不到 → 空清单 →
//     全走云端（不报错、不阻断）。
//
// 🔴 api.js 是模块单例（跨用例共享状态）：每条用例收尾都要把选路判据复位，
//    否则上一条用例留下的"开关开着 + 清单命中"会污染下一条。

const CLOUD_BASE = "https://htwmedia.dpdns.org";
const LOCAL_BASE = "http://127.0.0.1:51111";
const CAPS_PATH = "/api/v2/local/capabilities";
// 清单夹具：一条带占位符的端点（匹配的是"方法 + 路径模式"，不是前缀）。
const CAPS_LIST = ["GET /api/v2/voice/status/{id:int}"];

// 探活回 ready；清单端点按 capsResponder 给。
function makeRoute(capsResponder) {
  return function (method, path) {
    if (path === CAPS_PATH) return capsResponder();
    return READY_HEALTH;
  };
}

// 复位 api.js 的选路判据（模块单例的跨用例污染）。
function resetRouting() {
  api.setLocalRouting({});
}

// 勾选启用 → 落盘 localEnabled:true（既有四键一字不动）。
// 什么使其变红：勾选框没有接线（或落盘时漏了这个键）→ 落盘里没有 localEnabled / 不是 true。
test("本地模式总开关: 勾选启用 → 落盘 localEnabled:true，既有四键一字不动", async () => {
  const app = await bootApp({
    config: { apiBase: CLOUD_BASE, apiKey: "test-key", localBase: LOCAL_BASE },
  });
  try {
    app.els["local-enabled"].checked = true;
    await app.els["local-enabled"].fire("change");

    const cfg = app.saved[app.saved.length - 1];
    assert.strictEqual(cfg.localEnabled, true, "勾选后应落盘 localEnabled:true");
    // 既有四键一个都不能少（少写一个键等于把另一个清空）。
    assert.strictEqual(cfg.apiBase, CLOUD_BASE);
    assert.strictEqual(cfg.apiKey, "test-key");
    assert.strictEqual(cfg.localBase, LOCAL_BASE);
    assert.strictEqual(cfg.localBinary, "");
  } finally {
    app.restore();
    resetRouting();
  }
});

// 取消勾选 → 落盘 localEnabled:false。
// 什么使其变红：只写 true 不写 false（或取消勾选时干脆不落盘）→ 落盘值不是 false。
test("本地模式总开关: 取消勾选 → 落盘 localEnabled:false", async () => {
  const app = await bootApp({
    config: { apiBase: CLOUD_BASE, apiKey: "test-key", localBase: LOCAL_BASE, localEnabled: true },
  });
  try {
    assert.strictEqual(app.els["local-enabled"].checked, true, "启动时应回填勾选状态");
    app.els["local-enabled"].checked = false;
    await app.els["local-enabled"].fire("change");

    const cfg = app.saved[app.saved.length - 1];
    assert.strictEqual(cfg.localEnabled, false, "取消勾选后应落盘 localEnabled:false");
  } finally {
    app.restore();
    resetRouting();
  }
});

// 启动读到 localEnabled:true → 勾选框选中，且选路判据里的 enabled 为真。
// 什么使其变红：启动时不读这个键（或读了不喂给选路）→ 勾选框未选中 / enabled 为假。
test("本地模式总开关: 启动读到 localEnabled:true → 勾选框选中，选路判据 enabled 为真", async () => {
  const app = await bootApp({
    config: { apiBase: CLOUD_BASE, apiKey: "test-key", localBase: LOCAL_BASE, localEnabled: true },
  });
  try {
    assert.strictEqual(app.els["local-enabled"].checked, true, "启动时应回填勾选状态");
    assert.strictEqual(api.localRouting.enabled, true, "api.js 的选路判据应收到 enabled:true");
    assert.strictEqual(app.App.local.routing().enabled, true);
  } finally {
    app.restore();
    resetRouting();
  }
});

// 默认关：配置里没有该键 → 勾选框未选中；即使实例就绪且清单命中也走云端。
// 什么使其变红：缺省当成"开"（或读不到时按 true 处理）→ 勾选框选中 / 端点走本地。
test("本地模式总开关: 默认关（配置里没有该键）→ 未选中，实例就绪且清单命中也走云端", async () => {
  const app = await bootApp({
    config: { apiBase: CLOUD_BASE, apiKey: "test-key", localBase: LOCAL_BASE },
    route: makeRoute(() => ({ status: 200, ok: true, data: { endpoints: CAPS_LIST } })),
  });
  try {
    assert.strictEqual(app.els["local-enabled"].checked, false, "总开关默认不该勾选");
    assert.strictEqual(api.localRouting.enabled, false, "默认不该把选路判据的 enabled 置真");

    await app.els["local-apply"].fire("click");

    // 只差总开关这一条：清单确实拉到了、也确实喂给了 api.js。
    assert.strictEqual(
      api.localRouting.store.has("GET", "/api/v2/voice/status/123"), true,
      "清单应已喂给 api.js（否则下面的断言没有意义）"
    );
    assert.strictEqual(
      api.resolveTarget("GET", "/api/v2/voice/status/123"), CLOUD_BASE,
      "总开关关 → 该端点必须走云端"
    );
  } finally {
    app.restore();
    resetRouting();
  }
});

// 开关开 + 实例就绪 + 清单命中 → 该端点走本地；不在清单里的端点仍走云端。
// 什么使其变红：enabled 没喂进选路（或开关状态没生效）→ 命中的端点仍走云端。
test("本地模式总开关: 开启 + 实例就绪 + 清单命中 → 命中的端点走本地，其余走云端", async () => {
  const app = await bootApp({
    config: { apiBase: CLOUD_BASE, apiKey: "test-key", localBase: LOCAL_BASE, localEnabled: true },
    route: makeRoute(() => ({ status: 200, ok: true, data: { endpoints: CAPS_LIST } })),
  });
  try {
    await app.els["local-apply"].fire("click");

    assert.strictEqual(api.localRouting.enabled, true);
    assert.strictEqual(
      api.resolveTarget("GET", "/api/v2/voice/status/123"), LOCAL_BASE,
      "清单命中的端点应走本地实例"
    );
    assert.strictEqual(
      api.resolveTarget("GET", "/api/v2/voice/other"), CLOUD_BASE,
      "清单外的端点仍走云端"
    );
  } finally {
    app.restore();
    resetRouting();
  }
});

// 运行时勾选 / 取消 → 立刻生效（不用重启）：选路判据的 enabled 跟着变。
// 什么使其变红：勾选后不把新状态喂给选路 → enabled 仍是旧值（关），
// 表现为「勾选框勾着、请求却还是走云端」。
test("本地模式总开关: 运行时勾选 / 取消 → 立刻生效，选路判据的 enabled 跟着变", async () => {
  const app = await bootApp({
    config: { apiBase: CLOUD_BASE, apiKey: "test-key", localBase: LOCAL_BASE },
  });
  try {
    assert.strictEqual(api.localRouting.enabled, false, "初始是关");

    app.els["local-enabled"].checked = true;
    await app.els["local-enabled"].fire("change");
    assert.strictEqual(api.localRouting.enabled, true, "勾选后应立刻生效");

    app.els["local-enabled"].checked = false;
    await app.els["local-enabled"].fire("change");
    assert.strictEqual(api.localRouting.enabled, false, "取消勾选后应立刻回到关");
  } finally {
    app.restore();
    resetRouting();
  }
});

// 实例就绪 → 自动拉一次端点能力清单（向本地实例拉），并喂给 api.js。
// 什么使其变红：实例就绪后不拉清单（拉了但没喂给 api.js）→ 没有那条请求 / store 缺席。
test("本地模式总开关: 实例就绪 → 自动拉一次端点能力清单并喂给 api.js", async () => {
  const app = await bootApp({
    config: { apiBase: CLOUD_BASE, apiKey: "test-key", localBase: LOCAL_BASE, localEnabled: true },
    route: makeRoute(() => ({ status: 200, ok: true, data: { endpoints: CAPS_LIST } })),
  });
  try {
    await app.els["local-apply"].fire("click");

    const pulls = app.calls.filter((c) => c.path === CAPS_PATH);
    assert.strictEqual(pulls.length, 1, "实例就绪后应自动拉一次清单");
    assert.strictEqual(pulls[0].method, "GET");
    assert.strictEqual(pulls[0].base, LOCAL_BASE, "清单要向本地实例拉");

    assert.ok(api.localRouting.store, "清单应喂给 api.js");
    assert.strictEqual(
      api.localRouting.store.has("GET", "/api/v2/voice/status/123"), true,
      "喂进去的清单应能按方法 + 路径模式命中"
    );
  } finally {
    app.restore();
    resetRouting();
  }
});

// 清单拉取失败 → 空清单 → 全走云端，**不报错**（状态行照旧，不抛异常）。
// 什么使其变红：拉取失败被当成错误抛出去（状态行变成失败文案 / 流程抛异常）。
test("本地模式总开关: 清单拉取失败 → 空清单 → 全走云端，不报错", async () => {
  const app = await bootApp({
    config: { apiBase: CLOUD_BASE, apiKey: "test-key", localBase: LOCAL_BASE, localEnabled: true },
    route: makeRoute(() => ({ status: 500, ok: false, data: { errMsg: "boom" } })),
  });
  try {
    await app.els["local-apply"].fire("click");

    // 失败不是错误：状态行照旧说就绪（实例本身是好的，只是清单没拉到）。
    assert.strictEqual(app.els["local-status"].textContent, "本地模式就绪", "清单拉不到不该影响状态行");
    assert.ok(api.localRouting.store, "清单对象仍在（只是表是空的）");
    assert.strictEqual(
      api.localRouting.store.has("GET", "/api/v2/voice/status/123"), false,
      "空清单 → 任何端点都不命中"
    );
    assert.strictEqual(
      api.resolveTarget("GET", "/api/v2/voice/status/123"), CLOUD_BASE,
      "空清单 → 全部走云端"
    );
  } finally {
    app.restore();
    resetRouting();
  }
});
