(function () {
  const Skills = (window.Skills = window.Skills || {});
  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }
  // 兼容服务端把列表包成数组 / {data:[]} / {list:[]} / 平台为 key 的对象 等多种形态，并丢弃 null 项。
  function asList(raw) {
    let arr;
    if (Array.isArray(raw)) arr = raw;
    else if (raw && typeof raw === "object") {
      if (Array.isArray(raw.data)) arr = raw.data;
      else if (Array.isArray(raw.list)) arr = raw.list;
      else if (Array.isArray(raw.items)) arr = raw.items;
      else if (Array.isArray(raw.platforms)) arr = raw.platforms;
      else arr = Object.values(raw);
    } else arr = [];
    return arr.filter(function (x) { return x && typeof x === "object"; });
  }
  function opt(v, t) { return window.UI.el("option", { value: v, text: t || v }); }

  Skills.publish = {
    mount: function (panel) {
      const UI = window.UI;
      const API = window.HTWApi;
      UI.clear(panel);

      const PLATFORMS = ["douyin", "xhs", "bilibili", "toutiao"];
      const PLAT_NAME = { douyin: "抖音", xhs: "小红书", bilibili: "B站", toutiao: "今日头条" };
      const COOKIE_HINTS = {
        bilibili: "从 bilibili.com 登录后，DevTools → Network → 任意请求 → Cookie 头复制完整字符串（需包含 SESSDATA 和 bili_jct）",
        toutiao: "从 toutiao.com 登录后，DevTools → Application → Cookies 复制完整 Cookie（需包含 ttwid）",
        douyin: "从 douyin.com 登录后，DevTools → Application → Cookies 复制完整 Cookie（需包含 ttwid 和 odin_ttid）",
        xhs: "从小红书 web 端登录后，DevTools → Application → Cookies 复制完整 Cookie（需包含 web_session 和 webId）",
      };

      async function readFiles(wrap) {
        const arr = [];
        const list = wrap.input.files;
        for (let i = 0; i < list.length; i++) { const f = list[i]; arr.push({ name: f.name, buffer: await f.arrayBuffer() }); }
        return arr;
      }
      function field(labelText, input) { return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]); }
      function section(title, bodyNodes, actionNodes, region, icon) {
        const head = icon ? UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]) : UI.el("h3", { text: title });
        const kids = [head].concat(bodyNodes);
        const actions = Array.isArray(actionNodes) ? actionNodes : [actionNodes];
        kids.push(UI.el("div", { class: "row" }, actions));
        kids.push(region);
        return UI.el("div", { class: "card" }, kids);
      }

      // ===== 状态 =====
      const tags = [];
      let mediaUrl = "", coverUrl = "";
      let platformCfg = {};
      const platformEls = {};       // checkbox
      const platformDotEls = {};     // 状态点（cookie 是否有效）
      const cookieHas = {};         // 各平台是否已配置 Cookie
      const cookieMsgs = {};        // 各平台最近一次操作结果（刷新后保留提示）
      const selPlats = [];

      // ===== 发布编辑面板 =====
      const pubTitle = UI.el("input", { type: "text", placeholder: "标题", maxlength: "100" });
      const pubContent = UI.el("textarea", { placeholder: "正文内容（可选）" });
      const tagInput = UI.el("input", { type: "text", placeholder: "输入标签，回车添加" });
      const tagBox = UI.el("div", { class: "tagbox" });
      const tagGenBtn = UI.el("button", { class: "btn secondary", text: "AI 生成" });
      const mediaFile = UI.fileInput({ label: "选择视频/图片", accept: "video/*,image/*" });
      const mediaUploadBtn = UI.el("button", { class: "btn secondary", text: "上传媒体" });
      const mediaPrev = UI.el("div", { class: "hintline" });
      const coverFile = UI.fileInput({ label: "选择封面图", accept: "image/*" });
      const coverUploadBtn = UI.el("button", { class: "btn secondary", text: "上传封面" });
      const coverPrev = UI.el("div", { class: "hintline" });
      const platformRow = UI.el("div", { class: "row" }, PLATFORMS.map(function (p) {
        const c = UI.el("input", { type: "checkbox", value: p });
        const dot = UI.el("span", { class: "dot rd" });
        platformEls[p] = c; platformDotEls[p] = dot;
        c.addEventListener("change", function () { togglePlat(p); });
        const cfgLink = UI.el("button", { class: "linkbtn", text: "配置 Cookie", title: "配置 " + (PLAT_NAME[p] || p) + " 的 Cookie" });
        cfgLink.addEventListener("click", function (e) { e.preventDefault(); switchTab("cookie"); });
        return UI.el("label", { class: "inline plat-item" }, [c, dot, " " + (PLAT_NAME[p] || p) + " ", cfgLink]);
      }));
      const platConfigBox = UI.el("div", {});
      const genContentBtn = UI.el("button", { class: "btn secondary", text: "AI 生成文案" });
      const compPlatform = UI.el("select", {}, PLATFORMS.map(function (p) { return opt(p, PLAT_NAME[p]); }));
      const compRegion = UI.el("div", { class: "hintline" });
      const compBtn = UI.el("button", { class: "btn secondary", text: "合规检测" });
      const pubRegion = UI.el("div");
      const pubBtn = UI.el("button", { class: "btn", text: "提交发布" });

      function togglePlat(p) {
        const i = selPlats.indexOf(p);
        if (i >= 0) selPlats.splice(i, 1); else selPlats.push(p);
        renderPlatConfig();
      }
      function addTag(v) {
        v = (v || "").trim(); if (!v || tags.indexOf(v) >= 0) return;
        tags.push(v); renderTags(); tagInput.value = "";
      }
      function renderTags() {
        UI.clear(tagBox);
        tags.forEach(function (t, i) {
          const x = UI.el("span", { class: "tagx", text: "×" });
          x.addEventListener("click", function () { tags.splice(i, 1); renderTags(); });
          tagBox.appendChild(UI.el("span", { class: "tagchip" }, [UI.el("span", { text: t }), x]));
        });
      }
      function renderPlatConfig() {
        UI.clear(platConfigBox);
        selPlats.forEach(function (p) {
          const cfg = platformCfg[p]; if (!cfg) return;
          const kids = [UI.el("strong", { text: (PLAT_NAME[p] || p) + " 配置" })];
          if (!cookieHas[p]) {
            const go = UI.el("button", { class: "linkbtn", text: "去配置 Cookie" });
            go.addEventListener("click", function () { switchTab("cookie"); });
            kids.push(UI.el("div", { class: "hintline bad", text: "⚠ 该平台尚未配置 Cookie，发布将失败。" }));
            kids.push(go);
          }
          if (cfg.CreativeStatements && cfg.CreativeStatements.length) {
            const sel = UI.el("select", {}, cfg.CreativeStatements.map(function (c) { return opt(c.Value, c.Label); }));
            sel.id = "cs-" + p;
            kids.push(field("创作声明", sel));
          }
          if (cfg.HasCategory && cfg.Categories && cfg.Categories.length) {
            const sel = UI.el("select", {}, cfg.Categories.map(function (c) { return opt(c); }));
            sel.id = "cat-" + p;
            kids.push(field("分类", sel));
          }
          if (cfg.HasSavePermission) {
            const sel = UI.el("select", {}, [opt("deny", "不允许保存"), opt("allow", "允许保存")]);
            sel.id = "sp-" + p;
            kids.push(field("保存权限", sel));
          }
          platConfigBox.appendChild(UI.el("div", { class: "subcfg" }, kids));
        });
      }

      const editCard = section("发布编辑 Publish", [
        field("标题", pubTitle),
        field("正文", pubContent),
        UI.el("div", { class: "field" }, [UI.el("label", { text: "标签" }), UI.el("div", {}, [UI.el("div", { class: "row" }, [tagInput, tagGenBtn]), tagBox])]),
        UI.el("div", { class: "field" }, [UI.el("label", { text: "媒体文件" }), UI.el("div", {}, [mediaFile, UI.el("div", { class: "row" }, [mediaUploadBtn]), mediaPrev])]),
        UI.el("div", { class: "field" }, [UI.el("label", { text: "封面" }), UI.el("div", {}, [coverFile, UI.el("div", { class: "row" }, [coverUploadBtn]), coverPrev])]),
        field("发布平台", platformRow),
        platConfigBox,
        UI.el("div", { class: "row" }, [genContentBtn, compBtn]),
        compRegion,
      ], pubBtn, pubRegion, "fa-paper-plane");

      // ===== 任务队列 =====
      const queueRegion = UI.el("div");
      const queueCard = section("任务队列 Queue", [], UI.el("div", {}, [queueRegion]), null, "fa-list-check");

      // ===== 历史记录 =====
      const histRegion = UI.el("div");
      const histCard = section("历史记录 History", [], UI.el("div", {}, [histRegion]), null, "fa-clock-rotate-left");

      // ===== Cookie 配置 =====
      const cookieRegion = UI.el("div");
      const cookieCard = section("Cookie 配置", [UI.el("div", { class: "hintline", text: "每个账号的 Cookie 相互隔离，仅当前登录账号可用。粘贴对应平台浏览器中的完整 Cookie 字符串保存。" })], UI.el("div", {}, [cookieRegion]), null, "fa-cookie");

      // ===== 标签页 =====
      const TABS = [
        { id: "edit", label: "发布编辑", node: editCard },
        { id: "queue", label: "任务队列", node: queueCard },
        { id: "history", label: "历史记录", node: histCard },
        { id: "cookie", label: "Cookie 配置", node: cookieCard },
      ];
      const tabBar = UI.el("div", { class: "tabbar" });
      const tabBtns = {};
      TABS.forEach(function (t) {
        const b = UI.el("button", { class: "tab", text: t.label });
        tabBtns[t.id] = b;
        b.addEventListener("click", function () { switchTab(t.id); });
        tabBar.appendChild(b);
      });
      function switchTab(id) {
        TABS.forEach(function (t) {
          const on = t.id === id;
          tabBtns[t.id].classList.toggle("on", on);
          t.node.style.display = on ? "" : "none";
        });
        if (id === "queue") refreshQueue();
        if (id === "history") refreshHistory();
        if (id === "cookie") refreshCookie();
      }

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "发布 Publish" }),
        tabBar,
        editCard, queueCard, histCard, cookieCard,
      ]));
      switchTab("edit");

      // 加载平台配置 + cookie 状态
      API.call("GET", "/api/v2/publish/platform-config").then(function (r) {
        if (r.ok && r.data) { platformCfg = r.data; renderPlatConfig(); }
      }).catch(function () {});
      refreshCookieStatus();

      // ===== 事件 =====
      tagInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); addTag(tagInput.value); }
      });
      tagGenBtn.addEventListener("click", function () {
        UI.withLoading(tagGenBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/generate-tags", { title: pubTitle.value, content: pubContent.value, platform: selPlats[0] || "all" });
            if (!up.ok) { UI.showError(tagBox, formatErr(up)); return; }
            const arr = (up.data && up.data.tags) || [];
            arr.forEach(addTag);
          } catch (e) { UI.showError(tagBox, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      mediaUploadBtn.addEventListener("click", function () {
        UI.withLoading(mediaUploadBtn, async function () {
          try {
            const files = await readFiles(mediaFile);
            if (!files.length) { UI.showError(mediaPrev, "请选择媒体文件"); return; }
            const up = await API.upload("POST", "/api/v2/publish/upload-file", files, {});
            if (!up.ok) { UI.showError(mediaPrev, formatErr(up)); return; }
            mediaUrl = (up.data && up.data.url) || "";
            UI.showResult(mediaPrev, { message: "已上传: " + mediaUrl });
          } catch (e) { UI.showError(mediaPrev, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      coverUploadBtn.addEventListener("click", function () {
        UI.withLoading(coverUploadBtn, async function () {
          try {
            const files = await readFiles(coverFile);
            if (!files.length) { UI.showError(coverPrev, "请选择封面图"); return; }
            const up = await API.upload("POST", "/api/v2/publish/upload-file", files, {});
            if (!up.ok) { UI.showError(coverPrev, formatErr(up)); return; }
            coverUrl = (up.data && up.data.url) || "";
            UI.showResult(coverPrev, { message: "已上传: " + coverUrl });
          } catch (e) { UI.showError(coverPrev, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      genContentBtn.addEventListener("click", function () {
        UI.withLoading(genContentBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/generate-content", { title: pubTitle.value, mediaHint: mediaUrl, platform: selPlats[0] || "all" });
            if (!up.ok) { UI.showError(pubRegion, formatErr(up)); return; }
            const txt = (up.data && (up.data.content || up.data.text)) || "";
            if (txt) pubContent.value = txt;
            UI.showResult(pubRegion, up.data);
          } catch (e) { UI.showError(pubRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      compBtn.addEventListener("click", function () {
        const c = pubContent.value.trim();
        if (!c) { UI.showError(compRegion, "请先填写正文内容"); return; }
        UI.withLoading(compBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/check-compliance", { content: c, platform: compPlatform.value });
            if (!up.ok) { UI.showError(compRegion, formatErr(up)); return; }
            UI.showResult(compRegion, up.data);
          } catch (e) { UI.showError(compRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      pubBtn.addEventListener("click", function () {
        const title = pubTitle.value.trim();
        if (!title) { UI.showError(pubRegion, "请输入标题"); return; }
        if (!selPlats.length) { UI.showError(pubRegion, "请选择至少一个平台"); return; }
        const missing = selPlats.filter(function (p) { return !cookieHas[p]; });
        if (missing.length) {
          const names = missing.map(function (p) { return PLAT_NAME[p] || p; }).join("、");
          UI.clear(pubRegion);
          const go = UI.el("button", { class: "linkbtn", text: "去配置 Cookie" });
          go.addEventListener("click", function () { switchTab("cookie"); });
          pubRegion.appendChild(UI.el("div", { class: "hintline bad", text: "以下平台尚未配置 Cookie，无法发布：" + names }));
          pubRegion.appendChild(go);
          return;
        }
        const platforms = selPlats.map(function (p) {
          return {
            platformId: p,
            creativeStatement: (document.getElementById("cs-" + p) && document.getElementById("cs-" + p).value) || "none",
            savePermission: (document.getElementById("sp-" + p) && document.getElementById("sp-" + p).value) || "deny",
          };
        });
        UI.withLoading(pubBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/submit", {
              title: title,
              content: pubContent.value,
              tags: tags.slice(),
              mediaUrls: mediaUrl ? [mediaUrl] : [],
              coverImage: coverUrl,
              isDraft: false,
              platforms: platforms,
            });
            if (!up.ok) { UI.showError(pubRegion, formatErr(up)); return; }
            UI.showResult(pubRegion, { message: "已提交发布 taskId=" + (up.data && up.data.taskId), taskId: up.data && up.data.taskId });
            switchTab("queue");
          } catch (e) { UI.showError(pubRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      function refreshQueue() {
        API.call("GET", "/api/v2/publish/queue-status").then(function (r) {
          if (!r.ok) { UI.showError(queueRegion, formatErr(r)); return; }
          const d = r.data || {};
          if (d.items && !d.items.length) { UI.clear(queueRegion); queueRegion.appendChild(UI.el("div", { class: "hintline", text: "暂无任务" })); return; }
          UI.showResult(queueRegion, d);
        }).catch(function (e) { UI.showError(queueRegion, "请求异常: " + (e && e.message ? e.message : String(e))); });
      }
      function refreshHistory() {
        API.call("GET", "/api/v2/publish/history?page=1&pageSize=20").then(function (r) {
          if (!r.ok) { UI.showError(histRegion, formatErr(r)); return; }
          const d = r.data || {};
          if (d.items && !d.items.length) { UI.clear(histRegion); histRegion.appendChild(UI.el("div", { class: "hintline", text: "暂无记录" })); return; }
          UI.showResult(histRegion, d);
        }).catch(function (e) { UI.showError(histRegion, "请求异常: " + (e && e.message ? e.message : String(e))); });
      }

      // ===== Cookie（注意保存后校验有效性）=====
      function refreshCookieStatus() {
        API.call("GET", "/api/v2/publish/cookie-status").then(function (r) {
          if (!r.ok) return;
          const list = asList(r.data);
          list.forEach(function (p) {
            cookieHas[p.platform] = !!p.hasCookie;
            const dot = platformDotEls[p.platform];
            if (dot) dot.className = "dot " + (p.hasCookie ? "gn" : "rd");
          });
          renderPlatConfig();
        }).catch(function () {});
      }
      function refreshCookie() {
        UI.clear(cookieRegion);
        API.call("GET", "/api/v2/publish/cookie-status").then(function (r) {
          if (!r.ok) { UI.showError(cookieRegion, formatErr(r)); return; }
          const list = asList(r.data);
          list.forEach(function (p) {
            const hint = COOKIE_HINTS[p.platform] || "从对应平台登录态获取 Cookie";
            const ta = UI.el("textarea", { placeholder: "在此粘贴 Cookie 字符串..." });
            const resLine = UI.el("div", { class: "hintline" });
            if (cookieMsgs[p.platform]) { resLine.textContent = cookieMsgs[p.platform].text; resLine.className = cookieMsgs[p.platform].cls; }
            const saveBtn = UI.el("button", { class: "btn", text: "保存 Cookie" });
            const testBtn = UI.el("button", { class: "btn secondary", text: "测试连接" });
            const clearBtn = UI.el("button", { class: "btn secondary", text: "清空" });
            saveBtn.addEventListener("click", function () {
              const v = ta.value.trim();
              if (!v) { cookieMsgs[p.platform] = { text: "请先粘贴 Cookie", cls: "hintline bad" }; refreshCookie(); return; }
              UI.withLoading(saveBtn, async function () {
                try {
                  const up = await API.call("POST", "/api/v2/publish/save-cookie", { platform: p.platform, cookieText: v });
                  if (!up.ok) { cookieMsgs[p.platform] = { text: "✗ " + formatErr(up), cls: "hintline bad" }; refreshCookie(); return; }
                  const st = (up.data && up.data.cookieStatus) || {};
                  let msg, cls;
                  if (st.valid) { msg = "✓ 已保存，Cookie 有效"; cls = "hintline ok"; ta.value = ""; }
                  else { msg = "⚠ 已保存，但 Cookie 已失效: " + (st.message || ""); cls = "hintline bad"; }
                  cookieMsgs[p.platform] = { text: msg, cls: cls };
                  refreshCookieStatus(); refreshCookie();
                } catch (e) { cookieMsgs[p.platform] = { text: "✗ 请求异常: " + (e && e.message ? e.message : String(e)), cls: "hintline bad" }; refreshCookie(); }
              });
            });
            testBtn.addEventListener("click", function () {
              UI.withLoading(testBtn, async function () {
                try {
                  const up = await API.call("POST", "/api/v2/publish/check-cookie", { platform: p.platform });
                  let msg, cls;
                  if (!up.ok) { msg = "✗ " + formatErr(up); cls = "hintline bad"; }
                  else if (up.data && up.data.hasCookie && up.data.valid) { msg = "✓ 连接成功，Cookie 有效" + (up.data.message ? "（" + up.data.message + "）" : ""); cls = "hintline ok"; }
                  else if (up.data && up.data.hasCookie && !up.data.valid) { msg = "✗ 连接失败：Cookie 已失效" + (up.data.message ? "（" + up.data.message + "）" : ""); cls = "hintline bad"; }
                  else { msg = "✗ 未配置 Cookie，无法连接"; cls = "hintline bad"; }
                  cookieMsgs[p.platform] = { text: msg, cls: cls };
                  resLine.textContent = msg; resLine.className = cls;
                  refreshCookieStatus();
                } catch (e) { cookieMsgs[p.platform] = { text: "✗ 请求异常: " + (e && e.message ? e.message : String(e)), cls: "hintline bad" }; resLine.textContent = cookieMsgs[p.platform].text; resLine.className = "hintline bad"; }
              });
            });
            clearBtn.addEventListener("click", function () { ta.value = ""; resLine.textContent = "已清空输入框"; resLine.className = "hintline"; });
            cookieRegion.appendChild(UI.el("div", { class: "subcfg" }, [
              UI.el("h4", {}, [(p.hasCookie ? "🟢 " : "🔴 ") + (PLAT_NAME[p.platform] || p.platform) + (p.hasCookie ? "（已配置）" : "（未配置）")]),
              UI.el("div", { class: "hintline", text: hint }),
              ta,
              UI.el("div", { class: "row" }, [saveBtn, testBtn, clearBtn]),
              resLine,
            ]));
          });
          if (!list.length) cookieRegion.appendChild(UI.el("div", { class: "hintline", text: "暂无平台信息" }));
        }).catch(function (e) { UI.showError(cookieRegion, "请求异常: " + (e && e.message ? e.message : String(e))); });
      }
    },
  };
})();
