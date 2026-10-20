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

// streamId -> { req, ownerId }。同一 streamId 重复订阅复用既有连接，不重复发起。
// ownerId 是订阅发起方 webContents 的 id：窗口被关掉后要能只清理属于它的那几条，
// 否则多窗口场景下会把别人正在用的连接一起断掉。
const streams = new Map();

// streams Map 在上面；这里先定义两个连接层的时限常量
// STREAM_LIFETIME_MS：连接生命周期的硬上限。120 秒那个是**空闲**超时，
// 服务端每秒一次的 ": ka" 心跳会把它彻底废掉，所以真正的上界必须另设一条。
const STREAM_IDLE_TIMEOUT_MS = 120000;
// 服务端自己封顶 60 分钟；客户端取 65 分钟，稳稳高过它，
// 免得把服务端仍认作活着的连接提前砍掉。
const STREAM_LIFETIME_MS = 3900000;

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
  return { apiBase: j.apiBase || "", apiKey: j.apiKey || "", localBase: j.localBase || "" };
});
ipcMain.handle("htw:saveConfig", (_e, cfg) => {
  try {
    fs.writeFileSync(configPath(), JSON.stringify({ apiBase: (cfg && cfg.apiBase) || "", apiKey: (cfg && cfg.apiKey) || "", localBase: (cfg && cfg.localBase) || "" }), "utf-8");
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
  // 身份守卫：连接池按 streamId 索引，取消订阅后同名重订阅会把新连接登记到同一个键上。
  // 旧请求被 destroy() 后，它的迟到回调（ECONNRESET、socket 超时、响应 end/error）仍会照常触发；
  // 若不先确认"池里这条还是我自己这个 req"，旧回调就会把新连接正在用的条目删掉，
  // 还替新订阅发出终态事件 —— 结果是一条活得好好的连接被静默杀掉，而渲染层已经降级去轮询。
  // 所以下面每一个"删条目 / 发终态事件"的地方都要先过这一关，过不了就什么都不做。
  const isMine = () => {
    const cur = streams.get(streamId);
    return !!(cur && cur.req === req);
  };
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
      if (!isMine()) return;
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "error", payload: { status: res.statusCode } });
      return;
    }
    let remainder = "";
    res.setEncoding("utf-8");
    res.on("data", (chunk) => {
      if (!isMine()) return;
      const r = parseSseChunk(remainder, chunk);
      remainder = r.remainder;
      for (let i = 0; i < r.events.length; i++) {
        const ev = r.events[i];
        const terminal = ev.event === "end";
        // 先把终态事件发给渲染层，再释放连接，顺序不能反：反了就等于让它一直等下去。
        emit(sender, {
          streamId: streamId,
          type: terminal ? "end" : "data",
          payload: ev.data,
        });
        // 服务端发完结束事件并不会断开连接：它还有每秒一次的 ": ka" 心跳和 60 分钟的自保上限。
        // 而 res.on("end") 只有服务端真正关闭响应才会触发，120 秒空闲超时又因为数据一直在来而永远不触发。
        // 于是条目永久泄漏、socket 一直挂着；同一个 streamId 再次订阅还会命中复用分支，
        // 拿到一条已经把终态事件发完的连接，订阅方从此什么都收不到、只能干等到自己那次的超时。
        // 所以这条连接必须由我们自己来放。守卫仍要留着：过期请求不得去动别人的连接池条目。
        if (terminal && isMine()) {
          streams.delete(streamId);
          try { req.destroy(); } catch (e) { /* 已经断了 */ }
          break;
        }
      }
    });
    const bail = (err) => {
      if (!isMine()) return;
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "error", payload: { message: String((err && err.message) || err || "") } });
    };
    res.on("end", () => {
      if (!isMine()) return;
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "end", payload: "" });
    });
    res.on("error", bail);
  });

  req.on("error", (err) => {
    if (!isMine()) return;
    streams.delete(streamId);
    emit(sender, { streamId: streamId, type: "error", payload: { message: String(err.message || err) } });
  });
  // 半开连接（对端不回 FIN，Cloudflare 这类前置代理后面尤其常见）会让 socket 无限期挂着，
  // 连接池条目也永远清不掉。服务端约每秒发一次 ": ka" 心跳，正常连接不可能静默这么久，
  // 所以 120 秒内一个字节都没收到就判定连接已死：销毁并按 error 通知，
  // 渲染层收到后会降级到轮询，而不是卡在"进行中"。
  req.setTimeout(STREAM_IDLE_TIMEOUT_MS, () => {
    if (isMine()) {
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "error", payload: { message: "STREAM_TIMEOUT" } });
    }
    try { req.destroy(); } catch (e) { /* 已经断了 */ }
  });
  // 120 秒是**空闲**超时，而服务端每秒一次的 ": ka" 心跳会让它永远不触发，
  // 于是这条连接的上界只剩服务端自己的 60 分钟。对能推出终态的域无所谓（终态一到就收工），
  // 但推送里推不出终态的域（publish 的 status 可能为空、服务端也不当它终态）
  // 会一直挂着、记录一直显示「进行中」。所以这里再给一条生命周期上限：
  // 65 分钟（3900000 毫秒）比服务端的 60 分钟高，绝不会砍掉服务端仍认作活着的连接；
  // 到点销毁并按 error 通知，渲染层随即静默降级到轮询，由轮询去收敛。
  // 过期请求不得动别人的连接池条目，仍要过 isMine()。
  const lifetime = setTimeout(() => {
    if (isMine()) {
      streams.delete(streamId);
      emit(sender, { streamId: streamId, type: "error", payload: { message: "STREAM_LIFETIME_EXCEEDED" } });
    }
    try { req.destroy(); } catch (e) { /* 已经断了 */ }
  }, STREAM_LIFETIME_MS);
  // 终态事件到达时这条上限就没用了，提前撤掉，免得白留一个 65 分钟的定时器。
  req.on("close", () => { try { clearTimeout(lifetime); } catch (e) { /* 已触发 */ } });
  // 先入池再 end()：目前两者在同一个同步片段里，顺序看不出差别，但一旦日后有人在这里插入任何
  // 会让出事件循环的东西，注册的回调就会看到"条目不存在"，isMine() 一律为假而静默跳过工作。
  // 登记在前，setup 阶段的这个竞态就不存在了。
  streams.set(streamId, { req: req, ownerId: sender.id });
  // 必须显式结束请求：http.request 只把请求行挂起排队，不会替你把没有请求体的请求发出去，
  // 忘了这一句服务端什么都收不到、连接只会干等到超时——看起来就像"服务端不支持推送"。
  // http.get 之所以存在，就是因为它替你做了这一句。
  req.end();
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

  // 窗口没了，它发起的 SSE 长连接必须跟着断。macOS 上关掉最后一个窗口不会退出进程，
  // 全局兜底只剩 before-quit 那一条，等不到；连接会一直挂着、服务端还在推，
  // emit 每次都吞掉"Object has been destroyed"，连接池里的条目也永远清不掉。
  // 只按 webContents id 清理属于这个窗口的连接，多窗口时不会误伤别人正在用的。
  const wcId = win.webContents.id;
  const dropOwnedStreams = () => {
    streams.forEach((s, id) => {
      if (s.ownerId !== wcId) return;
      try { s.req.destroy(); } catch (e) { /* 已经断了 */ }
      streams.delete(id);
    });
  };
  win.on("closed", dropOwnedStreams);
  // 渲染进程崩溃同样不会触发 closed，销毁时一并清理。
  win.webContents.on("destroyed", dropOwnedStreams);

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
