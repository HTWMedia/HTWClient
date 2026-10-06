(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") {
    var Skills = (window.Skills = window.Skills || {});
    Skills.batch = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /*
   * 批量面板：把服务端 /api/v2/batch 的三种 kind 接到桌面端。
   * 服务端契约见后端 Controllers/Api/V2/BatchController.cs 与 docs 内批量说明：
   *   POST /api/v2/batch/upload            上传素材到素材池 → materialId（24h 有效）
   *   POST /api/v2/batch/market-video      批量营销成片（条目：商品名/卖点/比例/时长/素材）
   *   POST /api/v2/batch/cut-same          批量剪同款（整批共用 draftPackageUrl，条目差异在素材）
   *   POST /api/v2/batch/smart-package     批量智能包装（条目 = 恰好一个视频素材）
   *   GET  /api/v2/batch/status?batchId=   整批状态（items + summary + packageUrl）
   *   POST /api/v2/batch/cancel            整批取消
   *   POST /api/v2/batch/retry             重提（indexes 或 failedOnly）
   *   GET  /api/v2/batch/download?...      整批 zip 打包（packageUrl 由 status 下发）
   *
   * 响应经 HTWApi.normalize 转 camelCase 后读取；请求体用 PascalCase（与工作流面板一致，
   * 服务端 Newtonsoft 大小写不敏感，但同库内保持一种口径）。
   *
   * 🔴 批量是工作室档（Studio/Enterprise）功能：免费/个人档提交时每条会被拒
   * （rejected[].error 带升级提示），HTTP 仍是 200 —— 不能只看 ok 就报成功。
   */

  var KINDS = [
    { id: "market-video", name: "营销成片", tip: "每条 = 一个商品。AI 写口播 + 自动剪辑出带货成片。" },
    { id: "cut-same", name: "剪同款", tip: "整批共用一个模板，N 个视频各套一遍。" },
    { id: "smart-package", name: "智能包装", tip: "给已有视频自动配字幕、贴片与包装。" },
  ];

  // 条目状态与服务端 BuildItemStatus 的 status 字段对应
  var ITEM_STATUS = {
    pending: { text: "排队中", cls: "wf-mute" },
    running: { text: "处理中", cls: "wf-run" },
    completed: { text: "已完成", cls: "wf-ok" },
    failed: { text: "失败", cls: "wf-bad" },
    cancelled: { text: "已取消", cls: "wf-mute" },
    expired: { text: "已过期", cls: "wf-bad" },
  };

  function itemStatus(s) { return ITEM_STATUS[s] || { text: s || "未知", cls: "wf-mute" }; }

  // 与 workflow.js 同一套节奏：批量渲染一条也是分钟级
  var POLL_MS = 6000;
  var POLL_LIMIT_MS = 60 * 60 * 1000;

  var RATIOS = ["16:9", "9:16"];
  var DURATIONS = ["0-15", "15-30", "30-60"];

  // ─────────── 纯函数（导出供单测） ───────────

  /*
   * 解析「一行一条」的商品文本。行格式：商品名|卖点|折扣活动（后两段可省）。
   * 返回 items（供拼 BatchMarketVideoItem）与 errors（空商品名的行号，1 起）。
   * 空行跳过；竖线两侧空白裁掉；折扣段里再出现竖线按字面并入折扣
   * （卖点里不该有竖线，但真写了也不能把后面的段错位丢掉）。
   */
  function parseItemLines(text) {
    var items = [];
    var errors = [];
    var lines = String(text || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var parts = line.split("|");
      var name = (parts[0] || "").trim();
      if (!name) { errors.push({ line: i + 1, error: "缺少商品名" }); continue; }
      items.push({
        productName: name,
        sellPoints: (parts[1] || "").trim(),
        discountActivity: (parts[2] || "").trim(),
      });
    }
    return { items: items, errors: errors };
  }

  // 营销成片请求体。素材是共用的一份 materialId/直链（整批同一个商品的常见用法）。
  function marketVideoRequest(name, parsed, ratio, duration, materials) {
    return {
      Name: String(name || ""),
      Items: (parsed.items || []).map(function (it) {
        return {
          ProductName: it.productName,
          SellPoints: it.sellPoints,
          Script: "",
          Ratio: ratio,
          Duration: duration,
          DiscountActivity: it.discountActivity,
          AudienceTypes: "",
          Materials: (materials || []).slice(),
        };
      }),
    };
  }

  // 剪同款/智能包装请求体：N 个文件 = N 条，文件名（去扩展名）当条目名。
  function videoRequest(kind, name, draftPackageUrl, fileEntries) {
    var body = { Name: String(name || ""), Items: [] };
    if (kind === "cut-same") body.DraftPackageUrl = String(draftPackageUrl || "");
    body.Items = (fileEntries || []).map(function (f) {
      return { ProductName: f.baseName || f.fileName || "", DraftPackageUrl: body.DraftPackageUrl || "", Materials: [f.materialId] };
    });
    return body;
  }

  // 批次是否跑完：pending/running 都归零才算，否则轮询不能停。
  function isFinished(status) {
    var s = (status && status.summary) || {};
    return ((s.pending || 0) + (s.running || 0)) === 0;
  }

  // 汇总一行文案。0 条完成时不写"完成 0"，直接从"排队/处理"说起。
  function summaryText(status) {
    var s = (status && status.summary) || {};
    var parts = [];
    if (s.completed) parts.push("完成 " + s.completed);
    if (s.running) parts.push("处理中 " + s.running);
    if (s.pending) parts.push("排队 " + s.pending);
    if (s.failed) parts.push("失败 " + s.failed);
    if (s.cancelled) parts.push("已取消 " + s.cancelled);
    if (s.expired) parts.push("已过期 " + s.expired);
    if (!parts.length) parts.push("共 " + ((status && status.total) || 0) + " 条");
    return parts.join(" · ");
  }

  // 提交结果文案。rejected[].index 是原始下标（0 起），显示 +1。
  function submitSummary(data) {
    var d = data || {};
    var lines = ["已启动 " + (d.accepted || 0) + " 条，共提交 " + (d.total || 0) + " 条。"];
    (d.rejected || []).forEach(function (x) {
      lines.push("第 " + ((x.index || 0) + 1) + " 条未启动：" + (x.error || ""));
    });
    return { lines: lines, accepted: d.accepted || 0, rejectedCount: (d.rejected || []).length };
  }

  // 402/503 有专门含义；其余透传服务端文案（含档位升级提示）
  function explain(r) {
    if (!r) return "请求失败";
    if (r.code === 402) return "本月可用时长已用完，升级会员或购买额外时长后才能继续。";
    if (r.code === 503) return "服务当前没有可用的剪映账号，请联系管理员。";
    return r.message || "请求失败";
  }

  function errText(e) {
    if (!e) return "请求失败";
    return e.message || String(e);
  }

  function fmtTime(s) {
    if (!s) return "—";
    var str = String(s);
    if (str.indexOf("T") > 0) str = str.replace("T", " ").slice(0, 16);
    return str.slice(0, 16);
  }

  // ─────────── UI ───────────

  function mount(panel) {
    UI.clear(panel);

    var tabs = UI.el("div", { class: "wf-tabs" });
    var body = UI.el("div");
    var tabDefs = [
      { key: "new", text: "发起批次" },
      { key: "status", text: "批次状态" },
    ];
    tabDefs.forEach(function (t, i) {
      var b = UI.el("button", { class: "btn wf-tab" + (i === 0 ? " active" : ""), text: t.text });
      b.addEventListener("click", function () {
        tabs.querySelectorAll(".wf-tab").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        renderTab(t.key);
      });
      tabs.appendChild(b);
    });
    panel.appendChild(tabs);
    panel.appendChild(body);

    function renderTab(key) {
      UI.clear(body);
      if (key === "new") renderNew(body);
      if (key === "status") renderStatus(body);
    }

    function call(method, path, payload) {
      return window.HTWApi.call(method, path, payload);
    }

    // status 里的下载地址是带 token 的相对路径（/api/v2/...），拼上 API 基址
    function absolute(url) {
      var s = String(url || "");
      if (/^https?:\/\//i.test(s)) return s;
      var base = (window.HTWApi && window.HTWApi.base) || "";
      if (!base) return s;
      try { return new URL(s, base).href; } catch (e) { return s; }
    }

    function openExternal(url) {
      if (!url) return;
      if (window.htw && typeof window.htw.openExternal === "function") window.htw.openExternal(url);
      else window.open(url, "_blank");
    }

    // ---------- 发起批次 ----------
    function renderNew(root) {
      var wrap = UI.el("div");
      root.appendChild(wrap);

      var state = { kind: "market-video", tpl: null };

      // kind 切换行：切到 cut-same 时追加模板搜索卡片
      var kindRow = UI.el("div", { class: "wf-row" });
      var kindTip = UI.el("div", { class: "wf-hint", text: KINDS[0].tip });
      KINDS.forEach(function (k, i) {
        // 不用 wf-tab：那是面板页签的类，面板内的类型切换用它会被计数/选择器误伤
        var b = UI.el("button", { class: "btn wf-kind" + (i === 0 ? " active" : ""), text: k.name });
        b.addEventListener("click", function () {
          state.kind = k.id;
          kindRow.querySelectorAll(".wf-kind").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          kindTip.textContent = k.tip;
          // 剪同款需要模板；其余两种不需要 —— 模板卡片按需显隐
          tplCard.style.display = k.id === "cut-same" ? "" : "none";
          mktCard.style.display = k.id === "market-video" ? "" : "none";
        });
        kindRow.appendChild(b);
      });

      var nameInput = UI.el("input", { class: "input", placeholder: "批次名（可选，方便自己对账）" });

      // ── 营销成片专属：一行一条 + 共用画幅/时长 ──
      var itemsText = UI.el("textarea", {
        class: "input",
        placeholder: "一行一个商品：商品名|卖点|优惠活动\n后两段可省略，例如：\n便携榨汁杯|Type-C充电 6叶刀头|双11立减30\n户外露营灯",
        rows: 5,
      });
      var ratioSel = UI.el("select", {}, RATIOS.map(function (r, i) {
        return UI.el("option", { value: r, text: r === "16:9" ? "16:9（横屏）" : "9:16（竖屏）", selected: i === 0 });
      }));
      var durSel = UI.el("select", {}, DURATIONS.map(function (d, i) {
        return UI.el("option", { value: d, text: d.replace("-", " ~ ") + " 秒", selected: i === 1 });
      }));
      var mktMat = UI.fileInput({ label: "商品素材（可多选，整批共用）", multiple: true });
      var mktMsg = UI.el("div", { class: "wf-hint" });
      var mktCard = UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "商品条目" }),
        itemsText,
        UI.el("div", { class: "wf-row" }, [
          UI.el("span", { class: "wf-hint", text: "画幅" }), ratioSel,
          UI.el("span", { class: "wf-hint", text: "时长" }), durSel,
        ]),
        mktMat,
        mktMsg,
      ]);

      // ── 剪同款专属：模板搜索 + 选择 ──
      var tplKeyword = UI.el("input", { class: "input", placeholder: "模板关键词" });
      var tplGrid = UI.el("div");
      var tplMsg = UI.el("div", { class: "wf-hint" });
      var tplSearchBtn = UI.el("button", { class: "btn", text: "搜模板" });
      tplSearchBtn.addEventListener("click", function () {
        var kw = (tplKeyword.value || "").trim();
        if (!kw) { tplMsg.textContent = "请输入模板关键词"; return; }
        tplMsg.textContent = "搜索中…";
        call("GET", "/api/v2/edit/cutsame/search?keyword=" + encodeURIComponent(kw) + "&count=20")
          .then(function (r) {
            if (!r || !r.ok) { tplMsg.textContent = ""; UI.showError(tplGrid, explain(r)); return; }
            UI.clear(tplGrid);
            var list = (r.data && r.data.templates) || [];
            if (!list.length) { tplMsg.textContent = "没有找到相关模板，换个关键词试试"; return; }
            tplMsg.textContent = "点一个模板选中它：";
            var grid = UI.el("div", { class: "wf-grid" });
            list.forEach(function (t) {
              var usable = !!t.available && !!t.draftPackageUrl;
              var meta = (t.fragmentCount ? t.fragmentCount + " 段 · " : "") +
                ((t.durationMs || 0) / 1000).toFixed(1) + "s" +
                (t.usageAmount ? " · " + t.usageAmount + " 人用过" : "");
              var card = UI.el("button", { class: "btn wf-topic" }, [
                UI.el("span", { text: t.name || "未命名模板" }),
                UI.el("span", { class: "wf-topic-score", text: meta + (usable ? "" : " · 不可用") }),
              ]);
              card.addEventListener("click", function () {
                if (!usable) { tplMsg.textContent = "该模板暂不可用（付费或未解锁），请换一个"; return; }
                state.tpl = t;
                grid.querySelectorAll(".wf-topic").forEach(function (x) { x.classList.remove("active"); });
                card.classList.add("active");
                tplMsg.textContent = "已选模板：" + (t.name || "");
              });
              grid.appendChild(card);
            });
            tplGrid.appendChild(grid);
          })
          .catch(function (e) { tplMsg.textContent = errText(e); });
      });
      var tplCard = UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "选模板" }),
        UI.el("div", { class: "wf-row" }, [tplKeyword, tplSearchBtn]),
        tplMsg,
        tplGrid,
      ]);
      tplCard.style.display = "none";

      // ── 剪同款/智能包装共用：N 个视频 = N 条 ──
      var vidMat = UI.fileInput({ label: "视频文件（可多选，每个文件 = 一条）", multiple: true, accept: ".mp4,.mov,.m4v" });

      var go = UI.el("button", { class: "btn", text: "▶ 提交批次" });
      var msg = UI.el("div", { class: "wf-hint" });
      go.addEventListener("click", function () {
        if (state.kind === "market-video") submitMarket();
        else submitVideos();
      });

      function setBusy(b) {
        go.disabled = b;
        msg.textContent = b ? "上传与提交中，素材越大等待越久…" : "";
      }

      function uploadOne(fileObj) {
        return window.HTWApi.upload("POST", "/api/v2/batch/upload",
          [{ name: fileObj.name, buffer: fileObj.buffer }], {}, null, "file");
      }

      async function readInputs(input) {
        var out = [];
        var files = (input.files && input.files.length) ? input.files : [];
        for (var i = 0; i < files.length; i++) {
          out.push({ name: files[i].name, buffer: await files[i].arrayBuffer() });
        }
        return out;
      }

      function baseName(n) { return String(n || "").replace(/\.[^.]+$/, ""); }

      async function submitMarket() {
        var parsed = parseItemLines(itemsText.value);
        if (parsed.errors.length) {
          msg.textContent = "第 " + parsed.errors.map(function (e) { return e.line; }).join("、") + " 行" +
            parsed.errors[0].error + "，请修正后重试";
          return;
        }
        if (!parsed.items.length) { msg.textContent = "请先填写商品条目（一行一个：商品名|卖点）"; return; }
        if (parsed.items.length > 50) { msg.textContent = "单批最多 50 条"; return; }
        setBusy(true);
        try {
          var materialIds = [];
          var matFiles = await readInputs(mktMat);
          for (var i = 0; i < matFiles.length; i++) {
            msg.textContent = "上传素材 " + (i + 1) + "/" + matFiles.length + "：" + matFiles[i].name;
            var up = await uploadOne(matFiles[i]);
            if (!up || !up.ok) throw new Error("素材上传失败：" + explain(up) + "（" + matFiles[i].name + "）");
            var mid = up.data && up.data.materialId;
            if (!mid) throw new Error("素材上传未返回 materialId：" + matFiles[i].name);
            materialIds.push(mid);
          }
          msg.textContent = "提交批次中…";
          var r = await call("POST", "/api/v2/batch/market-video",
            marketVideoRequest(nameInput.value, parsed, ratioSel.value, durSel.value, materialIds));
          onSubmitResult(r);
        } catch (e) { setBusy(false); msg.textContent = errText(e); }
      }

      async function submitVideos() {
        var files = await readInputs(vidMat);
        if (!files.length) { msg.textContent = "请先选择视频文件"; return; }
        if (files.length > 50) { msg.textContent = "单批最多 50 条"; return; }
        if (state.kind === "cut-same" && !(state.tpl && state.tpl.draftPackageUrl)) {
          msg.textContent = "剪同款需要先搜索并选中一个模板"; return;
        }
        setBusy(true);
        try {
          var entries = [];
          for (var i = 0; i < files.length; i++) {
            msg.textContent = "上传素材 " + (i + 1) + "/" + files.length + "：" + files[i].name;
            var up = await uploadOne(files[i]);
            if (!up || !up.ok) throw new Error("素材上传失败：" + explain(up) + "（" + files[i].name + "）");
            var mid = up.data && up.data.materialId;
            if (!mid) throw new Error("素材上传未返回 materialId：" + files[i].name);
            entries.push({ fileName: files[i].name, baseName: baseName(files[i].name), materialId: mid });
          }
          msg.textContent = "提交批次中…";
          var r = await call("POST", "/api/v2/batch/" + state.kind,
            videoRequest(state.kind, nameInput.value, state.tpl && state.tpl.draftPackageUrl, entries));
          onSubmitResult(r);
        } catch (e) { setBusy(false); msg.textContent = errText(e); }
      }

      // 提交结果：全成功 → 切到状态页盯进度；部分/全部被拒 → 留在本页摊开原因
      //（档位不符时是整批被拒，用户需要看到升级提示而不是"什么都没发生"）。
      function onSubmitResult(r) {
        setBusy(false);
        if (!r || !r.ok) { msg.textContent = ""; UI.showError(msg.parentNode, explain(r)); return; }
        var sum = submitSummary(r.data);
        if (sum.accepted > 0) {
          lastBatchId = r.data.batchId || "";
          renderTab("status");
          return;
        }
        UI.clear(msg.parentNode);
        msg.parentNode.appendChild(UI.el("div", { class: "wf-notice", text: sum.lines.join("\n") }));
      }

      wrap.appendChild(UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "批次类型" }),
        kindRow,
        kindTip,
        UI.el("div", { class: "field" }, [UI.el("label", { text: "批次名" }), nameInput]),
      ]));
      wrap.appendChild(tplCard);
      wrap.appendChild(mktCard);
      wrap.appendChild(UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "素材文件" }),
        vidMat,
      ]));
      wrap.appendChild(UI.el("div", { class: "card" }, [
        UI.el("div", { class: "wf-row" }, [go]),
        msg,
      ]));
    }

    // ---------- 批次状态 ----------
    var lastBatchId = "";

    function renderStatus(root) {
      var wrap = UI.el("div");
      root.appendChild(wrap);

      var idInput = UI.el("input", { class: "input", placeholder: "批次 ID（提交后自动填入）", value: lastBatchId });
      var loadBtn = UI.el("button", { class: "btn", text: "查询" });
      var region = UI.el("div");
      wrap.appendChild(UI.el("div", { class: "card" }, [
        UI.el("div", { class: "wf-row" }, [idInput, loadBtn]),
      ]));
      wrap.appendChild(region);

      function refresh() { loadStatus(region, idInput.value.trim()); }
      loadBtn.addEventListener("click", function () { UI.withLoading(loadBtn, refresh); });
      if (lastBatchId) refresh();
      else region.appendChild(UI.el("div", { class: "wf-empty", text: "提交批次后会自动在这里显示进度；也可以凭批次 ID 手动查询。" }));
    }

    function loadStatus(region, batchId) {
      if (!batchId) { UI.showError(region, "请先填写批次 ID"); return; }
      UI.clear(region);
      region.appendChild(UI.el("div", { class: "wf-hint", text: "加载中…" }));
      call("GET", "/api/v2/batch/status?batchId=" + encodeURIComponent(batchId)).then(function (r) {
        if (!r || !r.ok) { UI.showError(region, explain(r)); return; }
        renderBatch(region, r.data);
      }).catch(function (e) {
        UI.showError(region, errText(e));
      });
    }

    function renderBatch(region, data) {
      UI.clear(region);
      var kindName = data.kind;
      for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === data.kind) kindName = KINDS[i].name;

      region.appendChild(UI.el("div", { class: "wf-card" }, [
        UI.el("div", { class: "wf-card-head" }, [
          UI.el("span", { class: "wf-title", text: (data.name || "(未命名批次)") + " · " + kindName }),
          UI.el("span", { class: "wf-time", text: fmtTime(data.createdAt) }),
        ]),
        UI.el("div", { class: "wf-hint", text: "批次 " + (data.batchId || "") }),
        UI.el("div", { class: "wf-hint", text: summaryText(data) }),
      ]));

      var actions = UI.el("div", { class: "wf-row" });
      if (data.packageUrl) {
        var zip = UI.el("button", { class: "btn", text: "⬇ 整批打包下载" });
        zip.addEventListener("click", function () { openExternal(absolute(data.packageUrl)); });
        actions.appendChild(zip);
      }
      if (!isFinished(data)) {
        var cancel = UI.el("button", { class: "btn btn-ghost", text: "取消整批" });
        cancel.addEventListener("click", function () {
          cancel.disabled = true;
          call("POST", "/api/v2/batch/cancel", { BatchId: data.batchId }).then(function (r) {
            if (!r || !r.ok) { cancel.disabled = false; UI.showError(region, explain(r)); return; }
            loadStatus(region, data.batchId);
          }).catch(function (e) { cancel.disabled = false; msgText(region, errText(e)); });
        });
        actions.appendChild(cancel);
      } else if (data.summary && data.summary.failed) {
        var retry = UI.el("button", { class: "btn btn-ghost", text: "重提失败条目" });
        retry.addEventListener("click", function () {
          retry.disabled = true;
          call("POST", "/api/v2/batch/retry", { BatchId: data.batchId, FailedOnly: true }).then(function (r) {
            // 重提与提交同一套返回（accepted/rejected）：被拒的条目要摊开原因
            if (!r || !r.ok) { retry.disabled = false; UI.showError(region, explain(r)); return; }
            var sum = submitSummary(r.data);
            if (sum.rejectedCount) UI.showError(region, sum.lines.join("\n"));
            loadStatus(region, data.batchId);
          }).catch(function (e) { retry.disabled = false; msgText(region, errText(e)); });
        });
        actions.appendChild(retry);
      }
      if (actions.childNodes.length) region.appendChild(actions);

      var items = data.items || [];
      if (!items.length) { region.appendChild(UI.el("div", { class: "wf-empty", text: "批次里没有条目。" })); return; }
      items.forEach(function (it) {
        var st = itemStatus(it.status);
        var meta = "第 " + ((it.index || 0) + 1) + " 条 · " + (it.productName || "（未命名）");
        if (it.currentStep) meta += " · " + it.currentStep;
        if (it.attempt > 1) meta += " · 已重提 " + (it.attempt - 1) + " 次";
        var row = UI.el("div", { class: "wf-acct" }, [
          UI.el("div", {}, [
            UI.el("div", { class: "wf-acct-name", text: meta }),
            UI.el("div", { class: "wf-acct-meta", text: (it.progress != null ? it.progress + "%" : "") + (it.error ? " · " + it.error : "") }),
          ]),
          UI.el("div", { class: "wf-row" }, [
            it.downloadUrl
              ? UI.el("button", { class: "btn btn-ghost", text: "⬇ 下载", onclick: function () { openExternal(absolute(it.downloadUrl)); } })
              : null,
            UI.el("span", { class: "wf-stage " + st.cls, text: st.text }),
          ]),
        ]);
        region.appendChild(row);
      });

      // 没跑完就轮询；跑完或面板切走即停。POLL_LIMIT 兜底，别永远挂着。
      if (!isFinished(data)) track(region, data.batchId);
    }

    function track(root, id) {
      var started = Date.now();
      var timer = setInterval(function () {
        if (!root.isConnected) { clearInterval(timer); return; }
        if (Date.now() - started > POLL_LIMIT_MS) {
          clearInterval(timer);
          return;
        }
        call("GET", "/api/v2/batch/status?batchId=" + encodeURIComponent(id)).then(function (r) {
          if (!r || !r.ok) { clearInterval(timer); return; }   // 404 等明确失败：批次没了，别再问
          if (!root.isConnected) return;
          if (isFinished(r.data || {})) { clearInterval(timer); renderBatch(root, r.data); return; }
          // 没跑完也刷新汇总行，但不整页重绘（重绘会让滚动位置跳回顶部）
          updateSummary(root, r.data);
        }).catch(function () { /* 单次失败不终止轮询 */ });
      }, POLL_MS);
    }

    // 只刷新汇总行与条目进度，不动按钮 —— 整页重绘每 6 秒一次太晃眼
    function updateSummary(root, data) {
      var cards = root.querySelectorAll ? root.querySelectorAll(".wf-card") : [];
      if (!cards.length) return;
      var hint = cards[0].querySelectorAll(".wf-hint");
      if (hint.length > 1) hint[hint.length - 1].textContent = summaryText(data);
      var metas = root.querySelectorAll(".wf-acct-meta");
      var items = data.items || [];
      for (var i = 0; i < metas.length && i < items.length; i++) {
        var it = items[i];
        metas[i].textContent = (it.progress != null ? it.progress + "%" : "") + (it.error ? " · " + it.error : "");
      }
    }

    function msgText(region, text) {
      region.appendChild(UI.el("div", { class: "wf-error", text: text }));
    }

    renderTab("new");
  }

  return {
    mount: mount,
    _internal: {
      KINDS: KINDS, ITEM_STATUS: ITEM_STATUS, itemStatus: itemStatus,
      parseItemLines: parseItemLines, marketVideoRequest: marketVideoRequest,
      videoRequest: videoRequest, isFinished: isFinished, summaryText: summaryText,
      submitSummary: submitSummary, explain: explain, fmtTime: fmtTime,
      POLL_MS: POLL_MS, POLL_LIMIT_MS: POLL_LIMIT_MS, RATIOS: RATIOS, DURATIONS: DURATIONS,
    },
  };
});
