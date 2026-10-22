const test = require("node:test");
const assert = require("node:assert");
// preload 里请求头物化的真实口径（preload.call 直接用这份逻辑）。
const H = require("./call-headers.js");

// 集成级验证：探活/清单这类匿名请求走**省略通道**，凭据不递给本机进程。
// 契约与服务器侧一致：本地角色下"任意头都放行"，但客户端根本不发头 ——
// 卫生口径是客户端侧的（不把云端密钥递给本机进程）。
test("call-headers: apiKey=null（省略通道）→ 请求头对象里没有 AuthKey 键", () => {
  const headers = H.buildCallHeaders(null, undefined);
  assert.ok(!("AuthKey" in headers), "省略通道必须连 AuthKey 键都不建，实际：" + JSON.stringify(headers));
  assert.deepStrictEqual(Object.keys(headers), []);
});

test("call-headers: apiKey=undefined（历史实参）→ 同样走省略通道", () => {
  const headers = H.buildCallHeaders(undefined, undefined);
  assert.ok(!("AuthKey" in headers), "undefined 也是省略，实际：" + JSON.stringify(headers));
});

test("call-headers: apiKey=真值 → 带 AuthKey 头（online 正语义不回退）", () => {
  const headers = H.buildCallHeaders("test-key", undefined);
  assert.strictEqual(headers.AuthKey, "test-key");
});

test("call-headers: apiKey=空串 → 物化成空值头（显式空密钥与省略是两种语义）", () => {
  const headers = H.buildCallHeaders("", undefined);
  assert.ok("AuthKey" in headers, "空串是显式声明，保留空值头");
  assert.strictEqual(headers.AuthKey, "");
});

test("call-headers: 带体时补 Content-Type（与 preload.call 既有行为一致）", () => {
  const h1 = H.buildCallHeaders("test-key", { a: 1 });
  assert.strictEqual(h1["Content-Type"], "application/json");
  assert.strictEqual(h1.AuthKey, "test-key");
  const h2 = H.buildCallHeaders("test-key", "raw-string");
  assert.strictEqual(h2["Content-Type"], "application/json");
  const h3 = H.buildCallHeaders("test-key", null);
  assert.ok(!("Content-Type" in h3), "不带体不建 Content-Type");
});
