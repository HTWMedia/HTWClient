const test = require("node:test");
const assert = require("node:assert");
const api = require("./api.js");
// 本地模式模块：地址准入的**唯一**口径在这里（去尾斜杠 + 拒绝带路径 + 强制回环）。
// 模块缺席时准入闸门 fail-closed（见下面那条用例），所以要测「放行」的用例
// 必须把模块装上 —— 装的是真模块，不是另造一份规则。
const Local = require("./local.js");

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
// - enroll 走 v2 信封：HTTP 200 + 外层 Ok/Data（PascalCase），内层 Data={ keyMaterial, keyId, account }。
//   ⚠️ 内层是**小写** —— 服务器侧 LocalEnrollController 返回的就是小写，
//   夹具必须照抄真实形状，照抄来的那一份才是能被回归钉住的那一份。
// - pair 失败是小写 errCode/errMsg 字面量壳（HTTP 403/401 等非 2xx），errMsg 必须逐字透传不改写。
test("normalize: enroll 成功 v2 外壳（PascalCase）+ 内层小写（keyMaterial/keyId/account）", () => {
  const r = api.normalize({
    ok: true,
    data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } },
  });
  assert.deepStrictEqual(r, {
    ok: true,
    data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" },
    taskId: null,
  });
});

// 🔴 形状钉子必须**不经 camelize**：上一条断言走的是 normalize 的输出，
// 而输出的键名已经被 camelize 统一成小写开头 —— 于是夹具改成 PascalCase
// （KeyMaterial/KeyId/Account）时，那条断言照样绿，服务器换形状它不会红。
// 这里直接断言**原始响应体**的键名：服务器返回的内层就是小写开头。
test("normalize: enroll 原始响应体的内层键名就是小写（不经 camelize 的形状钉子）", async () => {
  let raw = null;
  await withStubWindow(stubWindow(async () => {
    raw = {
      ok: true,
      status: 200,
      data: { Ok: true, Data: { keyMaterial: "AAAABBBBCCCCDDDD", keyId: "aid-1", account: "a@x.com" } },
    };
    return raw;
  }), async (localApi) => {
    localApi.setKey("test-key");
    const r = await localApi.call("POST", "/api/v2/local/enroll", {});

    // 逐字断言原始响应体的内层键名（这里没有经过 camelize）。
    assert.ok(raw, "应当拿到原始响应体");
    assert.deepStrictEqual(Object.keys(raw.data.Data), ["keyMaterial", "keyId", "account"]);
    for (const k of Object.keys(raw.data.Data)) {
      assert.strictEqual(k[0], k[0].toLowerCase(),
        "内层键名必须是小写开头（服务器的真实形状）；PascalCase 说明服务器换了形状，这条断言就该红");
    }

    // 归一化结果与原始内层一致：对已是小写开头的键名，camelize 是恒等变换。
    assert.deepStrictEqual(r.data, raw.data.Data);
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

// 换 global.window 必须还原：这枚 window 漏给后面的用例，后面的断言就成了
// 在别人的环境里跑出来的结果（而且看起来还挺绿）。
test("setLocalBase: 登记 preload 并生效 localBase getter", async () => {
  const reg = [];
  await withStubWindow({
    HTWLocal: Local,
    htw: { apiBase: "", directBase: "", registerBase: (b) => reg.push(b) },
  }, async (localApi) => {
    localApi.setLocalBase("http://127.0.0.1:51123");
    assert.strictEqual(localApi.localBase, "http://127.0.0.1:51123");
    assert.ok(reg.includes("http://127.0.0.1:51123"));
    // 单出口：localBase 请求图层拒绝网络失败时返回统一形状
  });
});

// 结尾斜杠必须在登记前归一化掉：preload 是 base + path 直接拼的，
// 尾斜杠会拼出 "//api/v2/local/health" → 探活 404。
test("setLocalBase: 结尾斜杠归一化后再登记", async () => {
  const reg = [];
  await withStubWindow({
    HTWLocal: Local,
    htw: { apiBase: "", directBase: "", registerBase: (b) => { reg.push(b); return true; } },
  }, async (localApi) => {
    localApi.setLocalBase("http://127.0.0.1:51123/");
    assert.strictEqual(localApi.localBase, "http://127.0.0.1:51123");
    assert.ok(reg.includes("http://127.0.0.1:51123"), "登记的必须是归一化后的地址");
    assert.ok(!reg.includes("http://127.0.0.1:51123/"), "尾斜杠不该被登记进去");
  });
});

// 🔴 闸门 fail-closed：本地模式模块（window.HTWLocal）缺席时，地址准入必须**拒绝**。
// 兜底分支若退回"仅去尾斜杠"，就等于跳过了「必须是本机回环」「必须是根地址」两条硬约束，
// 于是非回环地址会被登记进 preload 白名单 —— 而配对请求会把 AuthKey + 账号级材料发往那个地址。
// 缺模块时宁可不配置，也不放行。
test("setLocalBase: 本地模式模块缺席 → 拒绝，不登记、不生效（fail-closed）", async () => {
  const reg = [];
  const win = {
    htw: { apiBase: "", directBase: "", registerBase: (b) => { reg.push(b); return true; } },
  };
  assert.strictEqual(win.HTWLocal, undefined, "本用例的前提：窗口里没有本地模式模块");
  await withStubWindow(win, async (localApi) => {
    const res = localApi.setLocalBase("http://example.com:51111");
    assert.strictEqual(res.ok, false, "模块缺席时不得放行");
    assert.strictEqual(res.reason, "format");
    assert.strictEqual(reg.length, 0, "没过准入的地址不许登记");
    assert.strictEqual(localApi.localBase, "", "没过准入的地址不许生效");
  });
});

// 🔴 同一闸门的另一面：**空地址 = 关闭本地模式**仍然必须放行。
// 空地址不放行任何地址、也不登记（清空既有登记是安全的），
// 把「关掉本地模式」也堵死的话，用户在模块异常时反而关不掉它。
test("setLocalBase: 模块缺席时清空地址（关闭本地模式）仍然生效", async () => {
  const reg = [];
  await withStubWindow({
    htw: { apiBase: "", directBase: "", registerBase: (b) => { reg.push(b); return true; } },
  }, async (localApi) => {
    const res = localApi.setLocalBase("");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.base, "");
    assert.strictEqual(reg.length, 0, "清空地址不登记任何东西");
    assert.strictEqual(localApi.localBase, "");
  });
});

// registerBase 的返回值必须看：它 false 的唯一原因是地址格式非法。
// 没登记的地址 preload 那边会直接回 BASE_NOT_ALLOWED，请求根本发不出去 ——
// 与其让用户看到一句含糊的「连不上」，不如当场说清「格式无效」。
test("setLocalBase: registerBase 拒绝 → 不生效（调用方据此不落盘）", async () => {
  const reg = [];
  await withStubWindow({
    htw: { apiBase: "", directBase: "", registerBase: (b) => { reg.push(b); return false; } },
  }, async (localApi) => {
    const res = localApi.setLocalBase("http://127.0.0.1:51123");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "format");
    assert.strictEqual(localApi.localBase, "", "没被登记的地址不能生效");
  });
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
    // 缓存里这枚 api.js 是按桩 window 初始化过的：留着的话，下一条用例
    // require 到的是"带着桩的实例"，看到的 localBase / base 都不是真值。
    delete require.cache[require.resolve("./api.js")];
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

    // 其它基地址（云端）的失败**不被本地模式这条出口吞掉**：仍然抛出去，
    // 但英文原文换成一句中性文案（用户看到的是中文，不是 "fetch failed"）。
    await assert.rejects(
      () => localApi.call("POST", "/api/v2/agent/start", {}, "https://other.example.com"),
      /无法连接服务器，请检查网络或服务器地址。/
    );
  });
});

// M3：云端（服务器）连不上时，界面不能显示英文原文 "fetch failed"。
// 症状与「本地执行不可用」**不同**（一个是云端服务器连不上，一个是本机实例连不上），
// 两句文案必须分开，不能合成一句。
test("call: 云端基地址网络失败 → 抛中性中文文案，不外泄英文原文", async () => {
  await withStubWindow(stubWindow(async () => { throw new TypeError("fetch failed"); }), async (localApi) => {
    localApi.setKey("test-key");
    await assert.rejects(
      () => localApi.call("POST", "/api/v2/local/enroll", {}, "https://htwmedia.dpdns.org"),
      (e) => {
        assert.strictEqual(e.message, "无法连接服务器，请检查网络或服务器地址。");
        assert.ok(!/fetch failed/.test(e.message), "英文原文不该出现在给用户看的文案里");
        // 根因仍留在 cause 里，便于排查。
        assert.ok(e.cause, "原始异常要留在 cause 里");
        return true;
      }
    );
  });
});

// 云端失败与本地失败是**两种症状**，文案必须能分开。
test("call: 云端失败与本地失败文案不同", async () => {
  await withStubWindow(stubWindow(async () => { throw new TypeError("fetch failed"); }), async (localApi) => {
    localApi.setKey("test-key");
    const localRes = await localApi.call("POST", "/api/local/pair", {}, localApi.localBase);
    assert.strictEqual(localRes.localUnavailable, true);
    assert.strictEqual(localRes.message, "本地执行不可用，请检查网络或服务器状态。");
    assert.notStrictEqual(localRes.message, "无法连接服务器，请检查网络或服务器地址。");
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

// 失败壳的判定面收紧：errCode:0 表示"没有错误"，不能判成失败。
// 收紧前只要顶层有 errCode 就判失败 —— 一次没带错误码的成功响应会被误报成失败。
test("normalize: errCode:0 的壳不算失败（0 = 没有错误）", () => {
  const r = api.normalize({ ok: true, status: 200, data: { errCode: 0, errMsg: null } });
  assert.strictEqual(r.ok, true, "errCode:0 不该被判失败");

  // PascalCase 变体同理；errMsg 是否为空都不影响判定（errCode 才是判据）。
  const pascal = api.normalize({ ok: true, status: 200, data: { ErrCode: 0, ErrMsg: "" } });
  assert.strictEqual(pascal.ok, true, "ErrCode:0 不该被判失败");

  // 字符串 "0" 同义。
  const str = api.normalize({ ok: true, status: 200, data: { errCode: "0" } });
  assert.strictEqual(str.ok, true, "errCode:\"0\" 不该被判失败");
});

// 判定面仍然要接住真正的错误码：0 之外的非零码照旧判失败。
test("normalize: errCode 非 0 的壳仍判失败", () => {
  const r = api.normalize({ ok: true, status: 200, data: { errCode: 403, errMsg: "本进程不是本地实例，不接受配对。" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.message, "本进程不是本地实例，不接受配对。");
});
