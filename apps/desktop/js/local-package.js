// 本地更新包的下载校验与解压（设计：2026-10-24 本地包分发与一键更新 §3.1）。
//
// 为什么独立成模块而不直接写在 preload.js：这两件事的真实行为必须能被
// node --test 直测（真实小文件实算 sha256、真实 tar 解小 zip），preload.js
// 只有挂上 electron 桩才能加载。独立成模块后测试可以直接 require，
// 行为验证不必退化为"源码里有没有某个词"的静态形状守卫。
// preload.js 只做两件事：url 白名单闸门（BASE_ORIGINS 只在 preload 有一份）
// 与转发 —— 闸门不在本模块，因为登记来源（registerBase）是 preload 的状态。

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");

// 下载并校验更新包。入参 { url, headers, destPath, expectedSha256 }。
// 返回 { ok:true, sizeBytes, sha256 } 或 { ok:false, message }（message 是人话）。
//
// 做法与既有 call/download 一致：fetch（自动跟随重定向）+ 对响应体逐块异步迭代，
// 边收边写临时文件、边算 sha256 —— 包可能有几百 MB，绝不整包入内存。
// 校验通过才把临时文件改名为目标路径：落盘的要么是完整正确的包，要么什么都没有。
async function downloadPackage(opts) {
  const url = String((opts && opts.url) || "");
  const destPath = String((opts && opts.destPath) || "");
  const expectedSha256 = String((opts && opts.expectedSha256) || "").trim().toLowerCase();
  const headers = (opts && opts.headers) || {};

  if (!url || !destPath || !expectedSha256) {
    return { ok: false, message: "下载参数不完整：需要下载地址、保存路径与校验值。" };
  }

  const tempPath = destPath + ".part";
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;

  let res;
  try {
    res = await fetch(url, { method: "GET", headers: headers });
  } catch (e) {
    // 与 upload 的网络失败出口同一口径：中性中文陈述，不透英文原文。
    return { ok: false, message: "网络连接失败，请检查网络或服务器状态。" };
  }
  if (!res.ok) {
    // 读掉响应体再放弃，连接才能被正常回收。
    try { await res.arrayBuffer(); } catch (e) { /* 断就断了 */ }
    return { ok: false, message: "下载失败：服务器返回状态 " + res.status + "。" };
  }

  try {
    const out = fs.createWriteStream(tempPath);
    let writeErr = null;
    out.on("error", (e) => { writeErr = e; });
    try {
      for await (const chunk of res.body) {
        hash.update(chunk);
        sizeBytes += chunk.length;
        if (!out.write(chunk)) {
          // 落盘慢于网络时等 drain，否则整个包会堆在内存里。
          await new Promise((resolve) => out.once("drain", resolve));
        }
        if (writeErr) throw writeErr;
      }
      out.end();
      await new Promise((resolve, reject) => {
        out.on("finish", resolve);
        out.on("error", reject);
      });
    } finally {
      // 无论哪一步失败，先把流关掉再谈清理，免得句柄悬着。
      try { out.destroy(); } catch (e) { /* 已关闭 */ }
    }
  } catch (e) {
    cleanupTemp(tempPath);
    return { ok: false, message: "下载更新包失败：文件写入本地磁盘出错，请检查保存位置是否可用。" };
  }

  const sha256 = hash.digest("hex");
  if (sha256 !== expectedSha256) {
    // 校验失败 = 拿到的不是清单承诺的那个包，绝不能留到目标路径上。
    cleanupTemp(tempPath);
    return { ok: false, message: "更新包校验失败：下载内容与清单中的校验值不一致，已删除下载内容。请重试；若反复失败请联系管理员。" };
  }

  try {
    fs.renameSync(tempPath, destPath);
  } catch (e) {
    cleanupTemp(tempPath);
    return { ok: false, message: "下载更新包失败：文件无法放到目标位置（可能被占用），请重试。" };
  }
  return { ok: true, sizeBytes: sizeBytes, sha256: sha256 };
}

function cleanupTemp(tempPath) {
  try { fs.unlinkSync(tempPath); } catch (e) { /* 本来就不在 */ }
}

// 解压用哪个 tar：Windows 10+ 自带的是 System32 里的 bsdtar（能解 zip）。
// 刻意显式指过去而不裸写 "tar"：Git Bash 一类开发环境的 PATH 前段可能挂着
// GNU tar —— 它解不了 zip（退出码 128），应用从那种终端启动就会莫名失败。
// System32 不存在（理论上不会）再退回 "tar"，交给 PATH。
function tarCommand() {
  if (process.platform !== "win32") return "tar";
  const sysTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  try {
    if (fs.existsSync(sysTar)) return sysTar;
  } catch (e) { /* 探测失败就走 PATH */ }
  return "tar";
}

// 解压更新包。入参 { zipPath, destDir }；destDir 必须已存在（由调用方建好）。
// 返回 { ok:true } 或 { ok:false, message }（message 是人话）。
//
// 用 Windows 10+ 自带的 tar 解压（零 npm 依赖）。spawn 参数一律数组形式，
// 不拼 shell 字符串 —— 路径来自用户配置，拼接等于把空格和特殊字符变成漏洞。
function extractPackage(opts) {
  const zipPath = String((opts && opts.zipPath) || "");
  const destDir = String((opts && opts.destDir) || "");
  const spawnFn = (opts && opts.spawnFn) || spawn; // 注入点：测试用它桩掉 tar 或模拟缺失

  return new Promise((resolve) => {
    if (!zipPath || !destDir) {
      resolve({ ok: false, message: "解压参数不完整：需要更新包路径与目标目录。" });
      return;
    }
    let st = null;
    try { st = fs.statSync(destDir); } catch (e) { /* 读不到就当不存在 */ }
    if (!st || !st.isDirectory()) {
      resolve({ ok: false, message: "目标目录不存在：" + destDir + "。解压前需要先建好该目录。" });
      return;
    }

    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };

    let child;
    try {
      child = spawnFn(tarCommand(), ["-xf", zipPath, "-C", destDir], { windowsHide: true });
    } catch (e) {
      finish({ ok: false, message: "解压更新包失败：无法启动解压程序。" });
      return;
    }
    child.on("error", (e) => {
      if (e && e.code === "ENOENT") {
        // 老系统没有自带 tar：人话报错，不给 "ENOENT" 原文。
        finish({ ok: false, message: "系统缺少 tar，无法解压更新包。" });
      } else {
        finish({ ok: false, message: "解压更新包失败：解压程序启动出错。" });
      }
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ ok: true });
      } else {
        finish({ ok: false, message: "解压更新包失败（解压程序退出码 " + code + "）。请重试；若反复失败，更新包可能已损坏。" });
      }
    });
  });
}

// 为新版本目录做准备（**独占创建**：已存在即失败，绝不覆盖）。
// 入参 destDir；返回 { ok:true } 或 { ok:false, message }（message 是人话）。
//
// extractPackage 只挡"目录不存在"，不校验目录空不空（信任调用方）——
// 这里的职责就是把"调用方保证"落成代码：目录要么是刚建出来的（必然为空），
// 要么就报错不解压。已有同名目录（上次更新留下的半成品 / 用户自己的文件）
// 一律停手，覆盖别人的文件比让用户手动删一次目录糟糕得多。
function ensureNewDir(destDir) {
  const d = String(destDir || "");
  if (!d) {
    return { ok: false, message: "更新目录未指定，无法准备解压位置。" };
  }
  let st = null;
  try { st = fs.statSync(d); } catch (e) { /* 读不到 = 不存在，正是要建的新目录 */ }
  if (st) {
    return { ok: false, message: "更新目录已存在：" + d + "。为避免覆盖已有文件，本次更新已停止；可手动删除该目录后重试。" };
  }
  try {
    // 非递归：父目录必须已存在（父目录是本地实例所在目录，本就存在）。
    fs.mkdirSync(d);
  } catch (e) {
    return { ok: false, message: "无法创建更新目录：" + d + "。请检查磁盘空间与权限后重试。" };
  }
  return { ok: true };
}

module.exports = { downloadPackage, extractPackage, ensureNewDir };
