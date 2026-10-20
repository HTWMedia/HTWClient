(function () {
  // 面板白名单：showPanel 只给名单里的面板切active。
  // 🔴 新增面板**必须**同时改这里——只加 index.html 的 section 与 nav 按钮的话，
  //    点导航会"点了没反应"（面板永远不激活），而且不报任何错。
  const SKILLS = ["insight", "topics", "edit", "tools", "publish", "assistant", "create", "marketing", "batch", "shortdrama", "workflow", "tasks"];

  function getBaseInput() { return document.getElementById("api-base"); }
  function getKeyInput() { return document.getElementById("api-key"); }
  function getLocalBaseInput() { return document.getElementById("local-base"); }
  function getLocalStatusEl() { return document.getElementById("local-status"); }
  function getLocalPairBtn() { return document.getElementById("local-pair"); }
  function getLocalPairResultEl() { return document.getElementById("local-pair-result"); }

  // 本地模式未配置（输入框为空）时的状态文案。
  const LOCAL_NOT_CONFIGURED = "本地模式未配置";

  function localBaseValue() {
    const input = getLocalBaseInput();
    return input ? String(input.value || "").trim() : "";
  }
  function setLocalStatus(text) { const el = getLocalStatusEl(); if (el) el.textContent = text; }
  function setLocalPairResult(text) { const el = getLocalPairResultEl(); if (el) el.textContent = text; }
  function setLocalPairEnabled(on) { const b = getLocalPairBtn(); if (b) b.disabled = !on; }

  // 配置的三个键必须一起写：主进程的 saveConfig 只认 apiBase/apiKey/localBase，
  // 少写一个键等于把另一个键清空（例如保存 AuthKey 时把本地地址抹掉）。
  function saveConfigAll(localBase) {
    if (!window.htw || !window.htw.saveConfig) return;
    const base = getBaseInput() ? getBaseInput().value.trim() : "";
    const key = getKeyInput() ? getKeyInput().value : "";
    window.htw.saveConfig({ apiBase: base, apiKey: key, localBase: localBase == null ? "" : localBase });
  }

  // AuthKey 只存主进程的 userData 文件（明文，README 已声明）。
  // 早期版本还往 localStorage 写了一份做"互为备份"，那只是把泄露面扩大了一倍
  // （渲染层任何脚本都能读到），现在改为：仅在迁移时读一次，读到后立刻清掉。
  function readLocal() {
    try {
      return {
        apiBase: localStorage.getItem("htw_apiBase") || "",
        apiKey: localStorage.getItem("htw_apiKey") || "",
      };
    } catch (e) { return { apiBase: "", apiKey: "" }; }
  }
  function clearLocal() {
    try {
      localStorage.removeItem("htw_apiBase");
      localStorage.removeItem("htw_apiKey");
    } catch (e) { /* ignore */ }
  }

  function applyAuth() {
    const base = getBaseInput().value.trim();
    const key = getKeyInput().value;
    saveConfigAll(localBaseValue());
    clearLocal();
    if (base) window.HTWApi.setBase(base);
    window.HTWApi.setKey(key);
    // 本地地址也跟着输入框走：填了但没登记，注册表与实际请求地址会对不上。
    const lb = localBaseValue();
    if (window.HTWApi && window.HTWApi.setLocalBase && window.HTWApi.localBase !== lb)
      window.HTWApi.setLocalBase(lb);
    refreshKeyUI();
  }

  function persistAuth() {
    saveConfigAll(localBaseValue());
    clearLocal();
  }

  function openGetKey() {
    const base = (getBaseInput().value.trim() || (window.htw && window.htw.apiBase) || "https://htwmedia.dpdns.org").replace(/\/+$/, "");
    const url = base + "/Home/GetApiKey";
    if (window.htw && window.htw.openExternal) window.htw.openExternal(url);
  }

  function refreshKeyUI() {
    const status = document.getElementById("key-status");
    if (status) {
      const has = window.HTWApi && window.HTWApi.hasKey && window.HTWApi.hasKey();
      status.textContent = has ? "已设置 ✓" : "未设置";
      status.style.color = has ? "#10b981" : "#ef4444";
    }
    const warn = document.getElementById("key-warning");
    if (warn) {
      const active = document.querySelector(".panel.active");
      const isSettings = document.getElementById("panel-settings") && document.getElementById("panel-settings").classList.contains("active");
    const isAssistant = document.getElementById("panel-assistant") && document.getElementById("panel-assistant").classList.contains("active");
      const has = window.HTWApi && window.HTWApi.hasKey && window.HTWApi.hasKey();
      if (!has && !isSettings && !isAssistant) {
        warn.hidden = false;
        warn.textContent = "尚未设置 AuthKey，以下功能将无法使用。请到「设置」填写，或点击「前往 web 端获取 AuthKey」。";
      } else {
        warn.hidden = true;
      }
    }
  }

  function showPanel(name) {
    for (const s of SKILLS) {
      const p = document.getElementById("panel-" + s);
      if (p) p.classList.toggle("active", s === name);
    }
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.skill === name);
    });
    const settingsPanel = document.getElementById("panel-settings");
    if (settingsPanel) settingsPanel.classList.remove("active");
    refreshKeyUI();
  }

  function showSettings() {
    for (const s of SKILLS) {
      const p = document.getElementById("panel-" + s);
      if (p) p.classList.remove("active");
    }
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    const sp = document.getElementById("panel-settings");
    if (sp) sp.classList.add("active");
    refreshKeyUI();
  }

  // 402 是账号级状态：任何一个面板撞上都要能看见，且要给出充值入口。
  // 注册在 api.js 的 normalize 里 —— 所有请求都经过它，不用改 40 处错误提示。
  function showQuotaBanner(info) {
    const banner = document.getElementById("quota-banner");
    if (!banner) return;
    banner.textContent = "免费次数已用完，充值后可继续使用。";
    const btn = document.createElement("button");
    btn.className = "quota-btn";
    btn.textContent = "去充值";
    btn.addEventListener("click", function () {
      const base = (getBaseInput().value.trim() || (window.htw && window.htw.apiBase) || "https://htwmedia.dpdns.org").replace(/\/+$/, "");
      const url = /^https?:/i.test(info.redirectUrl || "") ? info.redirectUrl : base + (info.redirectUrl || "/Home/Recharge");
      if (window.htw && window.htw.openExternal) window.htw.openExternal(url);
    });
    banner.appendChild(btn);
    banner.hidden = false;
  }

  // ---- 本地模式设置块 ----
  // 三态文案与状态判定都在 js/local.js（机器契约只在那里翻译），
  // 这里只做接线：读地址 → 登记基地址 → 探活 → 显示状态 → 允许配对。

  // 把完整 URL 拆成 path（preload 的 call 是 base + path 拼出来的，
  // 直接把完整 URL 当 path 传过去会拼出坏地址）。
  function pathOf(url) {
    try {
      const u = new URL(String(url));
      return u.pathname + (u.search || "");
    } catch (e) { return String(url); }
  }

  // 探活用的传输层：HTTP 状态自己判 —— 非 2xx 一律当失败。
  // 不判的话 500 会被当成"探活成功"，状态行显示就绪，用户白高兴一场。
  function localTransport(localBase) {
    return {
      call: async function (method, path) {
        // 不带 AuthKey：健康检查不需要登录，也不该把云端密钥递给本机进程。
        const res = await window.htw.call(method, pathOf(path), undefined, undefined, localBase);
        const status = res ? res.status : 0;
        if (typeof status !== "number" || status < 200 || status >= 300)
          throw new Error("HTTP " + status);
        return res;
      },
    };
  }

  // 探活并刷新状态行（探活结果只在这里翻译成界面文案）。
  async function probeLocal(localBase) {
    const Local = window.HTWLocal;
    if (!Local || typeof Local.probeHealth !== "function") {
      setLocalStatus("本地模式模块未加载。");
      setLocalPairEnabled(false);
      return { ok: false, state: "invalid", message: "本地模式模块未加载。" };
    }
    let r;
    try {
      r = await Local.probeHealth(localBase, localTransport(localBase));
    } catch (e) {
      r = { ok: false, state: "unreachable", message: (e && e.message) ? e.message : String(e) };
    }
    if (!r || r.ok !== true) {
      setLocalStatus((r && r.message) ? r.message : "无法连接本地实例，请先启动或检查地址。");
      setLocalPairEnabled(false);
      return r;
    }
    // 状态文案取机器契约的映射表（不在这里另造一套说法）。
    const text = (Local.STATE_TEXT && Local.STATE_TEXT[r.state]) || r.message || "";
    setLocalStatus(text);
    setLocalPairEnabled(r.state === "ready" || r.state === "pairedNotUnlocked");
    return r;
  }

  // 「保存并探活」：空地址 = 关闭本地模式；非空 = 登记 + 探活。
  async function applyLocal() {
    const api = window.HTWApi;
    const v = localBaseValue();
    if (!v) {
      if (api && api.setLocalBase) api.setLocalBase("");
      saveConfigAll("");
      setLocalStatus(LOCAL_NOT_CONFIGURED);
      setLocalPairEnabled(false);
      setLocalPairResult("");
      return { ok: false, state: "notConfigured", message: LOCAL_NOT_CONFIGURED };
    }
    if (api && api.setLocalBase) api.setLocalBase(v);
    saveConfigAll(v);
    setLocalPairResult("");
    return await probeLocal(v);
  }

  // 「一键配对」：登记材料（enroll，走服务端）→ 出示材料（pair，走本地实例）→ 比对 keyId。
  // 账号由 enroll 响应回带，调用方不传也不猜。
  async function pairLocal() {
    const Local = window.HTWLocal;
    const api = window.HTWApi;
    const localBase = (api && api.localBase) ? api.localBase : localBaseValue();
    const serverBase = getBaseInput() ? getBaseInput().value.trim() : "";
    const key = getKeyInput() ? getKeyInput().value : "";
    if (!Local || typeof Local.pairFlow !== "function") {
      setLocalPairResult("本地模式模块未加载。");
      return { ok: false, message: "本地模式模块未加载。" };
    }
    let r;
    try {
      r = await Local.pairFlow({
        apiBase: serverBase,
        localBase: localBase,
        key: key,
        enroll: async function () { return api.call("POST", "/api/v2/local/enroll"); },
        pair: async function (body) { return api.call("POST", "/api/local/pair", body, localBase); },
      });
    } catch (e) {
      r = { ok: false, message: (e && e.message) ? e.message : String(e) };
    }
    if (!r || r.ok !== true) {
      // 失败文案逐字透传（keyId 不一致等都是流程给出的原文）。
      setLocalPairResult((r && r.message) ? r.message : "配对失败。");
      return r;
    }
    setLocalPairResult("配对成功。");
    // 只刷新状态行，不清结果行（刚写进去的成功提示不能被自己抹掉）。
    await probeLocal(localBase);
    return r;
  }

  function wireLocal() {
    const apply = document.getElementById("local-apply");
    if (apply) apply.addEventListener("click", function () { return applyLocal(); });
    const pair = getLocalPairBtn();
    if (pair) pair.addEventListener("click", function () { return pairLocal(); });
  }

  function wireNav() {
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.addEventListener("click", () => {
        const name = b.dataset.skill;
        if (name === "settings") { showSettings(); return; }
        applyAuth();
        showPanel(name);
      });
    });
    const gk = document.getElementById("get-key-btn");
    if (gk) gk.addEventListener("click", openGetKey);
    const kw = document.getElementById("key-warning");
    if (kw) kw.addEventListener("click", showSettings);
  }

  function mountSkills() {
    for (const s of SKILLS) {
      const mod = window.Skills && window.Skills[s];
      const panel = document.getElementById("panel-" + s);
      if (mod && typeof mod.mount === "function" && panel) {
        try { mod.mount(panel); } catch (e) {
          panel.appendChild(window.UI.el("div", { class: "error-box", text: "技能加载失败: " + (e && e.message ? e.message : e) }));
        }
      }
    }
  }

  // preload 的配置读写现在走 IPC（异步），这里必须先等结果再决定用哪份配置。
  async function boot() {
    let saved = {};
    if (window.htw && window.htw.loadConfig) {
      try { saved = (await window.htw.loadConfig()) || {}; } catch (e) { saved = {}; }
    }
    if (!saved.apiKey) {
      // 迁移老版本留在 localStorage 里的凭据：读出来后马上清掉。
      const l = readLocal();
      if (l.apiKey) { saved.apiKey = l.apiKey; saved.apiBase = l.apiBase || saved.apiBase; }
    }
    clearLocal();
    if (saved.apiBase) getBaseInput().value = saved.apiBase;
    if (saved.apiKey) getKeyInput().value = saved.apiKey;
    // 本地地址要在 applyAuth 之前填好：applyAuth 会把配置整份写回，
    // 顺序反了会把刚读出来的本地地址又清空。
    if (saved.localBase) {
      const lb = String(saved.localBase);
      const li = getLocalBaseInput();
      if (li) li.value = lb;
      if (window.HTWApi && window.HTWApi.setLocalBase) window.HTWApi.setLocalBase(lb);
      setLocalStatus("已配置，未探活");
    }
    getBaseInput().addEventListener("change", applyAuth);
    getKeyInput().addEventListener("input", applyAuth);
    applyAuth();
    if (window.HTWApi && window.HTWApi.onQuotaExceeded) window.HTWApi.onQuotaExceeded(showQuotaBanner);
    wireNav();
    wireLocal();
    mountSkills();
    // 任务恢复要等配置与 AuthKey 就绪，所以排在 mountSkills 之后。
    // 注意面板在 mountSkills 里已经渲染过一次（那时列表还是空的）：真正把记录显示
    // 出来的是 restore() 末尾那次 emitChange()，它通知已订阅的面板重渲染。
    if (window.HTWTasks && window.HTWTasks.restore) {
      try { window.HTWTasks.restore(); } catch (e) { /* 恢复失败不该挡住启动 */ }
    }
    // README 主推的工作流从「选题」开始；默认落在「工具」会让新用户第一眼看到一堆
    // 与创作无关的卡片（此前选题面板还是坏的，更糟）。
    showPanel("topics");
    window.addEventListener("beforeunload", persistAuth);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") persistAuth(); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    boot().catch(function (e) {
      // 启动失败时也要把界面装配起来，否则整个应用是白屏。
      console.error("boot failed", e);
      applyAuth();
      wireNav();
      wireLocal();
      mountSkills();
      showPanel("topics");
    });
  });

  window.App = {
    showPanel: showPanel,
    getKey: function () { return getKeyInput().value; },
    getBase: function () { return getBaseInput().value; },
    applyAuth: applyAuth,
    // 本地模式接线（设置块）：暴露出来便于冒烟测试直接驱动。
    local: {
      apply: applyLocal,
      pair: pairLocal,
      wire: wireLocal,
      transport: localTransport,
    },
  };
})();
