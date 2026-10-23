// 🔴 铁律守卫（来源：服务器仓 docs/superpowers/specs/2026-10-15-local-v2-execution-design.md §11.1）：
// 「本地 v2 的源码与产物绝不能进入本仓」——本仓是 public + MIT，一旦进入即为公开。
// 本文件把这条铁律变成可执行断言：扫描 git 跟踪文件，
// ① 服务器源码/产物扩展名（.cs / .csproj / .dll / .exe …）一份都不能有；
// ② 服务器仓特有的内部标识不能出现在任何被跟踪的文本文件里。
//
// 注意区分「允许」与「不允许」的引用：桌面端合法持有的是**端点路径与协议面**
// （如 /api/v2/local/health、能力清单），这些出现在判定白名单之外，不在标记名单里；
// 被拦的是**实现面**——服务器仓的类型名、内部路由、仓库名本身。

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// ---- 规则数据（纯数据，便于对照）----

const SERVER_ARTIFACT_EXTENSIONS = [
  ".cs", ".csproj", ".csx", ".sln", ".slnf", ".razor", ".pubxml",
  ".dll", ".exe", ".pdb", ".blend",
  ".deps.json", ".runtimeconfig.json",
  ".pri", ".snk", ".binlog",
];

const SERVER_INTERNAL_MARKERS = [
  "HTWCore.Web",
  "LocalKeyMaterialStore",
  "LocalCredentialVault",
  "CredentialEnvelope",
  "DbCredentialSource",
  "SqliteHelper",
  "LocalInstanceHosting",
  "creds/envelope",
];

// ---- 纯扫描函数（可单测）----

/**
 * @param {{path: string, bytes: Buffer}[]} files
 * @returns {{path: string, rule: string, detail: string}[]}
 */
function scanForServerLeaks(files) {
  const violations = [];
  for (const file of files) {
    const lowerPath = file.path.toLowerCase();
    for (const ext of SERVER_ARTIFACT_EXTENSIONS) {
      if (lowerPath.endsWith(ext)) {
        violations.push({ path: file.path, rule: "extension", detail: ext });
        break;
      }
    }
    let flags = null;
    for (const marker of SERVER_INTERNAL_MARKERS) {
      const index = file.bytes.toString("latin1").indexOf(marker);
      if (index !== -1) {
        flags = flags || [];
        flags.push(marker);
      }
    }
    if (flags) {
      violations.push({ path: file.path, rule: "marker", detail: flags.join(", ") });
    }
  }
  return violations;
}

// ---- 合成泄漏用例（钉住检测规则本身）----

test("守卫规则: 服务器源码扩展名被逐类拦下", () => {
  const leaks = scanForServerLeaks([
    { path: "Local/Services/LocalKeyMaterialStore.cs", bytes: Buffer.from("") },
    { path: "Local/Local.csproj", bytes: Buffer.from("x") },
    { path: "bin/Debug/HTW.Core.dll", bytes: Buffer.from("MZ") },
    { path: "bin/Debug/HTW.Core.pdb", bytes: Buffer.from("MZ") },
    { path: "local-instance.exe", bytes: Buffer.from("MZ") },
    { path: "runtimes/win/lib/htw.deps.json", bytes: Buffer.from("{}") },
  ]);
  assert.strictEqual(leaks.length, 6);
  assert.ok(leaks.every((v) => v.rule === "extension"));
});

test("守卫规则: 服务器实现面标识出现在跟踪文本里被拦下", () => {
  const leaks = scanForServerLeaks([
    { path: "js/app.js", bytes: Buffer.from('const k = "LocalKeyMaterialStore";') },
    { path: "docs/noted.md", bytes: Buffer.from("这是 HTWCore.Web 的 CredentialEnvelopeController 用法") },
    { path: "js/local.js", bytes: Buffer.from('fetch("/api/v2/creds/envelope")') },
  ]);
  assert.strictEqual(leaks.length, 3);
  assert.ok(leaks.every((v) => v.rule === "marker"));
  assert.match(leaks[0].detail, /LocalKeyMaterialStore/);
  assert.match(leaks[1].detail, /HTWCore.Web/);
  assert.match(leaks[2].detail, /creds\/envelope/);
});

test("守卫规则: 协议面引用不在标记名单里，一个都拦不到", () => {
  const clean = scanForServerLeaks([
    { path: "js/api.js", bytes: Buffer.from('const HEALTH = "/api/v2/local/health";') },
    { path: "js/local-capabilities.js", bytes: Buffer.from('const CAPS = "/api/v2/local/capabilities";') },
    { path: "js/local-supervisor.js", bytes: Buffer.from("[local-instance] listening http://127.0.0.1:51234") },
    { path: "README.md", bytes: Buffer.from("本地模式：能力清单由服务器下发。") },
  ]);
  assert.deepStrictEqual(clean, []);
});

// ---- 真实仓断言（铁律本体）----

function repoRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: path.resolve(__dirname, "..", ".."),
    encoding: "utf8",
  }).trim();
}

function trackedFiles() {
  const raw = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot() });
  return raw.toString("utf8").split("\0").filter(Boolean);
}

test("铁律: 跟踪文件里没有任何服务器源码/产物与实现面标识", () => {
  const root = repoRoot();
  const files = trackedFiles().map((rel) => ({
    path: rel,
    bytes: fs.readFileSync(path.join(root, rel)),
  }));
  const violations = scanForServerLeaks(files);
  assert.deepStrictEqual(
    violations,
    [],
    "铁律触发：以下跟踪文件含服务器仓源码/产物或实现面标识（本仓 public + MIT，进入即公开）：\n" +
      violations.map((v) => `  ${v.path} (${v.rule}: ${v.detail})`).join("\n")
  );
});
