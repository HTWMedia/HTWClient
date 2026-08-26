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
