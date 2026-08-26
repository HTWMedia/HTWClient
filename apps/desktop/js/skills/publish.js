(function () {
  const Skills = (window.Skills = window.Skills || {});
  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }
  function opt(v, t) { return window.UI.el("option", { value: v, text: t || v }); }

  Skills.publish = {
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
      function field(labelText, input) { return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]); }
      function section(title, bodyNodes, actionNodes, region, icon) {
        const head = icon ? UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]) : UI.el("h3", { text: title });
        const kids = [head].concat(bodyNodes);
        const actions = Array.isArray(actionNodes) ? actionNodes : [actionNodes];
        kids.push(UI.el("div", { class: "row" }, actions));
        kids.push(region);
        return UI.el("div", { class: "card" }, kids);
      }

      const PUBLISH_PLATFORMS = ["douyin", "xhs", "bilibili", "toutiao"];
      const platformEls = {};
      const platformRow = UI.el("div", { class: "row" }, PUBLISH_PLATFORMS.map(function (p) {
        const c = UI.el("input", { type: "checkbox", value: p });
        platformEls[p] = c;
        return UI.el("label", { class: "inline" }, [c, " " + p]);
      }));
      function selectedPlatforms() { return PUBLISH_PLATFORMS.filter(function (p) { return platformEls[p].checked; }).map(function (p) { return { platformId: p }; }); }

      const pubTitle = UI.el("input", { type: "text", placeholder: "标题" });
      const pubContent = UI.el("textarea", { placeholder: "正文内容" });
      const pubTags = UI.el("input", { type: "text", placeholder: "标签，逗号分隔" });
      const pubMedia = UI.el("input", { type: "text", placeholder: "媒体 URL，逗号分隔" });
      const pubCover = UI.el("input", { type: "text", placeholder: "封面图 URL" });
      const pubCategory = UI.el("input", { type: "text", placeholder: "分类" });
      const pubIsDraft = UI.el("input", { type: "checkbox" });
      const pubRegion = UI.el("div");
      const pubBtn = UI.el("button", { class: "btn", text: "发布" });
      const pubCard = section("发布 Submit", [
        field("标题", pubTitle), field("正文", pubContent), field("标签", pubTags), field("媒体URL", pubMedia), field("封面", pubCover), field("分类", pubCategory), field("存草稿", pubIsDraft),
        field("平台", platformRow),
      ], pubBtn, pubRegion, "fa-paper-plane");

      const upFile = UI.fileInput({ label: "选择媒体文件", accept: "*/*" });
      const upRegion = UI.el("div");
      const upBtn = UI.el("button", { class: "btn", text: "上传文件" });
      const upCard = section("上传文件 Upload-file", [upFile], upBtn, upRegion, "fa-cloud-arrow-up");

      const compPlatform = UI.el("select", {}, [opt("douyin"), opt("xhs"), opt("bilibili"), opt("toutiao")]);
      const compContent = UI.el("textarea", { placeholder: "待检测内容" });
      const compRegion = UI.el("div");
      const compBtn = UI.el("button", { class: "btn", text: "合规检测" });
      const compCard = section("合规检测 Check-compliance", [field("平台", compPlatform), field("内容", compContent)], compBtn, compRegion, "fa-shield-halved");

      const tagTitle = UI.el("input", { type: "text", placeholder: "标题" });
      const tagContent = UI.el("input", { type: "text", placeholder: "正文" });
      const tagPlatform = UI.el("select", {}, [opt("douyin"), opt("xhs"), opt("bilibili"), opt("toutiao")]);
      const tagRegion = UI.el("div");
      const tagBtn = UI.el("button", { class: "btn", text: "生成标签" });
      const tagCard = section("生成标签 Generate-tags", [field("标题", tagTitle), field("正文", tagContent), field("平台", tagPlatform)], tagBtn, tagRegion, "fa-tags");

      const genTitle = UI.el("input", { type: "text", placeholder: "标题" });
      const genHint = UI.el("input", { type: "text", placeholder: "媒体提示" });
      const genPlatform = UI.el("select", {}, [opt("douyin"), opt("xhs"), opt("bilibili"), opt("toutiao")]);
      const genRegion = UI.el("div");
      const genBtn = UI.el("button", { class: "btn", text: "生成文案" });
      const genCard = section("生成文案 Generate-content", [field("标题", genTitle), field("媒体提示", genHint), field("平台", genPlatform)], genBtn, genRegion, "fa-pen-line");

      const connRegion = UI.el("div");
      const connBtn = UI.el("button", { class: "btn", text: "检查连接" });
      const queueRegion = UI.el("div");
      const queueBtn = UI.el("button", { class: "btn", text: "队列状态" });
      const connCard = section("状态 Status", [], [connBtn, queueBtn], UI.el("div", {}, [connRegion, queueRegion]), "fa-plug");

      const histPage = UI.el("input", { type: "number", value: "1" });
      const histRegion = UI.el("div");
      const histBtn = UI.el("button", { class: "btn", text: "历史" });
      const histCard = section("历史 History", [field("页码", histPage)], histBtn, histRegion, "fa-clock-rotate-left");

      const ckPlatform = UI.el("select", {}, [opt("douyin"), opt("xhs"), opt("bilibili"), opt("toutiao")]);
      const ckCookie = UI.el("textarea", { placeholder: "Cookie 文本" });
      const ckRegion = UI.el("div");
      const ckSaveBtn = UI.el("button", { class: "btn", text: "保存 Cookie" });
      const ckStatusBtn = UI.el("button", { class: "btn secondary", text: "Cookie 状态" });
      const ckCard = section("Cookie", [field("平台", ckPlatform), field("Cookie", ckCookie)], [ckSaveBtn, ckStatusBtn], ckRegion, "fa-cookie");

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "发布 Publish" }),
        pubCard, upCard, compCard, tagCard, genCard, connCard, histCard, ckCard,
      ]));

      pubBtn.addEventListener("click", function () {
        const title = pubTitle.value.trim();
        if (!title) { UI.showError(pubRegion, "请输入标题"); return; }
        const plats = selectedPlatforms();
        if (!plats.length) { UI.showError(pubRegion, "请选择至少一个平台"); return; }
        UI.withLoading(pubBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/submit", {
              title: title,
              content: pubContent.value,
              tags: pubTags.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
              mediaUrls: pubMedia.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
              coverImage: pubCover.value.trim(),
              category: pubCategory.value.trim(),
              isDraft: pubIsDraft.checked,
              platforms: plats,
            });
            if (!up.ok) { UI.showError(pubRegion, formatErr(up)); return; }
            UI.showResult(pubRegion, up.data);
          } catch (e) { UI.showError(pubRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      upBtn.addEventListener("click", function () {
        UI.withLoading(upBtn, async function () {
          try {
            const files = await readFiles(upFile);
            if (!files.length) { UI.showError(upRegion, "请选择文件"); return; }
            const up = await API.upload("POST", "/api/v2/publish/upload-file", files, {});
            if (!up.ok) { UI.showError(upRegion, formatErr(up)); return; }
            UI.showResult(upRegion, up.data);
          } catch (e) { UI.showError(upRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      compBtn.addEventListener("click", function () {
        const c = compContent.value.trim();
        if (!c) { UI.showError(compRegion, "请输入内容"); return; }
        UI.withLoading(compBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/check-compliance", { content: c, platform: compPlatform.value });
            if (!up.ok) { UI.showError(compRegion, formatErr(up)); return; }
            UI.showResult(compRegion, up.data);
          } catch (e) { UI.showError(compRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      tagBtn.addEventListener("click", function () {
        UI.withLoading(tagBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/generate-tags", { title: tagTitle.value, content: tagContent.value, platform: tagPlatform.value });
            if (!up.ok) { UI.showError(tagRegion, formatErr(up)); return; }
            UI.showResult(tagRegion, up.data);
          } catch (e) { UI.showError(tagRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      genBtn.addEventListener("click", function () {
        UI.withLoading(genBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/publish/generate-content", { title: genTitle.value, mediaHint: genHint.value, platform: genPlatform.value });
            if (!up.ok) { UI.showError(genRegion, formatErr(up)); return; }
            UI.showResult(genRegion, up.data);
          } catch (e) { UI.showError(genRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      connBtn.addEventListener("click", function () {
        UI.withLoading(connBtn, async function () {
          try { const up = await API.call("GET", "/api/v2/publish/check-connections"); if (!up.ok) { UI.showError(connRegion, formatErr(up)); return; } UI.showResult(connRegion, up.data); } catch (e) { UI.showError(connRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      queueBtn.addEventListener("click", function () {
        UI.withLoading(queueBtn, async function () {
          try { const up = await API.call("GET", "/api/v2/publish/queue-status"); if (!up.ok) { UI.showError(queueRegion, formatErr(up)); return; } UI.showResult(queueRegion, up.data); } catch (e) { UI.showError(queueRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      histBtn.addEventListener("click", function () {
        UI.withLoading(histBtn, async function () {
          try { const up = await API.call("GET", "/api/v2/publish/history?page=" + (histPage.value || 1) + "&pageSize=20"); if (!up.ok) { UI.showError(histRegion, formatErr(up)); return; } UI.showResult(histRegion, up.data); } catch (e) { UI.showError(histRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      ckSaveBtn.addEventListener("click", function () {
        const c = ckCookie.value.trim();
        if (!c) { UI.showError(ckRegion, "请输入 Cookie"); return; }
        UI.withLoading(ckSaveBtn, async function () {
          try { const up = await API.call("POST", "/api/v2/publish/save-cookie", { platform: ckPlatform.value, cookieText: c }); if (!up.ok) { UI.showError(ckRegion, formatErr(up)); return; } UI.showResult(ckRegion, up.data); } catch (e) { UI.showError(ckRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      ckStatusBtn.addEventListener("click", function () {
        UI.withLoading(ckStatusBtn, async function () {
          try { const up = await API.call("GET", "/api/v2/publish/cookie-status"); if (!up.ok) { UI.showError(ckRegion, formatErr(up)); return; } UI.showResult(ckRegion, up.data); } catch (e) { UI.showError(ckRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
    },
  };
})();
