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

  return {
    probeHealth: probeHealth,
    STATE_TEXT: STATE_TEXT,
    MODE_TEXT: MODE_TEXT,
  };
});
