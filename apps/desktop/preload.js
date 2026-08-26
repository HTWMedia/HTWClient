const { contextBridge, ipcRenderer, net } = require("electron");
const fs = require("fs");

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
  // Multipart/form-data uploader. Mirrors `call` but streams a generated
  // multipart body via `net` (fetch cannot send multipart streams here).
  // (method, path, filePaths, fields, headers, onProgress)
  upload: (method, path, filePaths, fields, headers, onProgress) => {
    return new Promise((resolve, reject) => {
      const boundary = "----HTWFormBoundary" + Math.random().toString(16).slice(2);
      const enc = (s) => Buffer.from(s, "utf-8");
      const parts = [];

      if (fields && typeof fields === "object") {
        for (const [k, v] of Object.entries(fields)) {
          parts.push(enc(`--${boundary}\r\n`));
          parts.push(enc(`Content-Disposition: form-data; name="${k}"\r\n\r\n`));
          parts.push(enc(`${v}`));
          parts.push(enc("\r\n"));
        }
      }

      for (const fp of filePaths || []) {
        const content = fs.readFileSync(fp);
        const filename = fp.split(/[\\/]/).pop();
        parts.push(enc(`--${boundary}\r\n`));
        parts.push(
          enc(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`)
        );
        parts.push(enc("Content-Type: application/octet-stream\r\n\r\n"));
        parts.push(content);
        parts.push(enc("\r\n"));
      }

      parts.push(enc(`--${boundary}--\r\n`));
      const bodyBuf = Buffer.concat(parts);

      const reqHeaders = {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": bodyBuf.length,
        ...(headers || {}),
      };

      const req = net.request({
        method,
        url: `${API_BASE}${path}`,
        headers: reqHeaders,
      });

      if (typeof onProgress === "function") {
        req.on("uploadProgress", ({ position, total }) => {
          onProgress({
            loaded: position,
            total,
            percent: total ? position / total : 0,
          });
        });
      }

      req.on("error", (err) => reject(err));

      req.on("response", (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let body;
          try { body = JSON.parse(text); } catch { body = text; }
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ status: response.statusCode, body });
          } else {
            const err = new Error(
              `Upload failed with status ${response.statusCode}`
            );
            err.status = response.statusCode;
            err.body = body;
            reject(err);
          }
        });
      });

      req.write(bodyBuf);
      req.end();
    });
  },
});
