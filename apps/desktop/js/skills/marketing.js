'use strict';

var api = window.HTWApi;
var UI = window.UI;
var Skills = (window.Skills = window.Skills || {});

function formatErr(r) {
  if (!r) return "未知错误";
  if (r.code || r.errCode) return "[" + (r.errCode || r.code) + "] " + (r.errMsg || r.message || "");
  return r.errMsg || r.message || "请求失败";
}

Skills.marketing = {
  title: "营销成片",
  mount: function (root) {
    UI.clear(root);
    var taskId = null;
    var pollTimer = null;
    var isProcessing = false;

    function field(labelText, input) {
      return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
    }

    var materials = UI.el("input", { type: "file", multiple: true, accept: "image/*,video/*" });
    var productName = UI.el("input", { type: "text", placeholder: "如：考试填卡笔、办公室养生茶" });
    var sellPointBtn = UI.el("button", { class: "btn", text: "生成卖点" });
    var sellPoints = UI.el("textarea", { rows: "3", placeholder: "每行一个卖点，可自动生成也可手动编写" });
    var script = UI.el("textarea", { rows: "4", placeholder: "营销口播文案，可 AI 自动生成" });
    var scriptBtn = UI.el("button", { class: "btn", text: "AI 生成口播" });
    var ratio = UI.el("select", {}, [
      UI.el("option", { value: "16:9", text: "16:9（横屏）", selected: true }),
      UI.el("option", { value: "9:16", text: "9:16（竖屏）" }),
    ]);
    var duration = UI.el("select", {}, [
      UI.el("option", { value: "0-15", text: "0-15 秒" }),
      UI.el("option", { value: "15-30", text: "15-30 秒", selected: true }),
      UI.el("option", { value: "30-60", text: "30-60 秒" }),
    ]);
    var discount = UI.el("input", { type: "text", placeholder: "如：买二送一 / 满 99 减 20" });
    var audience = UI.el("input", { type: "text", placeholder: "如：学生、上班族（逗号分隔）" });
    var submitBtn = UI.el("button", { class: "btn primary", text: "生成成片" });

    var progressCard = UI.el("div", { class: "progress-area", style: "display:none;margin-top:16px" }, [
      UI.el("div", { class: "progress-area-text", id: "mv-progress-step", text: "正在提交渲染任务..." }),
      UI.el("div", { class: "progress-area-bar" }, [UI.el("div", { class: "progress-area-fill", id: "mv-progress-bar", style: "width:0%" })]),
    ]);
    var resultCard = UI.el("div", { class: "result-area", id: "mv-result-card", style: "display:none;margin-top:16px" });
    var errBox = UI.el("div", { id: "mv-err", style: "margin:12px 0 0;font-size:13px;color:#d33" });

    UI.mount(root, UI.el("div", {}, [
      UI.el("h2", { text: "营销成片 MarketVideo" }),
      UI.el("div", { class: "card" }, [
        field("商品素材（图片 / 视频，可多选，必填）", materials),
        field("商品名称（必填）", productName),
        UI.el("div", { class: "row" }, [sellPointBtn]),
        field("核心卖点（每行一个）", sellPoints),
        field("营销口播文案", script),
        UI.el("div", { class: "row" }, [scriptBtn]),
        field("画幅比例", ratio),
        field("时长", duration),
        field("优惠活动（可选）", discount),
        field("适用人群（可选）", audience),
        UI.el("div", { class: "row" }, [submitBtn]),
        progressCard,
        resultCard,
        errBox,
      ]),
    ]));

    function setErr(msg) { errBox.textContent = msg || ""; }
    function clearResult() { resultCard.style.display = "none"; resultCard.innerHTML = ""; }
    function showProgress(text) {
      setErr("");
      clearResult();
      progressCard.style.display = "block";
      document.getElementById("mv-progress-step").textContent = text;
      document.getElementById("mv-progress-bar").style.width = "0%";
    }
    function setProgress(pct, step) {
      document.getElementById("mv-progress-bar").style.width = (pct || 0) + "%";
      if (step) document.getElementById("mv-progress-step").textContent = step;
    }
    function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
    function restoreBtn() {
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "生成成片";
    }

    sellPointBtn.addEventListener("click", function () {
      var name = productName.value.trim();
      if (!name) { setErr("请先填写商品名称"); return; }
      setErr("");
      sellPointBtn.disabled = true;
      api.post("/api/v2/market-video/product-info", { Text: name })
        .then(function (r) {
          if (!r.ok) { setErr("生成卖点失败：" + formatErr(r)); return; }
          var d = r.data || {};
          if (d.productName) productName.value = d.productName;
          var points = d.sellPoints || [];
          if (points.length) sellPoints.value = points.join("\n");
        })
        .catch(function (e) { setErr("生成卖点异常：" + (e && e.message ? e.message : e)); })
        .then(function () { sellPointBtn.disabled = false; });
    });

    scriptBtn.addEventListener("click", function () {
      var name = productName.value.trim();
      if (!name) { setErr("请先填写商品名称"); return; }
      setErr("");
      scriptBtn.disabled = true;
      api.post("/api/v2/market-video/generate-script", {
        ProductName: name,
        SellPoints: sellPoints.value,
        Ratio: ratio.value,
        Duration: duration.value,
        DiscountActivity: discount.value,
        AudienceTypes: audience.value,
      })
        .then(function (r) {
          if (!r.ok) { setErr("AI 生成口播失败：" + formatErr(r)); return; }
          var d = r.data || {};
          if (d.script) script.value = d.script;
        })
        .catch(function (e) { setErr("AI 生成口播异常：" + (e && e.message ? e.message : e)); })
        .then(function () { scriptBtn.disabled = false; });
    });

    submitBtn.addEventListener("click", function () {
      if (isProcessing) return;
      var name = productName.value.trim();
      if (!name) { setErr("请填写商品名称"); return; }
      if (!materials.files || materials.files.length === 0) { setErr("请上传至少一个商品素材"); return; }

      isProcessing = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "生成中...";
      showProgress("正在上传素材并提交渲染任务...");

      Promise.resolve().then(async function () {
        var files = [];
        for (var i = 0; i < materials.files.length; i++) {
          var f = materials.files[i];
          files.push({ name: f.name, buffer: await f.arrayBuffer() });
        }
        var fields = {
          productName: name,
          sellPoints: sellPoints.value,
          script: script.value,
          ratio: ratio.value,
          duration: duration.value,
          discountActivity: discount.value,
          audienceTypes: audience.value,
        };
        return api.upload("POST", "/api/v2/market-video/submit", files, fields, null, "files");
      })
        .then(function (r) {
          if (!r.ok) { showSubmitError(r); return; }
          taskId = r.taskId || (r.data && (r.data.taskId || r.data.TaskId));
          if (!taskId) { showSubmitDataError(r.data); return; }
          pollStatus();
        })
        .catch(function (e) { showSubmitMsg("提交失败：" + (e && e.message ? e.message : e)); });
    });

    function pollStatus() {
      if (!taskId) return;
      pollTimer = setInterval(function () {
        api.get("/api/v2/market-video/status?taskId=" + encodeURIComponent(taskId))
          .then(function (r) {
            if (!r.ok) { stopPolling(); showSubmitError(r); return; }
            var d = r.data || {};
            if (d.status === "completed") {
              stopPolling();
              showResult(d);
            } else if (d.status === "failed") {
              stopPolling();
              showSubmitMsg(d.error || "生成失败");
            } else {
              setProgress(Math.min(d.progress || 0, 99), d.currentStep || "正在生成...");
            }
          })
          .catch(function (e) {
            stopPolling();
            showSubmitMsg("状态查询异常：" + (e && e.message ? e.message : e));
          });
      }, 2000);
    }

    function showSubmitError(r) {
      stopPolling();
      restoreBtn();
      setErr("生成失败：" + formatErr(r));
      progressCard.style.display = "none";
    }
    function showSubmitDataError(d) {
      stopPolling();
      restoreBtn();
      setErr("未返回 taskId：" + JSON.stringify(d));
      progressCard.style.display = "none";
    }
    function showSubmitMsg(msg) {
      stopPolling();
      restoreBtn();
      setErr(msg);
      progressCard.style.display = "none";
    }

    async function showResult(data) {
      progressCard.style.display = "none";
      restoreBtn();
      try {
        var url = data && data.downloadUrl;
        if (!url) { setErr("未获取到下载链接，请稍后重试"); return; }
        // 服务端已下发可直接使用的下载链接（带短时效凭证），桌面端直接作为
        // <video> 源与 <a download> 使用，避免用 AuthKey 头取二进制再转 Blob。
        if (url.charAt(0) === "/") url = api.base + url;
        resultCard.innerHTML = "";
        resultCard.appendChild(UI.el("div", { class: "result-area-text", text: "视频生成完成" }));
        var video = UI.el("video", { controls: true, style: "width:100%;max-width:480px;border-radius:8px;background:#000" });
        video.src = url;
        resultCard.appendChild(video);
        resultCard.appendChild(UI.el("a", { class: "btn primary", href: url, download: "market_video.mp4", text: "下载视频" }));
        resultCard.style.display = "block";
        setErr("");
      } catch (e) {
        setErr("视频下载异常：" + (e && e.message ? e.message : e));
      }
    }
  },
};
