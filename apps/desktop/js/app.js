(function () {
  const SKILLS = ["insight", "edit", "tools", "publish", "create"];

  function getBaseInput() { return document.getElementById("api-base"); }
  function getKeyInput() { return document.getElementById("api-key"); }

  function applyAuth() {
    const base = getBaseInput().value.trim();
    const key = getKeyInput().value;
    if (base) window.HTWApi.setBase(base);
    window.HTWApi.setKey(key);
    if (window.htw && window.htw.saveConfig) window.htw.saveConfig({ apiBase: base, apiKey: key });
    refreshKeyUI();
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
      const has = window.HTWApi && window.HTWApi.hasKey && window.HTWApi.hasKey();
      if (!has && !isSettings) {
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

  document.addEventListener("DOMContentLoaded", () => {
    const saved = (window.htw && window.htw.loadConfig) ? window.htw.loadConfig() : {};
    if (saved.apiBase) getBaseInput().value = saved.apiBase;
    if (saved.apiKey) getKeyInput().value = saved.apiKey;
    getBaseInput().addEventListener("change", applyAuth);
    getKeyInput().addEventListener("input", applyAuth);
    applyAuth();
    wireNav();
    mountSkills();
    showPanel("tools");
  });

  window.App = {
    showPanel: showPanel,
    getKey: function () { return getKeyInput().value; },
    getBase: function () { return getBaseInput().value; },
    applyAuth: applyAuth,
  };
})();
