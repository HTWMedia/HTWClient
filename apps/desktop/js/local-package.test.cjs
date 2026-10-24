// js/local-package.js 的行为测试：下载校验与解压。
//
// 这里全是**真实行为**，不是形状守卫：sha256 用真实小文件实算（本地 HTTP 服务器
// 下发 KB 级字节流，边收边写真实临时文件），解压真跑系统 tar 解一个内置的小 zip。
// preload 侧（白名单闸门、入口暴露）的测试在 preload.test.cjs —— 闸门是
// preload 的状态（BASE_ORIGINS），不在本模块。
//
// 为什么这套测试放在独立文件：模块不依赖 electron，node --test 可以直接
// require，不需要桩；这比把逻辑塞进 preload.js 再挂 electron 桩测要直接得多。

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { downloadPackage, extractPackage, ensureNewDir } = require("./local-package.js");

// 内置小 zip（tar -a -cf 生成，362 字节）：pkg/probe.txt，内容见下。
// 预置 base64 而不是测试内现打包：打包产物依赖系统 tar 的 zip 能力，
// 预置件在只有 GNU tar 的环境下也能被解压验证（bsdtar 与 unzip 均可解）。
const PROBE_ZIP_B64 =
  "UEsDBBQAAAAAANFGWF0AAAAAAAAAAAAAAAAEACAAcGtnL3V4CwABBAAAAAAEAAAAAFVUDQAHywHcassB3GrLAdxqUEsDBBQACAAIANFGWF0AAAAAAAAAAAAAAAANACAAcGtnL3Byb2JlLnR4dHV4CwABBAAAAAAEAAAAAFVUDQAHywHcassB3GrLAdxqyygp183JT07M0S1ITM5OTE/VLSjKT0rlAgBQSwcIPa6qpBoAAAAYAAAAUEsBAhQDFAAAAAAA0UZYXQAAAAAAAAAAAAAAAAQAGAAAAAAAAAAAAP9BAAAAAHBrZy91eAsAAQQAAAAABAAAAABVVAUAAcsB3GpQSwECFAMUAAgACADRRlhdPa6qpBoAAAAYAAAADQAYAAAAAAAAAAAAtoFCAAAAcGtnL3Byb2JlLnR4dHV4CwABBAAAAAAEAAAAAFVUBQABywHcalBLBQYAAAAAAgACAJ0AAAC3AAAAAAA=";
const PROBE_TEXT = "htw-local-package-probe\n";

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "htw-pkg-"));
}

// 起一个本地 HTTP 服务器，对所有请求回固定字节流。
async function startBodyServer(body, status) {
  const server = http.createServer((req, res) => {
    res.statusCode = status || 200;
    res.setHeader("Content-Type", "application/zip");
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: "http://127.0.0.1:" + server.address().port + "/api/v2/local/package" };
}

function tempFilePath(dir) {
  return path.join(dir, "package.zip");
}

// ---- downloadPackage：sha256 校验 ----

test("downloadPackage: 校验值匹配 → 成功落盘，sizeBytes/sha256 如实回传", async () => {
  const body = crypto.randomBytes(4096); // KB 级夹具
  const { server, url } = await startBodyServer(body);
  const dir = mkTempDir();
  try {
    const destPath = tempFilePath(dir);
    const r = await downloadPackage({
      url: url,
      headers: {},
      destPath: destPath,
      expectedSha256: crypto.createHash("sha256").update(body).digest("hex"),
    });

    assert.strictEqual(r.ok, true, "校验值匹配必须成功，实际：" + JSON.stringify(r));
    assert.strictEqual(r.sizeBytes, body.length);
    assert.strictEqual(r.sha256, crypto.createHash("sha256").update(body).digest("hex"));
    assert.deepStrictEqual(fs.readFileSync(destPath), body, "落盘内容必须与下发内容一致");
    assert.ok(!fs.existsSync(destPath + ".part"), "成功后不得留下临时文件");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadPackage: 校验值不匹配 → 失败、删临时文件，目标路径什么都没留", async () => {
  const body = crypto.randomBytes(2048);
  const { server, url } = await startBodyServer(body);
  const dir = mkTempDir();
  try {
    const destPath = tempFilePath(dir);
    // 期望值是"另一个内容"的摘要：清单说 A、服务器给 B 的场景。
    const wrong = crypto.createHash("sha256").update(Buffer.from("not-the-package")).digest("hex");
    const r = await downloadPackage({
      url: url,
      headers: {},
      destPath: destPath,
      expectedSha256: wrong,
    });

    assert.strictEqual(r.ok, false, "校验不匹配必须失败");
    assert.ok(/校验失败/.test(r.message), "失败文案要说清是校验失败，实际：" + r.message);
    assert.ok(!fs.existsSync(destPath), "坏包绝不能落到目标路径");
    assert.ok(!fs.existsSync(destPath + ".part"), "临时文件必须被删掉");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- downloadPackage：非 200 与网络失败 ----

test("downloadPackage: 服务器返回 404 → 人话失败，不落任何文件", async () => {
  const { server, url } = await startBodyServer(Buffer.from("nope"), 404);
  const dir = mkTempDir();
  try {
    const destPath = tempFilePath(dir);
    const r = await downloadPackage({
      url: url,
      headers: {},
      destPath: destPath,
      expectedSha256: "0".repeat(64),
    });

    assert.strictEqual(r.ok, false);
    assert.ok(/404/.test(r.message), "失败文案要带上服务器状态，实际：" + r.message);
    assert.ok(!fs.existsSync(destPath));
    assert.ok(!fs.existsSync(destPath + ".part"));
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("downloadPackage: 网络连不上 → 中性中文文案，不透英文原文", async () => {
  const dir = mkTempDir();
  try {
    // 死端口：连接立即被拒，不拖慢测试。
    const r = await downloadPackage({
      url: "http://127.0.0.1:51899/api/v2/local/package",
      headers: {},
      destPath: tempFilePath(dir),
      expectedSha256: "0".repeat(64),
    });

    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.message, "网络连接失败，请检查网络或服务器状态。",
      "网络类失败与 upload 出口同一口径，实际：" + r.message);
    for (const bad of ["ECONNREFUSED", "ETIMEDOUT", "socket hang up", "fetch failed"]) {
      assert.ok(!r.message.includes(bad), "文案不该出现英文原文（" + bad + "）");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- extractPackage：真跑 tar ----

test("extractPackage: 真跑系统 tar 解小 zip → 成功且内容正确", async () => {
  const dir = mkTempDir();
  const zipPath = path.join(dir, "probe.zip");
  fs.writeFileSync(zipPath, Buffer.from(PROBE_ZIP_B64, "base64"));
  const destDir = path.join(dir, "out");
  fs.mkdirSync(destDir); // 目标目录由调用方建好 —— 这正是约定
  try {
    const r = await extractPackage({ zipPath: zipPath, destDir: destDir });

    assert.strictEqual(r.ok, true, "tar 解压小 zip 必须成功，实际：" + JSON.stringify(r));
    assert.strictEqual(
      fs.readFileSync(path.join(destDir, "pkg", "probe.txt"), "utf-8"),
      PROBE_TEXT,
      "解出的文件内容必须与夹具一致"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("extractPackage: 目标目录不存在 → 失败且绝不 spawn", async () => {
  const dir = mkTempDir();
  const zipPath = path.join(dir, "probe.zip");
  fs.writeFileSync(zipPath, Buffer.from(PROBE_ZIP_B64, "base64"));
  try {
    let spawned = 0;
    const r = await extractPackage({
      zipPath: zipPath,
      destDir: path.join(dir, "no-such-dir"),
      spawnFn: () => { spawned += 1; return new EventEmitter(); },
    });

    assert.strictEqual(r.ok, false, "目标目录不存在必须失败");
    assert.ok(/目标目录不存在/.test(r.message), "失败文案要说清是目标目录不存在，实际：" + r.message);
    assert.strictEqual(spawned, 0, "前置校验不过就不得启动解压程序");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("extractPackage: tar 不存在（ENOENT）→ 人话报「系统缺少 tar」", async () => {
  const dir = mkTempDir();
  const destDir = path.join(dir, "out");
  fs.mkdirSync(destDir);
  try {
    const fake = new EventEmitter();
    const r = await extractPackage({
      zipPath: path.join(dir, "probe.zip"),
      destDir: destDir,
      spawnFn: () => {
        // 复刻 spawn 对不存在程序的 behavior：异步发 'error'（带 ENOENT 码）。
        setImmediate(() => fake.emit("error", Object.assign(new Error("spawn tar ENOENT"), { code: "ENOENT" })));
        return fake;
      },
    });

    assert.strictEqual(r.ok, false);
    assert.ok(r.message.includes("系统缺少 tar"), "必须人话报 tar 缺失，实际：" + r.message);
    assert.ok(!r.message.includes("ENOENT"), "不得透出错误码原文");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("extractPackage: tar 非零退出 → 人话报错并带上退出码", async () => {
  const dir = mkTempDir();
  const destDir = path.join(dir, "out");
  fs.mkdirSync(destDir);
  try {
    const fake = new EventEmitter();
    const r = await extractPackage({
      zipPath: path.join(dir, "broken.zip"),
      destDir: destDir,
      spawnFn: () => {
        setImmediate(() => fake.emit("close", 2));
        return fake;
      },
    });

    assert.strictEqual(r.ok, false);
    assert.ok(/退出码 2/.test(r.message), "失败文案要带上退出码，实际：" + r.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- ensureNewDir：新版本目录的独占创建 ----
//
// 任务 2 的 concern（extractPackage 不校验目录空不空，信任调用方）由流程层
// 用本函数兑现：目录要么是刚建出来的（必然为空），要么就报错不解压。

test("ensureNewDir: 目录不存在 → 创建成功且确实是目录", () => {
  const dir = mkTempDir();
  try {
    const target = path.join(dir, "HTWLocal-2.0.0");
    const r = ensureNewDir(target);
    assert.strictEqual(r.ok, true, "新目录应创建成功，实际：" + JSON.stringify(r));
    assert.ok(fs.statSync(target).isDirectory(), "创建出来的必须是目录");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureNewDir: 目录已存在 → 拒绝（人话说清『已存在』），绝不覆盖", () => {
  const dir = mkTempDir();
  try {
    const target = path.join(dir, "HTWLocal-2.0.0");
    fs.mkdirSync(target);
    // 里面放一个既有文件：独占创建的语义就是它一个字节都不能被动。
    const keep = path.join(target, "keep.txt");
    fs.writeFileSync(keep, "keep-me");
    const r = ensureNewDir(target);
    assert.strictEqual(r.ok, false, "已存在的目录必须拒绝");
    assert.ok(/已存在/.test(r.message), "失败文案要说清目录已存在，实际：" + r.message);
    assert.strictEqual(fs.readFileSync(keep, "utf-8"), "keep-me", "既有文件必须原样保留");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureNewDir: 父目录不存在 → 创建失败（人话），不递归补建", () => {
  const dir = mkTempDir();
  try {
    // 父目录不存在：非递归创建必须失败 —— 父目录应是本地实例所在目录，
    // 它不存在说明可执行文件路径本身有问题，静默补建反而把错误藏起来。
    const r = ensureNewDir(path.join(dir, "no-such-parent", "HTWLocal-2.0.0"));
    assert.strictEqual(r.ok, false);
    assert.ok(/无法创建/.test(r.message), "失败文案要说清创建失败，实际：" + r.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
