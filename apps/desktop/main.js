const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { parseSseChunk } = require("./js/sse-parser.js");

Menu.setApplicationMenu(null);

// SSE 允许访问的来源。preload 是信任边界（它持有 AuthKey 与来源白名单），
// 但主进程自己也要有一份：preload 只把已放行的 origin 通过 htw:allowBase 同步过来，
// 主进程再独立校验一次。两处都查才不会出现"渲染层换个地址就让 preload 带密钥去连"。
const allowedOrigins = new Set();
function originOf(u) {
  try {
    const x = new URL(String(u));
    return x.protocol + "//" + x.host;
  } catch (e) { return ""; }
}
allowedOrigins.add(originOf(process.env.HTW_API_BASE || "https://htwmedia.dpdns.org"));
if (process.env.HTW_API_DIRECT) allowedOrigins.add(originOf(process.env.HTW_API_DIRECT));

// streamId -> { req }。同一 streamId 重复订阅复用既有连接，不重复发起。
const streams = new Map();

// 持久化目录：Electron 的 app / shell 是主进程模块，preload 里取不到，
// 因此配置的读写一律由主进程代劳，preload 只通过 IPC 调用。
function userDir() {
  return app.getPath("userData");
}
function configPath() {
  return path.join(userDir(), "htw-config.json");
}
function jsonPath(name) {
  return path.join(userDir(), "htw-" + name + ".json");
}
function readJsonFile(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) { /* 读不到就当没有配置 */ }
  return fallback;
}

ipcMain.handle("htw:loadConfig", () => {
  const j = readJsonFile(configPath(), null) || {};
  return { apiBase: j.apiBase || "", apiKey: j.apiKey || "" };
});
ipcMain.handle("htw:saveConfig", (_e, cfg) => {
  try {
    fs.writeFileSync(configPath(), JSON.stringify({ apiBase: (cfg && cfg.apiBase) || "", apiKey: (cfg && cfg.apiKey) || "" }), "utf-8");
    return true;
  } catch (e) { return false; }
});
ipcMain.handle("htw:loadJson", (_e, name) => readJsonFile(jsonPath(String(name || "")), null));
ipcMain.handle("htw:saveJson", (_e, name, data) => {
  try {
    fs.writeFileSync(jsonPath(String(name || "")), JSON.stringify(data), "utf-8");
    return true;
  } catch (e) { return false; }
});
ipcMain.handle("htw:openExternal", (_e, url) => {
  try { if (url) shell.openExternal(String(url)); return true; } catch (e) { return false; }
});

ipcMain.on("htw:allowBase", (_e, base) => {
  const o = originOf(base);
  if (o) allowedOrigins.add(o);
});

function emit(sender, msg) {
  try { sender.send("htw:stream-event", msg); } catch (e) { /* 窗口已销毁 */ }
}

ipcMain.handle("htw:subscribe", (e, opts) => {
  const streamId = String((opts && opts.streamId) || "");
  const domain = String((opts && opts.domain) || "");
  const taskId = String((opts && opts.taskId) || "");
  const base = String((opts && opts.base) || "");
  if (!streamId || !domain || !taskId) return { ok: false, errMsg: "订阅参数缺失" };
  if (streams.has(streamId)) return { ok: true, reused: true };

  const o = originOf(base);
  if (!o || !allowedOrigins.has(o)) return { ok: false, errMsg: "BASE_NOT_ALLOWED" };

  let target;
  try {
    target = new URL(base.replace(/\/+$/, "") + "/api/v2/stream/"
      + encodeURIComponent(domain) + "/" + encodeURIComponent(taskId));
  } catch (err) {
    return { ok: false, errMsg: "invalid url: " + err.message };
  }

  const sender = e.sender;
  const transport = target.protocol === "http:" ? http : https;
  const req = transport.request({
    method: "GET",
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: target.pathname + target.search,
    headers: {
      AuthKey: String((opts && opts.apiKey) || ""),
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  }, (res) => {
    // 非 200 = 认证失败或任务不存在。读掉响应体并断开，让客户端降级到轮询。
    if (res.statusCode !== 200) {
      res.resume();
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "error", payload: { status: res.statusCode } });
      return;
    }
    let remainder = "";
    res.setEncoding("utf-8");
    res.on("data", (chunk) => {
      const r = parseSseChunk(remainder, chunk);
      remainder = r.remainder;
      for (let i = 0; i < r.events.length; i++) {
        const ev = r.events[i];
        emit(sender, {
          streamId: streamId,
          type: ev.event === "end" ? "end" : "data",
          payload: ev.data,
        });
      }
    });
    const bail = (err) => {
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "error", payload: { message: String((err && err.message) || err || "") } });
    };
    res.on("end", () => { streams.delete(streamId); emit(sender, { streamId: streamId, type: "end", payload: "" }); });
    res.on("error", bail);
  });

  req.on("error", (err) => {
    streams.delete(streamId);
    emit(sender, { streamId: streamId, type: "error", payload: { message: String(err.message || err) } });
  });
  streams.set(streamId, { req: req });
  return { ok: true };
});

ipcMain.on("htw:unsubscribe", (_e, streamId) => {
  const s = streams.get(String(streamId || ""));
  if (!s) return;
  try { s.req.destroy(); } catch (e) { /* 已经断了 */ }
  streams.delete(String(streamId));
});

// 退出前把所有长连接断掉：进程不退的话，Cloudflare 侧的连接会一直挂到超时。
app.on("before-quit", () => {
  streams.forEach((s) => { try { s.req.destroy(); } catch (e) { /* ignore */ } });
  streams.clear();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 结果区「下载视频」是 <a download> 指向服务端下发的 CDN 直链。
  // Electron 默认不处理 will-download，下载会被静默取消 —— 必须显式指定保存路径。
  win.webContents.session.on("will-download", (_event, item) => {
    try {
      let name = item.getFilename() || "download";
      // <a download="xxx.mp4"> 时 getFilename 已是建议名，这里只需补目录。
      item.setSavePath(path.join(app.getPath("downloads"), name));
    } catch (e) { /* 保存路径设置失败就让下载走默认行为 */ }
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
