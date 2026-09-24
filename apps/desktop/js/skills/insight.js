(function () {
  var Skills = (window.Skills = window.Skills || {});

  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }

  Skills.insight = {
    mount: function (panel) {
      var UI = window.UI;
      const API = window.HTWApi;
      UI.clear(panel);

      function field(labelText, input) {
        return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
      }
      function section(title, bodyNodes, actionNode, region, icon) {
        const head = icon ? UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]) : UI.el("h3", { text: title });
        const kids = [head].concat(bodyNodes);
        kids.push(UI.el("div", { class: "row" }, [actionNode]));
        kids.push(region);
        return UI.el("div", { class: "card" }, kids);
      }
      // fn 自己渲染完（比如热榜回落到缓存榜）时返回带 __rendered 的结果，
      // 这里就不再重复渲染一遍覆盖掉它。
      function run(btn, region, fn) {
        UI.withLoading(btn, async function () {
          try {
            const r = await fn();
            if (r && r.__rendered) return;
            if (!r.ok) { UI.showError(region, formatErr(r)); return; }
            UI.renderResult(region, r.data);
          } catch (e) {
            UI.showError(region, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      }

      const copyText = UI.el("textarea", { placeholder: "输入文案或今日头条文章链接" });
      const copyRegion = UI.el("div");
      const copyBtn = UI.el("button", { class: "btn", text: "分析文案" });
      const copyCard = section("文案分析", [field("文案", copyText)], copyBtn, copyRegion, "fa-file-lines");

      const videoUrl = UI.el("input", { type: "text", placeholder: "视频链接 URL（仅支持 B站 / 小红书 / 抖音）" });
      const videoRegion = UI.el("div");
      const videoBtn = UI.el("button", { class: "btn", text: "分析视频" });
      const videoCard = section("视频分析", [field("视频 URL", videoUrl)], videoBtn, videoRegion, "fa-film");

      const accountUrl = UI.el("input", { type: "text", placeholder: "账号主页 URL（仅支持 B站 / 小红书 / 抖音）" });
      const accountRegion = UI.el("div");
      const accountBtn = UI.el("button", { class: "btn", text: "分析账号" });
      const accountCard = section("账号分析", [field("账号 URL", accountUrl)], accountBtn, accountRegion, "fa-user");

      const hotRegion = UI.el("div");
      const hotBtn = UI.el("button", { class: "btn", text: "获取热榜" });
      const hotCard = section("热榜", [], hotBtn, hotRegion, "fa-fire");

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

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "洞察 Insight" }),
        copyCard, videoCard, accountCard, hotCard, searchCard,
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
      // 实时热榜对非付费账号有 3 次/分钟的限流，撞上就是 429。
      // 后端给的提示是「改用 hot-rankings-cached」，但界面上原来没有这条路径，
      // 用户点了只能看到一句错误干等 —— 这里直接自动回落到库里的采样榜。
      async function loadHot() {
        const live = await API.call("GET", "/api/v2/insight/hot-rankings");
        if (live.ok) return live;
        if (live.code !== 429) return live;

        const cached = await API.call("GET", "/api/v2/insight/hot-rankings-cached");
        if (!cached.ok) return live; // 缓存也没有，还是把限流原因原样告诉用户

        const d = cached.data || {};
        const rows = d.data !== undefined ? d.data : d;
        UI.renderResult(hotRegion, rows);
        const when = d.sampledAt ? "（采样时间 " + d.sampledAt + "）" : "";
        // renderResult 会清空区域，提示要在渲染之后插到最前面
        hotRegion.insertBefore(
          UI.el("div", { class: "hint", text: "实时抓取太频繁，已改展示后台缓存的热榜" + when }),
          hotRegion.firstChild
        );
        return { ok: true, __rendered: true };
      }

      hotBtn.addEventListener("click", function () {
        run(hotBtn, hotRegion, loadHot);
      });
      searchBtn.addEventListener("click", function () {
        const kw = searchKeyword.value.trim();
        if (!kw) { UI.showError(searchRegion, "请输入关键词"); return; }
        run(searchBtn, searchRegion, function () { return API.call("POST", "/api/v2/insight/search", { platform: searchPlatform.value, keyword: kw, count: Number(searchCount.value) || 10 }); });
      });
    },
  };
})();
