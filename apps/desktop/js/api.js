(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HTWApi = api;
})(typeof self !== "undefined" ? self : this, function () {
  let _key = "";
  let _base =
    (typeof window !== "undefined" && window.htw && window.htw.apiBase) ||
    "https://htwmedia.dpdns.org";

  function setKey(k) { _key = k || ""; }
  function setBase(b) { if (b) _base = b; }
  function authHeader() { return { AuthKey: _key }; }

  async function call(method, path, body) {
    const res = await window.htw.call(method, path, body, _key);
    return normalize(res);
  }

  // 单文件且超过该阈值时走分片上传，规避反向代理 / Cloudflare 的 body 大小限制 (413)。
  // 单片 < 1MB，确保即使默认 nginx client_max_body_size(1m) 也能直传通过。
  const CHUNK_SIZE = 800 * 1024;

  function genUploadId() {
    const buf = new Uint8Array(16);
    (window.crypto || self.crypto).getRandomValues(buf);
    let s = "";
    for (let i = 0; i < buf.length; i++) s += buf[i].toString(16).padStart(2, "0");
    return s;
  }

  async function chunkedUpload(method, path, file, fields, fileField) {
    const full = new Uint8Array(file.buffer);
    const uploadId = genUploadId();
    const total = Math.max(1, Math.ceil(full.length / CHUNK_SIZE));
    let failed = null;
    let next = 0;
    async function worker() {
      while (true) {
        const i = next++;
        if (i >= total || failed) return;
        const start = i * CHUNK_SIZE;
        const end = Math.min(full.length, start + CHUNK_SIZE);
        const chunkBuf = full.slice(start, end);
        try {
          const res = await window.htw.upload(
            "POST",
            "/api/v2/files/chunk",
            [{ name: file.name, buffer: chunkBuf }],
            { fileId: uploadId, index: String(i), total: String(total), fileName: file.name },
            authHeader()
          );
          const norm = normalize(res);
          if (!norm.ok) { failed = new Error("分片 " + i + " 上传失败: " + (norm.message || norm.code)); return; }
        } catch (e) { failed = e; return; }
      }
    }
    const workers = [];
    const concurrency = 4;
    for (let w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);
    if (failed) throw failed;
    return await call("POST", "/api/v2/files/complete", {
      fileId: uploadId,
      fileName: file.name,
      total: total,
      target: path,
      fileField: fileField || "file",
      fields: fields || {},
    });
  }

  async function upload(method, path, filePaths, fields, onProgress, fileField) {
    fileField = fileField || "file";
    if (
      Array.isArray(filePaths) &&
      filePaths.length === 1 &&
      filePaths[0] &&
      filePaths[0].buffer &&
      filePaths[0].buffer.byteLength > CHUNK_SIZE
    ) {
      try {
        return await chunkedUpload(method, path, filePaths[0], fields || {}, fileField);
      } catch (e) {
        console.warn("分片上传失败，回退为整文件上传:", e);
      }
    }
    const res = await window.htw.upload(method, path, filePaths, fields, authHeader(), onProgress);
    return normalize(res);
  }

  function normalize(res) {
    const d = res.data !== undefined ? res.data : res.body;
    if (res.ok && d && d.ok === true) return { ok: true, data: d.data, taskId: d.taskId || null };
    if (res.ok && d && d.ok === false) return { ok: false, code: d.errCode, message: d.errMsg, raw: d };
    if (!res.ok) return { ok: false, code: (d && d.errCode) || res.status, message: (d && d.errMsg) || ("HTTP " + res.status), raw: d };
    return { ok: true, data: d, taskId: (d && d.taskId) || null };
  }

  async function pollTask(taskId, opts) {
    opts = opts || {};
    const interval = opts.interval || 2000;
    const timeout = opts.timeout || 600000;
    const fetcher = opts.fetcher || ((id) => call("GET", "/api/v2/task/" + id));
    const start = Date.now();
    while (true) {
      let r;
      try {
        r = await fetcher(taskId);
      } catch (e) {
        return { ok: false, code: "NETWORK", message: e && e.message ? e.message : String(e), raw: e };
      }
      if (!r.ok) return { ok: false, code: r.code, message: r.message, raw: r.raw };
      const data = r.data || {};
      if (data.status === "failed") return { ok: false, code: data.errCode || "TASK_FAILED", message: data.errMsg || "task failed", raw: data };
      if (data.status === "done") return { ok: true, data: data.result !== undefined ? data.result : data, done: true, raw: data };
      if (Date.now() - start > timeout) return { ok: false, code: "TIMEOUT", message: "task timed out", raw: data };
      await new Promise((res) => setTimeout(res, interval));
    }
  }

  return { setKey: setKey, setBase: setBase, authHeader: authHeader, call: call, upload: upload, normalize: normalize, pollTask: pollTask, get base() { return _base; } };
});

