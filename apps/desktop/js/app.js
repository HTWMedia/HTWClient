(function () {
  const SKILLS = ["insight", "edit", "tools", "publish", "create"];

  function getBaseInput() { return document.getElementById("api-base"); }
  function getKeyInput() { return document.getElementById("api-key"); }

  function applyAuth() {
    const base = getBaseInput().value.trim();
    const key = getKeyInput().value;
    if (base) window.HTWApi.setBase(base);
    window.HTWApi.setKey(key);
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
  }

  function showSettings() {
    for (const s of SKILLS) {
      const p = document.getElementById("panel-" + s);
      if (p) p.classList.remove("active");
    }
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    const sp = document.getElementById("panel-settings");
    if (sp) sp.classList.add("active");
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
    getBaseInput().addEventListener("change", applyAuth);
    getKeyInput().addEventListener("input", applyAuth);
    applyAuth();
    wireNav();
    mountSkills();
    showPanel("insight");
  });

  window.App = {
    showPanel: showPanel,
    getKey: function () { return getKeyInput().value; },
    getBase: function () { return getBaseInput().value; },
    applyAuth: applyAuth,
  };
})();
