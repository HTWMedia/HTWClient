const test = require("node:test");
const assert = require("node:assert");
const Caps = require("./local-capabilities.js");

const BASE = "http://127.0.0.1:51111";

// 造一个"只记调用、不带业务"的传输层：
// 记录每次调用的方法 / URL / 实参个数，供"裸 GET"这条硬约束断言。
function makeStore(respond, base) {
  const calls = [];
  const transport = {
    call: async function (method, url) {
      calls.push({ method: method, url: url, argc: arguments.length });
      if (typeof respond === "function") return respond(method, url);
      return respond;
    },
  };
  const store = Caps.createStore({
    transport: transport,
    base: base === undefined ? BASE : base,
  });
  return { store: store, calls: calls };
}

const ENDPOINTS = [
  "GET /api/v2/agent/voices",
  "POST /api/v2/voice/status/{id:int}",
];

const FLAT_BODY = { protocolVersion: 1, endpoints: ENDPOINTS };
// v2 信封壳（PascalCase Ok / Data）—— 服务器端全局信封过滤器的形状。
const ENVELOPE_BODY = { Ok: true, Data: { protocolVersion: 1, endpoints: ENDPOINTS } };

// ---- 模式匹配 ----

// 什么使其变红：占位符编译成跨段（.*）或允许空段（[^/]*）→ 这里会命中。
// 什么使其变红：占位符被当字面量比对 → 这里不命中。
test("matches: 占位符匹配单段非空内容（不跨 /）", () => {
  assert.strictEqual(
    Caps.matches("POST /api/v2/voice/status/{id:int}", "POST", "/api/v2/voice/status/123"),
    true
  );
  // 占位符是"任意形态"：{id:int} / {name} / {} 都按单段处理。
  assert.strictEqual(Caps.matches("GET /api/v2/x/{name}", "GET", "/api/v2/x/abc"), true);
  assert.strictEqual(Caps.matches("GET /api/v2/x/{}", "GET", "/api/v2/x/abc"), true);
});

// 什么使其变红：方法比较放宽成"包含"或忽略方法 → GET 会命中 POST 的条目。
test("matches: 方法必须相等（GET 不命中 POST 条目）", () => {
  assert.strictEqual(
    Caps.matches("POST /api/v2/voice/status/{id:int}", "GET", "/api/v2/voice/status/123"),
    false
  );
  assert.strictEqual(
    Caps.matches("POST /api/v2/voice/status/{id:int}", "PUT", "/api/v2/voice/status/123"),
    false
  );
});

// 什么使其变红：正则不锚定整条路径 → 占位符吃掉多余的 /extra 段。
test("matches: 占位符不跨段（尾部多一段不命中）", () => {
  assert.strictEqual(
    Caps.matches("POST /api/v2/voice/status/{id:int}", "POST", "/api/v2/voice/status/123/extra"),
    false
  );
});

// 什么使其变红：占位符允许空串 → 空段会被当成命中。
test("matches: 占位符段不能为空", () => {
  assert.strictEqual(
    Caps.matches("POST /api/v2/voice/status/{id:int}", "POST", "/api/v2/voice/status/"),
    false
  );
});

// 什么使其变红：只做前缀匹配（startsWith）→ voices2 会命中 voices。
test("matches: 前缀不算命中（voices2 ≠ voices）", () => {
  assert.strictEqual(Caps.matches("GET /api/v2/agent/voices", "GET", "/api/v2/agent/voices2"), false);
  // 精确命中仍然要成立（否则上面的反例可以靠"永远不命中"作弊通过）。
  assert.strictEqual(Caps.matches("GET /api/v2/agent/voices", "GET", "/api/v2/agent/voices"), true);
});

// ---- 清单拉取与缓存 ----

// 什么使其变红：解析只认一种外壳 → 顶层直出的形状解析不出来（has 恒 false）。
test("store.load(): 顶层直出形状 → has() 命中", async () => {
  const { store } = makeStore(async () => ({ status: 200, ok: true, data: FLAT_BODY }));
  await store.load();
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices"), true);
  assert.strictEqual(store.has("POST", "/api/v2/voice/status/123"), true);
  // 方法不同仍不命中（清单不是"路径集合"）。
  assert.strictEqual(store.has("GET", "/api/v2/voice/status/123"), false);
  // 清单里没有的路径不命中。
  assert.strictEqual(store.has("GET", "/api/v2/agent/other"), false);
});

// 什么使其变红：解析不剥 v2 信封 → Data 包裹的形状解析不出来（has 恒 false）。
test("store.load(): v2 信封壳（Ok/Data）也能解析", async () => {
  const { store } = makeStore(async () => ({ status: 200, ok: true, data: ENVELOPE_BODY }));
  await store.load();
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices"), true);
  assert.strictEqual(store.has("POST", "/api/v2/voice/status/123"), true);
  assert.strictEqual(store.has("GET", "/api/v2/agent/other"), false);
});

// 什么使其变红：load() 把传输层异常往外抛 → 这里会 reject 而不是返回空清单。
test("store.load(): 传输层失败 → 空清单、不抛错、has() 恒 false", async () => {
  const { store } = makeStore(async () => {
    throw new Error("ECONNREFUSED");
  });
  const r = await store.load();
  assert.strictEqual(r.endpoints.length, 0);
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices"), false);
  assert.strictEqual(store.has("POST", "/api/v2/voice/status/123"), false);
});

// 什么使其变红：非 2xx 响应被当成成功 → 失败路径没被覆盖。
test("store.load(): HTTP 错误响应 → 空清单、不抛错、has() 恒 false", async () => {
  const { store } = makeStore(async () => ({ status: 500, ok: false, data: { errCode: 500, errMsg: "内部错误" } }));
  const r = await store.load();
  assert.strictEqual(r.endpoints.length, 0);
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices"), false);
});

// 什么使其变红：空清单被当成"命中一切"（比如把空表当成通配）→ has() 会误命中。
test("store.load(): 空清单 → has() 恒 false", async () => {
  const { store } = makeStore(async () => ({ status: 200, ok: true, data: { protocolVersion: 1, endpoints: [] } }));
  await store.load();
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices"), false);
  assert.strictEqual(store.has("POST", "/api/v2/voice/status/123"), false);
  assert.strictEqual(store.has("GET", "/api/v2/anything"), false);
});

// 什么使其变红：拉清单时带上 v2 Accept 头或 ?format=json → 服务器端会被信封过滤器改写形状。
test("store.load(): 裸 GET —— 不带 v2 Accept 头、不加 ?format=json", async () => {
  const { store, calls } = makeStore(async () => ({ status: 200, ok: true, data: FLAT_BODY }));
  await store.load();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, "GET");
  assert.strictEqual(calls[0].url, BASE + "/api/v2/local/capabilities");
  assert.strictEqual(calls[0].url.indexOf("?"), -1, "不得带查询串");
  assert.strictEqual(calls[0].url.indexOf("format=json"), -1, "不得带 format=json");
  // 只传两个实参：下层 call 的第三个参数是请求体，多传就会变成"带体 GET"。
  assert.strictEqual(calls[0].argc, 2, "不得传第三个实参（那里是请求体 / 头位）");
});

// 什么使其变红：has() 不看方法 → GET 会命中 POST 条目。
test("store.has(): 用编译表判定（方法 + 路径模式）", async () => {
  const { store } = makeStore(async () => ({ status: 200, ok: true, data: FLAT_BODY }));
  await store.load();
  assert.strictEqual(store.has("POST", "/api/v2/voice/status/abc"), true);
  assert.strictEqual(store.has("POST", "/api/v2/voice/status/abc/extra"), false);
  assert.strictEqual(store.has("GET", "/api/v2/voice/status/abc"), false);
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices2"), false);
});

// 什么使其变红：compile 不按方法分组 → 查表拿到的是混在一起的正则。
test("compile: 编译成「方法 → 正则数组」查表", () => {
  const table = Caps.compile(ENDPOINTS);
  assert.ok(Object.prototype.hasOwnProperty.call(table, "GET"));
  assert.ok(Object.prototype.hasOwnProperty.call(table, "POST"));
  assert.strictEqual(table.GET.length, 1);
  assert.strictEqual(table.POST.length, 1);
  assert.ok(table.GET[0] instanceof RegExp);
  assert.strictEqual(table.GET[0].test("/api/v2/agent/voices"), true);
  assert.strictEqual(table.GET[0].test("/api/v2/agent/voices2"), false);
  // 不认识的条目（缺方法 / 非字符串）被丢掉，不进查表。
  const mixed = Caps.compile(["GET /api/v2/a", "缺方法", "", null, 42]);
  assert.strictEqual(Object.keys(mixed).length, 1);
  assert.strictEqual(mixed.GET.length, 1);
});

// 什么使其变红：clear() 没清缓存 → 清空后 has() 仍然命中。
test("store.clear(): 清空缓存后 has() 恒 false", async () => {
  const { store } = makeStore(async () => ({ status: 200, ok: true, data: FLAT_BODY }));
  await store.load();
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices"), true);
  store.clear();
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices"), false);
  assert.strictEqual(store.loaded, false);
});

// 什么使其变红：没 load 过就 has() → 未加载时按"命中一切"或"直接崩"处理。
test("store: 未拉清单时 has() 恒 false", () => {
  const { store } = makeStore(async () => ({ status: 200, ok: true, data: FLAT_BODY }));
  assert.strictEqual(store.loaded, false);
  assert.strictEqual(store.has("GET", "/api/v2/agent/voices"), false);
});
