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

  async function upload(method, path, filePaths, fields, onProgress) {
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
      const r = await fetcher(taskId);
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

