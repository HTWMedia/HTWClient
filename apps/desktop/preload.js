const { contextBridge, ipcRenderer, shell, app } = require("electron");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const API_BASE = process.env.HTW_API_BASE || "https://htwmedia.dpdns.org";
// 直连源站 IP：大文件直传走这里，绕过 Cloudflare 域名代理（域名对大文件上传很慢）。
// 可用环境变量 HTW_API_DIRECT 覆盖（如 https://123.57.217.155）。
const API_DIRECT = process.env.HTW_API_DIRECT || "http://123.57.217.155";

function resolveBase(override) {
  return override || API_BASE;
}

function configPath() {
  const dir = app.getPath("userData");
  return path.join(dir, "htw-config.json");
}
// 读取持久化的 API 地址 / AuthKey（保存于应用数据目录，明文存储）。
function loadConfig() {
  try {
    const p = configPath();
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf-8"));
      return { apiBase: j.apiBase || "", apiKey: j.apiKey || "" };
    }
  } catch (e) { /* ignore */ }
  return { apiBase: "", apiKey: "" };
}
function saveConfig(cfg) {
  try {
    const p = configPath();
    fs.writeFileSync(p, JSON.stringify({ apiBase: cfg.apiBase || "", apiKey: cfg.apiKey || "" }), "utf-8");
    return true;
  } catch (e) { return false; }
}

// 通用 JSON 存储（如聊天历史），写入 userData 下独立文件，避免与配置互相覆盖。
function jsonPath(name) {
  const dir = app.getPath("userData");
  return path.join(dir, "htw-" + name + ".json");
}
function saveJson(name, data) {
  try {
    fs.writeFileSync(jsonPath(name), JSON.stringify(data), "utf-8");
    return true;
  } catch (e) { return false; }
}
function loadJson(name) {
  try {
    const p = jsonPath(name);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) { /* ignore */ }
  return null;
}

// Expose a minimal, safe API to the renderer. The actual request signing
// (AuthKey header) is done by the renderer; the key never leaves the client.
contextBridge.exposeInMainWorld("htw", {
  apiBase: API_BASE,
  directBase: API_DIRECT,
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  saveJson: saveJson,
  loadJson: loadJson,
  // 在系统默认浏览器中打开外部链接（结果里的 URL 点击时用）。
  openExternal: (url) => {
    try { if (url) shell.openExternal(url); } catch (e) { /* ignore */ }
  },
  // Generic V2 caller. `body` is optional (omitted => GET).
  // baseOverride 用于大文件直连源站 IP（绕过域名代理）。
  call: async (method, path, body, apiKey, baseOverride) => {
    const base = resolveBase(baseOverride);
    const headers = { AuthKey: apiKey || "" };
    const init = { method, headers };
    if (body !== undefined) {
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

      // 直连源站 IP 时证书主机名通常不匹配（证书签发给域名），关闭校验避免 TLS 报错。
      const tlsOpts = baseOverride ? { rejectUnauthorized: false } : {};
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

      req.write(bodyBuf);
      req.end();
    });
  },
});
