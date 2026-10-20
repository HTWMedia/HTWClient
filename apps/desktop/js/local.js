(function (root, factory) {
  const local = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = local;
  if (typeof window !== "undefined") window.HTWLocal = local;
})(typeof self !== "undefined" ? self : this, function () {
  const HEALTH_PATH = "/api/v2/local/health";

  // 三态字符串是机器契约（服务器 LocalHealthController 钉住），客户端只做显示映射，
  // 不改写、不做别名猜测。之后进入哪个状态就显示哪句文案。
  const STATE_TEXT = {
    notPaired: "本地实例未配对",
    pairedNotUnlocked: "已配对，待解锁（本地实例重启后出现）",
    ready: "本地模式就绪",
  };

  const MODE_TEXT = {
    server: "该地址不是本地实例",
  };

  const UNREACHABLE_TEXT = "无法连接本地实例，请先启动或检查地址。";
  const INVALID_TEXT = "本地实例响应不可识别。";

  function joinBase(base, path) {
    const b = (base || "").replace(/\/+$/, "");
    return b + path;
  }

  // 服务器端 ApiEnvelopeResultFilter 会把 health 响应包进 ApiResult 外壳：
  // 外层 { ok/Ok, data/Data }，内层才是 { state, mode, credentialsUnlocked, ... }。
  // 这里按 api.js normalize 一样的兼容读法，读外层信封取内层对象（模块自身保持独立，不依赖 api.js）。
  function unwrapEnvelope(data) {
    if (!data || typeof data !== "object") return data;
    const ok = data.ok !== undefined ? data.ok : data.Ok;
    const inner = data.data !== undefined ? data.data : data.Data;
    if (ok === true && inner && typeof inner === "object") return inner;
    return data;
  }

  function readFirst(obj, names) {
    for (let i = 0; i < names.length; i++) {
      if (obj && obj[names[i]] !== undefined) return obj[names[i]];
    }
    return undefined;
  }

  // 探活本地实例。返回 { ok, state, message }：
  // - ok:true  → state 为三态之一（notPaired / pairedNotUnlocked / ready），message 为对应文案；
  // - ok:false → state 为 server（该地址不是本地实例）/ unreachable（连不上）/ invalid（响应不可识别）。
  async function probeHealth(base, transport) {
    const call = transport && transport.call;
    let res;
    try {
      res = await call("GET", joinBase(base, HEALTH_PATH));
    } catch (e) {
      return { ok: false, state: "unreachable", message: UNREACHABLE_TEXT };
    }
    const envelope = res && res.data;
    const inner = unwrapEnvelope(envelope);
    const mode = readFirst(inner, ["mode", "Mode"]);
    const state = readFirst(inner, ["state", "State"]);
    if (mode === "server") {
      return { ok: false, state: "server", message: MODE_TEXT.server };
    }
    if (typeof state !== "string" || !Object.prototype.hasOwnProperty.call(STATE_TEXT, state)) {
      return { ok: false, state: "invalid", message: INVALID_TEXT };
    }
    return { ok: true, state: state, message: STATE_TEXT[state] };
  }

  // ---- 一键配对协议 ----

  // 校验服务端地址（配对前置）。四类拒绝各自给出明确文案：
  // - 必须是 https 根地址（不带路径/查询/哈希）；
  // - 解析失败视为格式无效；
  // - 禁止本机回环地址（回环上的服务端不是真实对外服务端，配对材料会落到错误的地方）。
  function validateServerUrl(url) {
    if (!url || typeof url !== "string") return { ok: false, reason: "serverUrl", message: "服务地址格式无效。" };
    let u;
    try { u = new URL(url); }
    catch (e) { return { ok: false, reason: "serverUrl", message: "服务地址格式无效。" }; }
    if (u.protocol !== "https:") return { ok: false, reason: "serverUrl", message: "服务地址必须是 https 根地址。" };
    if (u.pathname !== "/" || u.search || u.hash)
      return { ok: false, reason: "serverUrl", message: "服务地址必须是根地址（不允许带路径）。" };
    const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (host === "127.0.0.1" || host === "localhost" || host === "::1")
      return { ok: false, reason: "serverUrl", message: "服务地址不能是本机回环地址。" };
    return { ok: true };
  }

  // 配对流程：enroll（从服务端登记拿 keyMaterial）→ pair（向本地实例出示材料）→ keyId 强制比对。
  // - enroll/pair 都是注入函数（生产装配在设置面板接入时完成）；对本模块而言入参
  //   均为 normalize 之后的形状：{ ok, data | code/message }。
  // - enroll 成功返回 Data={ keyMaterial, keyId, account }；account 可由调用方显式传入，
  //   未传入时回退读 enroll 响应里的 account，两者都没有就中断（不发 pair）。
  // - pair 请求体固定 PascalCase：ServerUrl/AuthKey/Account/KeyMaterial/AuthorizeWith。
  //   AuthorizeWith 恒带（首配对被忽略；本地实例重启后的重配对必须出示当前 AuthKey）。
  // - pair 失败的错误壳（errCode/errMsg → code/message）逐字透传，不改写文案。
  // - keyId 不一致（材料与服务端登记不符）即响亮失败，不保存任何凭据、不进入配对成功态。
  async function pairFlow(opts) {
    const fail = (stage, r) => Object.assign({ ok: false, stage: stage }, r);
    const v = validateServerUrl(opts.apiBase);
    if (!v.ok) return fail("serverUrl", { reason: "serverUrl", message: v.message });
    const en = await opts.enroll();
    if (!en || en.ok !== true) return fail("enroll", en || { code: "NO_ENROLL", message: "登记材料失败。" });
    const enrollKeyId = en.data && en.data.keyId;
    const material = en.data && en.data.keyMaterial;
    if (!enrollKeyId || !material) return fail("enroll", { code: "BAD_ENROLL", message: "登记响应缺少 keyMaterial/keyId。" });
    const account = opts.account || (en.data && en.data.account);
    if (!account) return fail("enroll", { code: "NO_ACCOUNT", message: "未取得账号，无法配对。" });
    const body = {
      ServerUrl: opts.apiBase, AuthKey: opts.key, Account: account,
      KeyMaterial: material, AuthorizeWith: opts.key,
    };
    const pr = await opts.pair(body);
    if (!pr || pr.ok !== true) return fail("pair", pr || { code: "NO_PAIR", message: "配对请求失败。" });
    const pairKeyId = pr.data && pr.data.keyId;
    if (pairKeyId !== enrollKeyId)
      return fail("pair", { reason: "keyIdMismatch", code: 0,
        message: "配对材料与服务端登记不一致，请先重新登记材料。" });
    return { ok: true, stage: "pair", keyId: pairKeyId };
  }

  return {
    probeHealth: probeHealth,
    validateServerUrl: validateServerUrl,
    pairFlow: pairFlow,
    STATE_TEXT: STATE_TEXT,
    MODE_TEXT: MODE_TEXT,
  };
});
