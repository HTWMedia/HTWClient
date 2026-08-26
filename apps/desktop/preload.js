const { contextBridge, ipcRenderer } = require("electron");

const API_BASE = process.env.HTW_API_BASE || "https://htwmedia.dpdns.org";

// Expose a minimal, safe API to the renderer. The actual request signing
// (AuthKey header) is done by the renderer; the key never leaves the client.
contextBridge.exposeInMainWorld("htw", {
  apiBase: API_BASE,
  // Generic V2 caller. `body` is optional (omitted => GET).
  call: async (method, path, body, apiKey) => {
    const headers = { AuthKey: apiKey || "" };
    const init = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(`${API_BASE}${path}`, init);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  },
});
