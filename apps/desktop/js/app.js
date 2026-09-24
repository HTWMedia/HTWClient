(function () {
  const SKILLS = ["insight", "topics", "edit", "tools", "publish", "assistant", "create", "marketing", "shortdrama"];

  function getBaseInput() { return document.getElementById("api-base"); }
  function getKeyInput() { return document.getElementById("api-key"); }

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
    if (window.htw && window.htw.saveConfig) window.htw.saveConfig({ apiBase: base, apiKey: key });
    clearLocal();
    if (base) window.HTWApi.setBase(base);
    window.HTWApi.setKey(key);
    refreshKeyUI();
  }

  function persistAuth() {
    const base = getBaseInput().value.trim();
    const key = getKeyInput().value;
    if (window.htw && window.htw.saveConfig) window.htw.saveConfig({ apiBase: base, apiKey: key });
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
    getBaseInput().addEventListener("change", applyAuth);
    getKeyInput().addEventListener("input", applyAuth);
    applyAuth();
    if (window.HTWApi && window.HTWApi.onQuotaExceeded) window.HTWApi.onQuotaExceeded(showQuotaBanner);
    wireNav();
    mountSkills();
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
      mountSkills();
      showPanel("topics");
    });
  });

  window.App = {
    showPanel: showPanel,
    getKey: function () { return getKeyInput().value; },
    getBase: function () { return getBaseInput().value; },
    applyAuth: applyAuth,
  };
})();
