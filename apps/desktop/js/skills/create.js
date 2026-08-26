(function () {
  const Skills = (window.Skills = window.Skills || {});
  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }
  function opt(v, t) { return window.UI.el("option", { value: v, text: t || v }); }

  Skills.create = {
    mount: function (panel) {
      const UI = window.UI;
      const API = window.HTWApi;
      UI.clear(panel);

      async function readFiles(wrap) {
        const arr = [];
        const list = wrap.input.files;
        for (let i = 0; i < list.length; i++) { const f = list[i]; arr.push({ name: f.name, buffer: await f.arrayBuffer() }); }
        return arr;
      }
      let sessionId = null;
      let creType = "video";

      const typeSelect = UI.el("select", {}, [opt("video"), opt("image"), opt("article")]);
      const topicInput = UI.el("textarea", { placeholder: "创作主题" });
      const refInput = UI.el("input", { type: "text", placeholder: "参考视频 URL，逗号分隔（可选）" });
      const setupRegion = UI.el("div");
      const startBtn = UI.el("button", { class: "btn", text: "开始创作" });
      const setupCard = UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "第 1 步：新建会话" }),
        UI.el("div", { class: "field" }, [UI.el("label", { text: "类型" }), typeSelect]),
        UI.el("div", { class: "field" }, [UI.el("label", { text: "主题" }), topicInput]),
        UI.el("div", { class: "field" }, [UI.el("label", { text: "参考视频" }), refInput]),
        UI.el("div", { class: "row" }, [startBtn]),
        setupRegion,
      ]);

      const sessionRegion = UI.el("div");
      const statusRegion = UI.el("div");
      const refreshBtn = UI.el("button", { class: "btn", text: "刷新状态" });
      const approveBtn = UI.el("button", { class: "btn", text: "通过并继续" });
      const regenBtn = UI.el("button", { class: "btn secondary", text: "重新生成" });
      const refineBtn = UI.el("button", { class: "btn secondary", text: "细化" });
      const recBtn = UI.el("button", { class: "btn secondary", text: "创作建议" });
      const matFile = UI.fileInput({ label: "上传素材", accept: "*/*" });
      const matBtn = UI.el("button", { class: "btn secondary", text: "上传素材" });
      const sessionCard = UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "第 2 步：会话" }),
        UI.el("div", { class: "row" }, [refreshBtn, approveBtn, regenBtn, refineBtn, recBtn, matBtn]),
        matFile,
        statusRegion,
        sessionRegion,
      ]);

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "创作 Create（向导）" }),
        setupCard, sessionCard,
      ]));

      function loadTypes() {
        UI.withLoading(typeSelect, async function () {
          try {
            const r = await API.call("GET", "/api/v2/creation/types");
            if (!r.ok) { UI.showError(setupRegion, formatErr(r)); return; }
            const list = (r.data && r.data.data) || r.data || [];
            if (Array.isArray(list) && list.length) {
              UI.clear(typeSelect);
              for (const t of list) {
                const v = typeof t === "string" ? t : (t.id || t.type || JSON.stringify(t));
                const txt = typeof t === "string" ? t : (t.name || v);
                typeSelect.appendChild(opt(v, txt));
              }
            }
          } catch (e) { UI.showError(setupRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      }
      loadTypes();

      startBtn.addEventListener("click", function () {
        const topic = topicInput.value.trim();
        if (!topic) { UI.showError(setupRegion, "请输入主题"); return; }
        creType = typeSelect.value;
        UI.withLoading(startBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/creation/start", {
              type: creType,
              topic: topic,
              referenceVideoUrls: refInput.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
            });
            if (!up.ok) { UI.showError(setupRegion, formatErr(up)); return; }
            sessionId = up.data && up.data.sessionId;
            UI.showResult(setupRegion, { sessionId: sessionId, step: up.data && up.data.step });
            refreshStatus();
          } catch (e) { UI.showError(setupRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      function refreshStatus() {
        if (!sessionId) { UI.showError(statusRegion, "尚无会话"); return; }
        UI.withLoading(refreshBtn, async function () {
          try {
            const r = await API.call("GET", "/api/v2/creation/status?sessionId=" + encodeURIComponent(sessionId) + "&type=" + encodeURIComponent(creType));
            if (!r.ok) { UI.showError(statusRegion, formatErr(r)); return; }
            UI.showResult(statusRegion, r.data);
          } catch (e) { UI.showError(statusRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      }
      refreshBtn.addEventListener("click", refreshStatus);

      approveBtn.addEventListener("click", function () {
        if (!sessionId) { UI.showError(sessionRegion, "尚无会话"); return; }
        UI.withLoading(approveBtn, async function () {
          try {
            const r = await API.call("POST", "/api/v2/creation/approve", { sessionId: sessionId, type: creType });
            if (!r.ok) { UI.showError(sessionRegion, formatErr(r)); return; }
            UI.showResult(sessionRegion, r.data);
            refreshStatus();
          } catch (e) { UI.showError(sessionRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      regenBtn.addEventListener("click", function () {
        if (!sessionId) { UI.showError(sessionRegion, "尚无会话"); return; }
        const instruction = window.prompt ? window.prompt("重新生成指令（可选）") : "";
        UI.withLoading(regenBtn, async function () {
          try {
            const r = await API.call("POST", "/api/v2/creation/regenerate", { sessionId: sessionId, instruction: instruction || "", type: creType });
            if (!r.ok) { UI.showError(sessionRegion, formatErr(r)); return; }
            UI.showResult(sessionRegion, r.data);
            refreshStatus();
          } catch (e) { UI.showError(sessionRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      refineBtn.addEventListener("click", function () {
        if (!sessionId) { UI.showError(sessionRegion, "尚无会话"); return; }
        const message = window.prompt ? window.prompt("细化要求") : "";
        if (!message) return;
        UI.withLoading(refineBtn, async function () {
          try {
            const r = await API.call("POST", "/api/v2/creation/refine", { sessionId: sessionId, message: message, type: creType });
            if (!r.ok) { UI.showError(sessionRegion, formatErr(r)); return; }
            UI.showResult(sessionRegion, r.data);
            refreshStatus();
          } catch (e) { UI.showError(sessionRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      recBtn.addEventListener("click", function () {
        UI.withLoading(recBtn, async function () {
          try {
            const r = await API.call("GET", "/api/v2/creation/recommendations");
            if (!r.ok) { UI.showError(sessionRegion, formatErr(r)); return; }
            UI.showResult(sessionRegion, r.data);
          } catch (e) { UI.showError(sessionRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      matBtn.addEventListener("click", function () {
        if (!sessionId) { UI.showError(sessionRegion, "尚无会话"); return; }
        UI.withLoading(matBtn, async function () {
          try {
            const files = await readFiles(matFile);
            if (!files.length) { UI.showError(sessionRegion, "请选择素材文件"); return; }
            const r = await API.upload("POST", "/api/v2/creation/upload-material?sessionId=" + encodeURIComponent(sessionId), files, {});
            if (!r.ok) { UI.showError(sessionRegion, formatErr(r)); return; }
            UI.showResult(sessionRegion, r.data);
          } catch (e) { UI.showError(sessionRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
    },
  };
})();
