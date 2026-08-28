'use strict';

var api = window.HTWApi;
var UI = window.UI;
var Skills = (window.Skills = window.Skills || {});

function formatErr(r) {
  if (!r) return "未知错误";
  if (r.code || r.errCode) return "[" + (r.errCode || r.code) + "] " + (r.errMsg || r.message || "");
  return r.errMsg || r.message || "请求失败";
}

Skills.shortdrama = {
  title: "短剧创作",
  mount: function (root) {
    UI.clear(root);

    var taskId = null;
    var pollTimer = null;
    var recomposeTimer = null;
    var isProcessing = false;

    var errBox, progressCard, progressStep, progressBar, resultCard;

    function field(labelText, input) {
      return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
    }

    function setErr(msg) { errBox.textContent = msg || ""; }
    function clearResult() { resultCard.style.display = "none"; resultCard.innerHTML = ""; }
    function showProgress(text) {
      setErr("");
      clearResult();
      progressCard.style.display = "block";
      progressStep.textContent = text;
      progressBar.style.width = "0%";
    }
    function setProgress(pct, step) {
      progressBar.style.width = (pct || 0) + "%";
      if (step) progressStep.textContent = step;
    }
    function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
    function stopRecompose() { if (recomposeTimer) { clearInterval(recomposeTimer); recomposeTimer = null; } }

    function buildProgress() {
      progressStep = UI.el("div", { class: "progress-area-text", text: "正在启动..." });
      progressBar = UI.el("div", { class: "progress-area-fill", style: "width:0%" });
      progressCard = UI.el("div", { class: "progress-area", style: "display:none;margin-top:16px" }, [
        progressStep,
        UI.el("div", { class: "progress-area-bar" }, [progressBar]),
      ]);
      resultCard = UI.el("div", { class: "result-area", style: "display:none;margin-top:16px" });
      errBox = UI.el("div", { style: "margin:12px 0 0;font-size:13px;color:#d33" });
    }

    // ============ 生成阶段 ============
    function renderGenerate() {
      stopPolling();
      stopRecompose();
      UI.clear(root);
      buildProgress();

      var theme = UI.el("input", { type: "text", placeholder: "视频主题描述，如：30 岁职场逆袭短剧，女主从普通文员成长为总监" });
      var ratio = UI.el("select", {}, [
        UI.el("option", { value: "_9_16", text: "9:16（竖屏）", selected: true }),
        UI.el("option", { value: "_16_9", text: "16:9（横屏）" }),
        UI.el("option", { value: "_1_1", text: "1:1（方形）" }),
        UI.el("option", { value: "_4_3", text: "4:3" }),
      ]);
      var scriptLength = UI.el("select", {}, [
        UI.el("option", { value: "Short", text: "短（~30秒）" }),
        UI.el("option", { value: "Medium", text: "中（~60秒）", selected: true }),
        UI.el("option", { value: "Long", text: "长（~90秒）" }),
      ]);
      var style = UI.el("select", {}, [
        UI.el("option", { value: "Default", text: "默认", selected: true }),
        UI.el("option", { value: "AnimeGhibli", text: "宫崎骏风格" }),
      ]);
      var storyboardStyle = UI.el("select", {}, [
        UI.el("option", { value: "Realistic_high_aes", text: "真实高画质", selected: true }),
        UI.el("option", { value: "Anime", text: "动漫" }),
        UI.el("option", { value: "Cinema", text: "电影" }),
        UI.el("option", { value: "_3D_Cartoon", text: "3D卡通" }),
        UI.el("option", { value: "Illustration", text: "插画" }),
        UI.el("option", { value: "Oil_Painting", text: "油画" }),
        UI.el("option", { value: "Watercolor", text: "水彩" }),
      ]);
      var mode = UI.el("select", {}, [
        UI.el("option", { value: "Quick", text: "快速", selected: true }),
        UI.el("option", { value: "Full", text: "完整（含调研）" }),
      ]);
      var startBtn = UI.el("button", { class: "btn primary", text: "开始生成" });

      UI.mount(root, UI.el("div", {}, [
        UI.el("h2", { text: "短剧创作" }),
        UI.el("div", { class: "card" }, [
          field("视频主题描述（必填）", theme),
          field("画幅比例", ratio),
          field("脚本长度", scriptLength),
          field("视频风格", style),
          field("画面风格", storyboardStyle),
          field("生成模式", mode),
          UI.el("div", { class: "row" }, [startBtn]),
          progressCard,
          resultCard,
          errBox,
        ]),
      ]));

      startBtn.addEventListener("click", function () {
        if (isProcessing) return;
        var themeVal = theme.value.trim();
        if (!themeVal) { setErr("请填写视频主题描述"); return; }

        isProcessing = true;
        startBtn.disabled = true;
        startBtn.textContent = "生成中...";
        showProgress("正在启动生成任务...");

        api.post("/api/v2/agent/start", {
          theme: themeVal,
          platform: "ShortDrama",
          ratio: ratio.value,
          scriptLength: scriptLength.value,
          style: style.value,
          storyboardStyleVal: storyboardStyle.value,
          mode: mode.value,
        })
          .then(function (r) {
            if (r.code === 402) { setErr("免费次数已用完，请先充值"); restore(); return; }
            if (!r.ok) { setErr("启动失败：" + formatErr(r)); restore(); return; }
            taskId = r.taskId || (r.data && (r.data.taskId || r.data.TaskId));
            if (!taskId) { setErr("未返回任务 ID：" + JSON.stringify(r.data)); restore(); return; }
            pollStatus();
          })
          .catch(function (e) { setErr("启动失败：" + (e && e.message ? e.message : e)); restore(); });
      });

      function restore() {
        isProcessing = false;
        startBtn.disabled = false;
        startBtn.textContent = "开始生成";
        progressCard.style.display = "none";
      }
    }

    function pollStatus() {
      if (!taskId) return;
      pollTimer = setInterval(function () {
        api.get("/api/v2/agent/status?taskId=" + encodeURIComponent(taskId))
          .then(function (r) {
            if (!r.ok) { stopPolling(); setErr("状态查询失败：" + formatErr(r)); return; }
            var d = r.data || {};
            if (d.status === "completed" || d.status === "done") {
              stopPolling();
              progressCard.style.display = "none";
              enterEditor(taskId);
            } else if (d.status === "failed") {
              stopPolling();
              setErr(d.error || "生成失败");
            } else {
              setProgress(Math.min(d.progress || 0, 99), d.currentStep || "正在生成...");
            }
          })
          .catch(function (e) {
            stopPolling();
            setErr("状态查询异常：" + (e && e.message ? e.message : e));
          });
      }, 2000);
    }

    // ============ 编辑器阶段 ============
    function enterEditor(tid) {
      stopPolling();
      stopRecompose();
      UI.clear(root);
      buildProgress();

      var editorRoot = UI.el("div", {});
      UI.mount(root, UI.el("div", {}, [
        UI.el("h2", { text: "短剧创作 · 编辑" }),
        UI.el("div", { class: "card" }, [progressCard, resultCard, errBox]),
        editorRoot,
      ]));

      showProgress("正在加载剧本与角色...");

      Promise.all([
        api.get("/api/v2/agent/storyboard?taskId=" + encodeURIComponent(tid)),
        api.get("/api/v2/agent/voices"),
      ])
        .then(function (res) {
          var sb = res[0], voicesRes = res[1];
          if (!sb.ok) { setErr("加载剧本失败：" + formatErr(sb)); return; }
          var d = sb.data || {};
          var voiceList = (voicesRes.data && voicesRes.data.voices) || [];
          renderEditor(tid, d, voiceList, editorRoot);
          progressCard.style.display = "none";
        })
        .catch(function (e) { setErr("加载失败：" + (e && e.message ? e.message : e)); });
    }

    function loadShotImage(img, url) {
      var bust = url + (url.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now();
      api.download("GET", bust)
        .then(function (r) {
          if (r.ok && r.data) img.src = URL.createObjectURL(new Blob([r.data], { type: "image/png" }));
        })
        .catch(function () { /* 缩略图加载失败忽略 */ });
    }

    function renderEditor(tid, d, voiceList, editorRoot) {
      // 角色卡
      var charCards = (d.characters || []).map(function (c) {
        var nameI = UI.el("input", { type: "text", value: c.name || "" });
        var voiceSel = UI.el("select", {}, voiceList.map(function (v) {
          return UI.el("option", { value: v, text: v, selected: (v === c.ttsSpeakerId) });
        }));
        var descI = UI.el("textarea", { rows: "2", value: c.description || "" });
        var saveBtn = UI.el("button", { class: "btn", text: "保存" });
        var hint = UI.el("div", { class: "result-area-text", style: "color:#2a8;font-size:12px;min-height:14px" });
        saveBtn.addEventListener("click", function () {
          saveBtn.disabled = true;
          api.post("/api/v2/agent/character", {
            taskId: tid, characterId: c.id, name: nameI.value,
            ttsSpeakerId: voiceSel.value, description: descI.value,
          })
            .then(function (r) {
              if (r.ok) hint.textContent = "已保存";
              else { hint.textContent = ""; setErr("保存失败：" + formatErr(r)); }
            })
            .catch(function (e) { setErr("保存异常：" + (e && e.message ? e.message : e)); })
            .then(function () { saveBtn.disabled = false; });
        });
        return UI.el("div", { class: "card" }, [
          UI.el("div", { class: "result-area-text", text: "角色：" + (c.name || c.id) }),
          field("角色名", nameI),
          field("配音人", voiceSel),
          field("人设", descI),
          UI.el("div", { class: "row" }, [saveBtn, hint]),
        ]);
      });

      // 分镜网格
      var shotCards = (d.shots || []).map(function (s) {
        var img = UI.el("img", { style: "width:100%;height:90px;object-fit:cover;border-radius:6px;background:#000" });
        if (s.imageUrl) loadShotImage(img, s.imageUrl);
        var promptI = UI.el("input", { type: "text", placeholder: "新提示词（可选）", value: s.visualPrompt || "" });
        var regenBtn = UI.el("button", { class: "btn", text: "重新生成" });
        regenBtn.addEventListener("click", function () {
          regenBtn.disabled = true;
          api.post("/api/v2/agent/shot/regenerate", { taskId: tid, shotId: s.shotId, prompt: promptI.value })
            .then(function (r) {
              if (r.ok && r.data && r.data.imageUrl) loadShotImage(img, r.data.imageUrl);
              else setErr("重生成失败：" + formatErr(r));
            })
            .catch(function (e) { setErr("重生成异常：" + (e && e.message ? e.message : e)); })
            .then(function () { regenBtn.disabled = false; });
        });
        var fileI = UI.el("input", { type: "file", accept: "image/*" });
        var repBtn = UI.el("button", { class: "btn", text: "上传替换" });
        repBtn.addEventListener("click", async function () {
          if (!fileI.files || !fileI.files.length) { setErr("请选择图片"); return; }
          repBtn.disabled = true;
          try {
            var buf = await fileI.files[0].arrayBuffer();
            var r = await api.upload("POST", "/api/v2/agent/shot/replace",
              [{ name: fileI.files[0].name, buffer: buf }],
              { taskId: tid, shotId: s.shotId }, null, "file");
            if (r.ok && r.data && r.data.imageUrl) loadShotImage(img, r.data.imageUrl);
            else setErr("替换失败：" + formatErr(r));
          } catch (e) {
            setErr("替换异常：" + (e && e.message ? e.message : e));
          } finally { repBtn.disabled = false; }
        });
        return UI.el("div", { class: "card" }, [
          img,
          UI.el("div", { class: "result-area-text", text: (s.text || "") + " ｜ " + (s.characterName || "") }),
          field("提示词", promptI),
          UI.el("div", { class: "row" }, [regenBtn, repBtn, fileI]),
        ]);
      });

      var recomposeBtn = UI.el("button", { class: "btn primary", text: "重新合成成片" });
      recomposeBtn.addEventListener("click", function () {
        recomposeBtn.disabled = true;
        showProgress("正在启动重新合成...");
        api.post("/api/v2/agent/recompose?taskId=" + encodeURIComponent(tid), {})
          .then(function (r) {
            if (r.ok) pollRecompose(tid, recomposeBtn);
            else { setErr("重新合成启动失败：" + formatErr(r)); recomposeBtn.disabled = false; progressCard.style.display = "none"; }
          })
          .catch(function (e) {
            setErr("重新合成启动异常：" + (e && e.message ? e.message : e));
            recomposeBtn.disabled = false;
            progressCard.style.display = "none";
          });
      });

      editorRoot.appendChild(UI.el("h3", { text: "角色" }));
      editorRoot.appendChild(UI.el("div", { class: "grid", style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px" }, charCards));
      editorRoot.appendChild(UI.el("h3", { text: "分镜" }));
      editorRoot.appendChild(UI.el("div", { class: "grid", style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px" }, shotCards));
      editorRoot.appendChild(UI.el("div", { class: "row", style: "margin-top:12px" }, [recomposeBtn]));
    }

    function pollRecompose(tid, recomposeBtn) {
      stopRecompose();
      recomposeTimer = setInterval(function () {
        api.get("/api/v2/agent/status?taskId=" + encodeURIComponent(tid))
          .then(function (r) {
            var d = (r.data) || {};
            if (!r.ok) { stopRecompose(); setErr("状态查询失败：" + formatErr(r)); recomposeBtn.disabled = false; return; }
            if (d.status === "completed" || d.status === "done") {
              stopRecompose();
              showProgress("正在获取成片...");
              api.download("GET", "/api/v2/agent/download?taskId=" + encodeURIComponent(tid))
                .then(function (res) {
                  if (res.ok && res.data) {
                    var v = UI.el("video", { controls: true, style: "width:100%;max-width:480px;border-radius:8px;background:#000" });
                    v.src = URL.createObjectURL(new Blob([res.data], { type: "video/mp4" }));
                    resultCard.innerHTML = "";
                    resultCard.appendChild(UI.el("div", { class: "result-area-text", text: "成片合成完成" }));
                    resultCard.appendChild(v);
                    resultCard.appendChild(UI.el("a", { class: "btn primary", href: v.src, download: true, text: "下载视频" }));
                    resultCard.style.display = "block";
                    progressCard.style.display = "none";
                    setErr("");
                  } else {
                    setErr("成片下载失败");
                  }
                  recomposeBtn.disabled = false;
                })
                .catch(function (e) { setErr("成片下载异常：" + (e && e.message ? e.message : e)); recomposeBtn.disabled = false; });
            } else if (d.status === "failed") {
              stopRecompose();
              setErr(d.error || "重新合成失败");
              recomposeBtn.disabled = false;
              progressCard.style.display = "none";
            } else {
              setProgress(Math.min(d.progress || 0, 99), d.currentStep || "合成中...");
            }
          })
          .catch(function (e) {
            stopRecompose();
            setErr("状态查询异常：" + (e && e.message ? e.message : e));
            recomposeBtn.disabled = false;
          });
      }, 2000);
    }

    renderGenerate();
  },
};
