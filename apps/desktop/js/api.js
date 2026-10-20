(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HTWApi = api;
})(typeof self !== "undefined" ? self : this, function () {
  let _key = "";
  let _base =
    (typeof window !== "undefined" && window.htw && window.htw.apiBase) ||
    "https://htwmedia.dpdns.org";
  // 可选的大文件直连通道：默认空串（走 _base）。自建部署需要让分片上传绕过
  // 反向代理时，可用 setDirectBase 或环境变量 HTW_API_DIRECT 指定。
  let _directBase =
    (typeof window !== "undefined" && window.htw && window.htw.directBase) || "";
  // 本地服务的请求基地址：默认空串（不启用本地模式）。与 _directBase 同为可选通道，
  // 由设置面板通过 setLocalBase 注入并登记到 preload 白名单。
  let _localBase =
    (typeof window !== "undefined" && window.htw && window.htw.localBase) || "";

  // 4007 = 本地执行不可用（服务器侧的机器契约）。同一症状只留一个出口：
  // 客户端一律显示这句中性文案，内部细节（额度确认之类）不外泄给用户。
  const LOCAL_UNAVAILABLE_CODE = 4007;
  const LOCAL_UNAVAILABLE_MESSAGE = "本地执行不可用，请检查网络或服务器状态。";

  // 云端（服务器）连不上时的中性文案。
  // 🔴 与上面那句是**两种不同的症状**，必须分开：
  // 「本地执行不可用」说的是本机实例连不上，「无法连接服务器」说的是云端服务器连不上。
  // 合成一句，用户既不知道该看本机还是该看网络。
  const CLOUD_UNREACHABLE_MESSAGE = "无法连接服务器，请检查网络或服务器地址。";

  function setKey(k) { _key = k || ""; }
  // 改服务端地址必须先向 preload 登记：preload 只向白名单内的来源发请求，
  // 否则任何页面脚本都能让 preload 带着 AuthKey 去连它指定的服务器。
  // （以前 setBase 只改了这里，请求仍发往 preload 内置的默认地址 —— 设置面板填的地址根本没生效。）
  function setBase(b) {
    if (!b) return;
    if (window.htw && window.htw.registerBase) window.htw.registerBase(b);
    _base = b;
  }
  function setDirectBase(b) {
    if (!b) return;
    if (window.htw && window.htw.registerBase) window.htw.registerBase(b);
    _directBase = b;
  }

  // 本地实例地址的归一化：口径只有一份，在 js/local.js 的 normalizeLocalBase
  // （去尾斜杠 + 拒绝带路径 + 强制回环）。这里不重复实现那三条规则。
  // 载入时 window.HTWLocal 可能还没就位，那时退回「仅去尾斜杠」的最小归一化；
  // 准入由应用层（app.js 的 applyLocal）把关 —— 两处都把关，才不会因加载顺序漏掉。
  function normalizeLocalBaseValue(b) {
    const L = (typeof window !== "undefined" && window.HTWLocal) || null;
    if (L && typeof L.normalizeLocalBase === "function") return L.normalizeLocalBase(b);
    const raw = typeof b === "string" ? b.trim() : "";
    if (!raw) return { ok: true, base: "", empty: true };
    return { ok: true, base: raw.replace(/\/+$/, "") };
  }

  // 保存本地实例地址。返回 { ok, base, reason? }：
  //  - ok:true  → 已归一化、已登记到 preload 白名单、生效；
  //  - ok:false → **没有登记、没有生效**（调用方据此不落盘，并给出明确文案）。
  function setLocalBase(b) {
    const n = normalizeLocalBaseValue(b);
    if (!n.ok) return { ok: false, base: "", reason: n.reason || "format" };
    if (n.empty) { _localBase = ""; return { ok: true, base: "" }; }
    if (window.htw && window.htw.registerBase) {
      const ok = window.htw.registerBase(n.base);
      // 🔴 registerBase 的返回值必须看：它 false 的唯一原因是地址格式非法
      // （不是 http/https）。没被登记的地址 preload 那边会直接回 BASE_NOT_ALLOWED，
      // 请求根本发不出去 —— 与其让用户看到一句含糊的「连不上」，不如当场说清格式不对。
      if (ok === false) return { ok: false, base: "", reason: "format" };
    }
    _localBase = n.base;
    return { ok: true, base: n.base };
  }
  function hasKey() { return !!_key; }
  function authHeader() { return { AuthKey: _key }; }

  function keyError() {
    const e = new Error("未设置 AuthKey：请到左侧「设置」填写，或点击「前往 web 端获取 AuthKey」。所有功能都需要 AuthKey 验证。");
    e.authMissing = true;
    return e;
  }

  // 网络类失败的判定：连接被拒 / 超时 / fetch 本身失败。
  // 只有这一类失败才算"本地执行不可用"；别的异常（代码错误、鉴权错误等）
  // 一律原样抛出去 —— 吞掉的话真正的错误会被一句通用文案盖住，用户既看不到
  // 原因，也没法自己绕开。
  function isNetworkFailure(e) {
    if (!e) return false;
    // Chromium 的 fetch 失败就是 TypeError("fetch failed")。
    if (e instanceof TypeError) return true;
    const msg = String((e && e.message) || e || "").toLowerCase();
    if (!msg) return false;
    return /fetch failed|failed to fetch|econnrefused|econnreset|etimedout|ehostunreach|enetunreach|enotfound|epipe|socket hang up|network error|err_connection_refused|err_connection_reset|err_timed_out|err_name_not_resolved|err_internet_disconnected/.test(msg);
  }

  async function call(method, path, body, baseOverride) {
    if (!_key) throw keyError();
    // 默认带上当前服务端地址：不传的话 preload 会退回它的内置默认值，
    // 「设置」里改过的地址就失效了。
    const target = baseOverride || _base;
    let res;
    try {
      res = await window.htw.call(method, path, body, _key, target);
    } catch (e) {
      // 本地基地址连不上（fetch failed / 连接被拒）与 4007 是同一个症状，
      // 走同一个出口；只限网络类失败，其它异常原样抛出去，不被这里吞掉。
      if (_localBase && target === _localBase && isNetworkFailure(e))
        return { ok: false, code: LOCAL_UNAVAILABLE_CODE, localUnavailable: true,
          message: LOCAL_UNAVAILABLE_MESSAGE, raw: e };
      // 云端（服务器）连不上：把英文原文（Chromium 的 "fetch failed"）换成一句中性文案。
      // 原来这里原样抛出去，界面上就蹦出一句英文，用户既看不懂也不知道该查什么。
      // 仍然**抛出去**（不改成返回值）：抛与不抛是调用方的既有契约，只换文案。
      if (target !== _localBase && isNetworkFailure(e)) {
        const err = new Error(CLOUD_UNREACHABLE_MESSAGE);
        err.cause = e;
        throw err;
      }
      throw e;
    }
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

  async function chunkedUpload(method, path, file, fields, fileField, onProgress) {
    const full = new Uint8Array(file.buffer);
    const uploadId = genUploadId();
    const total = Math.max(1, Math.ceil(full.length / CHUNK_SIZE));
    // 大文件走分片上传；若配置了直连通道（_directBase）则走它，否则走 _base。
    const uploadBase = _directBase;
    let failed = null;
    let next = 0;
    let done = 0;
    const report = () => {
      if (typeof onProgress !== "function") return;
      try { onProgress({ loaded: Math.min(full.length, done * CHUNK_SIZE), total: full.length }); } catch (e) { /* ignore */ }
    };
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
          done++;
          report();
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

  // 多文件走整包上传时的体积上限（Cloudflare 免费版单请求 100MB）：
  // 分片接口一次只能合并出一个文件，多文件没法分片，超限时必须明确报错，
  // 否则只会被反向代理以 413 / 连接重置拒绝，界面上表现为"提交失败"却看不出原因。
  const MULTI_MAX_TOTAL = 100 * 1024 * 1024;

  async function upload(method, path, filePaths, fields, onProgress, fileField) {
    if (!_key) throw keyError();
    fileField = fileField || "file";
    const list = Array.isArray(filePaths) ? filePaths : [];
    const bigOne = list.length === 1 && list[0] && list[0].buffer && list[0].buffer.byteLength > CHUNK_SIZE;
    if (bigOne) {
      try {
        return await chunkedUpload(method, path, list[0], fields || {}, fileField, onProgress);
      } catch (e) {
        // 一律不回退为整文件上传：大文件直传必然被反向代理以 413 / 连接重置
        // （"socket hang up"）拒绝，回退只会用第二个更难懂的错误盖掉真正的原因。
        throw e;
      }
    }
    if (list.length > 1) {
      let total = 0;
      for (const f of list) total += (f && f.buffer && f.buffer.byteLength) || 0;
      if (total > MULTI_MAX_TOTAL) {
        throw new Error(
          "素材总大小 " + (total / 1024 / 1024).toFixed(1) + "MB，超过单次上传上限 100MB。" +
          "请减少单次上传的文件数量或压缩后重试（多文件暂不支持分片上传）。"
        );
      }
    }
    const res = await window.htw.upload(method, path, filePaths, fields, authHeader(), onProgress, fileField, _base);
    return normalize(res);
  }

  // 后端 MVC 走 AddNewtonsoftJson + DefaultContractResolver：POCO / DTO 一律 PascalCase
  // 输出，只有匿名投影里手写的小写字段才是小写（如 { date, cards }、{ sessionId, step }）。
  // 渲染层统一按 camelCase 读取，这里对 data 做一次深度转换，避免每个面板各自踩大小写坑。
  // 缩写开头（URL、CDNId…）保持原样，避免 Url -> uRL 之类的误伤。
  const ACRONYM_PREFIX = /^[A-Z]{2,}/;
  function camelKey(k) {
    if (typeof k !== "string" || !k) return k;
    if (ACRONYM_PREFIX.test(k)) return k;
    if (k[0] >= "A" && k[0] <= "Z") return k[0].toLowerCase() + k.slice(1);
    return k;
  }
  function camelize(v) {
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(camelize);
    const out = {};
    for (const k of Object.keys(v)) out[camelKey(k)] = camelize(v[k]);
    return out;
  }

  // 402 = 免费额度用尽。它是账号级状态，不是某个面板的错，所以不塞进各自的格式函数里
  // （那里有 40 处调用，且 shortdrama/marketing 走的是自己的 setErr）。
  // 这里识别出来后回调给 app.js 弹一条全局横幅，所有面板、所有错误路径都覆盖到。
  let _quotaHandler = null;
  function onQuotaExceeded(fn) { _quotaHandler = typeof fn === "function" ? fn : null; }

  function fireQuotaExceeded(raw) {
    if (!_quotaHandler) return;
    const url = (raw && (raw.redirectUrl || raw.RedirectUrl)) || "/Home/Recharge";
    try { _quotaHandler({ redirectUrl: url, message: (raw && (raw.error || raw.Error)) || "" }); } catch (e) { /* ignore */ }
  }

  function isLocalUnavailableCode(code) {
    if (code === undefined || code === null || code === "") return false;
    return Number(code) === LOCAL_UNAVAILABLE_CODE;
  }

  // 失败侧统一形状：{ ok:false, code, message, raw }。
  // 4007 再多带一个 localUnavailable 标记，界面据此走本地模式的专用提示。
  function failShape(code, message, raw) {
    if (isLocalUnavailableCode(code))
      return { ok: false, code: LOCAL_UNAVAILABLE_CODE, localUnavailable: true,
        message: LOCAL_UNAVAILABLE_MESSAGE, raw: raw };
    return { ok: false, code: code, message: message, raw: raw };
  }

  // 失败壳的判据：顶层 errCode/ErrCode 存在，且不是 0。
  // errCode:0 表示"没有错误"，不能判成失败 —— 判错了就是一次成功的响应被报成失败。
  // errCode 缺失的壳也不算失败壳（那是另一个形状：有 ok/Ok 时由 ok/Ok 判定）。
  function isFailureShellCode(code) {
    if (code === undefined || code === null || code === "") return false;
    return Number(code) !== 0;
  }

  function normalize(res) {
    const d = res.data !== undefined ? res.data : res.body;
    if (res.status === 402) fireQuotaExceeded(d);
    if (!d || typeof d !== "object") {
      return { ok: !!res.ok, data: d, taskId: null, code: res.status, message: res.ok ? "" : ("HTTP " + res.status) };
    }
    // 服务端信封字段大小写不固定：Ok/Ok、Data/data、ErrCode/errCode、ErrMsg/errMsg、TaskId/taskId 都兼容。
    const ok = d.ok !== undefined ? d.ok : d.Ok;
    const data = d.data !== undefined ? d.data : d.Data;
    const code = d.errCode !== undefined ? d.errCode : d.ErrCode;
    const msg = d.errMsg !== undefined ? d.errMsg : d.ErrMsg;
    const taskId = d.taskId !== undefined ? d.taskId : d.TaskId;
    if (res.ok && ok === true) return { ok: true, data: camelize(data), taskId: taskId || null };
    if (res.ok && ok === false) return failShape(code, msg, d);
    if (!res.ok) return failShape(code || res.status, msg || ("HTTP " + res.status), d);
    // 失败壳：没有 ok/Ok 字段，却带着非 0 的 errCode/ErrCode。
    // 本地实例的 pair 失败壳正是这个形状（{errCode, errMsg}），而且可能是
    // HTTP 200 —— 不在这里判失败，就会落到下面的 return { ok:true }，
    // 把一次失败当成配对成功。
    // 只看顶层：内层 Data 里带 errCode 的正常载荷不受影响；
    // 有 ok/Ok 字段时仍以 ok/Ok 为准（上面的分支已经先判过了）；
    // errCode:0 是"没有错误"，不算失败壳。
    //
    // 🔴 本分支依赖的不变量：**服务器今天只有两个端点产出顶层 errCode**
    // ——api/local/pair 与 api/v2/local-materials/rotate ——而**两者的失败
    // 都是非 2xx**（4xx/5xx）。非 2xx 会被上面那个 `if (!res.ok)` 分支先接住，
    // **根本走不到这一段**。
    // 所以本分支目前是**兜底**：它保的是「哪天多了一个用 200 回答失败的端点」
    // 或者「本地实例用 200 回了失败壳」时，一次失败不会被当成成功。
    // 反过来说：哪天有端点改成用 **HTTP 200 + 顶层 errCode** 回答失败，
    // 这一行就是那条路上的**唯一**拦截点，删掉它失败就会变成成功。
    if (ok === undefined && isFailureShellCode(code)) return failShape(code, msg || ("HTTP " + res.status), d);
    return { ok: true, data: camelize(data !== undefined ? data : d), taskId: taskId || null };
  }

  async function download(method, path, baseOverride) {
    if (!_key) throw keyError();
    const res = await window.htw.download(method, path, _key, baseOverride || _base);
    if (res && !res.ok && res.error) throw new Error(res.error);
    return res;
  }

  // SSE 订阅转发。streamId 用 "域:任务标识" 作键，主进程据此去重连接。
  function subscribeTask(domain, taskId) {
    const streamId = domain + ":" + taskId;
    if (!window.htw || !window.htw.subscribeTask) return null;
    window.htw.subscribeTask(streamId, domain, taskId, _key, _base);
    return streamId;
  }
  function unsubscribeTask(streamId) {
    if (window.htw && window.htw.unsubscribeTask) window.htw.unsubscribeTask(streamId);
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
  return {
    setKey: setKey, setBase: setBase, setDirectBase: setDirectBase,
    setLocalBase: setLocalBase,
    hasKey: hasKey, authHeader: authHeader,
    call: call, get: get, post: post, upload: upload, download: download,
    normalize: normalize, pollTask: pollTask, onQuotaExceeded: onQuotaExceeded,
    LOCAL_UNAVAILABLE_CODE: LOCAL_UNAVAILABLE_CODE,
    LOCAL_UNAVAILABLE_MESSAGE: LOCAL_UNAVAILABLE_MESSAGE,
    subscribeTask: subscribeTask, unsubscribeTask: unsubscribeTask,
    get base() { return _base; }, get directBase() { return _directBase; },
    get localBase() { return _localBase; },
  };
});

