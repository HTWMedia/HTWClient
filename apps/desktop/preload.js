// 注意：app / shell 是主进程模块，preload 里 require("electron") 拿不到它们
// （值为 undefined，调用会抛错）。所有需要它们的动作都走 IPC 交给 main.js。
const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const API_BASE = process.env.HTW_API_BASE || "https://htwmedia.dpdns.org";
// 可选的大文件直连通道：默认关闭（空串），此时所有请求都走 API_BASE。
// 自建部署若需要让大文件分片上传绕过反向代理，用环境变量 HTW_API_DIRECT 指定
// 直连地址即可；仓库里不内置任何源站 IP / 主机名。
const API_DIRECT = process.env.HTW_API_DIRECT || "";

function originOf(u) {
  try {
    const x = new URL(String(u));
    return x.protocol + "//" + x.host;
  } catch (e) { return ""; }
}

// 允许访问的服务端来源（origin）。
// window.htw 对渲染层完全可见，若不做白名单，页面里任何脚本都能让 preload 带着
// AuthKey 去连它自己指定的服务器 —— 凭据会被静默转发到第三方。
// 只放行内置的两个来源；用户在「设置」里填的自定义地址通过 registerBase 追加。
const BASE_ORIGINS = [originOf(API_BASE), originOf(API_DIRECT)].filter(Boolean);
// 只有显式配置了直连地址、且它是 http 明文时才放宽证书校验：
// 证书签发给域名，用 IP / 明文地址访问必然主机名不匹配。
// 未配置直连时该值为空串，任何请求都不会命中这个豁免。
const INSECURE_TLS_ORIGIN = /^http:\/\//.test(API_DIRECT) ? originOf(API_DIRECT) : "";

function isAllowedBase(u) {
  const o = originOf(u);
  return !!o && BASE_ORIGINS.indexOf(o) >= 0;
}
function registerBase(u) {
  const o = originOf(u);
  if (!o || !/^https?:\/\//.test(o)) return false;
  if (BASE_ORIGINS.indexOf(o) < 0) BASE_ORIGINS.push(o);
  return true;
}

function resolveBase(override) {
  return override || API_BASE;
}

// 超出白名单时统一回这个错，调用方（api.js）会原样显示给用户。
function baseRejected(base) {
  return {
    status: 0,
    ok: false,
    data: { errCode: "BASE_NOT_ALLOWED", errMsg: "已拒绝访问未登记的服务地址：" + String(base) + "。如需使用其它服务端地址，请到「设置」里填写。" },
  };
}

function configPath() {
  // 配置实际存于主进程；这里仅保留函数名以便阅读，真实读写走 IPC。
  return "htw-config.json";
}
// 读取持久化的 API 地址 / AuthKey（保存于应用数据目录，明文存储）。
function loadConfig() {
  return ipcRenderer.invoke("htw:loadConfig").catch(function () {
    return { apiBase: "", apiKey: "" };
  });
}
function saveConfig(cfg) {
  return ipcRenderer.invoke("htw:saveConfig", cfg || {}).catch(function () {
    return false;
  });
}

// 通用 JSON 存储（如聊天历史），写入 userData 下独立文件，避免与配置互相覆盖。
function jsonPath(name) {
  return "htw-" + name + ".json";
}
function saveJson(name, data) {
  return ipcRenderer.invoke("htw:saveJson", name, data).catch(function () { return false; });
}
function loadJson(name) {
  return ipcRenderer.invoke("htw:loadJson", name).catch(function () { return null; });
}

// Expose a minimal, safe API to the renderer. The actual request signing
// (AuthKey header) is done by the renderer; the key never leaves the client.
contextBridge.exposeInMainWorld("htw", {
  apiBase: API_BASE,
  directBase: API_DIRECT,
  // 用户在「设置」里填写的自定义服务端地址，必须先登记才能被 call/upload/download 使用。
  registerBase: (base) => registerBase(base),
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  saveJson: saveJson,
  loadJson: loadJson,
  // 在系统默认浏览器中打开外部链接（结果里的 URL 点击时用）。
  openExternal: (url) => {
    if (!url) return;
    ipcRenderer.invoke("htw:openExternal", String(url)).catch(function () { /* ignore */ });
  },
  // Generic V2 caller. `body` is optional (omitted => GET).
  // baseOverride 用于大文件直连通道（可选，需在「设置」或环境变量中配置）。
  call: async (method, path, body, apiKey, baseOverride) => {
    const base = resolveBase(baseOverride);
    if (!isAllowedBase(base)) return baseRejected(base);
    const headers = { AuthKey: apiKey || "" };
    const init = { method, headers };
    // GET / DELETE 等不带体的请求，body 必须是 undefined：
    // Chromium 的 fetch 遇到 method=GET 且 body 非空会直接抛
    // "Request with GET/HEAD method cannot have body"。
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  },
  // Multipart/form-data uploader. Mirrors `call` but streams a generated
  // multipart body via Node's http/https (Electron's net.request is fragile
  // from a preload context and throws "reading 'request'").
  // `filePaths` is an array of absolute path strings OR `{name, buffer}`
  // objects (where `buffer` is an ArrayBuffer from a renderer file input).
  // (method, path, filePaths, fields, headers, onProgress, fileField, baseOverride)
  upload: (method, path, filePaths, fields, headers, onProgress, fileField, baseOverride) => {
    return new Promise((resolve, reject) => {
      const boundary = crypto.randomBytes(16).toString("hex");
      const enc = (s) => Buffer.from(s, "utf-8");
      const parts = [];

      if (fields && typeof fields === "object") {
        for (const [k, v] of Object.entries(fields)) {
          const val = String(v);
          parts.push(enc(`--${boundary}\r\n`));
          parts.push(enc(`Content-Disposition: form-data; name="${k}"\r\n\r\n`));
          parts.push(enc(val));
          parts.push(enc("\r\n"));
        }
      }

      for (const f of filePaths || []) {
        let content;
        let safeName;
        if (typeof f === "string") {
          content = fs.readFileSync(f);
          safeName = path.basename(f).replace(/["\r\n]/g, "_");
        } else {
          content = Buffer.from(f.buffer);
          safeName = String(f.name || "file").replace(/["\r\n]/g, "_");
        }
        parts.push(enc(`--${boundary}\r\n`));
        const fieldName = fileField || "file";
        parts.push(
          enc(`Content-Disposition: form-data; name="${fieldName}"; filename="${safeName}"\r\n`)
        );
        parts.push(enc("Content-Type: application/octet-stream\r\n\r\n"));
        parts.push(content);
        parts.push(enc("\r\n"));
      }

      parts.push(enc(`--${boundary}--\r\n`));
      const bodyBuf = Buffer.concat(parts);

      let target;
      const base = resolveBase(baseOverride);
      if (!isAllowedBase(base)) {
        resolve(baseRejected(base));
        return;
      }
      try {
        target = new URL(`${base}${path}`);
      } catch (e) {
        resolve({ status: 0, ok: false, data: { errCode: 0, errMsg: "invalid url: " + e.message } });
        return;
      }

      const transport = target.protocol === "http:" ? http : https;
      const reqHeaders = {
        ...(headers || {}),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": bodyBuf.length,
      };

      // 只对内置直连源站关闭证书校验（证书签发给域名，用 IP 访问必然不匹配）。
      // 任意脚本传来的其它 base 一律正常校验，不再享受这个豁免。
      const tlsOpts = originOf(base) === INSECURE_TLS_ORIGIN ? { rejectUnauthorized: false } : {};
      const req = transport.request(
        {
          method,
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === "https:" ? 443 : 80),
          path: target.pathname + target.search,
          headers: reqHeaders,
          ...tlsOpts,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            let body;
            try { body = JSON.parse(text); } catch { body = text; }
            const ok = response.statusCode >= 200 && response.statusCode < 300;
            resolve({ status: response.statusCode, ok, data: body });
          });
        }
      );

      req.on("error", (err) =>
        resolve({ status: 0, ok: false, data: { errCode: 0, errMsg: err.message } })
      );

      // 分块写入以便回传进度：整块 write 时内核缓冲会一次性吞掉，
      // 界面只能显示"处理中…"。每块写完后回调 { loaded, total }。
      const CHUNK = 256 * 1024;
      const total = bodyBuf.length;
      let sent = 0;
      const report = () => {
        if (typeof onProgress !== "function") return;
        try { onProgress({ loaded: sent, total }); } catch (e) { /* 渲染层回调出错不能打断上传 */ }
      };
      const writeNext = () => {
        while (sent < total) {
          const end = Math.min(sent + CHUNK, total);
          const flushed = req.write(bodyBuf.subarray(sent, end));
          sent = end;
          report();
          if (!flushed) {
            // 内核缓冲满了，等 drain 再继续，否则会把整个文件堆在内存里。
            req.once("drain", writeNext);
            return;
          }
        }
        req.end();
      };
      if (total === 0) { report(); req.end(); }
      else writeNext();
    });
  },
  // 下载二进制（如成片视频）。桌面端用 AuthKey 头鉴权，无法像 web 端那样靠
  // 会话 Cookie 直接给 <video> 设 src，因此这里取 ArrayBuffer 回渲染进程转 Blob。
  download: async (method, path, apiKey, baseOverride) => {
    const base = resolveBase(baseOverride);
    if (!isAllowedBase(base)) return { status: 0, ok: false, data: null, error: "BASE_NOT_ALLOWED" };
    const headers = { AuthKey: apiKey || "" };
    // 单个体积上限（默认 64MB）。原来用 res.arrayBuffer() 整包入内存，
    // 大文件会直接把渲染进程撑爆；现在边收边统计，超限立刻中止并给出明确错误。
    const MAX_BYTES = Number(process.env.HTW_DOWNLOAD_MAX_BYTES || 64 * 1024 * 1024);
    try {
      const res = await fetch(`${base}${path}`, { method, headers });
      if (!res.ok) return { status: res.status, ok: false, data: null };
      const chunks = [];
      let size = 0;
      if (res.body && typeof res.body[Symbol.asyncIterator] === "function") {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > MAX_BYTES) {
            if (typeof res.body.cancel === "function") { try { res.body.cancel(); } catch (e) { /* ignore */ } }
            return { status: res.status, ok: false, data: null, error: "文件超过 " + Math.round(MAX_BYTES / 1024 / 1024) + "MB，已取消下载" };
          }
          chunks.push(chunk);
        }
      } else {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_BYTES) return { status: res.status, ok: false, data: null, error: "文件超过 " + Math.round(MAX_BYTES / 1024 / 1024) + "MB，已取消下载" };
        return { status: res.status, ok: true, data: buf };
      }
      const merged = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }
      return { status: res.status, ok: true, data: merged.buffer };
    } catch (e) {
      return { status: 0, ok: false, data: null, error: e.message };
    }
  },
});
