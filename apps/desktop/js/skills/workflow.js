(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") {
    var Skills = (window.Skills = window.Skills || {});
    Skills.workflow = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /*
   * 全链路工作流：选题 → 成片 → 包装 → 文案/合规 → 发布
   * 服务端契约见后端 docs/2026-10-03-workflow-pipeline.md。
   * 对应接口：
   *   GET  /api/v2/workflow/topics?count=6   自动选题候选（已剔除跑过的主题）
   *   POST /api/v2/workflow/create            起一条（topic 留空 + topicSource=auto 则自动选题）
   *   POST /api/v2/workflow/create-batch      一次起 N 条
   *   GET  /api/v2/workflow/status?workflowId=
   *   POST /api/v2/workflow/approve           人工确认发布
   *   POST /api/v2/workflow/cancel
   *   GET  /api/v2/workflow/history?limit=30
   *
   * 响应字段统一经 HTWApi.normalize 转成 camelCase 后再读取（后端 POCO 是 PascalCase）。
   */

  // 服务端状态机词表。终态（completed/failed/cancelled）不再轮询。
  var STAGE = {
    produce: { text: "出片中", cls: "wf-run", tip: "正在生成脚本、配音与画面" },
    package: { text: "包装中", cls: "wf-run", tip: "正在做智能包装与云端渲染" },
    compose: { text: "生成文案中", cls: "wf-run", tip: "正在生成标题、正文、标签并做合规检查" },
    publishing: { text: "发布中", cls: "wf-run", tip: "已提交发布，等平台回执" },
    "awaiting-publish": { text: "待你确认", cls: "wf-wait", tip: "成片与文案已就绪，确认后才会真正发到平台" },
    completed: { text: "已完成", cls: "wf-ok", tip: "已发布成功" },
    failed: { text: "失败", cls: "wf-bad", tip: "某一段没有跑通" },
    cancelled: { text: "已取消", cls: "wf-mute", tip: "你取消了这个工作流" },
  };

  function stage(s) { return STAGE[s] || { text: s || "未知", cls: "wf-mute", tip: "" }; }

  // 轮询节奏：出片这段通常要几分钟。6s 够用，也不至于把服务端问爆。
  var POLL_MS = 6000;
  // 上限 30 分钟。超时就停手并指去"历史"看，而不是无限轮询一个可能已经死掉的任务。
  var POLL_LIMIT_MS = 30 * 60 * 1000;

  // 平台复选框。发布目标与后端 WorkflowPublishConfig.Platforms 对应。
  var PLATFORMS = [
    { id: "douyin", name: "抖音" },
    { id: "xhs", name: "小红书" },
    { id: "bili", name: "B站" },
    { id: "toutiao", name: "今日头条" },
  ];

  // 内容形态。与后端 WorkflowStartRequest.ContentType 对齐：
  // video 全链路（出片→包装→文案→发布）；narration 为口播解读变体（3-5 分钟，先出调研简报
  // 再分段口播）；article/weitoutiao 跳过出片与包装，服务端直接从 compose 起步
  // （article 会用即梦补封面，weitoutiao 纯文本）。
  var CONTENT_TYPES = [
    { id: "video", name: "视频成片", tip: "完整链路：AI 出片 → 智能包装 → 文案 → 发布（耗时较长）" },
    { id: "narration", name: "口播解读", tip: "3-5 分钟时事/财经口播：先出调研简报再逐段口播出片（耗时最长，仅口播画面）" },
    { id: "article", name: "图文文章", tip: "不出片：AI 写文章并生成封面，直接进入文案与发布" },
    { id: "weitoutiao", name: "微头条", tip: "最轻：纯文本短内容，无封面无成片" },
  ];

  // 与服务端 WorkflowEngine.NormalizeContentType 同口径：
  // 空/未知按 video 处理；narration 是独立形态（走视频线的叙事驱动变体）。
  function normalizeContentType(s) {
    var v = String(s || "").trim().toLowerCase();
    if (v === "narration") return v;
    return (v === "article" || v === "weitoutiao") ? v : "video";
  }

  // 图文两形态（跳过出片与包装）。注意 narration 不算图文 —— 它要走 produce/package 全链。
  function isTextContent(s) {
    var v = normalizeContentType(s);
    return v === "article" || v === "weitoutiao";
  }

  // ─────────── 纯函数（导出供单测） ───────────

  // 需要盯着的状态：活动段（服务端泵会推进）+ 等人确认的那一段。
  function isWatching(w) {
    var s = (w && w.stage) || "";
    return s === "awaiting-publish" || s === "produce" || s === "package" ||
           s === "compose" || s === "publishing";
  }

  // 批量结果文案。rejected[].index 是**原始下标**（服务端口径），显示时 +1 变成人能读的序号。
  function batchSummary(data) {
    var d = data || {};
    var rejected = d.rejected || [];
    var lines = ["已启动 " + (d.accepted || 0) + " 条，共提交 " + (d.total || 0) + " 条。"];
    rejected.forEach(function (x) {
      lines.push("第 " + ((x.index || 0) + 1) + " 条未启动：" + (x.error || ""));
    });
    return { lines: lines, accepted: d.accepted || 0, rejectedCount: rejected.length };
  }

  function parseTags(s) {
    try {
      var v = JSON.parse(s || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function parseJson(s) {
    if (!s) return null;
    // 后端这几个字段一律是字符串（DB 列是 TEXT），不是对象
    if (typeof s === "object") return s;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  // 402/429/503 有专门的业务含义，原样透出会让用户只看到数字。
  function explain(r) {
    if (!r) return "请求失败";
    if (r.code === 402) return "本月可用时长已用完，升级会员或购买额外时长后才能继续。";
    if (r.code === 429) return "提交太频繁或并发已满，稍等一会儿再试。";
    if (code503(r)) return "服务当前没有可用的剪映账号，请联系管理员。";
    return r.message || "请求失败";
  }

  function code503(r) { return r.code === 503; }

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
      { key: "new", text: "发起工作流" },
      { key: "running", text: "进行中" },
      { key: "history", text: "历史" },
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
      if (key === "running") renderRunning(body);
      if (key === "history") renderHistory(body);
    }

    function call(method, path, payload) {
      return window.HTWApi.call(method, path, payload);
    }

    function load(region, method, path, payload, onData) {
      UI.clear(region);
      region.appendChild(UI.el("div", { class: "wf-hint", text: "加载中…" }));
      call(method, path, payload).then(function (r) {
        if (!r || !r.ok) { UI.showError(region, explain(r)); return; }
        onData(r.data || {});
      }).catch(function (e) {
        UI.showError(region, errText(e));
      });
    }

    function emptyBox(text) {
      return UI.el("div", { class: "wf-empty", text: text });
    }

    // 服务端给的下载地址可能是 CDN 绝对直链，也可能是自家 /api/... 相对路径
    // （包装段产物没有 CDN 直链，只能走自家端点）。相对路径要拼上 API 基址。
    function absolute(url) {
      var s = String(url || "");
      if (/^https?:\/\//i.test(s)) return s;
      var base = (window.HTWApi && window.HTWApi.base) || "";
      if (!base) return s;
      try { return new URL(s, base).href; } catch (e) { return s; }
    }

    // 下载要交给系统浏览器：CDN 是跨域的，<a download> 会被浏览器忽略；
    // 而 Electron 内部的 <a download> 只对自家 will-download 生效。
    function openExternal(url) {
      if (!url) return;
      if (window.htw && typeof window.htw.openExternal === "function") window.htw.openExternal(url);
      else window.open(url, "_blank");
    }

    // ---------- 发起工作流 ----------
    function renderNew(root) {
      var wrap = UI.el("div");
      root.appendChild(wrap);

      var state = {
        auto: false,
        contentType: "video",
        platforms: { douyin: true, xhs: false, bili: false, toutiao: false },
      };
      var topic = UI.el("input", { class: "input", placeholder: "主题 / 话题" });
      var topicBox = UI.el("div");
      var msg = UI.el("div", { class: "wf-hint" });

      // 口播专属：真人出镜素材（A-roll）。可选 —— 上传到素材池换 materialId 随 create 提交，
      // 服务端把口播稿的 host 段（钩子/观点/收尾）换成这些真人片段当主轨画面，其余段照常配画面。
      var arollInput = UI.fileInput({ label: "选择真人出镜片段（可多选，mp4/mov）", accept: ".mp4,.mov,.m4v", multiple: true });
      var arollHint = UI.el("div", {
        class: "wf-hint",
        text: "可选。上传后 AI 会在合适的段落切入真人出镜；不传则全程无真人。素材越大上传越久。",
      });
      var arollCard = UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "真人出镜素材（可选）" }),
        arollInput,
        arollHint,
      ]);
      arollCard.style.display = "none";

      function topicPlaceholder(ct) {
        var v = normalizeContentType(ct);
        return v === "video" ? "视频主题 / 话题"
          : v === "article" ? "文章主题 / 话题"
          : v === "narration" ? "解读主题 / 话题（时事、财经、科技事件）"
          : "微头条主题 / 话题";
      }

      // 内容形态三选一。图文两档在服务端会跳过出片与包装两段（省时长额度），
      // 这里切换时顺带把提示与占位换成对应口径。
      var typeRow = UI.el("div", { class: "wf-row" });
      var typeTip = UI.el("div", { class: "wf-hint", text: CONTENT_TYPES[0].tip });
      CONTENT_TYPES.forEach(function (t, i) {
        // 不用 wf-tab：那是面板页签的类，面板内的形态切换用它会被计数/选择器误伤
        var b = UI.el("button", { class: "btn wf-type" + (i === 0 ? " active" : ""), text: t.name });
        b.addEventListener("click", function () {
          state.contentType = t.id;
          typeRow.querySelectorAll(".wf-type").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          typeTip.textContent = t.tip;
          topic.placeholder = topicPlaceholder(t.id);
          arollCard.style.display = t.id === "narration" ? "" : "none";
        });
        typeRow.appendChild(b);
      });

      var autoBtn = UI.el("button", { class: "btn", text: "🎲 让系统选题" });
      autoBtn.addEventListener("click", function () {
        if (state.auto) {                       // 已展开则收起
          state.auto = false;
          UI.clear(topicBox);
          topic.placeholder = topicPlaceholder(state.contentType);
          autoBtn.textContent = "🎲 让系统选题";
          return;
        }
        state.auto = true;
        autoBtn.textContent = "✕ 不用选题了";
        load(topicBox, "GET", "/api/v2/workflow/topics?count=6", null, function (d) {
          UI.clear(topicBox);
          var items = d.items || [];
          if (!items.length) {
            topicBox.appendChild(emptyBox(d.exhausted
              ? "近期选题都跑过了。换个赛道，或去「选题」补充对标账号后会有新候选。"
              : "暂时没有合适的选题（热榜与对标雷达都没有可展示的话题）。"));
            return;
          }
          topicBox.appendChild(UI.el("div", { class: "wf-hint", text: "按潜力分排序，点一条直接用它：" }));
          var grid = UI.el("div", { class: "wf-grid" });
          topicBox.appendChild(grid);
          items.forEach(function (c) {
            var pick = UI.el("button", { class: "btn wf-topic" }, [
              UI.el("span", { text: c.title || "" }),
              UI.el("span", { class: "wf-topic-score", text: c.score != null ? String(c.score) : "" }),
            ]);
            pick.addEventListener("click", function () {
              topic.value = c.title || "";
              grid.querySelectorAll(".wf-topic").forEach(function (x) { x.classList.remove("active"); });
              pick.classList.add("active");
            });
            grid.appendChild(pick);
          });
        });
      });

      var platRow = UI.el("div", { class: "wf-row" });
      PLATFORMS.forEach(function (p) {
        var cb = UI.el("input", { type: "checkbox" });
        cb.checked = !!state.platforms[p.id];
        cb.addEventListener("change", function () { state.platforms[p.id] = cb.checked; });
        platRow.appendChild(UI.el("label", { class: "wf-plat" }, [cb, " " + p.name]));
      });

      function pickedPlatforms() {
        return PLATFORMS.filter(function (p) { return state.platforms[p.id]; }).map(function (p) { return p.id; });
      }

      // 🔴 自动发布**故意不在界面上提供**。用客户自己的平台凭证自动化发帖，违反平台 ToS
      // 会连累客户账号，所以这一步必须人点（服务端也强制 AutoPublish=false）。
      var autoNote = UI.el("div", {
        class: "wf-notice",
        text: "工作流会跑到「待你确认」为止，最后的发布动作由你点确认 —— 自动发帖有平台合规风险，不做成一键到底。",
      });

      var go = UI.el("button", { class: "btn", text: "▶ 开始工作流" });
      go.addEventListener("click", function () {
        var topicValue = (topic.value || "").trim();
        var source = state.auto && !topicValue ? "auto" : "";
        if (!topicValue && !source) { msg.textContent = "请先填主题，或点「让系统选题」"; return; }
        go.disabled = true;

        // narration 且选了真人素材：先上传素材池换 materialId，再随 create 提交。
        // 上传失败要留在本页报错 —— 素材传不上去不该把整个工作流吞掉。
        var pre = Promise.resolve([]);
        if (state.contentType === "narration") {
          var input = arollInput.input;
          var files = (input.files && input.files.length) ? input.files : [];
          if (files.length) {
            pre = (async function () {
              var ids = [];
              for (var k = 0; k < files.length; k++) {
                msg.textContent = "上传真人素材 " + (k + 1) + "/" + files.length + "：" + files[k].name;
                var buf = await files[k].arrayBuffer();
                var up = await window.HTWApi.upload("POST", "/api/v2/batch/upload",
                  [{ name: files[k].name, buffer: buf }], {}, null, "file");
                if (!up || !up.ok || !(up.data && up.data.materialId)) {
                  throw new Error("真人素材上传失败：" + ((up && up.message) || "未知原因") + "（" + files[k].name + "）");
                }
                ids.push(up.data.materialId);
              }
              return ids;
            })();
          }
        }

        pre.then(function (arollIds) {
          msg.textContent = "提交中…";
          return call("POST", "/api/v2/workflow/create", {
            Topic: topicValue,
            TopicSource: source,
            ContentType: state.contentType,
            ARollMaterialIds: arollIds || [],
            Publish: { Platforms: pickedPlatforms(), AutoPublish: false },
          });
        }).then(function (r) {
          go.disabled = false;
          if (!r || !r.ok) { msg.textContent = ""; UI.showError(msg.parentNode, explain(r)); return; }
          var workflowId = r.taskId || (r.data && r.data.workflowId);
          // 判空再调：容器缺席时静默跳过，否则这一行抛出的 TypeError 会被下面的
          // catch 接成一句提交失败，把一次其实已经起成的工作流报成没起来。
          if (window.HTWTasks) window.HTWTasks.track({ domain: "workflow", taskId: workflowId, panel: "workflow", title: "工作流" });
          // 直接切到「进行中」看进度，不在这里弹成功提示：切走时该节点会被清掉，写了也看不见。
          renderTab("running");
        }).catch(function (e) {
          go.disabled = false;
          msg.textContent = e && e.message ? e.message : errText(e);
        });
      });

      var batchTopics = UI.el("textarea", {
        class: "input",
        placeholder: "一行一个主题，可一次跑多条",
      });
      var batchBtn = UI.el("button", { class: "btn btn-ghost", text: "批量启动" });
      batchBtn.addEventListener("click", function () {
        var topics = (batchTopics.value || "").split(/\r?\n/)
          .map(function (s) { return s.trim(); })
          .filter(function (s) { return s.length; });
        if (!topics.length) { msg.textContent = "请先填写至少一个主题（每行一个）"; return; }
        batchBtn.disabled = true;
        msg.textContent = "提交中…";
        call("POST", "/api/v2/workflow/create-batch", {
          Topics: topics,
          ContentType: state.contentType,
          Publish: { Platforms: pickedPlatforms(), AutoPublish: false },
        }).then(function (r) {
          batchBtn.disabled = false;
          if (!r || !r.ok) { msg.textContent = ""; UI.showError(msg.parentNode, explain(r)); return; }
          var sum = batchSummary(r.data);
          // 批量启动一次起了 N 条工作流，每条都要走完整条链路（出片→包装→文案→发布），
          // 正是任务中心存在的意义，不登记的话用户只能守在这个面板上等。
          // 标识取 items[].workflowId —— WorkflowController.CreateBatch 的响应是
          // { total, accepted, rejected, items: [{ index, workflowId, topic }] }，
          // 与面板自己读 accepted / rejected 同一个响应体。只登记真起来了的：
          // rejected 的那几条服务端压根没有这条记录，登记进去就是一条永远收敛不了
          // 的「进行中」。标题带上主题是为了在列表里能分辨是哪一条（主题截断，
          // 免得一行标题把整个面板撑开）。
          ((r.data && r.data.items) || []).forEach(function (it) {
            var topic = it && it.topic ? String(it.topic).slice(0, 20) : "";
            if (window.HTWTasks) window.HTWTasks.track({ domain: "workflow", taskId: it && it.workflowId, panel: "workflow", title: topic ? "工作流 · " + topic : "批量工作流" });
          });
          UI.clear(msg.parentNode);
          // 部分成功时**留在本页**把明细摊开：批量最常见的就是"大部分起来了、几条没进去"
          // （速率票据按条计，免费档一分钟只放得下几条）。直接切走等于把这事藏起来，
          // 用户会以为 10 条全在跑，次日才发现少了几条。
          if (sum.accepted > 0) {
            msg.parentNode.appendChild(UI.el("div", { class: "wf-notice", text: sum.lines.join("\n") }));
            var goSee = UI.el("button", { class: "btn", text: "查看进行中的工作流 →" });
            goSee.addEventListener("click", function () { renderTab("running"); });
            msg.parentNode.appendChild(UI.el("div", { class: "wf-row" }, [goSee]));
            return;
          }
          msg.parentNode.appendChild(UI.el("div", { class: "wf-ok-box", text: sum.lines.join("\n") }));
        }).catch(function (e) {
          batchBtn.disabled = false;
          msg.textContent = errText(e);
        });
      });

      wrap.appendChild(UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "内容形态" }),
        typeRow,
        typeTip,
      ]));

      wrap.appendChild(arollCard);

      wrap.appendChild(UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "选题" }),
        UI.el("div", { class: "wf-row" }, [topic, autoBtn]),
        topicBox,
        UI.el("h3", { text: "发布到" }),
        platRow,
        autoNote,
        UI.el("div", { class: "wf-row" }, [go]),
        msg,
      ]));

      wrap.appendChild(UI.el("div", { class: "card" }, [
        UI.el("h3", { text: "批量" }),
        UI.el("div", { class: "wf-hint", text: "一次跑多条。每条都各自计费、也都各自走完整条链路。" }),
        batchTopics,
        UI.el("div", { class: "wf-row" }, [batchBtn]),
      ]));
    }

    // ---------- 进行中 ----------
    function renderRunning(root) {
      var wrap = UI.el("div");
      root.appendChild(wrap);
      // 活动段 + 等人确认的，两类都要看得到
      load(wrap, "GET", "/api/v2/workflow/history?limit=30", null, function (d) {
        UI.clear(wrap);
        var items = (d.items || []).filter(isWatching);
        if (!items.length) {
          wrap.appendChild(emptyBox("现在没有进行中的工作流。去「发起工作流」起一条。"));
          return;
        }
        items.forEach(function (w) {
          wrap.appendChild(wfCard(w, function () { renderRunning(root); }));
        });
        // 每条各自计时；切走面板时定时器会自己停
        items.forEach(function (w) { track(root, w.workflowId); });
      });
    }

    // 轮询一条工作流。终态、超时、或面板已切走时都停手。
    function track(root, id) {
      if (!id) return;
      var started = Date.now();
      var timer = setInterval(function () {
        if (!root.isConnected) { clearInterval(timer); return; }
        if (Date.now() - started > POLL_LIMIT_MS) {
          clearInterval(timer);
          var box = root.querySelector('[data-wf-poll="' + id + '"]');
          if (box) box.textContent = "轮询已超时，可到「历史」里看最终结果。";
          return;
        }
        call("GET", "/api/v2/workflow/status?workflowId=" + encodeURIComponent(id)).then(function (r) {
          if (!r || !r.ok) return;
          if (!isWatching(r.data || {})) {
            clearInterval(timer);
            renderRunning(root);
          }
        }).catch(function () { /* 单次失败不终止轮询 */ });
      }, POLL_MS);
    }

    function wfCard(w, refresh) {
      var st = stage(w.stage);
      var kids = [
        UI.el("div", { class: "wf-card-head" }, [
          UI.el("span", { class: "wf-stage " + st.cls, text: st.text, title: st.tip || "" }),
          UI.el("span", { class: "wf-time", text: fmtTime(w.createdAt) }),
        ]),
        UI.el("div", { class: "wf-title", text: w.topic || "(无主题)" }),
      ];

      // 图文线没有成片，标出来免得用户等一个不会出现的下载按钮
      var ct = normalizeContentType(w.contentType);
      if (ct !== "video") {
        var name = "article";
        for (var i = 0; i < CONTENT_TYPES.length; i++) if (CONTENT_TYPES[i].id === ct) name = CONTENT_TYPES[i].name;
        kids.push(UI.el("div", { class: "wf-hint", text: "内容形态：" + name }));
      }

      var poll = UI.el("div", { class: "wf-hint" });
      poll.setAttribute("data-wf-poll", w.workflowId || "");
      kids.push(poll);

      if (w.title) kids.push(UI.el("div", { class: "wf-evidence", text: "标题：" + w.title }));
      if (w.error) kids.push(UI.el("div", { class: "wf-error", text: "✕ " + w.error }));

      var actions = UI.el("div", { class: "wf-row" });

      // 人工确认闸 —— 这是设计上必须的一步，不是可选项
      if (w.stage === "awaiting-publish") {
        var review = UI.el("button", { class: "btn", text: "查看并确认发布" });
        review.addEventListener("click", function () {
          var panel = showReview(w, refresh);
          if (panel) {
            var card = review.closest(".wf-card");
            if (card) card.appendChild(panel);
          }
        });
        actions.appendChild(review);
      }

      if (isWatching(w) && w.stage !== "awaiting-publish") {
        var cancel = UI.el("button", { class: "btn btn-ghost", text: "取消" });
        cancel.addEventListener("click", function () {
          cancel.disabled = true;
          call("POST", "/api/v2/workflow/cancel", { WorkflowId: w.workflowId }).then(function (r) {
            if (!r || !r.ok) { cancel.disabled = false; UI.showError(poll, explain(r)); return; }
            refresh();
          }).catch(function (e) { cancel.disabled = false; UI.showError(poll, errText(e)); });
        });
        actions.appendChild(cancel);
      }

      // 成片下载。地址由服务端给：优先剪映 CDN 直链（自家 /download 端点经 Cloudflare
      // 会把大文件截断，客户端拿到的是缺 moov 的坏文件）。
      // 走系统浏览器打开而不是 <a download> —— CDN 是跨域的，download 属性会被忽略。
      if (w.downloadUrl) {
        var dl = UI.el("button", { class: "btn btn-ghost", text: "⬇ 下载成片" });
        dl.addEventListener("click", function () { openExternal(absolute(w.downloadUrl)); });
        actions.appendChild(dl);
      }

      if (actions.childNodes.length) kids.push(actions);
      return UI.el("div", { class: "wf-card" }, kids);
    }

    // 确认前的复核界面。文案与合规结论必须让人先看到再点确认。
    function showReview(w, refresh) {
      var box = UI.el("div", { class: "card wf-review" });
      var kids = [
        UI.el("h3", { text: "发布前确认" }),
        UI.el("div", { class: "wf-hint", text: "下面就是即将发到平台的内容。确认无误再点发布 —— 发出去之后就收不回来了。" }),
        UI.el("div", { class: "wf-title", text: w.topic || "" }),
      ];

      // 标题候选（2026-10-07）：点一条即选中，确认发布时把它带上去。
      // 为什么做成"点选"而不是 input：服务端只接受**已落库的候选**
      // （WorkflowEngine.Approve 校验），自由输入会被 409 拒掉。
      var picked = w.title || "";
      var cands = Array.isArray(w.titleCandidates) ? w.titleCandidates : [];

      if (w.title) kids.push(UI.el("div", { class: "wf-evidence", text: "标题：" + w.title }));

      if (cands.length > 0) {
        var titleBox = UI.el("div", { class: "wf-title-cands" });
        titleBox.appendChild(UI.el("div", {
          class: "wf-hint",
          text: "换个标题（点一条选中，分数是系统按长度/数字/钩子等维度算的参考分）：",
        }));

        cands.forEach(function (c) {
          var isCurrent = c.title === picked;
          var row = UI.el("div", {
            class: "wf-title-cand" + (isCurrent ? " is-current" : ""),
            onclick: function () {
              // 幂等切换：点已选中的那条会取消选择，回到系统生成的标题
              var next = isCurrent ? (w.title || "") : c.title;
              picked = next;
              Array.prototype.forEach.call(titleBox.querySelectorAll(".wf-title-cand"), function (n) {
                n.classList.remove("is-current");
              });
              if (next === c.title) row.classList.add("is-current");
              var line = titleBox.querySelector(".wf-title-picked");
              if (line) line.textContent = next ? "将使用：" + next : "将使用系统生成的标题";
            },
          }, [
            UI.el("span", { class: "wf-title-cand-text", text: c.title }),
            UI.el("span", { class: "wf-title-cand-score", text: String(c.score == null ? "" : c.score) }),
          ]);
          // 分数旁边挂理由：让"为什么它排第一"可见，而不是黑盒分数
          if (Array.isArray(c.reasons) && c.reasons.length) {
            row.title = c.reasons.join("\n");
          }
          titleBox.appendChild(row);
        });

        titleBox.appendChild(UI.el("div", {
          class: "wf-title-picked",
          text: picked ? "将使用：" + picked : "将使用系统生成的标题",
        }));
        kids.push(titleBox);
      }

      if (w.content) kids.push(UI.el("div", { class: "wf-content", text: w.content }));

      var tags = parseTags(w.tags);
      if (tags.length) {
        kids.push(UI.el("div", { class: "wf-tags", text: tags.map(function (t) { return "#" + t; }).join(" ") }));
      }

      var comp = parseJson(w.compliance);
      if (comp && comp.evaluated) {
        kids.push(UI.el("div", {
          class: "wf-hint",
          text: (comp.safe ? "✓ 合规检查通过" : "✕ 合规检查未通过") + (comp.note ? "：" + comp.note : ""),
        }));
      } else {
        kids.push(UI.el("div", { class: "wf-hint", text: "本次没有合规检查结论，请自行确认内容。" }));
      }

      var errBox = UI.el("div");
      kids.push(errBox);

      // 待确认时成片已经在手上，先看再发是自然动作
      if (w.downloadUrl) {
        var watch = UI.el("button", { class: "btn btn-ghost", text: "▶ 先看成片" });
        watch.addEventListener("click", function () { openExternal(absolute(w.downloadUrl)); });
        kids.push(UI.el("div", { class: "wf-row" }, [watch]));
      }

      var ok = UI.el("button", { class: "btn", text: "确认发布" });
      var back = UI.el("button", { class: "btn btn-ghost", text: "再等等" });
      ok.addEventListener("click", function () {
        ok.disabled = true;
        // ChosenTitle 只在**用户真的改选过**时才带（与当前标题不同）。
        // 带上原标题虽然也合法，但让请求体保持"没改就不传"更干净。
        var approveBody = { WorkflowId: w.workflowId, Stage: "publish" };
        if (picked && picked !== w.title) approveBody.ChosenTitle = picked;
        call("POST", "/api/v2/workflow/approve", approveBody)
          .then(function (r) {
            ok.disabled = false;
            // 提交失败不是"内容有问题"，可能只是平台登录态失效 —— 服务端会把它留在待确认，
            // 修好登录态后再点一次即可。所以这里展示错误而不是清掉复核面板。
            if (!r || !r.ok) { UI.showError(errBox, explain(r)); return; }
            refresh();
          }).catch(function (e) { ok.disabled = false; UI.showError(errBox, errText(e)); });
      });
      back.addEventListener("click", function () { if (box.parentNode) box.parentNode.removeChild(box); });
      kids.push(UI.el("div", { class: "wf-row" }, [ok, back]));

      box.appendChild.apply(box, kids);
      return box;
    }

    // ---------- 历史 ----------
    function renderHistory(root) {
      var wrap = UI.el("div");
      root.appendChild(wrap);
      load(wrap, "GET", "/api/v2/workflow/history?limit=50", null, function (d) {
        UI.clear(wrap);
        var items = d.items || [];
        if (!items.length) {
          wrap.appendChild(emptyBox("还没有工作流记录。"));
          return;
        }
        var listCard = UI.el("div", { class: "card" }, [UI.el("h3", { text: "全部记录" })]);
        items.forEach(function (w) {
          var st = stage(w.stage);
          var ct = normalizeContentType(w.contentType);
          var head = UI.el("div", { class: "wf-acct-name", text: w.title || w.topic || "(无主题)" });
          if (ct !== "video") {
            var name = "";
            for (var i = 0; i < CONTENT_TYPES.length; i++) if (CONTENT_TYPES[i].id === ct) name = CONTENT_TYPES[i].name;
            if (name) head.appendChild(UI.el("span", { class: "wf-time", text: " · " + name }));
          }
          var right = UI.el("div", { class: "wf-row" });
          // 只有拿到下载地址才给按钮 —— 给一个必然 404 的链接比不给更让人困惑
          if (w.downloadUrl) {
            var dl = UI.el("button", { class: "btn btn-ghost", text: "⬇ 下载" });
            dl.addEventListener("click", function () { openExternal(absolute(w.downloadUrl)); });
            right.appendChild(dl);
          }
          right.appendChild(UI.el("span", { class: "wf-stage " + st.cls, text: st.text, title: st.tip || "" }));
          listCard.appendChild(UI.el("div", { class: "wf-acct" }, [
            UI.el("div", {}, [
              head,
              UI.el("div", { class: "wf-acct-meta", text: fmtTime(w.createdAt) + (w.error ? " · " + w.error : "") }),
            ]),
            right,
          ]));
        });
        wrap.appendChild(listCard);
      });
    }

    renderTab("new");
  }

  return {
    mount: mount,
    // 导出纯函数供单测（见 js/skills/workflow.test.cjs）
    _internal: {
      STAGE: STAGE, stage: stage, isWatching: isWatching, batchSummary: batchSummary,
      parseTags: parseTags, parseJson: parseJson, explain: explain, fmtTime: fmtTime,
      PLATFORMS: PLATFORMS, CONTENT_TYPES: CONTENT_TYPES,
      normalizeContentType: normalizeContentType, isTextContent: isTextContent,
      POLL_MS: POLL_MS, POLL_LIMIT_MS: POLL_LIMIT_MS,
    },
  };
});
