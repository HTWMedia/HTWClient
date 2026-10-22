const test = require("node:test");
const assert = require("node:assert");
const Local = require("./local.js");

test("probeHealth: ready", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true, version: "9.9.9-abc" } }),
  });
  assert.deepStrictEqual(r, { ok: true, state: "ready", message: "本地模式就绪", protocolVersion: null });
});

test("probeHealth: notPaired", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "local", state: "notPaired", credentialsUnlocked: false } }),
  });
  assert.deepStrictEqual(r, { ok: true, state: "notPaired", message: "本地实例未配对", protocolVersion: null });
});

test("probeHealth: pairedNotUnlocked", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "local", state: "pairedNotUnlocked", credentialsUnlocked: false } }),
  });
  assert.deepStrictEqual(r, { ok: true, state: "pairedNotUnlocked", message: "已配对，待解锁（本地实例重启后出现）", protocolVersion: null });
});

test("probeHealth: v2 信封包裹（PascalCase Data + 内层 state）", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({
      status: 200,
      ok: true,
      data: { Ok: true, Data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true, version: "1.2.3" } },
    }),
  });
  assert.deepStrictEqual(r, { ok: true, state: "ready", message: "本地模式就绪", protocolVersion: null });
});

test("probeHealth: mode:server → 该地址不是本地实例", async () => {
  const r = await Local.probeHealth("http://example.com", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "server", state: "ready" } }),
  });
  assert.deepStrictEqual(r, { ok: false, state: "server", message: "该地址不是本地实例" });
});

test("probeHealth: 连接拒绝 → unreachable", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => { throw new Error("ECONNREFUSED"); },
  });
  assert.deepStrictEqual(r, { ok: false, state: "unreachable", message: "无法连接本地实例，请先启动或检查地址。" });
});

// 实例回了错误（5xx）与连不上是两种症状，文案必须能区分开：
// 前者是实例内部出错，后者是实例没起来。
test("probeHealth: 实例回 500 → serverError（与 unreachable 区分）", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 500, ok: false, data: { errCode: 500, errMsg: "内部错误" } }),
  });
  assert.deepStrictEqual(r, { ok: false, state: "serverError", message: "本地实例返回错误，请检查本地实例状态。" });
});

test("probeHealth: 传输层把 HTTP 错误抛出来（带 httpStatus）→ serverError", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => { const e = new Error("HTTP 500"); e.httpStatus = 500; throw e; },
  });
  assert.deepStrictEqual(r, { ok: false, state: "serverError", message: "本地实例返回错误，请检查本地实例状态。" });
});

test("probeHealth: 请求根本没发出去（status 0）→ unreachable", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 0, ok: false, data: { errCode: 0, errMsg: "invalid url" } }),
  });
  assert.deepStrictEqual(r, { ok: false, state: "unreachable", message: "无法连接本地实例，请先启动或检查地址。" });
});

test("probeHealth: 非法响应（data 无 state）→ invalid", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "local" } }),
  });
  assert.deepStrictEqual(r, { ok: false, state: "invalid", message: "本地实例响应不可识别。" });
});

test("probeHealth: state 非字符串 → invalid", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "local", state: 3 } }),
  });
  assert.deepStrictEqual(r, { ok: false, state: "invalid", message: "本地实例响应不可识别。" });
});

// ---- 协议版本握手 ----
//
// protocolVersion 是客户端与本地实例之间的**机器判据**
// （响应里那个给人看的 version 字段不是判据 —— 桌面端与实例没有公共版本刻度）。
// 读不到时必须是 null：**不猜、不当 0**（0 会被当成"有个很老的协议"，那是断言）。

// 什么使其变红：probeHealth 不带出 protocolVersion（或把它当 0 / 当 1 填默认值）。
test("probeHealth: 响应带 protocolVersion → 返回该版本号", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({
      status: 200,
      ok: true,
      data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true, protocolVersion: 1 },
    }),
  });
  assert.strictEqual(r.protocolVersion, 1);
});

// 什么使其变红：缺字段时返回 undefined / 0 / 1（等于替老实例编了一个版本）。
test("probeHealth: 响应不带 protocolVersion → 返回 null（不是 0、不是 1）", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({
      status: 200,
      ok: true,
      data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true },
    }),
  });
  assert.strictEqual(r.protocolVersion, null);
  assert.notStrictEqual(r.protocolVersion, 0);
  assert.notStrictEqual(r.protocolVersion, 1);
});

// 大小写双兼容：服务器既可能回 protocolVersion，也可能回 ProtocolVersion。
// 什么使其变红：只读小写（PascalCase 字段读不到 → 版本被当成 null，握手形同虚设）。
test("probeHealth: protocolVersion 大小写双兼容（ProtocolVersion 也认）", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({
      status: 200,
      ok: true,
      data: { Ok: true, Data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true, ProtocolVersion: 1 } },
    }),
  });
  assert.strictEqual(r.protocolVersion, 1);
});

// 类型不对（字符串 / 布尔）一律当"不知道"，不当版本号用 —— 更不能当 0。
// 什么使其变红：非数字被原样透出（客户端拿字符串去比大小，等于没比）。
test("probeHealth: protocolVersion 不是数字 → 当作 null（不猜）", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({
      status: 200,
      ok: true,
      data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true, protocolVersion: "1" },
    }),
  });
  assert.strictEqual(r.protocolVersion, null);
});

// 客户端钉住自己支持的协议版本（与服务器 LocalProtocol.Version 对齐 = 1）。
// 什么使其变红：常量缺失 / 值不是 1（桌面端与实例就没有公共刻度了）。
test("SUPPORTED_PROTOCOL_VERSION: 客户端钉住支持的协议版本", () => {
  assert.strictEqual(Local.SUPPORTED_PROTOCOL_VERSION, 1);
});

test("STATE_TEXT / MODE_TEXT 机器契约映射", () => {
  assert.deepStrictEqual(Local.STATE_TEXT, {
    notPaired: "本地实例未配对",
    pairedNotUnlocked: "已配对，待解锁（本地实例重启后出现）",
    ready: "本地模式就绪",
  });
  assert.deepStrictEqual(Local.MODE_TEXT, { server: "该地址不是本地实例" });
});

// ---- 本地实例地址的归一化与准入 ----
//
// 这三条是硬的：配对请求会把 AuthKey + 账号级 KEK 材料发往这个地址。

test("normalizeLocalBase: 合法回环根地址通过", () => {
  assert.deepStrictEqual(Local.normalizeLocalBase("http://127.0.0.1:51111"),
    { ok: true, base: "http://127.0.0.1:51111" });
  assert.deepStrictEqual(Local.normalizeLocalBase("http://localhost:51111"),
    { ok: true, base: "http://localhost:51111" });
  assert.deepStrictEqual(Local.normalizeLocalBase("http://[::1]:51111"),
    { ok: true, base: "http://[::1]:51111" });
  assert.deepStrictEqual(Local.normalizeLocalBase("https://127.0.0.1"),
    { ok: true, base: "https://127.0.0.1" });
});

test("normalizeLocalBase: 127.0.0.0/8 整段都是回环", () => {
  assert.deepStrictEqual(Local.normalizeLocalBase("http://127.5.5.5:51111"),
    { ok: true, base: "http://127.5.5.5:51111" });
  assert.deepStrictEqual(Local.normalizeLocalBase("http://127.255.255.255"),
    { ok: true, base: "http://127.255.255.255" });
});

test("normalizeLocalBase: 结尾斜杠归一化掉（preload 是 base + path 直接拼的）", () => {
  // 尾斜杠不归一就会拼出 "//api/v2/local/health" → 404。
  const r = Local.normalizeLocalBase("http://127.0.0.1:51111/");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.base, "http://127.0.0.1:51111");
  assert.ok(!r.base.endsWith("/"), "归一化后不带结尾斜杠");

  // 多个尾斜杠同样归一化掉。
  const many = Local.normalizeLocalBase("http://127.0.0.1:51111///");
  assert.strictEqual(many.base, "http://127.0.0.1:51111");
});

test("normalizeLocalBase: FQDN 尾点形态归一化（localhost. → localhost）", () => {
  const r = Local.normalizeLocalBase("http://localhost.:51111/");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.base, "http://localhost:51111");
});

test("normalizeLocalBase: 带路径的地址拒绝（根地址口径）", () => {
  // 注意："http://127.0.0.1:51111/" 的 pathname 仍是 "/"，它是**根地址**，
  // 只是多了个尾斜杠 —— 那是归一化的事，不是拒绝的事。
  for (const url of ["http://127.0.0.1:51111/api", "http://127.0.0.1:51111/?a=1", "http://127.0.0.1:51111#f", "http://127.0.0.1:51111/x/y"]) {
    const r = Local.normalizeLocalBase(url);
    assert.strictEqual(r.ok, false, url + " 不该通过");
    assert.strictEqual(r.reason, "notRoot");
    assert.strictEqual(r.message, "本地实例地址必须是根地址（不允许带路径）。");
  }
});

test("normalizeLocalBase: 非回环地址拒绝（材料不能寄到第三方）", () => {
  for (const url of ["http://example.com", "http://example.com:51111", "http://192.168.1.10:51111", "http://10.0.0.1", "http://0.0.0.0:51111", "http://128.0.0.1"]) {
    const r = Local.normalizeLocalBase(url);
    assert.strictEqual(r.ok, false, url + " 不该通过");
    assert.strictEqual(r.reason, "notLoopback");
    assert.strictEqual(r.message, "本地实例地址必须是本机回环地址。");
  }
});

test("normalizeLocalBase: 格式非法拒绝（漏写 http:// 也要说清）", () => {
  for (const url of ["127.0.0.1:51111", "localhost:51111", "not a url", "ftp://127.0.0.1", "htp://127.0.0.1"]) {
    const r = Local.normalizeLocalBase(url);
    assert.strictEqual(r.ok, false, url + " 不该通过");
    assert.strictEqual(r.reason, "format");
    assert.strictEqual(r.message, "地址格式无效，请以 http:// 开头填写。");
  }
});

test("normalizeLocalBase: 空地址 = 关闭本地模式（不算错）", () => {
  assert.deepStrictEqual(Local.normalizeLocalBase(""), { ok: true, base: "", empty: true });
  assert.deepStrictEqual(Local.normalizeLocalBase("   "), { ok: true, base: "", empty: true });
  assert.deepStrictEqual(Local.normalizeLocalBase(null), { ok: true, base: "", empty: true });
});

test("normalizeLocalBase: 非字符串输入按格式非法处理", () => {
  assert.strictEqual(Local.normalizeLocalBase(123).ok, false);
  assert.strictEqual(Local.normalizeLocalBase({}).ok, false);
});

test("LOCAL_BASE_TEXTS 文案单一出处", () => {
  assert.deepStrictEqual(Local.LOCAL_BASE_TEXTS, {
    format: "地址格式无效，请以 http:// 开头填写。",
    notRoot: "本地实例地址必须是根地址（不允许带路径）。",
    notLoopback: "本地实例地址必须是本机回环地址。",
  });
});

// ---- 配对协议模块 ----

test("validateServerUrl: 合法 https 根地址通过", () => {
  assert.deepStrictEqual(Local.validateServerUrl("https://api.example.com"), { ok: true });
});

test("validateServerUrl: 非 https 拒绝", () => {
  const r = Local.validateServerUrl("http://api.example.com");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "serverUrl");
  assert.strictEqual(r.message, "服务地址必须是 https 根地址。");
});

test("validateServerUrl: 解析失败 → 格式无效", () => {
  const r = Local.validateServerUrl("not a url");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "serverUrl");
  assert.strictEqual(r.message, "服务地址格式无效。");
});

test("validateServerUrl: 带路径前缀 → 必须根地址", () => {
  const r = Local.validateServerUrl("https://h.x/api");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "serverUrl");
  assert.strictEqual(r.message, "服务地址必须是根地址（不允许带路径）。");
});

test("validateServerUrl: 本机回环地址拒绝", () => {
  for (const url of ["https://127.0.0.1", "https://localhost", "https://[::1]"]) {
    const r = Local.validateServerUrl(url);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "serverUrl");
    assert.strictEqual(r.message, "服务地址不能是本机回环地址。");
  }
});

test("validateServerUrl: 回环地址的 FQDN 尾点形态同样拒绝", () => {
  for (const url of ["https://localhost.", "https://127.0.0.1."]) {
    const r = Local.validateServerUrl(url);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "serverUrl");
    assert.strictEqual(r.message, "服务地址不能是本机回环地址。");
  }
});

test("validateServerUrl: 空/非字符串地址 → 格式无效", () => {
  for (const url of ["", null, undefined, 123, {}, ["https://api.example.com"]]) {
    const r = Local.validateServerUrl(url);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "serverUrl");
    assert.strictEqual(r.message, "服务地址格式无效。");
  }
});

test("validateServerUrl: 带 query 或 hash 的根地址 → 必须是根地址", () => {
  for (const url of ["https://api.example.com?a=1", "https://api.example.com#f", "https://api.example.com/?a=1"]) {
    const r = Local.validateServerUrl(url);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "serverUrl");
    assert.strictEqual(r.message, "服务地址必须是根地址（不允许带路径）。");
  }
});

test("pairFlow: happy path", async () => {
  const bodies = [];
  let pairCount = 0;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } }),
    pair: async (b) => { bodies.push(b); pairCount++;
      return pairCount === 1
        ? { ok: true, data: { keyId: "aid-1" } }
        : { ok: true, data: { keyId: "aid-1" } };
    },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stage, "pair");
  assert.strictEqual(r.keyId, "aid-1");
  assert.strictEqual(bodies.length, 1);
  assert.strictEqual(bodies[0].AuthorizeWith, "k1");           // 恒带（含首配对）
  assert.strictEqual(bodies[0].ServerUrl, "https://api.example.com");
  assert.strictEqual(bodies[0].Account, "a@x.com");
  assert.strictEqual(bodies[0].AuthKey, "k1");
  assert.strictEqual(bodies[0].KeyMaterial, "AAAABBBBCCCCDDDD");
});

test("pairFlow: 账号以 enroll 响应回带值为准（调用方未传 account）", async () => {
  const bodies = [];
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "en@x.com" } }),
    pair: async (b) => { bodies.push(b); return { ok: true, data: { keyId: "aid-1" } }; },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(bodies[0].Account, "en@x.com");
});

test("pairFlow: enroll 注入只收 key（不把账号塞进 enroll）", async () => {
  let seen = null;
  let argCount = -1;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async function () { seen = arguments[0]; argCount = arguments.length; return { ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "a@x.com" } }; },
    pair: async () => ({ ok: true, data: { keyId: "aid-1" } }),
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(seen, "k1");
  assert.strictEqual(argCount, 1);
});

test("pairFlow: 账号与服务器登记不一致 → 响亮失败，不进入 pair", async () => {
  let pairCount = 0;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "other@x.com" } }),
    pair: async () => { pairCount++; return { ok: true, data: { keyId: "aid-1" } }; },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "enroll");
  assert.strictEqual(r.reason, "accountMismatch");
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.message, "账号与服务器登记不一致，请重新登录后再试。");
  assert.strictEqual(pairCount, 0);
});

test("pairFlow: keyId 不一致 响亮失败 不继续", async () => {
  let pairedAfter = 0;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "a@x.com" } }),
    pair: async () => { pairedAfter++; return { ok: true, data: { keyId: "aid-OTHER" } }; },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "pair");
  assert.strictEqual(r.reason, "keyIdMismatch");
  assert.strictEqual(r.message, "配对材料与服务端登记不一致，请先重新登记材料。");
  assert.strictEqual(pairedAfter, 1);
});

test("pairFlow: enroll 响应无账号 → enroll 阶段 NO_ACCOUNT，不发 pair", async () => {
  let pairCount = 0;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1" } }),
    pair: async () => { pairCount++; return { ok: true, data: { keyId: "aid-1" } }; },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "enroll");
  assert.strictEqual(r.code, "NO_ACCOUNT");
  assert.strictEqual(pairCount, 0);
});

test("pairFlow: 空 account（enroll 响应无账号）→ enroll 阶段 NO_ACCOUNT，不发 pair", async () => {
  let pairCount = 0;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1" } }),
    pair: async () => { pairCount++; return { ok: true, data: { keyId: "aid-1" } }; },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "enroll");
  assert.strictEqual(r.code, "NO_ACCOUNT");
  assert.strictEqual(r.message, "未取得账号，无法配对。");
  assert.strictEqual(pairCount, 0);
});

test("pairFlow: enroll 响应缺 keyMaterial/keyId → enroll 阶段 BAD_ENROLL，不发 pair", async () => {
  const shapes = [
    { ok: true },
    { ok: true, data: null },
    { ok: true, data: { keyId: "aid-1", account: "a@x.com" } },
    { ok: true, data: { keyMaterial: "AAAA====", account: "a@x.com" } },
    { ok: true, data: { keyMaterial: "", keyId: "", account: "a@x.com" } },
  ];
  for (const shape of shapes) {
    let pairCount = 0;
    const r = await Local.pairFlow({
      apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
      enroll: async () => shape,
      pair: async () => { pairCount++; return { ok: true, data: { keyId: "aid-1" } }; },
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.stage, "enroll");
    assert.strictEqual(r.code, "BAD_ENROLL");
    assert.strictEqual(pairCount, 0);
  }
});

test("pairFlow: enroll 非 ok → 原样透传 code/message，不进入 pair", async () => {
  let pairCount = 0;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: false, code: 500, message: "服务器错误" }),
    pair: async () => { pairCount++; return { ok: true, data: { keyId: "aid-1" } }; },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "enroll");
  assert.strictEqual(r.code, 500);
  assert.strictEqual(r.message, "服务器错误");
  assert.strictEqual(pairCount, 0);
});

test("pairFlow: 失败结果的 stage/ok 由流程强制覆盖（不被源对象带偏）", async () => {
  const rEnroll = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: false, stage: "bogus", code: 500, message: "服务器错误" }),
    pair: async () => ({ ok: true, data: { keyId: "aid-1" } }),
  });
  assert.strictEqual(rEnroll.ok, false);
  assert.strictEqual(rEnroll.stage, "enroll");
  assert.strictEqual(rEnroll.code, 500);

  const rPair = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "a@x.com" } }),
    pair: async () => ({ ok: false, stage: "bogus", code: 403, message: "本进程不是本地实例，不接受配对。" }),
  });
  assert.strictEqual(rPair.ok, false);
  assert.strictEqual(rPair.stage, "pair");
  assert.strictEqual(rPair.code, 403);
});

test("pairFlow: pair 403 字面量壳逐字透传", async () => {
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "a@x.com" } }),
    pair: async () => ({ ok: false, code: 403, message: "本进程不是本地实例，不接受配对。" }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "pair");
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.message, "本进程不是本地实例，不接受配对。");
});

test("pairFlow: pair 401 字面量壳逐字透传（重配对出示 AuthKey）", async () => {
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "a@x.com" } }),
    pair: async () => ({ ok: false, code: 401, message: "重新配对需要出示当前 AuthKey" }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "pair");
  assert.strictEqual(r.code, 401);
  assert.strictEqual(r.message, "重新配对需要出示当前 AuthKey");
});

test("pairFlow: 端到端 —— 小写壳原始载荷经 api.normalize 后喂给 pairFlow，403 文案逐字透传", async () => {
  const api = require("./api.js");
  // 服务器 pair 失败时的字面量小写壳（未归一化的线上形状）。
  const rawPair = { status: 403, ok: false, data: { errCode: 403, errMsg: "本进程不是本地实例，不接受配对。" } };
  const normalizedPair = api.normalize(rawPair);
  assert.strictEqual(normalizedPair.ok, false);
  assert.strictEqual(normalizedPair.code, 403);
  assert.strictEqual(normalizedPair.message, "本进程不是本地实例，不接受配对。");

  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "a@x.com" } }),
    pair: async () => normalizedPair,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "pair");
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.message, "本进程不是本地实例，不接受配对。");
});

test("pairFlow: 端到端 —— enroll 成功经 api.normalize（v2 外壳 PascalCase + 内层小写）后账号取自回带值", async () => {
  const api = require("./api.js");
  // 服务器侧 LocalEnrollController 的**真实 wire 形状**：外层是 v2 信封
  // （PascalCase 的 Ok / Data），**内层字段是小写** { keyMaterial, keyId, account }。
  // 夹具照抄真实形状 —— 照抄来的那一份才是能被回归钉住的形状。
  const rawEnroll = {
    status: 200,
    ok: true,
    data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "srv@x.com" } },
  };
  const normalizedEnroll = api.normalize(rawEnroll);
  assert.strictEqual(normalizedEnroll.ok, true);
  assert.strictEqual(normalizedEnroll.data.account, "srv@x.com");

  const bodies = [];
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1",
    enroll: async () => normalizedEnroll,
    pair: async (b) => { bodies.push(b); return { ok: true, data: { keyId: "aid-1" } }; },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stage, "pair");
  assert.strictEqual(r.keyId, "aid-1");
  assert.strictEqual(bodies[0].Account, "srv@x.com");
  assert.strictEqual(bodies[0].KeyMaterial, "AAAABBBBCCCCDDDD");
});

test("pairFlow: 双外壳形状等价（PascalCase enroll 失败 = 小写壳 pair 失败 经 api.normalize）", async () => {
  const api = require("./api.js");
  const enrollShell = api.normalize({ status: 200, ok: true, data: { Ok: false, ErrCode: 401, ErrMsg: "未认证" } });
  const pairShell = api.normalize({ status: 401, ok: false, data: { errCode: 401, errMsg: "未认证" } });
  assert.strictEqual(enrollShell.ok, false);
  assert.strictEqual(enrollShell.code, 401);
  assert.strictEqual(enrollShell.message, "未认证");
  assert.strictEqual(pairShell.ok, false);
  assert.strictEqual(pairShell.code, 401);
  assert.strictEqual(pairShell.message, "未认证");

  const common = {
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
  };
  const rEnroll = await Local.pairFlow(Object.assign({}, common, {
    enroll: async () => enrollShell,
    pair: async () => ({ ok: true, data: { keyId: "aid-1" } }),
  }));
  assert.strictEqual(rEnroll.ok, false);
  assert.strictEqual(rEnroll.stage, "enroll");
  assert.strictEqual(rEnroll.code, 401);
  assert.strictEqual(rEnroll.message, "未认证");

  const rPair = await Local.pairFlow(Object.assign({}, common, {
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "a@x.com" } }),
    pair: async () => pairShell,
  }));
  assert.strictEqual(rPair.ok, false);
  assert.strictEqual(rPair.stage, "pair");
  assert.strictEqual(rPair.code, 401);
  assert.strictEqual(rPair.message, "未认证");
});
