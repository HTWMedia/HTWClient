(function () {
  var Skills = (window.Skills = window.Skills || {});
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
      var UI = window.UI;
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
      // 媒体可以是多个（后端 upload-file 一次只收一个文件，前端逐个上传后拼成数组）
      let mediaUrls = [], coverUrl = "";
      let platformCfg = {};
      const platformEls = {};       // checkbox
      const platformDotEls = {};     // 状态点（cookie 是否有效）
      const cookieHas = {};         // 各平台是否已配置 Cookie
      const cookieConn = {};        // 各平台登录态是否真的可用（true/false/undefined）
      const cookieHeadEls = {};     // Cookie 页的平台标题，测试后原地刷新
      const platWarnEls = {};       // 平台配置区的 Cookie 警告，状态变化时原地刷新
      const cookieMsgs = {};        // 各平台最近一次操作结果（刷新后保留提示）
      const selPlats = [];

      // ===== 发布编辑面板 =====
      const pubTitle = UI.el("input", { type: "text", placeholder: "标题", maxlength: "100" });
      const titleHint = UI.el("div", { class: "hintline" });
      const pubContent = UI.el("textarea", { placeholder: "正文内容（可选）" });
      const tagInput = UI.el("input", { type: "text", placeholder: "输入标签，回车或逗号添加" });
      const tagBox = UI.el("div", { class: "tagbox" });
      const tagGenBtn = UI.el("button", { class: "btn secondary", text: "AI 生成" });
      // multiple：后端 submit 收的是 mediaUrls 数组，界面却只能选一个文件，自相矛盾。
      const mediaFile = UI.fileInput({ label: "选择视频/图片（可多选）", accept: "video/*,image/*", multiple: true });
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
        updateTitleLimit();
      }

      // 标题上限来自 platform-config（titleMaxLength）。多平台取最严的一条，
      // 否则给用户一个"能输入却必然被拒"的标题。maxlength 只挡新输入，
      // 先选严格平台再改宽不会截断已有文字——所以提交前还要再校验一次。
      function titleLimits() {
        return selPlats.map(function (p) {
          const cfg = platformCfg[p] || {};
          const lim = Number(cfg.titleMaxLength != null ? cfg.titleMaxLength : cfg.TitleMaxLength) || 0;
          return { p: p, name: PLAT_NAME[p] || p, limit: lim };
        }).filter(function (x) { return x.limit > 0; });
      }
      function updateTitleLimit() {
        const lims = titleLimits();
        const n = pubTitle.value.length;
        const over = lims.filter(function (x) { return n > x.limit; });
        if (!lims.length) {
          pubTitle.maxLength = 100;
          titleHint.className = "hintline";
          titleHint.textContent = "选择发布平台后按平台标题上限校验";
          return;
        }
        pubTitle.maxLength = Math.min.apply(null, lims.map(function (x) { return x.limit; }));
        if (over.length) {
          titleHint.className = "hintline bad";
          titleHint.textContent = "当前 " + n + " 字，超出 " + over.map(function (x) { return x.name + "（" + x.limit + "）"; }).join("、") + " 的标题上限";
        } else {
          titleHint.className = "hintline";
          titleHint.textContent = "标题上限： " + lims.map(function (x) { return x.name + " " + x.limit + " 字"; }).join(" · ");
        }
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
      function cookieGoLink() {
        const go = UI.el("button", { class: "linkbtn", text: "去配置 Cookie" });
        go.addEventListener("click", function () { switchTab("cookie"); });
        return go;
      }
      // Cookie 状态可能在停留本页期间变化（测试连接/检测全部）。警告节点常驻、
      // 只改文案与显隐，避免整块重画把用户已选的创作声明/分类清掉。
      function paintPlatWarn(p) {
        const ref = platWarnEls[p]; if (!ref) return;
        let text = "";
        if (!cookieHas[p]) text = "⚠ 该平台尚未配置 Cookie，发布将失败。";
        else if (cookieConn[p] === false) text = "⚠ 该平台 Cookie 已失效，发布将失败。";
        ref.warn.className = "hintline" + (text ? " bad" : "");
        ref.warn.textContent = text;
        ref.go.style.display = text ? "" : "none";
      }
      function renderPlatConfig() {
        UI.clear(platConfigBox);
        Object.keys(platWarnEls).forEach(function (k) { delete platWarnEls[k]; });
        selPlats.forEach(function (p) {
          const cfg = platformCfg[p]; if (!cfg) return;
          const warn = UI.el("div", { class: "hintline" });
          const go = cookieGoLink();
          platWarnEls[p] = { warn: warn, go: go };
          const kids = [
            UI.el("strong", { text: (PLAT_NAME[p] || p) + " 配置" }),
            warn,
            go,
          ];
          // platform-config 返回 camelCase；旧接口曾用 PascalCase，两者都认。
          const statements = cfg.creativeStatements || cfg.CreativeStatements || [];
          if (statements.length) {
            const sel = UI.el("select", {}, statements.map(function (c) { return opt(c.value || c.Value, c.label || c.Label); }));
            sel.id = "cs-" + p;
            kids.push(field("创作声明", sel));
          }
          const categories = cfg.categories || cfg.Categories || [];
          if ((cfg.hasCategory || cfg.HasCategory) && categories.length) {
            const sel = UI.el("select", {}, categories.map(function (c) { return opt(c); }));
            sel.id = "cat-" + p;
            kids.push(field("分类", sel));
          }
          const hasSave = cfg.hasSavePermission != null ? cfg.hasSavePermission : cfg.HasSavePermission;
          if (hasSave) {
            const sel = UI.el("select", {}, [opt("deny", "不允许保存"), opt("allow", "允许保存")]);
            sel.id = "sp-" + p;
            kids.push(field("保存权限", sel));
          }
          platConfigBox.appendChild(UI.el("div", { class: "subcfg" }, kids));
          paintPlatWarn(p);
        });
      }

      const editCard = section("发布编辑 Publish", [
        field("标题", UI.el("div", {}, [pubTitle, titleHint])),
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
      const connBox = UI.el("div", { class: "pb-conn" });
      // cookie-status 读的是 60 秒内的缓存结果（快）；改完 Cookie 想立刻验真假，
      // 得走 check-connections 强制重验——小红书那条要开浏览器，会比较慢。
      const checkAllBtn = UI.el("button", { class: "btn secondary", text: "检测全部连接" });
      checkAllBtn.addEventListener("click", function () {
        UI.withLoading(checkAllBtn, async function () {
          try {
            UI.clear(connBox);
            connBox.appendChild(UI.el("span", { class: "hintline", text: "正在逐个平台真实校验，可能需要十几秒…" }));
            const r = await API.call("GET", "/api/v2/publish/check-connections");
            if (!r.ok) { UI.showError(connBox, formatErr(r)); return; }
            const list = connItems(r.data);
            applyConnections(list);
            renderConn(list);
          } catch (e) { UI.showError(connBox, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      // 两个端点返回的形状不一样，不能只按数组处理：
      //   platform-status → [{ platform_id, platform_name, connected }]
      //   check-connections → { toutiao: false, bilibili: false, ... }（平台 id 为键、布尔为值）
      // 后者用 asList 会被 "只要对象项" 的过滤全部丢掉，页面就成了"没有可用的平台"。
      function connItems(raw) {
        const out = [];
        if (Array.isArray(raw)) {
          raw.forEach(function (p) {
            if (!p || typeof p !== "object") return;
            out.push({
              id: p.platform_id || p.platform || p.platformId || "",
              name: p.platform_name || p.name || "",
              connected: p.connected,
            });
          });
          return out;
        }
        if (raw && typeof raw === "object") {
          Object.keys(raw).forEach(function (k) {
            const v = raw[k];
            out.push({ id: k, name: "", connected: typeof v === "boolean" ? v : (v && v.connected) });
          });
        }
        return out;
      }
      function renderConn(list) {
        UI.clear(connBox);
        if (!list.length) { connBox.appendChild(UI.el("span", { class: "hintline", text: "没有可用的平台" })); return; }
        list.forEach(function (p) {
          const id = p.id || p.platform_id || p.platform || p.platformId || "";
          const name = p.name || p.platform_name || PLAT_NAME[id] || id;
          const ok = p.connected === true;
          connBox.appendChild(UI.el("span", {
            class: "pb-conn-item " + (ok ? "ok" : "bad"),
            text: name + "：" + (p.connected === true ? "已连接" : (p.connected === false ? "未连接" : "未校验")),
          }));
        });
      }
      const cookieCard = section("Cookie 配置", [
        UI.el("div", { class: "hintline", text: "每个账号的 Cookie 相互隔离，仅当前登录账号可用。粘贴对应平台浏览器中的完整 Cookie 字符串保存。" }),
        connBox,
      ], [checkAllBtn], cookieRegion, "fa-cookie");

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
        if (r.ok && r.data) { platformCfg = r.data; renderPlatConfig(); updateTitleLimit(); }
      }).catch(function () {});
      refreshCookieStatus();

      // ===== 事件 =====
      pubTitle.addEventListener("input", updateTitleLimit);
      updateTitleLimit();
      tagInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === "," || e.key === "，") { e.preventDefault(); addTag(tagInput.value); }
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
            // 逐个上传：upload-file 一次只收一个文件，但发布时 mediaUrls 是数组，
            // 多选了却只发第一个会让用户以为"都传上去了"。
            const uploaded = [];
            for (const one of files) {
              const up = await API.upload("POST", "/api/v2/publish/upload-file", [one], {});
              if (!up.ok) { UI.showError(mediaPrev, formatErr(up)); return; }
              const url = (up.data && up.data.url) || "";
              if (url) uploaded.push(url);
            }
            if (!uploaded.length) { UI.showError(mediaPrev, "上传成功但没有返回文件地址"); return; }
            mediaUrls = mediaUrls.concat(uploaded);
            UI.showResult(mediaPrev, { message: "已上传 " + mediaUrls.length + " 个：" + mediaUrls.join("、") });
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
            const up = await API.call("POST", "/api/v2/publish/generate-content", { title: pubTitle.value, mediaHint: mediaUrls[0] || "", platform: selPlats[0] || "all" });
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
        const tooLong = titleLimits().filter(function (x) { return title.length > x.limit; });
        if (tooLong.length) {
          UI.showError(pubRegion, "标题 " + title.length + " 字，超出 " + tooLong.map(function (x) { return x.name + "（上限 " + x.limit + " 字）"; }).join("、") + "，请缩短后再发布");
          return;
        }
        const missing = selPlats.filter(function (p) { return !cookieHas[p]; });
        if (missing.length) {
          const names = missing.map(function (p) { return PLAT_NAME[p] || p; }).join("、");
          UI.clear(pubRegion);
          pubRegion.appendChild(UI.el("div", { class: "hintline bad", text: "以下平台尚未配置 Cookie，无法发布：" + names }));
          pubRegion.appendChild(cookieGoLink());
          return;
        }
        // 已保存 ≠ 登录态可用。cookie-status/check-connections 说 connected=false 时
        // 提交必然在平台侧失败，提前拦下并给出入口，而不是留一条注定失败的发布记录。
        const invalid = selPlats.filter(function (p) { return cookieConn[p] === false; });
        if (invalid.length) {
          const names = invalid.map(function (p) { return PLAT_NAME[p] || p; }).join("、");
          UI.clear(pubRegion);
          pubRegion.appendChild(UI.el("div", { class: "hintline bad", text: "以下平台 Cookie 已失效，无法发布：" + names + "。请重新登录获取 Cookie，或在 Cookie 页点「测试连接」确认。" }));
          pubRegion.appendChild(cookieGoLink());
          return;
        }
        const platforms = selPlats.map(function (p) {
          return {
            platformId: p,
            creativeStatement: (document.getElementById("cs-" + p) && document.getElementById("cs-" + p).value) || "none",
            savePermission: (document.getElementById("sp-" + p) && document.getElementById("sp-" + p).value) || "deny",
          };
        });
        // 分类在 submit 契约里是顶层字段，平台元数据却按平台给分类列表；
        // 取第一个选中且渲染了分类的平台值（目前只有 B 站需要）。
        const category = selPlats.map(function (p) {
          const el = document.getElementById("cat-" + p);
          return el ? el.value : "";
        }).filter(Boolean)[0] || "";
        UI.withLoading(pubBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/submit", {
              title: title,
              content: pubContent.value,
              tags: tags.slice(),
              mediaUrls: mediaUrls.slice(),
              coverImage: coverUrl,
              category: category,
              isDraft: false,
              platforms: platforms,
            });
            if (!up.ok) { UI.showError(pubRegion, formatErr(up)); return; }
            UI.showResult(pubRegion, { message: "已提交发布 taskId=" + (up.taskId || (up.data && up.data.taskId)), taskId: up.taskId || (up.data && up.data.taskId) });
            // 判空再调：容器缺席时静默跳过，否则这一行抛出的 TypeError 会被上面的 catch
            // 接成「请求异常」，发布其实已经提交成功，面板却不再切换到队列页。
            if (window.HTWTasks) window.HTWTasks.track({ domain: "publish", taskId: up.taskId || (up.data && up.data.taskId), panel: "publish", title: "多平台发布" });
            switchTab("queue");
          } catch (e) { UI.showError(pubRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      // 子任务/主任务状态。dot 用发布面板已有的三色点（gn 成功 / rd 失败 / gy 进行中）。
      var PUB_STATUS = {
        pending: { t: "等待中", c: "gy" },
        running: { t: "进行中", c: "gy" },
        uploading: { t: "上传中", c: "gy" },
        completed: { t: "已完成", c: "gn" },
        success: { t: "成功", c: "gn" },
        partial_success: { t: "部分成功", c: "gn" },
        failed: { t: "失败", c: "rd" },
        partial_failed: { t: "部分失败", c: "rd" },
        canceled: { t: "已取消", c: "gy" },
        cancelled: { t: "已取消", c: "gy" },
      };
      function pubStatus(s) { return PUB_STATUS[s] || { t: s || "未知", c: "gy" }; }
      // 后端目前给的 postUrl 多数是平台发布/上传页（mp.toutiao.com/.../publish、
      // member.bilibili.com/.../new-edit），不是作品详情页；叫「查看作品」会误导。
      function postLinkText(url) {
        return /(publish|upload|new-edit|creator)/i.test(String(url || "")) ? "打开平台后台" : "查看作品";
      }

      // 任务卡片。以前直接把整个响应塞给 UI.showResult 铺成 KV，
      // 一条任务里嵌套的子任务与长错误信息完全没法看，也没有任何操作入口。
      function taskCard(item, onChanged) {
        const st = pubStatus(item.status);
        const kids = [
          UI.el("div", { class: "pb-task-head" }, [
            UI.el("span", { class: "dot " + st.c }),
            UI.el("span", { class: "pb-task-title", text: item.title || "(无标题)" }),
            UI.el("span", { class: "pb-task-status", text: st.t }),
            UI.el("span", { class: "pb-task-time", text: item.createdAt || "" }),
          ]),
        ];
        (item.subTasks || []).forEach(function (s) {
          const sst = pubStatus(s.status);
          const row = UI.el("div", { class: "pb-sub" }, [
            UI.el("span", { class: "dot " + sst.c }),
            UI.el("span", { class: "pb-sub-plat", text: s.platform || s.platformName || "" }),
            UI.el("span", { class: "pb-sub-status", text: sst.t }),
            s.error ? UI.el("span", { class: "pb-sub-err", text: s.error, title: s.error }) : null,
            s.postUrl ? UI.el("a", { class: "title-link", href: s.postUrl, text: postLinkText(s.postUrl), title: s.postUrl }) : null,
          ]);
          // 只有失败且拿得到子任务 id 才给重试：后端 retry 是按 subTaskId 定位子任务的，
          // 缺了这个字段（老版本接口不返回）按钮就是个必然失败的空壳。
          if (sst.c === "rd" && s.subTaskId) {
            const rb = UI.el("button", { class: "btn secondary", text: "重试" });
            rb.addEventListener("click", function () {
              UI.withLoading(rb, async function () {
                try {
                  const r = await API.call("POST", "/api/v2/publish/retry", { SubTaskId: s.subTaskId });
                  if (!r.ok) { UI.showError(row, formatErr(r)); return; }
                  rb.textContent = "已提交";
                  onChanged();
                } catch (e) { UI.showError(row, "请求异常: " + (e && e.message ? e.message : String(e))); }
              });
            });
            row.appendChild(rb);
          }
          kids.push(row);
        });
        return UI.el("div", { class: "pb-task" }, kids);
      }

      function renderTaskList(region, r, emptyText, onChanged) {
        const d = r.data || {};
        const items = d.items || [];
        UI.clear(region);
        if (!items.length) { region.appendChild(UI.el("div", { class: "hintline", text: emptyText })); return; }
        if (d.total) region.appendChild(UI.el("div", { class: "hintline", text: "共 " + d.total + " 条，显示最近 " + items.length + " 条" }));
        items.forEach(function (it) { region.appendChild(taskCard(it, onChanged)); });
      }

      function refreshQueue() {
        UI.clear(queueRegion);
        queueRegion.appendChild(UI.el("div", { class: "hintline", text: "加载中…" }));
        API.call("GET", "/api/v2/publish/queue-status").then(function (r) {
          if (!r.ok) { UI.showError(queueRegion, formatErr(r)); return; }
          renderTaskList(queueRegion, r, "暂无进行中的任务", refreshQueue);
        }).catch(function (e) { UI.showError(queueRegion, "请求异常: " + (e && e.message ? e.message : String(e))); });
      }
      function refreshHistory() {
        UI.clear(histRegion);
        histRegion.appendChild(UI.el("div", { class: "hintline", text: "加载中…" }));
        API.call("GET", "/api/v2/publish/history?page=1&pageSize=20").then(function (r) {
          if (!r.ok) { UI.showError(histRegion, formatErr(r)); return; }
          renderTaskList(histRegion, r, "暂无记录", refreshHistory);
        }).catch(function (e) { UI.showError(histRegion, "请求异常: " + (e && e.message ? e.message : String(e))); });
      }

      // ===== Cookie（注意保存后校验有效性）=====
      // 后端 cookie-status 同时给 hasCookie（存过 Cookie）与 connected（登录态真的可用）。
      // 只看 hasCookie 会把「配过但已失效」也画成绿勾，真发布时才被平台拒绝。
      function connFlag(v) { return v === true ? true : (v === false ? false : undefined); }
      function cookieState(platform) {
        if (!cookieHas[platform]) return { cls: "gy", text: "未配置", icon: "⚪" };
        if (cookieConn[platform] === true) return { cls: "gn", text: "已连接", icon: "🟢" };
        if (cookieConn[platform] === false) return { cls: "rd", text: "Cookie 已失效", icon: "🟠" };
        return { cls: "gy", text: "已配置（未校验）", icon: "⚪" };
      }
      // 状态点在平台勾选行，标题在 Cookie 页；测试连接后两处都要原地更新，
      // 不能只刷点不刷标题（否则同屏一边「已失效」一边「连接成功」）。
      function paintCookie(platform) {
        const st = cookieState(platform);
        const dot = platformDotEls[platform];
        if (dot) { dot.className = "dot " + st.cls; dot.title = st.text; }
        const head = cookieHeadEls[platform];
        if (head) head.textContent = st.icon + " " + (PLAT_NAME[platform] || platform) + "（" + st.text + "）";
      }
      function applyConnections(list) {
        list.forEach(function (p) {
          if (!p.id) return;
          if (p.connected === true) cookieHas[p.id] = true; // 能连上就必然存过 Cookie
          cookieConn[p.id] = connFlag(p.connected);
          paintCookie(p.id);
          paintPlatWarn(p.id);
        });
      }

      function refreshCookieStatus() {
        API.call("GET", "/api/v2/publish/cookie-status").then(function (r) {
          if (!r.ok) return;
          const list = asList(r.data);
          list.forEach(function (p) {
            cookieHas[p.platform] = !!p.hasCookie;
            cookieConn[p.platform] = connFlag(p.connected);
            paintCookie(p.platform);
            paintPlatWarn(p.platform);
          });
        }).catch(function () {});
      }
      function refreshCookie() {
        UI.clear(cookieRegion);
        Object.keys(cookieHeadEls).forEach(function (k) { delete cookieHeadEls[k]; });
        cookieRegion.appendChild(UI.el("div", { class: "hintline", text: "加载中…" }));
        API.call("GET", "/api/v2/publish/cookie-status").then(function (r) {
          if (!r.ok) { UI.showError(cookieRegion, formatErr(r)); return; }
          const list = asList(r.data);
          // 本页自己也维护一份状态：refreshCookie 可能先于 refreshCookieStatus 返回。
          list.forEach(function (p) {
            cookieHas[p.platform] = !!p.hasCookie;
            cookieConn[p.platform] = connFlag(p.connected);
          });
          UI.clear(cookieRegion);
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
                  // check-cookie 只回答“这条 Cookie 看起来有效”，会和真实登录态打架；
                  // 真要判断能否发布，必须走 check-connections（force 重验）。
                  // 该端点一次校验所有平台，回填全部状态，避免各平台各说各话。
                  const up = await API.call("GET", "/api/v2/publish/check-connections");
                  if (!up.ok) { cookieMsgs[p.platform] = { text: "✗ " + formatErr(up), cls: "hintline bad" }; resLine.textContent = cookieMsgs[p.platform].text; resLine.className = "hintline bad"; return; }
                  const list = connItems(up.data || {});
                  applyConnections(list);
                  const me = list.filter(function (x) { return x.id === p.platform; })[0];
                  let msg, cls;
                  if (!me || me.connected == null) { msg = "⚠ 未能校验连接状态，请稍后重试"; cls = "hintline"; }
                  else if (me.connected) { msg = "✓ 已连接，登录态可用"; cls = "hintline ok"; }
                  else { msg = "✗ 未连接：Cookie 已失效，请重新登录获取后保存"; cls = "hintline bad"; }
                  cookieMsgs[p.platform] = { text: msg, cls: cls };
                  resLine.textContent = msg; resLine.className = cls;
                } catch (e) { cookieMsgs[p.platform] = { text: "✗ 请求异常: " + (e && e.message ? e.message : String(e)), cls: "hintline bad" }; resLine.textContent = cookieMsgs[p.platform].text; resLine.className = "hintline bad"; }
              });
            });
            clearBtn.addEventListener("click", function () { ta.value = ""; resLine.textContent = "已清空输入框"; resLine.className = "hintline"; });
            const st = cookieState(p.platform);
            const head = UI.el("h4", {}, [st.icon + " " + (PLAT_NAME[p.platform] || p.platform) + "（" + st.text + "）"]);
            cookieHeadEls[p.platform] = head;
            cookieRegion.appendChild(UI.el("div", { class: "subcfg" }, [
              head,
              UI.el("div", { class: "hintline", text: hint }),
              ta,
              UI.el("div", { class: "row" }, [saveBtn, testBtn, clearBtn]),
              resLine,
            ]));
          });
          list.forEach(function (p) { paintCookie(p.platform); });
          if (!list.length) cookieRegion.appendChild(UI.el("div", { class: "hintline", text: "暂无平台信息" }));
        }).catch(function (e) { UI.showError(cookieRegion, "请求异常: " + (e && e.message ? e.message : String(e))); });
      }
    },
  };
})();
