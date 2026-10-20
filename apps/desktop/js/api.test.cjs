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

// 线上形状钉子（Task 3 对齐）：
// - enroll 走 v2 信封：HTTP 200 + 外层 Ok/Data（PascalCase），成功 Data={ KeyMaterial, KeyId, Account }。
// - pair 失败是小写 errCode/errMsg 字面量壳（HTTP 403/401 等非 2xx），errMsg 必须逐字透传不改写。
test("normalize: enroll 成功 v2 PascalCase 双外壳（KeyMaterial/KeyId/Account）", () => {
  const r = api.normalize({
    ok: true,
    data: { Ok: true, Data: { KeyMaterial: "AAAABBBBCCCCDDDD", KeyId: "aid-1", Account: "a@x.com" } },
  });
  assert.deepStrictEqual(r, {
    ok: true,
    data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" },
    taskId: null,
  });
});

test("normalize: 双外壳形状等价（PascalCase ErrCode/ErrMsg = 小写 errCode/errMsg）", () => {
  const pascal = api.normalize({ ok: true, data: { Ok: false, ErrCode: "E1", ErrMsg: "bad" } });
  const lower = api.normalize({ ok: true, data: { ok: false, errCode: "E1", errMsg: "bad" } });
  assert.strictEqual(pascal.ok, false);
  assert.strictEqual(pascal.code, "E1");
  assert.strictEqual(pascal.message, "bad");
  assert.strictEqual(lower.ok, false);
  assert.strictEqual(lower.code, "E1");
  assert.strictEqual(lower.message, "bad");
});

test("normalize: pair 403 失败小写字面量壳逐字透传", () => {
  const r = api.normalize({ ok: false, status: 403, data: { errCode: 403, errMsg: "本进程不是本地实例，不接受配对。" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.message, "本进程不是本地实例，不接受配对。");
});

test("normalize: pair 401 失败小写字面量壳逐字透传", () => {
  const r = api.normalize({ ok: false, status: 401, data: { errCode: 401, errMsg: "重新配对需要出示当前 AuthKey" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 401);
  assert.strictEqual(r.message, "重新配对需要出示当前 AuthKey");
});

test("setLocalBase: 登记 preload 并生效 localBase getter", () => {
  const reg = [];
  global.window = Object.assign(global.window || {}, {
    htw: { apiBase: "", directBase: "", registerBase: (b) => reg.push(b) },
  });
  delete require.cache[require.resolve("./api.js")];
  const localApi = require("./api.js");
  localApi.setLocalBase("http://127.0.0.1:51123");
  assert.strictEqual(localApi.localBase, "http://127.0.0.1:51123");
  assert.ok(reg.includes("http://127.0.0.1:51123"));
  // 单出口：localBase 请求图层拒绝网络失败时返回统一形状
});

// 4007 = 本地执行不可用（服务器侧机器契约）。客户端只显示这句中性文案，
// 不把内部细节（额度确认之类）透给用户。
test("normalize: ErrCode 4007 → localUnavailable 文案", () => {
  const r = api.normalize({
    ok: true,
    data: { Ok: false, ErrCode: 4007, ErrMsg: "本地执行不可用：无法确认额度，请检查网络或服务器状态。" },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 4007);
  assert.strictEqual(r.localUnavailable, true);
  assert.strictEqual(r.message, "本地执行不可用，请检查网络或服务器状态。");
});

// 换掉全局 window 跑一枚 api.js 的新实例；跑完必须还原，
// 否则这枚 window 会漏给后面的用例（断言中途失败时最明显）。
async function withStubWindow(win, fn) {
  const prevWindow = global.window;
  global.window = win;
  delete require.cache[require.resolve("./api.js")];
  try {
    return await fn(require("./api.js"));
  } finally {
    global.window = prevWindow;
  }
}

function stubWindow(callImpl) {
  return {
    htw: {
      apiBase: "https://htwmedia.dpdns.org",
      localBase: "http://127.0.0.1:51111",
      registerBase: () => {},
      call: callImpl,
    },
  };
}

test("call: 本地基地址网络失败 → 同一出口文案", async () => {
  await withStubWindow(stubWindow(async () => { throw new TypeError("fetch failed"); }), async (localApi) => {
    localApi.setKey("test-key");

    const r = await localApi.call("POST", "/api/v2/agent/start", {}, localApi.localBase);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.localUnavailable, true);
    assert.strictEqual(r.message, "本地执行不可用，请检查网络或服务器状态。");

    // 其它基地址的失败原样抛出去，不被本地模式这条出口吞掉。
    await assert.rejects(
      () => localApi.call("POST", "/api/v2/agent/start", {}, "https://other.example.com"),
      /fetch failed/
    );
  });
});

// M1：只有网络类失败才算"本地执行不可用"。
// 别的异常（代码错误、鉴权错误）原样抛出去 —— 吞掉的话真正的错误就被一句
// "本地执行不可用"盖住了，用户既看不到原因，也没法自己绕开。
test("call: 本地基地址的连接被拒（ECONNREFUSED）→ 同一出口文案", async () => {
  await withStubWindow(stubWindow(async () => { throw new Error("ECONNREFUSED"); }), async (localApi) => {
    localApi.setKey("test-key");
    const r = await localApi.call("POST", "/api/local/pair", {}, localApi.localBase);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.localUnavailable, true);
    assert.strictEqual(r.message, "本地执行不可用，请检查网络或服务器状态。");
  });
});

test("call: 本地基地址的非网络异常原样抛出，不伪装成本地不可用", async () => {
  await withStubWindow(stubWindow(async () => { throw new Error("boom"); }), async (localApi) => {
    localApi.setKey("test-key");
    await assert.rejects(
      () => localApi.call("POST", "/api/local/pair", {}, localApi.localBase),
      /boom/
    );
  });
});

// ---- 失败壳判定（无 ok/Ok 字段的 {errCode, errMsg}） ----
//
// 本地实例的 pair 失败壳就是这个形状：只有 errCode/errMsg，没有 ok/Ok。
// 不判它的话 normalize 会落到末尾的 return { ok:true }，把失败当成功，
// 界面上就成了"配对成功"。
test("normalize: HTTP 200 + 无 ok 字段的失败壳 → 判失败（本地实例 pair 失败壳）", () => {
  const r = api.normalize({
    ok: true,
    status: 200,
    data: { errCode: 403, errMsg: "本进程不是本地实例，不接受配对。" },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.message, "本进程不是本地实例，不接受配对。");
});

test("normalize: 无 ok 字段的失败壳 PascalCase 变体（ErrCode/ErrMsg）同样判失败", () => {
  const r = api.normalize({
    ok: true,
    status: 200,
    data: { ErrCode: 403, ErrMsg: "本进程不是本地实例，不接受配对。" },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.message, "本进程不是本地实例，不接受配对。");
});

// 回归面：有 ok/Ok 字段时以它为准，errCode 不参与判定。
test("normalize: 有 ok 字段时以 ok 为准（errCode 不改变判定）", () => {
  const r = api.normalize({
    ok: true,
    status: 200,
    data: { ok: true, errCode: 0, errMsg: null, data: { x: 1 } },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data, { x: 1 });
});

// 回归面：errCode 出现在内层 Data 里（不是顶层失败壳）时仍是成功。
test("normalize: errCode 落在内层 Data 里不算失败壳", () => {
  const r = api.normalize({
    ok: true,
    status: 200,
    data: { ok: true, data: { errCode: 500, errMsg: "某个子项字段" } },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data, { errCode: 500, errMsg: "某个子项字段" });
});

// 回归面：HTTP 非 2xx 的判定面原样保留（壳里只有 errCode 时仍回 HTTP 状态文案）。
test("normalize: HTTP 403 且壳里只有 errCode → 仍回 HTTP 403 文案", () => {
  const r = api.normalize({ ok: false, status: 403, data: { errCode: 403 } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.message, "HTTP 403");
});
