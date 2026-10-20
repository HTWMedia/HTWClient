const test = require("node:test");
const assert = require("node:assert");
const Local = require("./local.js");

test("probeHealth: ready", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true, version: "9.9.9-abc" } }),
  });
  assert.deepStrictEqual(r, { ok: true, state: "ready", message: "本地模式就绪" });
});

test("probeHealth: notPaired", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "local", state: "notPaired", credentialsUnlocked: false } }),
  });
  assert.deepStrictEqual(r, { ok: true, state: "notPaired", message: "本地实例未配对" });
});

test("probeHealth: pairedNotUnlocked", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({ status: 200, ok: true, data: { ok: true, mode: "local", state: "pairedNotUnlocked", credentialsUnlocked: false } }),
  });
  assert.deepStrictEqual(r, { ok: true, state: "pairedNotUnlocked", message: "已配对，待解锁（本地实例重启后出现）" });
});

test("probeHealth: v2 信封包裹（PascalCase Data + 内层 state）", async () => {
  const r = await Local.probeHealth("http://127.0.0.1:51111", {
    call: async () => ({
      status: 200,
      ok: true,
      data: { Ok: true, Data: { ok: true, mode: "local", state: "ready", credentialsUnlocked: true, version: "1.2.3" } },
    }),
  });
  assert.deepStrictEqual(r, { ok: true, state: "ready", message: "本地模式就绪" });
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

test("STATE_TEXT / MODE_TEXT 机器契约映射", () => {
  assert.deepStrictEqual(Local.STATE_TEXT, {
    notPaired: "本地实例未配对",
    pairedNotUnlocked: "已配对，待解锁（本地实例重启后出现）",
    ready: "本地模式就绪",
  });
  assert.deepStrictEqual(Local.MODE_TEXT, { server: "该地址不是本地实例" });
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

test("pairFlow: happy path", async () => {
  const bodies = [];
  let pairCount = 0;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1" } }),
    pair: async (b) => { bodies.push(b); pairCount++;
      return pairCount === 1
        ? { ok: true, data: { keyId: "aid-1" } }
        : { ok: true, data: { keyId: "aid-1" } };
    },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(bodies.length, 1);
  assert.strictEqual(bodies[0].AuthorizeWith, "k1");           // 恒带（含首配对）
  assert.strictEqual(bodies[0].ServerUrl, "https://api.example.com");
  assert.strictEqual(bodies[0].Account, "a@x.com");
  assert.strictEqual(bodies[0].AuthKey, "k1");
  assert.strictEqual(bodies[0].KeyMaterial, "AAAABBBBCCCCDDDD");
});

test("pairFlow: 未传 account 时从 enroll Data.account 取", async () => {
  const bodies = [];
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1", account: "en@x.com" } }),
    pair: async (b) => { bodies.push(b); return { ok: true, data: { keyId: "aid-1" } }; },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(bodies[0].Account, "en@x.com");
});

test("pairFlow: keyId 不一致 响亮失败 不继续", async () => {
  let pairedAfter = 0;
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1" } }),
    pair: async () => { pairedAfter++; return { ok: true, data: { keyId: "aid-OTHER" } }; },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "keyIdMismatch");
  assert.strictEqual(r.message, "配对材料与服务端登记不一致，请先重新登记材料。");
  assert.strictEqual(pairedAfter, 1);
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

test("pairFlow: pair 403 字面量壳逐字透传", async () => {
  const r = await Local.pairFlow({
    apiBase: "https://api.example.com", localBase: "http://127.0.0.1:51111", key: "k1", account: "a@x.com",
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1" } }),
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
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1" } }),
    pair: async () => ({ ok: false, code: 401, message: "重新配对需要出示当前 AuthKey" }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, "pair");
  assert.strictEqual(r.code, 401);
  assert.strictEqual(r.message, "重新配对需要出示当前 AuthKey");
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
    enroll: async () => ({ ok: true, data: { keyMaterial: "AAAA====", keyId: "aid-1" } }),
    pair: async () => pairShell,
  }));
  assert.strictEqual(rPair.ok, false);
  assert.strictEqual(rPair.stage, "pair");
  assert.strictEqual(rPair.code, 401);
  assert.strictEqual(rPair.message, "未认证");
});
