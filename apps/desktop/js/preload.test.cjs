const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const Module = require("node:module");
const path = require("node:path");

// preload.js 的进程内钉子：electron 是桌面运行时才有的模块，node --test 下没有。
// 用 Module._load 把 require("electron") 换成桩，让 preload.js 在测试里**真实加载**，
// 断言建立在真实上线路径上，而不是在测试里另造一份逻辑。
const PRELOAD_PATH = path.join(__dirname, "..", "preload.js");

function loadPreload() {
  const stub = {
    api: null,
    contextBridge: {
      exposeInMainWorld(_name, api) { stub.api = api; },
    },
    ipcRenderer: {
      on() { /* 事件订阅：测试不派发 */ },
      send() { /* 单向消息：测试不校验 */ },
      invoke() { return Promise.resolve({}); },
      removeListener() {},
    },
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return stub;
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(PRELOAD_PATH)];
    require(PRELOAD_PATH);
  } finally {
    Module._load = origLoad;
  }
  assert.ok(stub.api, "前提：preload 通过 contextBridge 暴露了 window.htw");
  return stub.api;
}

// 死端口：本机确定未监听的口，连接立即被拒，不拖慢测试。
const DEAD_BASE = "http://127.0.0.1:51888";

test("preload upload: 网络连不上 → errCode=0 + 中性中文文案，不透英文原文", async () => {
  const htw = loadPreload();
  assert.strictEqual(htw.registerBase(DEAD_BASE), true, "前提：死端口地址已登记进白名单");

  const res = await htw.upload(
    "POST", "/api/v2/upload",
    [{ name: "a.txt", buffer: new Uint8Array([1, 2, 3]).buffer }],
    {}, undefined, undefined, "file", DEAD_BASE
  );

  assert.strictEqual(res.status, 0, "网络类失败不上 HTTP 状态码，实际：" + JSON.stringify(res));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.data.errCode, 0, "网络类失败按 errCode=0 报，实际：" + JSON.stringify(res.data));
  // 与 call 出口同一口径：只给中性中文陈述，用户看不到英文报错原文。
  assert.strictEqual(res.data.errMsg, "网络连接失败，请检查网络或服务器状态。",
    "文案应为中性中文，实际：" + res.data.errMsg);
  for (const bad of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "socket hang up", "connect", "error", "Error"]) {
    assert.ok(!String(res.data.errMsg).includes(bad),
      "文案不该出现英文原文（" + bad + "），实际：" + res.data.errMsg);
  }
});

// 回显服务器：把收到的请求头原样回给客户端，进程内验证"发出去的头"。
function startEchoServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ method: req.method, headers: req.headers }));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

test("preload call: 省略通道（apiKey=null）真的不发 authkey 头；显式密钥才发", async () => {
  const htw = loadPreload();
  const { server, port } = await startEchoServer();
  try {
    const base = "http://127.0.0.1:" + port;
    assert.strictEqual(htw.registerBase(base), true, "前提：回显服务器地址已登记进白名单");

    // 探活/清单这类匿名请求：连"空值的头"都不该出现。
    const anon = await htw.call("GET", "/probe", undefined, null, base);
    assert.strictEqual(anon.ok, true, "前提：回显服务器可达，实际：" + JSON.stringify(anon));
    const anonHeaders = (anon.data && anon.data.headers) || {};
    assert.ok(!Object.prototype.hasOwnProperty.call(anonHeaders, "authkey"),
      "省略通道不得发出 authkey 头，实际头：" + JSON.stringify(anonHeaders));

    // 显式密钥：正常带 authkey（online 正语义不回退）。
    const signed = await htw.call("GET", "/probe", undefined, "test-key", base);
    assert.strictEqual(signed.ok, true, "前提：回显服务器可达，实际：" + JSON.stringify(signed));
    const signedHeaders = (signed.data && signed.data.headers) || {};
    assert.strictEqual(signedHeaders.authkey, "test-key",
      "显式密钥必须带 authkey 头，实际头：" + JSON.stringify(signedHeaders));
  } finally {
    server.close();
  }
});

// ---- 本地更新包：packageDownload / packageExtract ----
//
// packageDownload 与 call 同一白名单闸门：url 未登记时请求根本不发。
// 什么使其变红：下载前忘了查 isAllowedBase —— 页面里任何脚本就能让 preload
// 把更新请求（连带请求头）发到任意第三方地址。
test("preload packageDownload: url 未登记 → 直接拒绝，请求根本没发出去", async () => {
  const htw = loadPreload();
  let hits = 0;
  const server = http.createServer(() => { hits += 1; });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    // 注意：这里刻意不 registerBase —— 未登记正是被测条件。
    const r = await htw.packageDownload({
      url: base + "/api/v2/local/package",
      headers: {},
      destPath: path.join(os.tmpdir(), "htw-should-never-exist.zip"),
      expectedSha256: "0".repeat(64),
    });

    assert.strictEqual(r.ok, false, "未登记地址必须被拒绝，实际：" + JSON.stringify(r));
    assert.ok(/未登记/.test(r.message), "拒绝文案要说清是地址未登记，实际：" + r.message);
    assert.strictEqual(hits, 0, "拒绝发生在闸门上，不得向该地址发出任何请求");
  } finally {
    server.close();
  }
});

// 下载成功路径走真实 HTTP 服务器 + 真实落盘 + 真实 sha256：这条验证的是
// 上线路径（白名单放行 → fetch 流式写文件 → 校验 → 改名），不是另一份测试逻辑。
test("preload packageDownload: 已登记地址 → 流式落盘 + sha256 校验成功", async () => {
  const htw = loadPreload();
  const body = crypto.randomBytes(4096); // KB 级夹具，够验流式写盘即可
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/zip");
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "htw-pkg-dl-"));
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    assert.strictEqual(htw.registerBase(base), true, "前提：本地服务器地址已登记进白名单");
    const destPath = path.join(dir, "package.zip");
    const r = await htw.packageDownload({
      url: base + "/api/v2/local/package",
      headers: {},
      destPath: destPath,
      expectedSha256: crypto.createHash("sha256").update(body).digest("hex"),
    });

    assert.strictEqual(r.ok, true, "校验值匹配时必须成功，实际：" + JSON.stringify(r));
    assert.strictEqual(r.sizeBytes, body.length, "sizeBytes 必须等于收到的字节数");
    assert.strictEqual(r.sha256, crypto.createHash("sha256").update(body).digest("hex"));
    assert.deepStrictEqual(fs.readFileSync(destPath), body, "落盘内容必须与服务器下发的完全一致");
    assert.ok(!fs.existsSync(destPath + ".part"), "成功后不得留下临时文件");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preload 暴露了本地更新包的两个入口", () => {
  const htw = loadPreload();
  assert.strictEqual(typeof htw.packageDownload, "function", "缺 packageDownload");
  assert.strictEqual(typeof htw.packageExtract, "function", "缺 packageExtract");
});
