(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HTWApi = api;
})(typeof self !== "undefined" ? self : this, function () {
  let _key = "";
  let _base =
    (typeof window !== "undefined" && window.htw && window.htw.apiBase) ||
    "https://htwmedia.dpdns.org";
  // 大文件直连源站 IP（绕过域名代理，上传更快）。可用 setDirectBase 覆盖。
  let _directBase =
    (typeof window !== "undefined" && window.htw && window.htw.directBase) ||
    "http://123.57.217.155";

  function setKey(k) { _key = k || ""; }
  function setBase(b) { if (b) _base = b; }
  function setDirectBase(b) { if (b) _directBase = b; }
  function hasKey() { return !!_key; }
  function authHeader() { return { AuthKey: _key }; }

  function keyError() {
    const e = new Error("未设置 AuthKey：请到左侧「设置」填写，或点击「前往 web 端获取 AuthKey」。所有功能都需要 AuthKey 验证。");
    e.authMissing = true;
    return e;
  }

  async function call(method, path, body, baseOverride) {
    if (!_key) throw keyError();
    const res = await window.htw.call(method, path, body, _key, baseOverride);
    return normalize(res);
  }

  // 单文件且超过该阈值时走分片上传，规避反向代理 / Cloudflare 的 body 大小限制 (413)。
  // 单片 10MB；需确保反向代理 client_max_body_size >= 单片大小（建议 16m），Cloudflare 免费版单请求 100MB 上限内。
  const CHUNK_SIZE = 10 * 1024 * 1024;

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
    // 大文件走直连源站 IP（_directBase），绕过域名代理以加速上传。
    const uploadBase = _directBase;
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
            authHeader(),
            null,
            null,
            uploadBase
          );
          const norm = normalize(res);
          if (!norm.ok) { const e = new Error("分片 " + i + " 上传失败: " + (norm.message || norm.code)); e.httpError = true; failed = e; return; }
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
    }, uploadBase);
  }

  async function upload(method, path, filePaths, fields, onProgress, fileField) {
    if (!_key) throw keyError();
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
        // 服务端明确拒绝分片（如缺少 /api/v2/files/chunk 端点）时，不要再回退为整文件上传：
        // 大文件直传必然被反向代理以 413 / 连接重置（"socket hang up"）拒绝，回退只会掩盖真正原因。
        if (e && e.httpError) throw e;
        console.warn("分片上传失败，回退为整文件上传:", e);
      }
    }
    const res = await window.htw.upload(method, path, filePaths, fields, authHeader(), onProgress, fileField);
    return normalize(res);
  }

  function normalize(res) {
    const d = res.data !== undefined ? res.data : res.body;
    if (!d || typeof d !== "object") {
      return { ok: !!res.ok, data: d, taskId: null, code: res.status, message: res.ok ? "" : ("HTTP " + res.status) };
    }
    // 服务端信封字段大小写不固定：Ok/Ok、Data/data、ErrCode/errCode、ErrMsg/errMsg、TaskId/taskId 都兼容。
    const ok = d.ok !== undefined ? d.ok : d.Ok;
    const data = d.data !== undefined ? d.data : d.Data;
    const code = d.errCode !== undefined ? d.errCode : d.ErrCode;
    const msg = d.errMsg !== undefined ? d.errMsg : d.ErrMsg;
    const taskId = d.taskId !== undefined ? d.taskId : d.TaskId;
    if (res.ok && ok === true) return { ok: true, data: data, taskId: taskId || null };
    if (res.ok && ok === false) return { ok: false, code: code, message: msg, raw: d };
    if (!res.ok) return { ok: false, code: code || res.status, message: msg || ("HTTP " + res.status), raw: d };
    return { ok: true, data: data !== undefined ? data : d, taskId: taskId || null };
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

  const get = (p) => call("GET", p);
  const post = (p, b) => call("POST", p, b);
  return { setKey: setKey, setBase: setBase, setDirectBase: setDirectBase, hasKey: hasKey, authHeader: authHeader, call: call, get: get, post: post, upload: upload, normalize: normalize, pollTask: pollTask, get base() { return _base; }, get directBase() { return _directBase; } };
});

