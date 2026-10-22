(function (root, factory) {
  const localCapabilities = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = localCapabilities;
  if (typeof window !== "undefined") window.HTWLocalCapabilities = localCapabilities;
})(typeof self !== "undefined" ? self : this, function () {
  // 能力清单的地址（服务器侧契约：免鉴权的 GET）。
  const CAPABILITIES_PATH = "/api/v2/local/capabilities";

  // ---- 清单条目的形态 ----
  //
  // 条目是"方法 + 空格 + 路径"：`"POST /api/v2/voice/status/{id:int}"`。
  // 路径里的 `{...}` 是占位符（形态随意：`{id:int}` / `{name}` / `{}` 一视同仁），
  // 匹配**单段非空**内容 —— 不跨 `/`，也不能是空段。

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 把路径模式编译成锚定的正则：
  // - 占位符 `{...}` → `[^/]+`（非空、单段）；
  // - 其余部分按字面量转义（`.`、`-` 之类不当通配）；
  // - 整条路径**锚定**（`^...$`）→ 前缀不算命中。
  function patternToRegExp(pattern) {
    const parts = [];
    let last = 0;
    const re = /\{[^}]*\}/g;
    let m;
    while ((m = re.exec(pattern)) !== null) {
      parts.push(escapeRegExp(pattern.slice(last, m.index)));
      parts.push("[^/]+");
      last = m.index + m[0].length;
    }
    parts.push(escapeRegExp(pattern.slice(last)));
    return new RegExp("^" + parts.join("") + "$");
  }

  // 解析一条清单条目 → { method, path }；不是合法条目就返回 null。
  function parseEntry(entry) {
    if (typeof entry !== "string") return null;
    const text = entry.trim();
    if (!text) return null;
    const sep = text.indexOf(" ");
    if (sep <= 0) return null;
    const method = text.slice(0, sep).trim().toUpperCase();
    const path = text.slice(sep + 1).trim();
    if (!method || !path) return null;
    return { method: method, path: path };
  }

  // 判断"方法 + 路径"是否命中一条清单条目。
  // 方法**必须相等**；路径按模式匹配（占位符单段非空，整条锚定）。
  function matches(entry, method, path) {
    const parsed = parseEntry(entry);
    if (!parsed) return false;
    if (typeof method !== "string" || !method) return false;
    if (typeof path !== "string" || !path) return false;
    if (parsed.method !== method.trim().toUpperCase()) return false;
    return patternToRegExp(parsed.path).test(path);
  }

  // 把清单编译成"方法 → 正则数组"的查表（供选路用）。
  // 非法条目（缺方法 / 非字符串）直接丢掉，不进查表。
  function compile(endpoints) {
    const table = {};
    if (!Array.isArray(endpoints)) return table;
    for (const entry of endpoints) {
      const parsed = parseEntry(entry);
      if (!parsed) continue;
      const re = patternToRegExp(parsed.path);
      if (!Object.prototype.hasOwnProperty.call(table, parsed.method)) table[parsed.method] = [];
      table[parsed.method].push(re);
    }
    return table;
  }

  // ---- 清单的拉取与缓存 ----

  function joinBase(base, path) {
    const b = String(base || "").replace(/\/+$/, "");
    return b + path;
  }

  // 双外壳兼容：顶层直出 / v2 信封（Ok + Data）都能取到内层。
  // 与 js/local.js 的读法一致（那里探活响应同样可能被信封包一层）。
  function unwrapEnvelope(data) {
    if (!data || typeof data !== "object") return null;
    const ok = data.ok !== undefined ? data.ok : data.Ok;
    const inner = data.data !== undefined ? data.data : data.Data;
    if (ok === true && inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
    return data;
  }

  function readFirst(obj, names) {
    for (let i = 0; i < names.length; i++) {
      if (obj && obj[names[i]] !== undefined) return obj[names[i]];
    }
    return undefined;
  }

  // 能力清单的缓存。职责只有三件：拉一次、编译成查表、按查表判定。
  //
  // 🔴 **拉清单必须裸 GET**：服务器端在请求带 `?format=json` 或
  //    `Accept: application/vnd.htw.v2+json` 时，会被全局信封过滤器包成
  //    `{ok,data:{...}}`，扁平契约就失效了。所以这里：
  //      · 不加任何查询串（URL 就是 base + 固定路径）；
  //      · 只传 (method, url) 两个实参 —— 下层 call 的第三个位置是**请求体**，
  //        多传就变成"带体的 GET"；头由下层默认决定，这里不塞任何 Accept。
  //    解析侧仍然双外壳兼容（万一服务器端改了过滤器，形状变了也读得出来）。
  function createStore(opts) {
    const options = opts || {};
    const transport = options.transport;
    const base = options.base || "";

    let table = {};
    let endpoints = [];
    let protocolVersion = null;
    let loaded = false;

    // 空清单（拉不到 / 解析不出 / 服务器没给端点）—— 不是错误，是"本地没有这些能力"。
    function emptyResult(ok) {
      return { ok: ok === true, protocolVersion: null, endpoints: [] };
    }

    async function load() {
      table = {};
      endpoints = [];
      protocolVersion = null;
      loaded = false;

      const call = transport && transport.call;
      if (typeof call !== "function") return emptyResult(false);

      let res;
      try {
        // 裸 GET：只有方法与 URL，不带查询串、不带头、不带体。
        res = await transport.call("GET", joinBase(base, CAPABILITIES_PATH));
      } catch (e) {
        // 拉不到就当没有本地能力（调用方据此让该端点走云端），不往上抛。
        return emptyResult(false);
      }

      // 传输层自己判了状态的话，错误响应会走到这里：仍然要看状态码，
      // 否则 500 会被当成"清单拉到了"。
      const status = res && res.status;
      if (typeof status === "number" && (status < 200 || status >= 300)) return emptyResult(false);
      if (res && res.ok === false) return emptyResult(false);

      const inner = unwrapEnvelope(res ? res.data : null);
      if (!inner || typeof inner !== "object") return emptyResult(false);

      const rawEndpoints = readFirst(inner, ["endpoints", "Endpoints"]);
      const list = Array.isArray(rawEndpoints)
        ? rawEndpoints.filter((e) => typeof e === "string" && e.trim())
        : [];
      const rawVersion = readFirst(inner, ["protocolVersion", "ProtocolVersion"]);
      const version = typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : null;

      endpoints = list;
      protocolVersion = version;
      table = compile(list);
      loaded = true;
      return { ok: true, protocolVersion: protocolVersion, endpoints: endpoints.slice() };
    }

    // 按"方法 + 路径模式"判定。没拉过清单（表是空的）→ 恒 false。
    function has(method, path) {
      if (typeof method !== "string" || !method) return false;
      if (typeof path !== "string" || !path) return false;
      const list = table[method.trim().toUpperCase()];
      if (!list || !list.length) return false;
      for (const re of list) {
        if (re.test(path)) return true;
      }
      return false;
    }

    // 清缓存（切走本地模式 / 地址变了时用）。
    function clear() {
      table = {};
      endpoints = [];
      protocolVersion = null;
      loaded = false;
    }

    return {
      load: load,
      has: has,
      clear: clear,
      get loaded() { return loaded; },
      get endpoints() { return endpoints.slice(); },
      get protocolVersion() { return protocolVersion; },
      get base() { return base; },
    };
  }

  return {
    matches: matches,
    compile: compile,
    createStore: createStore,
    CAPABILITIES_PATH: CAPABILITIES_PATH,
  };
});
