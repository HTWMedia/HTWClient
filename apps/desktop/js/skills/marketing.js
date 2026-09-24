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
    var pollStopped = false;
    var isProcessing = false;
    // 轮询上限：任务卡在中间状态时不能无限问下去（每 2 秒一次会一直打服务端）。
    var POLL_TIMEOUT = 30 * 60 * 1000;

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
    // 成片渲染动辄十几分钟，跑一半发现参数填错了只能干等到超时。
    // 「取消任务」调后端的 cancel：后续步骤不再继续（已经开始的那次远程渲染不保证立刻中断）。
    var cancelBtn = UI.el("button", { class: "btn", id: "mv-cancel", text: "取消任务", style: "display:none;margin-left:8px" });

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
        UI.el("div", { class: "row" }, [submitBtn, cancelBtn]),
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
      lastPct = 0;
      document.getElementById("mv-progress-step").textContent = text;
      document.getElementById("mv-progress-bar").style.width = "0%";
    }
    var lastPct = 0;
    function setProgress(pct, step) {
      // 只增不减：上传阶段先把进度推到 30%，任务刚建时后端 progress 还是 0，
      // 直接赋值会让进度条从 30% 跳回 0% 再慢慢涨，看起来像卡住重来。
      lastPct = Math.max(lastPct, Math.min(99, pct || 0));
      document.getElementById("mv-progress-bar").style.width = lastPct + "%";
      if (step) document.getElementById("mv-progress-step").textContent = step;
    }
    function stopPolling() {
      pollStopped = true;
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    }
    function restoreBtn() {
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "生成成片";
      cancelBtn.style.display = "none";
      cancelBtn.disabled = false;
      cancelBtn.textContent = "取消任务";
    }

    cancelBtn.addEventListener("click", function () {
      if (!taskId) return;
      if (!window.confirm("确定取消这个成片任务吗？已经开始的那段渲染可能仍会在服务端跑完。")) return;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "取消中...";
      api.post("/api/v2/market-video/cancel", { TaskId: taskId })
        .then(function (r) {
          // 后端不认（已结束 / 任务不存在）也要停掉本地轮询，别一直问下去
          stopPolling();
          restoreBtn();
          if (r && r.ok) {
            setErr("已取消任务");
          } else {
            setErr("取消未生效：" + formatErr(r));
          }
          progressCard.style.display = "none";
        })
        .catch(function (e) {
          stopPolling();
          restoreBtn();
          setErr("取消失败：" + (e && e.message ? e.message : e));
          progressCard.style.display = "none";
        });
    });

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
          if (points.length) { sellPoints.value = points.join("\n"); return; }
          // 后端在模型不可用时是「HTTP 200 + 空卖点」而不是报错，
          // 这里不提示的话用户点了按钮什么都没发生，会以为功能坏了。
          setErr("没拿到卖点（文案服务可能暂时不可用），可以手动填几行再生成");
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
          if (d.script) { script.value = d.script; return; }
          setErr("没生成出口播文案（文案服务可能暂时不可用），可手动填写；留空则由成片流程自己写");
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
        // 上传进度：素材动辄几十 MB，不显示进度用户只能盯着"正在上传…"干等。
        return api.upload("POST", "/api/v2/market-video/submit", files, fields, function (p) {
          if (!p || !p.total) return;
          var pct = Math.max(1, Math.min(30, Math.round((p.loaded / p.total) * 30)));
          setProgress(pct, "正在上传素材 " + (p.loaded / 1024 / 1024).toFixed(1) + "MB / " + (p.total / 1024 / 1024).toFixed(1) + "MB");
        }, "files");
      })
        .then(function (r) {
          if (!r.ok) { showSubmitError(r); return; }
          taskId = r.taskId || (r.data && (r.data.taskId || r.data.TaskId));
          if (!taskId) { showSubmitDataError(r.data); return; }
          // 拿到 taskId 才允许取消 —— 取消接口靠它定位任务
          cancelBtn.style.display = "inline-block";
          pollStatus();
        })
        .catch(function (e) { showSubmitMsg("提交失败：" + (e && e.message ? e.message : e)); });
    });

    // 自调度 setTimeout 而不是 setInterval：setInterval 不等待上一次请求返回，
    // 慢请求会一轮轮堆积（界面卡顿 + 打爆服务端），这里一轮结束才排下一轮。
    function pollStatus() {
      if (!taskId) return;
      pollStopped = false;
      var startedAt = Date.now();
      function tick() {
        if (pollStopped) return;
        api.get("/api/v2/market-video/status?taskId=" + encodeURIComponent(taskId))
          .then(function (r) {
            if (pollStopped) return;
            if (!r.ok) { stopPolling(); showSubmitError(r); return; }
            var d = r.data || {};
            if (d.status === "completed") {
              stopPolling();
              showResult(d);
            } else if (d.status === "failed") {
              stopPolling();
              showSubmitMsg(d.error || "生成失败");
            } else if (d.status === "cancelled") {
              stopPolling();
              restoreBtn();
              setErr("任务已取消");
              progressCard.style.display = "none";
            } else if (Date.now() - startedAt > POLL_TIMEOUT) {
              stopPolling();
              showSubmitMsg("生成超时（已等待 30 分钟），任务可能仍在服务端运行，请稍后重试");
            } else {
              setProgress(Math.min(d.progress || 0, 99), d.currentStep || "正在生成...");
              pollTimer = setTimeout(tick, 2000);
            }
          })
          .catch(function (e) {
            if (pollStopped) return;
            stopPolling();
            showSubmitMsg("状态查询异常：" + (e && e.message ? e.message : e));
          });
      }
      tick();
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
        var url = (data && data.cloudUrl) || (data && data.downloadUrl);
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
