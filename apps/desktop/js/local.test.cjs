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
