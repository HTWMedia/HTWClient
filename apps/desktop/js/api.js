(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HTWApi = api;
})(typeof self !== "undefined" ? self : this, function () {
  let _key = "";
  let _base =
    (typeof window !== "undefined" && window.htw && window.htw.apiBase) ||
    // TODO(换域名): 与 preload.js 的 API_BASE 保持同步(此 fallback 仅在非 preload
    // 环境(纯浏览器直开)生效)。换域名说明见 preload.js。
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

  // 本地**已选定**但执行失败时的文案前缀。与云端失败分开：用户看到这句就知道
  // 该查本机实例，而不是云端服务器。
  const LOCAL_FAILED_PREFIX = "本地执行失败：";

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
  //
  // 🔴 载入时 window.HTWLocal 可能还没就位 —— 那时**拒绝**，不做「仅去尾斜杠」的兜底：
  // 兜底会跳过「必须是本机回环」「必须是根地址」这两条准入，于是非回环地址会被
  // 登记进 preload 白名单并落盘，而配对请求会把 **AuthKey + 账号级材料**发往那个地址。
  // 这是防账号级材料外寄的闸门，所以必须 fail-closed：缺模块时宁可不配置，也不放行。
  // （空地址是「关闭本地模式」，不放行任何地址、不登记 —— 它不是闸门放行，所以照常通过。）
  function normalizeLocalBaseValue(b) {
    const L = (typeof window !== "undefined" && window.HTWLocal) || null;
    if (L && typeof L.normalizeLocalBase === "function") return L.normalizeLocalBase(b);
    const raw = typeof b === "string" ? b.trim() : "";
    if (!raw) return { ok: true, base: "", empty: true };
    return { ok: false, reason: "format" };
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
  // ---- 本地选路（端点能力清单）----
  //
  // 切本地的判据是**全部满足**（任一条不满足 → 该端点走云端）：
  //  ① 用户总开关开着（默认关）；
  //  ② 本地实例就绪（探活通过）；
  //  ③ 已配对**且已解锁**（未解锁时鉴权层会 500，切过去只会拿到一个坏结果）；
  //  ④ 协议握手兼容；
  //  ⑤ 本地地址已登记（没地址就没地方切）；
  //  ⑥ 端点能力清单命中（方法 + 路径模式，不是前缀匹配）。
  //
  // 🔴 这是**选路阶段**的判断：本地没就绪就走云端，不是"先发本地、失败再回云端"。
  //    已选定本地后执行失败**不回落**（重副作用端点双跑比报错更糟）。
  let _localRouting = {
    enabled: false, ready: false, paired: false, compatible: false, store: null,
  };

  // 由 app.js 调用：把用户总开关、实例就绪判据与能力清单喂进来。
  // 布尔字段一律只认 true：undefined / 0 / "false" 都当"不满足"，
  // 免得某个上游把字符串 "false" 当成开着（那会把流量切到本地去）。
  function setLocalRouting(state) {
    const s = state || {};
    _localRouting = {
      enabled: s.enabled === true,
      ready: s.ready === true,
      paired: s.paired === true,
      compatible: s.compatible === true,
      store: (s.store && typeof s.store.has === "function") ? s.store : null,
    };
  }

  // 清单匹配用的路径：**先剥掉查询串与片段**。
  // 清单里写的是端点路径（"/api/v2/voice/status/{id:int}"），而实际请求常常带查询串
  // （"?x=1"）—— 不剥掉的话匹配必然失败，白名单永远不命中，
  // 症状是"本地模式开着却什么都不走本地"（静默不生效，最难查的一种）。
  function pathForMatch(path) {
    const s = String(path == null ? "" : path);
    let end = s.length;
    const q = s.indexOf("?");
    if (q >= 0 && q < end) end = q;
    const h = s.indexOf("#");
    if (h >= 0 && h < end) end = h;
    return s.slice(0, end);
  }

  // 这个端点该不该走本地。
  function shouldUseLocal(method, path) {
    if (!_localRouting.enabled) return false;
    if (!_localRouting.ready) return false;
    if (!_localRouting.paired) return false;
    if (!_localRouting.compatible) return false;
    if (!_localBase) return false;
    const store = _localRouting.store;
    if (!store || typeof store.has !== "function") return false;
    const m = typeof method === "string" ? method : "";
    if (!m) return false;
    let hit = false;
    // 清单判据抛异常时按"不命中"处理：判成命中会把请求发到本地去，
    // 而本地多半没有这个端点 —— 宁可走云端。
    try { hit = store.has(m, pathForMatch(path)) === true; } catch (e) { hit = false; }
    return hit;
  }

  // 选路结果：命中本地 → 本地基地址；否则 → 云端基地址。
  // 除 base 外，方法 / 路径 / 体 / 头一律不变（"客户端零端点改动"仍然成立）。
  function resolveTarget(method, path) {
    return shouldUseLocal(method, path) ? _localBase : _base;
  }

  // ---- 请求选路记录（逐请求可观测性）----
  //
  // 最近 50 条选路记录的环形缓冲：设置页「最近请求」列表的唯一数据源。
  // 记录形状 { time, method, path, local, ok }（分片上传另附 chunked:true）：
  //  - time：Date.now() 毫秒（渲染层负责格式化）；
  //  - method / path：请求方法与路径；
  //  - local：这条请求**实际打到**的是本地实例还是云端（isLocalTarget 口径 ——
  //    显式 baseOverride 指向本地地址同样算"本地"，与 call 内注释口径一致）；
  //  - ok：请求是否成功（失败也记录 —— 排查选路问题时失败行最有价值）。
  //
  // 🔴 纯旁路不变量：记录与广播**不许影响请求结果** —— 监听器抛错被吞（不崩请求），
  //    不改选路、不改失败形状、不发任何网络请求。
  const ROUTING_HISTORY_LIMIT = 50;
  const _routingHistory = [];
  const _routingListeners = [];

  // 五个出口（call / upload 整包 / chunkedUpload / download / subscribeTask）
  // 都经由这里入列 + 广播。每次新记录**先入缓冲再广播**。
  function recordRouting(record) {
    const entry = {
      time: Date.now(),
      method: record.method,
      path: record.path,
      local: record.local === true,
      ok: record.ok === true,
    };
    if (record.chunked === true) entry.chunked = true;
    _routingHistory.push(entry);
    if (_routingHistory.length > ROUTING_HISTORY_LIMIT) _routingHistory.shift();
    for (const fn of _routingListeners) {
      try { fn(entry); } catch (e) {
        // 旁路不变量：监听器抛错被吞，不影响请求（OM1）——但留一条 debug 级痕迹，
        // 排查"设置页列表没更新"这类问题时不用靠猜。
        if (typeof console !== "undefined" && console.debug) console.debug("[routing] listener error:", e);
      }
    }
  }

  // 注册选路记录监听，返回退订函数。退订后不再收到广播。
  function onRouting(fn) {
    if (typeof fn !== "function") return function () {};
    _routingListeners.push(fn);
    return function () {
      const i = _routingListeners.indexOf(fn);
      if (i !== -1) _routingListeners.splice(i, 1);
    };
  }

  // 缓冲快照（最新在后，只读副本 —— 外部改动不影响缓冲本身）。
  function routingHistory() {
    return _routingHistory.slice();
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

  // 失败形状上打"这是本地失败"的标记。
  //
  // 🔴 只有**选路命中本地**的请求（routedLocal）才打这个标记：
  //    - 云端失败带上它，用户就会把云端的问题误当成本机的问题去查；
  //    - 配对 / 握手这类**显式指定本地地址**的请求不算"选路命中"，
  //      它们走的是握手契约的既有文案（"本进程不是本地实例，不接受配对。"），
  //      套上"本地执行失败："前缀反而把握手失败的性质说错了。
  // 形状：{ ok:false, code, localFailed:true, message:"本地执行失败：…" }。
  //  - 4007（本地执行不可用）那条出口**已有自己的中性文案**，不叠加前缀，只补标记，
  //    免得出现"本地执行失败：本地执行不可用…"这种叠词。
  //  - 原始 code 与 raw 一律透传：文案是给人看的，错误码是给排查看的，两者不能互相顶掉。
  //  - 幂等：已经打过标记的形状原样返回（不会叠出第二个前缀）。
  function markLocalFailed(norm) {
    if (!norm || norm.ok !== false) return norm;
    if (norm.localFailed) return norm;
    // 🔴 **展开原形状再覆写标记**：失败形状可能带着 data / raw 之类的扩展字段
    //    （raw 是排查凭据，data 是上游回带内容），白名单重建会把它们抹掉 —— 都不能丢。
    if (norm.localUnavailable) {
      return Object.assign({}, norm, { localUnavailable: true, localFailed: true });
    }
    const detail = norm.message ? String(norm.message) : "未知错误";
    return Object.assign({}, norm, { localFailed: true, message: LOCAL_FAILED_PREFIX + detail });
  }

  async function call(method, path, body, baseOverride) {
    if (!_key) throw keyError();
    // 默认带上当前服务端地址：不传的话 preload 会退回它的内置默认值，
    // 「设置」里改过的地址就失效了。
    // 🔴 baseOverride 是**显式指定**，优先于选路（配对等流程要打固定地址）；
    //    不显式指定时由选路决定：命中本地走本地，否则走云端。
    const routedLocal = shouldUseLocal(method, path);
    const target = baseOverride || (routedLocal ? _localBase : _base);
    // 请求是不是打到了本地实例？显式 baseOverride 指向本地地址时同样是"本地"。
    const isLocalTarget = !!(_localBase && target === _localBase);
    // 「本地已选定」= 选路命中本地 **且** 请求确实打到了本地地址。
    const localSelected = routedLocal && isLocalTarget;
    let res;
    try {
      res = await window.htw.call(method, path, body, _key, target);
    } catch (e) {
      // 本地基地址连不上（fetch failed / 连接被拒）与 4007 是同一个症状，
      // 走同一个出口；只限网络类失败，其它异常原样抛出去，不被这里吞掉。
      //
      // 🔴 这里**没有**"改投云端重发"的分支，而且**永远不会有**：
      //    请求已经打到本机实例上执行了，重发一次云端等于把有副作用的动作
      //    （起任务、扣额度）双跑 —— 那比报错糟糕得多。
      //    选路阶段的"本地没就绪 → 走云端"才是唯一允许改投的地方。
      if (isLocalTarget && isNetworkFailure(e)) {
        const shape = { ok: false, code: LOCAL_UNAVAILABLE_CODE, localUnavailable: true,
          message: LOCAL_UNAVAILABLE_MESSAGE, raw: e };
        // 选路命中的本地请求额外带 localFailed：界面据此显示"本地执行失败"。
        if (localSelected) shape.localFailed = true;
        // 观测：localUnavailable 形状同样发一条（失败也记录）。
        recordRouting({ method, path, local: isLocalTarget, ok: false });
        return shape;
      }
      // 云端（服务器）连不上：把英文原文（Chromium 的 "fetch failed"）换成一句中性文案。
      // 原来这里原样抛出去，界面上就蹦出一句英文，用户既看不懂也不知道该查什么。
      // 仍然**抛出去**（不改成返回值）：抛与不抛是调用方的既有契约，只换文案。
      if (!isLocalTarget && isNetworkFailure(e)) {
        const err = new Error(CLOUD_UNREACHABLE_MESSAGE);
        err.cause = e;
        // 观测：抛出型失败在 throw 前也发一条（失败也记录）。
        recordRouting({ method, path, local: isLocalTarget, ok: false });
        throw err;
      }
      // 其它异常（代码错误、鉴权错误等）原样抛出 —— throw 前同样发一条。
      recordRouting({ method, path, local: isLocalTarget, ok: false });
      throw e;
    }
    // 本地已选定但执行失败（HTTP 500 等）→ 打上本地失败标记，
    // **不回落云端**。云端失败原样透传，不带这个标记。
    const norm = normalize(res);
    const out = localSelected ? markLocalFailed(norm) : norm;
    // 观测：normalize 返回前发一条（成功与 localFailed 形状都发）。
    recordRouting({ method, path, local: isLocalTarget, ok: out.ok === true });
    return out;
  }

  // 单文件且超过该阈值时走分片上传，规避反向代理 / Cloudflare 的 body 大小限制 (413)。
  // 单片 1MB：2026-10-28 复测发现源站吞吐 ~25KB/s，2MB 一片要 70–90s，紧贴 Cloudflare
  // 524（源站 100s 无响应）阈值，整包直传几十 MB 几乎必撞；1MB 一片把单请求压到 40s 上下。
  // 🔴 该值必须与注释一致 —— 整包直传 /api/v2/batch/upload 在 4.5MB+ 就稳定撞 502/524，
  // 而分片全程 200。单片 10MB 意味着每片必死，批量面板的视频上传全军覆没。
  const CHUNK_SIZE = 1 * 1024 * 1024;
  // 分片失败重试：源站繁忙时网关会回 524/502/503/504 或直接断连。服务端按 index
  // 覆盖写分片，重发同一片是幂等的；不重试的话，十几片里任意一片抖动就整单失败。
  const CHUNK_ATTEMPTS = 3;
  const CHUNK_RETRY_DELAYS = [2000, 6000];

  function sleepMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function isTransientChunkCode(code) {
    if (code === undefined || code === null || code === "") return false;
    const c = Number(code);
    if (!Number.isFinite(c)) return false;
    return c === 0 || c === 429 || c === 502 || c === 503 || c === 504 || (c >= 520 && c <= 527);
  }
  // 分片上传的实际请求端点：选路输入是**它本身**，不是被拆分的原始业务端点。
  // 清单只收"能在本机独立执行"的端点 —— 清单没有分片端点 ⇒ 分片上传永不路由本地
  // （原始端点命中也不能把大文件文件端点带进本机）。
  const CHUNK_UPLOAD_PATH = "/api/v2/files/chunk";

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
    // 🔴 **直连语义不能被改坏**：分片上传的直连站是"源站直传"优化，与本地无关。
    //    所以选路的口径是：分片端点（CHUNK_UPLOAD_PATH）命中清单 → 本地基地址；
    //    **未命中 → 仍然是直连站**（不是云端 _base —— 那会把既有的大文件直传行为改掉）。
    //    注意输入是分片端点本身，不是被拆分的原始业务端点（path 只是给合并请求带回去用的）。
    const uploadBase = shouldUseLocal("POST", CHUNK_UPLOAD_PATH) ? _localBase : _directBase;
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
        const chunkLocal = !!(_localBase && uploadBase === _localBase);
        for (let attempt = 1; ; attempt++) {
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
            if (norm.ok) break;
            // 🔴 本地已选定但分片执行失败：收敛到 markLocalFailed 口径
            //    （localFailed 标记 + "本地执行失败："前缀），不抛裸的分片异常；
            //    throw 契约不变（调用方仍收到 Error），只是错误体带上了明确的标记。
            //    本地失败不重试：本机实例的错误不会靠等待自愈。
            if (chunkLocal) {
              const marked = markLocalFailed(norm);
              const e = new Error(marked.message + "（分片 " + i + "）");
              e.httpError = true;
              e.localFailed = true;
              e.code = norm.code;
              if (marked.localUnavailable === true) e.localUnavailable = true;
              e.raw = norm.raw;
              failed = e;
              return;
            }
            const e = new Error("分片 " + i + " 上传失败: " + (norm.message || norm.code));
            e.httpError = true;
            if (attempt >= CHUNK_ATTEMPTS || !isTransientChunkCode(norm.code)) {
              failed = e;
              return;
            }
            await sleepMs(CHUNK_RETRY_DELAYS[attempt - 1] || CHUNK_RETRY_DELAYS[CHUNK_RETRY_DELAYS.length - 1]);
          } catch (e) {
            // 只重试网络类异常；代码错误重试多少次都一样，还会把真正的异常盖住。
            if (attempt >= CHUNK_ATTEMPTS || !isNetworkFailure(e)) { failed = e; return; }
            await sleepMs(CHUNK_RETRY_DELAYS[attempt - 1] || CHUNK_RETRY_DELAYS[CHUNK_RETRY_DELAYS.length - 1]);
          }
        }
        done++;
        report();
      }
    }
    const workers = [];
    const concurrency = 4;
    for (let w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);
    // 观测：一次业务分片上传记一条（path 记分片端点本身，附 chunked:true；
    // 分片内部的循环请求不逐片发）。失败也记 —— 排查选路问题时失败行最有价值。
    recordRouting({
      method: "POST", path: CHUNK_UPLOAD_PATH,
      local: !!(_localBase && uploadBase === _localBase),
      ok: !failed, chunked: true,
    });
    if (failed) throw failed;
    const doneRes = await call("POST", "/api/v2/files/complete", {
      fileId: uploadId,
      fileName: file.name,
      total: total,
      target: path,
      fileField: fileField || "file",
      fields: fields || {},
    }, uploadBase);
    // 合并请求的路径（/api/v2/files/complete）不一定在清单里，所以"选路命中"
    // 要按**原始路径**算：本次上传被路由到本地，合并失败同样算本地失败。
    return (_localBase && uploadBase === _localBase) ? markLocalFailed(doneRes) : doneRes;
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
    // 整包上传的 base 由选路决定（命中本地 → 本地，否则 → 云端）。
    // 多文件没法分片，整包过 Cloudflare 会在源站回源慢时长时间卡在个位数百分比
    //（2026-10-28 录 03 实录：13.2MB 卡在 2%），所以多文件整包优先走直连源站。
    // 除 base 外，方法 / 路径 / 文件 / 字段 / 头一律不变。
    const routedLocal = shouldUseLocal(method, path);
    const multiDirect = !routedLocal && !!_directBase && list.length > 1;
    const target = routedLocal ? _localBase : (multiDirect ? _directBase : _base);
    const localSelected = routedLocal && !!(_localBase && target === _localBase);
    const res = await window.htw.upload(method, path, filePaths, fields, authHeader(), onProgress, fileField, target);
    // 与 call 同一口径：选路命中本地就在失败形状上标出来，**不回落云端**。
    const norm = normalize(res);
    const out = localSelected ? markLocalFailed(norm) : norm;
    // 观测：整包上传在 normalize 返回前发一条（local 用"实际打到"口径）。
    recordRouting({ method, path, local: !!(_localBase && target === _localBase), ok: out.ok === true });
    return out;
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

  // 没有 V2 信封的 HTTP 失败（Cloudflare/网关直接回的纯文本错误页）→ 用户能看懂、
  // 知道下一步做什么的文案。
  // 🔴 2026-10-25 教程录制实录：服务端繁忙时草稿导出提交撞 524，界面只显示
  // 「[524] HTTP 524」—— 用户既不知道 524 是什么，也不知道该等还是该查什么。
  // 码原样保留在 code 里（排查用），message 只负责说人话。
  function describeHttpStatus(status) {
    if (status === 429) return "请求过于频繁，请稍后重试";
    if (status === 401) return "AuthKey 无效或已过期，请到「设置」重新填写";
    if (status === 402) return "额度不足，请到充值页充值后再试";
    if (status === 404) return "接口不存在（HTTP 404），客户端可能需要更新";
    if (status === 502 || status === 503) return "服务器维护或繁忙（HTTP " + status + "），请稍后重试";
    if (status === 504) return "网关超时（HTTP 504），请稍后重试";
    // Cloudflare 52x = 源站异常系列（524 源站处理超时最常见：大文件上传在服务端
    // 繁忙时段高频出现，实测 2MB 分片可显著降低触发率）
    if (status >= 520 && status <= 527) return "服务器繁忙（HTTP " + status + "），请稍后重试；大文件可稍后再传";
    if (status >= 500) return "服务器错误（HTTP " + status + "），请稍后重试";
    if (status >= 400) return "请求被拒绝（HTTP " + status + "）";
    return "HTTP " + status;
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
      return { ok: !!res.ok, data: d, taskId: null, code: res.status, message: res.ok ? "" : describeHttpStatus(res.status) };
    }
    // 服务端信封字段大小写不固定：Ok/Ok、Data/data、ErrCode/errCode、ErrMsg/errMsg、TaskId/taskId 都兼容。
    const ok = d.ok !== undefined ? d.ok : d.Ok;
    const data = d.data !== undefined ? d.data : d.Data;
    const code = d.errCode !== undefined ? d.errCode : d.ErrCode;
    const msg = d.errMsg !== undefined ? d.errMsg : d.ErrMsg;
    const taskId = d.taskId !== undefined ? d.taskId : d.TaskId;
    if (res.ok && ok === true) return { ok: true, data: camelize(data), taskId: taskId || null };
    if (res.ok && ok === false) return failShape(code, msg, d);
    if (!res.ok) return failShape(code || res.status, msg || describeHttpStatus(res.status), d);
    // 失败壳：没有 ok/Ok 字段，却带着非 0 的 errCode/ErrCode。
    // 本地实例的 pair 失败壳正是这个形状（{errCode, errMsg}），而且可能是
    // HTTP 200 —— 不在这里判失败，就会落到下面的 return { ok:true }，
    // 把一次失败当成配对成功。
    // 只看顶层：内层 Data 里带 errCode 的正常载荷不受影响；
    // 有 ok/Ok 字段时仍以 ok/Ok 为准（上面的分支已经先判过了）；
    // errCode:0 是"没有错误"，不算失败壳。
    //
    // 🔴 本分支依赖的不变量：**只有 pair 与材料轮换两个端点会产出缺少 ok/Ok 字段的
    // 顶层 errCode**（v2 信封 ApiResult 对所有 v2 端点都带顶层 ErrCode，所以
    // 「有顶层 errCode」本身不是这两个端点的特征，真正的特征是
    // **顶层有 errCode、却没有 ok/Ok**）—— 而**两者的失败都是非 2xx**（4xx/5xx）。
    // 非 2xx 会被上面那个 `if (!res.ok)` 分支先接住，**根本走不到这一段**；
    // 别的 v2 端点因为带着 ok/Ok，判定条件 `ok === undefined` 也不成立，同样走不到。
    // 所以本分支目前是**兜底**：它保的是「哪天多了一个用 200 回答失败的端点」
    // 或者「本地实例用 200 回了失败壳」时，一次失败不会被当成成功。
    // 反过来说：哪天有端点改成用 **HTTP 200 + 顶层 errCode（且无 ok/Ok）** 回答失败，
    // 这一行就是那条路上的**唯一**拦截点，删掉它失败就会变成成功。
    if (ok === undefined && isFailureShellCode(code)) return failShape(code, msg || describeHttpStatus(res.status), d);
    return { ok: true, data: camelize(data !== undefined ? data : d), taskId: taskId || null };
  }

  // 下载/预览地址改走源站直连（绕过 Cloudflare）。
  // 🔴 2026-10-29：Cloudflare 对 /Download、/MediaFiles 这类自家端点会忽略 Range，
  // 整包传十几 MB 就被掐断（客户端拿到缺 moov 的坏 mp4）。直连源站实测能完整下完。
  //
  // 只改写**自家 API 源**的地址（相对路径，或与 _base 同源的绝对地址）；
  // 剪映等第三方 CDN 原样返回 —— 那不走我们的源站，换 IP 只会 404。
  // 没配置直连（_directBase 为空）时一律不动，行为与旧版完全一致。
  function preferDirectUrl(url) {
    const s = String(url == null ? "" : url);
    if (!s || !_directBase) return s;
    let u;
    let d;
    let baseOrigin = "";
    try {
      u = new URL(s, _base);
      d = new URL(_directBase);
      baseOrigin = new URL(_base).origin;
    } catch (e) { return s; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return s;
    if (d.protocol !== "http:" && d.protocol !== "https:") return s;
    // 已是直连地址原样返回；第三方 CDN 也不动
    if (u.origin === d.origin) return s;
    if (u.origin !== baseOrigin) return s;
    u.protocol = d.protocol;
    u.host = d.host;
    return u.href;
  }

  async function download(method, path, baseOverride) {
    if (!_key) throw keyError();
    // baseOverride 优先（显式指定）；否则由选路决定。
    const routedLocal = !baseOverride && shouldUseLocal(method, path);
    const target = baseOverride || (routedLocal ? _localBase : _base);
    const isLocalTarget = !!(_localBase && target === _localBase);
    const localSelected = routedLocal && isLocalTarget;
    const res = await window.htw.download(method, path, _key, target);
    if (res && !res.ok && res.error) {
      // 失败仍按既有契约**抛出**；本地已选定的失败把标记挂在 Error 对象上
      // （throw 契约不变），界面据此把"本地失败"与云端失败分开显示。
      const e = new Error(res.error);
      if (localSelected) {
        e.localFailed = true;
        if (isNetworkFailure(e)) e.localUnavailable = true;
      }
      // 观测：失败处发一条（throw 契约不变）。
      recordRouting({ method, path, local: isLocalTarget, ok: false });
      throw e;
    }
    // 观测：完成处发一条。
    recordRouting({ method, path, local: isLocalTarget, ok: true });
    return res;
  }

  // SSE 订阅转发。streamId 用 "域:任务标识" 作键，主进程据此去重连接。
  //
  // 订阅的路径由主进程按 base + "/api/v2/stream/{domain}/{taskId}" 发起，
  // 所以选路必须用**同一个路径**去比清单 —— 否则命中判据与实际请求对不上。
  function streamPath(domain, taskId) {
    return "/api/v2/stream/" + encodeURIComponent(domain) + "/" + encodeURIComponent(taskId);
  }

  // baseOverride：显式指定时优先于选路（与 call / download 同一口径）。
  function subscribeTask(domain, taskId, baseOverride) {
    const streamId = domain + ":" + taskId;
    if (!window.htw || !window.htw.subscribeTask) return null;
    const target = baseOverride || resolveTarget("GET", streamPath(domain, taskId));
    window.htw.subscribeTask(streamId, domain, taskId, _key, target);
    // 观测：订阅建立时发一条（SSE 长连接的每次 push 不算请求，不逐条记）。
    recordRouting({
      method: "GET", path: streamPath(domain, taskId),
      local: !!(_localBase && target === _localBase), ok: true,
    });
    return streamId;
  }
  function unsubscribeTask(streamId) {
    if (window.htw && window.htw.unsubscribeTask) window.htw.unsubscribeTask(streamId);
  }

  async function pollTask(taskId, opts) {
    opts = opts || {};
    const interval = opts.interval || 2000;
    const timeout = opts.timeout || 600000;
    // 轮询打向哪台机器由**同一套选路**决定（任务态在哪台机器上发起，就在哪台轮询）。
    // base 传给 fetcher：自定义 fetcher 可以自己决定用哪个 base，
    // 默认 fetcher 直接把它交给 call（显式 base 优先于再次选路，结果一致）。
    const path = "/api/v2/task/" + taskId;
    const base = resolveTarget("GET", path);
    const fetcher = opts.fetcher || ((id, b) => call("GET", "/api/v2/task/" + id, undefined, b));
    const start = Date.now();
    while (true) {
      let r;
      try {
        r = await fetcher(taskId, base);
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

  // 服务器更新包清单（本地包分发 §3.2 的「检查更新」入口）。
  // 🔴 该路径**不在**本地端点能力清单里 → shouldUseLocal 永不命中 → 选路自动走云端，
  //    这正是它的正确去向（包由服务器管理，本机实例没有这个端点）。
  //    因此刻意**不加** baseOverride：显式指定反而会绕过「设置里改过的服务端地址」。
  // 404（服务器未提供包）与其它失败形状由 call/normalize 如实透传，调用方按形状显示。
  async function packageManifest() {
    return await call("GET", "/api/v2/local/package/manifest");
  }

  return {
    setKey: setKey, setBase: setBase, setDirectBase: setDirectBase,
    setLocalBase: setLocalBase,
    // 本地选路：喂状态（app.js）+ 查结果（可单测的纯函数）。
    setLocalRouting: setLocalRouting,
    resolveTarget: resolveTarget,
    shouldUseLocal: shouldUseLocal,
    hasKey: hasKey, authHeader: authHeader,
    call: call, get: get, post: post, upload: upload, download: download,
    preferDirectUrl: preferDirectUrl,
    packageManifest: packageManifest,
    normalize: normalize, pollTask: pollTask, onQuotaExceeded: onQuotaExceeded,
    // 失败标记（可单测：界面层 / 汇总层也用它判别本地失败）。
    markLocalFailed: markLocalFailed,
    LOCAL_UNAVAILABLE_CODE: LOCAL_UNAVAILABLE_CODE,
    LOCAL_UNAVAILABLE_MESSAGE: LOCAL_UNAVAILABLE_MESSAGE,
    subscribeTask: subscribeTask, unsubscribeTask: unsubscribeTask,
    // 选路记录（观测性）：订阅广播 + 缓冲快照（app.js 的「最近请求」列表用）。
    onRouting: onRouting, routingHistory: routingHistory,
    get base() { return _base; }, get directBase() { return _directBase; },
    get localBase() { return _localBase; },
    get localRouting() { return _localRouting; },
  };
});

