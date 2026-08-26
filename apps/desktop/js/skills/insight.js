(function () {
  const Skills = (window.Skills = window.Skills || {});

  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }

  Skills.insight = {
    mount: function (panel) {
      const UI = window.UI;
      const API = window.HTWApi;
      UI.clear(panel);

      function field(labelText, input) {
        return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
      }
      function section(title, bodyNodes, actionNode, region) {
        const kids = [UI.el("h3", { text: title })].concat(bodyNodes);
        kids.push(UI.el("div", { class: "row" }, [actionNode]));
        kids.push(region);
        return UI.el("div", { class: "card" }, kids);
      }
      function run(btn, region, fn) {
        UI.withLoading(btn, async function () {
          try {
            const r = await fn();
            if (!r.ok) { UI.showError(region, formatErr(r)); return; }
            UI.showResult(region, r.data);
          } catch (e) {
            UI.showError(region, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      }

      const copyText = UI.el("textarea", { placeholder: "粘贴要分析的文案…" });
      const copyRegion = UI.el("div");
      const copyBtn = UI.el("button", { class: "btn", text: "分析文案" });
      const copyCard = section("文案分析", [field("文案", copyText)], copyBtn, copyRegion);

      const videoUrl = UI.el("input", { type: "text", placeholder: "视频链接 URL" });
      const videoRegion = UI.el("div");
      const videoBtn = UI.el("button", { class: "btn", text: "分析视频" });
      const videoCard = section("视频分析", [field("视频 URL", videoUrl)], videoBtn, videoRegion);

      const accountUrl = UI.el("input", { type: "text", placeholder: "账号主页 URL" });
      const accountRegion = UI.el("div");
      const accountBtn = UI.el("button", { class: "btn", text: "分析账号" });
      const accountCard = section("账号分析", [field("账号 URL", accountUrl)], accountBtn, accountRegion);

      const hotRegion = UI.el("div");
      const hotBtn = UI.el("button", { class: "btn", text: "获取热榜" });
      const hotCard = section("热榜", [], hotBtn, hotRegion);

      function platformOptions() {
        return [
          UI.el("option", { value: "xhs", text: "小红书" }),
          UI.el("option", { value: "bilibili", text: "B站" }),
          UI.el("option", { value: "douyin", text: "抖音" }),
          UI.el("option", { value: "toutiao", text: "头条" }),
        ];
      }
      const searchPlatform = UI.el("select", {}, platformOptions());
      const searchKeyword = UI.el("input", { type: "text", placeholder: "关键词" });
      const searchCount = UI.el("input", { type: "number", value: "10" });
      const searchRegion = UI.el("div");
      const searchBtn = UI.el("button", { class: "btn", text: "搜索" });
      const searchCard = section("搜索", [field("平台", searchPlatform), field("关键词", searchKeyword), field("数量", searchCount)], searchBtn, searchRegion);

      const cookiePlatform = UI.el("select", {}, platformOptions());
      const cookieText = UI.el("textarea", { placeholder: "粘贴 Cookie 文本…" });
      const cookieRegion = UI.el("div");
      const cookieBtn = UI.el("button", { class: "btn", text: "保存 Cookie" });
      const cookieStatusBtn = UI.el("button", { class: "btn secondary", text: "刷新状态" });
      const cookieCard = section("Cookie", [field("平台", cookiePlatform), field("Cookie", cookieText)], UI.el("div", { class: "row" }, [cookieBtn, cookieStatusBtn]), cookieRegion);

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "洞察 Insight" }),
        copyCard, videoCard, accountCard, hotCard, searchCard, cookieCard,
      ]));

      copyBtn.addEventListener("click", function () {
        const t = copyText.value.trim();
        if (!t) { UI.showError(copyRegion, "请输入文案"); return; }
        run(copyBtn, copyRegion, function () { return API.call("POST", "/api/v2/insight/analyze-copy", { text: t }); });
      });
      videoBtn.addEventListener("click", function () {
        const u = videoUrl.value.trim();
        if (!u) { UI.showError(videoRegion, "请输入视频 URL"); return; }
        run(videoBtn, videoRegion, function () { return API.call("POST", "/api/v2/insight/analyze-video", { url: u }); });
      });
      accountBtn.addEventListener("click", function () {
        const u = accountUrl.value.trim();
        if (!u) { UI.showError(accountRegion, "请输入账号 URL"); return; }
        run(accountBtn, accountRegion, function () { return API.call("POST", "/api/v2/insight/analyze-account", { url: u }); });
      });
      hotBtn.addEventListener("click", function () {
        run(hotBtn, hotRegion, function () { return API.call("GET", "/api/v2/insight/hot-rankings"); });
      });
      searchBtn.addEventListener("click", function () {
        const kw = searchKeyword.value.trim();
        if (!kw) { UI.showError(searchRegion, "请输入关键词"); return; }
        run(searchBtn, searchRegion, function () { return API.call("POST", "/api/v2/insight/search", { platform: searchPlatform.value, keyword: kw, count: Number(searchCount.value) || 10 }); });
      });
      cookieBtn.addEventListener("click", function () {
        const c = cookieText.value.trim();
        if (!c) { UI.showError(cookieRegion, "请输入 Cookie"); return; }
        run(cookieBtn, cookieRegion, function () { return API.call("POST", "/api/v2/insight/save-cookie", { platform: cookiePlatform.value, cookieText: c }); });
      });
      cookieStatusBtn.addEventListener("click", function () {
        run(cookieStatusBtn, cookieRegion, function () { return API.call("GET", "/api/v2/insight/cookie-status"); });
      });
    },
  };
})();
