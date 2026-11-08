(function () {
  var Skills = (window.Skills = window.Skills || {});

  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }

  function openExternal(url) {
    var href = String(url || "");
    if (!/^https?:\/\//i.test(href)) return;
    if (window.htw && typeof window.htw.openExternal === "function") window.htw.openExternal(href);
    else window.open(href, "_blank");
  }

  // 采样时间是 ISO 串（2026-10-29T19:28:35），原样贴出来不好读。
  function fmtTime(s) {
    var str = String(s || "");
    if (!str) return "";
    if (str.indexOf("T") > 0) str = str.replace("T", " ").slice(0, 16);
    return str.slice(0, 16);
  }

  // 分享口令里常混着文字，取第一个 http(s) 链接即可；末尾的标点一并去掉。
  function extractUrl(text) {
    var s = String(text == null ? "" : text).trim();
    var m = s.match(/https?:\/\/[^\s"'<>]+/i);
    if (!m) return "";
    return m[0].replace(/[),.，。;；、]+$/, "");
  }

  // 平台判据只用于**发请求前**挡掉明显不支持的链接：
  // 后端对不支持的 URL 会回 Ok:true + 一句「不支持的平台」占位串，照样扣额度。
  function platformOf(url) {
    var s = String(url || "");
    if (!/^https?:\/\//i.test(s)) return "";
    var host;
    try { host = new URL(s).hostname.toLowerCase(); } catch (e) { return ""; }
    if (/(^|\.)(bilibili\.com|b23\.tv)$/.test(host)) return "bilibili";
    if (/(^|\.)(xiaohongshu\.com|xhslink\.com)$/.test(host)) return "xhs";
    if (/(^|\.)(douyin\.com|iesdouyin\.com)$/.test(host)) return "douyin";
    if (/(^|\.)toutiao\.com$/.test(host)) return "toutiao";
    return "";
  }

  var VIDEO_PLATFORMS = { bilibili: 1, xhs: 1, douyin: 1 };
  var ACCOUNT_PLATFORMS = { bilibili: 1, xhs: 1, douyin: 1, toutiao: 1 };

  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v != null && v !== "") return v;
    }
    return null;
  }

  function firstUrl(v) {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") return pick(v, ["urlDefault", "urlPre", "url", "url_default", "url_pre"]) || "";
    return "";
  }

  function fmtMetric(v) {
    var s = String(v == null ? "" : v).trim();
    if (/[^\d.]/.test(s)) return s;
    var n = Number(s);
    if (!isFinite(n)) return s;
    if (n < 10000) return s;
    return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  }

  function addMetric(tags, label, v) {
    if (v == null || v === "" || Number(v) === 0) return;
    tags.push(label + " " + fmtMetric(v));
  }

  // 搜索接口各平台字段差异很大（B站给 play/bvid/弹幕，小红书给 noteCard/interactInfo，
  // 抖音/头条只给一个搜索页 URL）。这里统一成渲染层认识的形状，顺手丢掉
  // aid/cid/authorMid 这类内部 ID —— 它们对用户没有意义。
  function normalizeSearchItem(it, index, platform) {
    if (!it || typeof it !== "object") return it;
    var card = it.noteCard || it.note_card || it;
    var user = card.user || it.user || {};
    var interact = card.interactInfo || card.interact_info || it.interactInfo || it.interact_info || {};
    var title = pick(it, ["title"]) || pick(card, ["displayTitle", "title", "name"]) || "";
    var url = pick(it, ["url", "noteUrl", "shareUrl", "link", "arcurl"]) || pick(card, ["url", "noteUrl", "shareUrl", "link"]) || "";
    if (!url && it.bvid) url = "https://www.bilibili.com/video/" + it.bvid;
    var cover = firstUrl(pick(it, ["cover", "coverUrl", "noteCover", "image", "imageUrl"]) ||
      pick(card, ["cover", "coverUrl", "noteCover", "image", "imageUrl"]));
    var author = pick(it, ["author", "nickname", "userName"]) || pick(user, ["nickname", "nickName", "name"]) || "";
    var desc = pick(it, ["desc", "description", "summary"]) || pick(card, ["desc", "description", "summary"]) || "";
    if (desc && String(desc).length > 140) desc = String(desc).slice(0, 140) + "…";

    var score = null;
    var scoreLabel = "";
    var tags = [];
    if (platform === "bilibili") {
      score = it.play != null ? it.play : it.view;
      scoreLabel = "播放";
      addMetric(tags, "弹幕", it.danmaku);
      addMetric(tags, "点赞", it.like);
      addMetric(tags, "收藏", it.favorite);
    } else if (platform === "xhs") {
      score = pick(interact, ["likedCount", "likeCount", "likes"]);
      if (score == null) score = pick(it, ["likedCount", "likeCount", "likes"]);
      scoreLabel = "点赞";
      addMetric(tags, "收藏", pick(interact, ["collectedCount", "collectCount", "favorites"]));
      addMetric(tags, "评论", pick(interact, ["commentCount", "comments"]));
    }

    if (!title && !url && !cover) return it;
    var descText = author ? "作者：" + author : "";
    if (desc) descText += (descText ? " · " : "") + desc;
    return {
      rank: index + 1,
      title: String(title || url || ""),
      url: url || undefined,
      cover: cover || undefined,
      desc: descText || undefined,
      score: score == null ? undefined : score,
      scoreLabel: scoreLabel || undefined,
      tag: tags.length ? tags.join(" · ") : undefined,
    };
  }

  Skills.insight = {
    mount: function (panel) {
      var UI = window.UI;
      const API = window.HTWApi;
      UI.clear(panel);

      function field(labelText, input, hintText) {
        const kids = [UI.el("label", { text: labelText }), input];
        if (hintText) kids.push(UI.el("div", { class: "hint", text: hintText }));
        return UI.el("div", { class: "field" }, kids);
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
            // 没填 AuthKey 是配置问题，不是请求异常，别套「请求异常」前缀把人引到网络上去。
            if (e && e.authMissing) { UI.showError(region, e.message); return; }
            UI.showError(region, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      }
      function checkLink(raw, allowed, message) {
        const url = extractUrl(raw);
        if (!url) return { error: "请输入以 http(s):// 开头的链接" };
        const platform = platformOf(url);
        if (!platform || !allowed[platform]) return { error: message };
        return { url: url };
      }
      function readCount() {
        const raw = String(searchCount.value).trim();
        if (!/^\d+$/.test(raw)) return null;
        const n = Number(raw);
        if (n < 1 || n > 50) return null;
        return n;
      }
      function bindEnter(input, btn) {
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); btn.click(); }
        });
      }

      // 五个工具用页签分隔：一次只展示一块，避免整页滚动找功能。
      // 各页签内容常驻（只切换显隐），切走再切回来时输入和结果都还在。
      const panes = {};
      function pane(key, nodes) {
        panes[key] = UI.el("div", {
          class: "insight-pane",
          "data-tab": key,
          hidden: key !== "copy",
        }, nodes);
        return panes[key];
      }

      const copyText = UI.el("textarea", { placeholder: "输入文案或今日头条文章链接" });
      const copyRegion = UI.el("div");
      const copyBtn = UI.el("button", { class: "btn", text: "分析文案" });
      pane("copy", [
        field("文案", copyText, "可粘贴文案或今日头条文章链接；Ctrl + Enter 快速分析"),
        UI.el("div", { class: "row" }, [copyBtn]),
        copyRegion,
      ]);

      const videoUrl = UI.el("input", { type: "text", placeholder: "视频链接 URL" });
      const videoRegion = UI.el("div");
      const videoBtn = UI.el("button", { class: "btn", text: "分析视频" });
      pane("video", [
        field("视频 URL", videoUrl, "支持 B站 / 小红书 / 抖音；b23.tv、xhslink.com 等短链也可"),
        UI.el("div", { class: "row" }, [videoBtn]),
        videoRegion,
      ]);

      const accountUrl = UI.el("input", { type: "text", placeholder: "账号主页 URL" });
      const accountRegion = UI.el("div");
      const accountBtn = UI.el("button", { class: "btn", text: "分析账号" });
      pane("account", [
        field("账号 URL", accountUrl, "支持 B站 / 小红书 / 抖音 / 今日头条的账号主页链接"),
        UI.el("div", { class: "row" }, [accountBtn]),
        accountRegion,
      ]);

      const hotRegion = UI.el("div");
      const hotBtn = UI.el("button", { class: "btn", text: "获取热榜" });
      pane("hot", [
        UI.el("div", { class: "hint", text: "拉取 B站 / 微博 / 抖音 / 头条的热点榜单；实时抓取有频率限制，超限时自动改用后台缓存。" }),
        UI.el("div", { class: "row" }, [hotBtn]),
        hotRegion,
      ]);

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
      const searchCount = UI.el("input", { type: "number", value: "10", min: 1, max: 50, step: 1 });
      const searchRegion = UI.el("div");
      const searchBtn = UI.el("button", { class: "btn", text: "搜索" });
      pane("search", [
        UI.el("div", { class: "hint", text: "按平台和关键词调研对标内容；抖音 / 头条只提供搜索页跳转。" }),
        field("平台", searchPlatform),
        field("关键词", searchKeyword),
        field("数量", searchCount, "1–50，默认 10"),
        UI.el("div", { class: "row" }, [searchBtn]),
        searchRegion,
      ]);

      const tabDefs = [
        { key: "copy", text: "文案分析", icon: "fa-file-lines" },
        { key: "video", text: "视频分析", icon: "fa-film" },
        { key: "account", text: "账号分析", icon: "fa-user" },
        { key: "hot", text: "热榜", icon: "fa-fire" },
        { key: "search", text: "全网搜索", icon: "fa-magnifying-glass" },
      ];
      const tabBtns = {};
      const tabs = UI.el("div", { class: "insight-tabs" });
      function activate(key) {
        tabDefs.forEach(function (t) {
          tabBtns[t.key].classList.toggle("active", t.key === key);
          panes[t.key].hidden = t.key !== key;
        });
      }
      tabDefs.forEach(function (t) {
        const b = UI.el("button", {
          class: "btn insight-tab" + (t.key === "copy" ? " active" : ""),
          onclick: function () { activate(t.key); },
        }, [UI.el("i", { class: "fa-solid " + t.icon }), " " + t.text]);
        tabBtns[t.key] = b;
        tabs.appendChild(b);
      });

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "洞察 Analysis" }),
        tabs,
        UI.el("div", { class: "insight-body" }, tabDefs.map(function (t) { return panes[t.key]; })),
      ]));

      copyBtn.addEventListener("click", function () {
        const t = copyText.value.trim();
        if (!t) { UI.showError(copyRegion, "请输入文案"); return; }
        run(copyBtn, copyRegion, function () { return API.call("POST", "/api/v2/insight/analyze-copy", { text: t }); });
      });
      videoBtn.addEventListener("click", function () {
        const r = checkLink(videoUrl.value, VIDEO_PLATFORMS, "仅支持 B站 / 小红书 / 抖音的视频链接（b23.tv、xhslink.com 等短链也可）");
        if (r.error) { UI.showError(videoRegion, r.error); return; }
        run(videoBtn, videoRegion, function () { return API.call("POST", "/api/v2/insight/analyze-video", { url: r.url }); });
      });
      accountBtn.addEventListener("click", function () {
        const r = checkLink(accountUrl.value, ACCOUNT_PLATFORMS, "仅支持 B站 / 小红书 / 抖音 / 今日头条的账号主页链接");
        if (r.error) { UI.showError(accountRegion, r.error); return; }
        run(accountBtn, accountRegion, function () { return API.call("POST", "/api/v2/insight/analyze-account", { url: r.url }); });
      });

      bindEnter(videoUrl, videoBtn);
      bindEnter(accountUrl, accountBtn);
      bindEnter(searchKeyword, searchBtn);
      bindEnter(searchCount, searchBtn);
      copyText.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); copyBtn.click(); }
      });

      // 实时热榜对非付费账号有 3 次/分钟的限流，撞上就是 429。
      // 后端给的提示是「改用 hot-rankings-cached」，这里直接自动回落到库里的采样榜。
      async function loadHot() {
        const live = await API.call("GET", "/api/v2/insight/hot-rankings");
        if (live.ok) return live;
        if (live.code !== 429) return live;

        const cached = await API.call("GET", "/api/v2/insight/hot-rankings-cached");
        const d = (cached && cached.ok && cached.data) || {};
        const rows = d.data !== undefined ? d.data : d;
        const hasRows = rows && typeof rows === "object" && !Array.isArray(rows) &&
          Object.keys(rows).some(function (k) { return Array.isArray(rows[k]); });
        if (!cached.ok || !hasRows) {
          const why = live.message || "实时抓取太频繁";
          return { ok: false, code: live.code, message: "实时热榜暂时不可用（" + why + "），缓存榜也没能取到，请稍后再试。" };
        }

        UI.renderResult(hotRegion, rows);
        const when = d.sampledAt ? "（采样时间 " + fmtTime(d.sampledAt) + "）" : "";
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

      // 抖音 / 头条的搜索接口只回一个搜索页 URL，不是结果列表；
      // 直接铺 Url/Platform 两个字段既像故障又没法点，这里给一张明确的跳转卡。
      function renderSearchData(region, platform, data) {
        if (data && !Array.isArray(data) && typeof data === "object" &&
            typeof data.url === "string" && /^https?:\/\//i.test(data.url)) {
          UI.clear(region);
          region.appendChild(UI.el("div", {
            class: "hint",
            text: UI.platformName(platform) + " 不提供站内结果列表，已为你生成搜索结果页。",
          }));
          region.appendChild(UI.el("a", {
            class: "title-link",
            href: data.url,
            text: "在浏览器打开搜索结果",
            onclick: function (e) { e.preventDefault(); openExternal(data.url); },
          }));
          return true;
        }
        if (Array.isArray(data)) {
          const items = data.map(function (it, i) { return normalizeSearchItem(it, i, platform); });
          UI.renderResult(region, items);
          region.insertBefore(
            UI.el("div", { class: "hint", text: UI.platformName(platform) + " · 共 " + data.length + " 条结果" }),
            region.firstChild
          );
          return true;
        }
        return false;
      }

      searchBtn.addEventListener("click", function () {
        const kw = searchKeyword.value.trim();
        if (!kw) { UI.showError(searchRegion, "请输入关键词"); return; }
        const count = readCount();
        if (count == null) { UI.showError(searchRegion, "数量需为 1–50 的整数"); return; }
        const platform = searchPlatform.value;
        run(searchBtn, searchRegion, async function () {
          const r = await API.call("POST", "/api/v2/insight/search", { platform: platform, keyword: kw, count: count });
          if (!r.ok) return r;
          if (renderSearchData(searchRegion, platform, r.data)) return { ok: true, __rendered: true };
          return r;
        });
      });
    },
  };
})();
