const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

Menu.setApplicationMenu(null);

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
