const test = require("node:test");
const assert = require("node:assert");
const api = require("./api.js");

test("normalize: V2 ok=true", () => {
  const r = api.normalize({ ok: true, data: { ok: true, data: { x: 1 }, taskId: "T1" } });
  assert.deepStrictEqual(r, { ok: true, data: { x: 1 }, taskId: "T1" });
});

test("normalize: V2 ok=false", () => {
  const r = api.normalize({ ok: true, data: { ok: false, errCode: "E1", errMsg: "bad" } });
  assert.deepStrictEqual(r, { ok: false, code: "E1", message: "bad", raw: { ok: false, errCode: "E1", errMsg: "bad" } });
});

test("normalize: HTTP non-2xx with envelope", () => {
  const r = api.normalize({ ok: false, status: 400, data: { errCode: "E2", errMsg: "nope" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "E2");
  assert.strictEqual(r.message, "nope");
});

test("normalize: HTTP non-2xx without envelope", () => {
  const r = api.normalize({ ok: false, status: 500, data: "oops" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 500);
  assert.strictEqual(r.message, "HTTP 500");
});

test("normalize: plain ok (no envelope)", () => {
  const r = api.normalize({ ok: true, status: 200, data: { foo: "bar" } });
  assert.deepStrictEqual(r, { ok: true, data: { foo: "bar" }, taskId: null });
});

// 402 = 免费额度用尽，后端会带 redirectUrl。它是账号级状态，因此不在各面板的错误文案里
// 处理（那里有几十处调用），而是由 normalize 统一回调给 app.js 弹全局横幅。
test("normalize: 402 triggers quota handler with redirectUrl", () => {
  const seen = [];
  api.onQuotaExceeded((info) => seen.push(info));

  api.normalize({ ok: false, status: 402, data: { success: false, error: "免费次数已用完", redirectUrl: "/Home/Recharge" } });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].redirectUrl, "/Home/Recharge");

  // 非 402 不该触发
  api.normalize({ ok: false, status: 401, data: { errMsg: "unauthorized" } });
  assert.strictEqual(seen.length, 1);

  // 后端没带 redirectUrl 时用默认充值页
  api.normalize({ ok: false, status: 402, data: { error: "quota" } });
  assert.strictEqual(seen[1].redirectUrl, "/Home/Recharge");

  api.onQuotaExceeded(null);
});

test("pollTask: progresses then done", async () => {
  let n = 0;
  const fetcher = async () => {
    n++;
    if (n < 3) return { ok: true, data: { status: "processing" } };
    return { ok: true, data: { status: "done", result: { out: 42 } } };
  };
  const r = await api.pollTask("id", { fetcher, interval: 1, timeout: 1000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.done, true);
  assert.deepStrictEqual(r.data, { out: 42 });
});

test("pollTask: failed task", async () => {
  const fetcher = async () => ({ ok: true, data: { status: "failed", errCode: "F1", errMsg: "died" } });
  const r = await api.pollTask("id", { fetcher, interval: 1, timeout: 1000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "F1");
  assert.strictEqual(r.message, "died");
});

test("pollTask: fetcher throws (network)", async () => {
  const fetcher = async () => { throw new Error("boom"); };
  const r = await api.pollTask("id", { fetcher, interval: 1, timeout: 1000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "NETWORK");
  assert.strictEqual(r.message, "boom");
});

test("pollTask: timeout", async () => {
  const fetcher = async () => ({ ok: true, data: { status: "processing" } });
  const r = await api.pollTask("id", { fetcher, interval: 5, timeout: 40 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "TIMEOUT");
});
