(function () {
  var Skills = (window.Skills = window.Skills || {});

  /*
   * 选题雷达（原型实现）
   * 数据来自 MOCK（接口形状与 docs/prd-topic-selection.md §5 一致）。
   * 服务端实现后：将 mockApi(path, options) 替换为 HTWApi.call 即可，UI 无需改动。
   * 对应接口：
   *   GET  /api/v2/topics/daily
   *   GET  /api/v2/topics/radar/accounts
   *   POST /api/v2/topics/radar/accounts
   *   GET  /api/v2/topics/radar/alerts
   *   GET  /api/v2/topics/trends
   *   POST /api/v2/topics/feedback
   */

  var MOCK = {
    daily: {
      date: "2026-08-30",
      cards: [
        {
          id: "tp_001",
          title: "打工人一周备餐指南：成本 50 块吃五天",
          hook: "开头用价格对比制造冲突：一顿外卖 = 一天备餐",
          category: "美食",
          tags: ["备餐", "省钱", "上班族"],
          evidence: {
            type: "peer",
            ref_title: "本周备餐挑战",
            metric_label: "数据超对标账号均值",
            metric_value: "5.2×",
          },
          score: 92,
        },
        {
          id: "tp_002",
          title: "把《黑神话》的 UI 设计拆给你看：为什么它一开售就封神",
          hook: "开局直接亮销量数字，用结果倒推设计决策",
          category: "游戏",
          tags: ["游戏设计", "国产之光", "拆解"],
          evidence: {
            type: "hot",
            ref_title: "热榜 #2 · 热度 +186%",
            metric_label: "热榜趋势",
            metric_value: "↑ 上升期",
          },
          score: 88,
        },
        {
          id: "tp_003",
          title: "面试官问我离职原因，我反手甩出这份离职攻略",
          hook: "第一人称冲突开场：'我被问住了，然后我反问了'",
          category: "职场",
          tags: ["职场", "离职", "面试"],
          evidence: {
            type: "peer",
            ref_title: "职场避坑系列",
            metric_label: "数据超对标账号均值",
            metric_value: "3.8×",
          },
          score: 81,
        },
        {
          id: "tp_004",
          title: "10 元做出米其林摆盘：穷人版 fine dining 挑战",
          hook: "反差感：菜市场食材 × 米其林摆盘审美",
          category: "美食",
          tags: ["挑战", "平替", "摆盘"],
          evidence: {
            type: "gap",
            ref_title: "垂类内无人做过同题材",
            metric_label: "趋势缺口",
            metric_value: "gap",
          },
          score: 76,
        },
        {
          id: "tp_005",
          title: "我用 AI 一周做完了原本要一个月的活",
          hook: "亮工作量对比：原来 30 天 → 现在 7 天",
          category: "效率",
          tags: ["AI", "工作流", "效率"],
          evidence: {
            type: "hot",
            ref_title: "热榜 #5 · AI 工具话题持续上升",
            metric_label: "热榜趋势",
            metric_value: "↑ 上升期",
          },
          score: 74,
        },
        {
          id: "tp_006",
          title: "租房党改造出租屋：200 块的幸福感爆棚改造",
          hook: "Before/After 对比放在第 3 秒",
          category: "生活",
          tags: ["租房", "改造", "平价"],
          evidence: {
            type: "peer",
            ref_title: "租房改造合集",
            metric_label: "数据超对标账号均值",
            metric_value: "2.6×",
          },
          score: 69,
        },
      ],
    },
    radarAccounts: [
      { id: "acc_01", platform: "bilibili", name: "干饭王阿伟", baseline_plays: 52000, baseline_likes: 4300, samples: 24, last: "今天 09:00" },
      { id: "acc_02", platform: "xiaohongshu", name: "低卡食堂", baseline_plays: 18000, baseline_likes: 2100, samples: 18, last: "今天 09:00" },
    ],
    radarAlerts: [
      {
        id: "al_01",
        account: "干饭王阿伟",
        title: "挑战全网最便宜的一顿减脂餐",
        multiplier: "5.2×",
        detail: "播放 27 万（基线 5.2 万）· 发布于 2 小时前",
      },
    ],
    trends: [
      { rank: 1, title: "中国女vs泰国女排", source: "今日头条", heat: "2841万", stage: "fading" },
      { rank: 2, title: "黑神话 UI 设计拆解", source: "B站", heat: "932万", stage: "rising" },
      { rank: 3, title: "一周备餐挑战", source: "小红书", heat: "417万", stage: "rising" },
      { rank: 4, title: "中足联公布英博国安冲突处罚", source: "今日头条", heat: "386万", stage: "plateau" },
      { rank: 5, title: "AI 工具替代岗位讨论", source: "B站", heat: "255万", stage: "rising" },
      { rank: 6, title: "国庆调休安排", source: "今日头条", heat: "187万", stage: "fading" },
    ],
  };

  // mock 接口：返回 Promise，形状与真实 API 一致；服务端就绪后替换为 HTWApi.call
  function mockApi(path, options) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (path === "/api/v2/topics/daily") return resolve({ ok: true, data: MOCK.daily });
        if (path === "/api/v2/topics/radar/accounts")
          return resolve({ ok: true, data: { accounts: MOCK.radarAccounts, alerts: MOCK.radarAlerts } });
        if (path === "/api/v2/topics/trends") return resolve({ ok: true, data: { topics: MOCK.trends } });
        if (path === "/api/v2/topics/radar/accounts" && options && options.method === "POST") {
          var b = options.body || {};
          MOCK.radarAccounts.push({
            id: "acc_" + Date.now(),
            platform: b.platform || "bilibili",
            name: b.url.replace(/^https?:\/\/[^/]+\//, "").slice(0, 18) || "新账号",
            baseline_plays: 0,
            baseline_likes: 0,
            samples: 0,
            last: "刚刚",
          });
          return resolve({ ok: true });
        }
        resolve({ ok: true });
      }, 350);
    });
  }

  var STAGE = {
    rising: { text: "↑ 上升期", cls: "tp-stage-up", tip: "上升期：建议 24 小时内跟进" },
    plateau: { text: "→ 平台期", cls: "tp-stage-flat", tip: "平台期：需要差异化角度切入" },
    fading: { text: "↓ 已过气", cls: "tp-stage-down", tip: "已过气：不建议再追" },
  };

  Skills.topics = {
    mount: function (panel) {
      var UI = window.UI;
      UI.clear(panel);

      // 原型模式角标
      panel.appendChild(
        UI.el("div", {
          class: "tp-proto-badge",
          text: "原型模式 · 当前为演示数据（接口契约见 docs/prd-topic-selection.md）",
        })
      );

      // Tab 导航
      var tabs = UI.el("div", { class: "tp-tabs" });
      var body = UI.el("div");
      var tabDefs = [
        { key: "daily", text: "今日选题" },
        { key: "radar", text: "对标雷达" },
        { key: "trends", text: "热榜趋势" },
      ];
      tabDefs.forEach(function (t, i) {
        var b = UI.el("button", { class: "btn tp-tab" + (i === 0 ? " active" : ""), text: t.text });
        b.addEventListener("click", function () {
          tabs.querySelectorAll(".tp-tab").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          renderTab(t.key);
        });
        tabs.appendChild(b);
      });
      panel.appendChild(tabs);
      panel.appendChild(body);

      function renderTab(key) {
        UI.clear(body);
        if (key === "daily") renderDaily(body);
        if (key === "radar") renderRadar(body);
        if (key === "trends") renderTrends(body);
      }

      // ---------- 今日选题 ----------
      function renderDaily(root) {
        var tip = UI.el("div", { class: "tp-hint", text: "每天由服务端结合热榜趋势与你的垂类画像生成，每条选题都附带数据证据。" });
        root.appendChild(tip);
        var grid = UI.el("div", { class: "tp-grid" });
        root.appendChild(grid);
        mockApi("/api/v2/topics/daily").then(function (r) {
          UI.clear(grid);
          r.data.cards.forEach(function (c) {
            var evText;
            if (c.evidence.type === "peer")
              evText = "对标 @" + c.evidence.ref_title + " · " + c.evidence.metric_label + " " + c.evidence.metric_value;
            else if (c.evidence.type === "hot") evText = c.evidence.ref_title + " · " + c.evidence.metric_value;
            else evText = c.evidence.ref_title;
            var card = UI.el("div", { class: "tp-card" }, [
              UI.el("div", { class: "tp-card-head" }, [
                UI.el("span", { class: "tp-badge", text: c.category }),
                UI.el("span", { class: "tp-score", text: "潜力 " + c.score }),
              ]),
              UI.el("div", { class: "tp-title", text: c.title }),
              UI.el("div", { class: "tp-hook", text: "钩子：" + c.hook }),
              UI.el("div", { class: "tp-evidence", text: "📌 " + evText }),
              UI.el("div", { class: "tp-tags", text: c.tags.map(function (t) { return "#" + t; }).join(" ") }),
              (function () {
                var b = UI.el("button", { class: "btn", text: "🚀 去创作" });
                b.addEventListener("click", function () {
                  var title = c.title;
                  try {
                    (navigator.clipboard || { writeText: function () {} }).writeText
                      ? navigator.clipboard.writeText(title)
                      : null;
                  } catch (e) {}
                  b.textContent = "✓ 标题已复制，去「创作」粘贴";
                  b.disabled = true;
                  setTimeout(function () { b.textContent = "🚀 去创作"; b.disabled = false; }, 1800);
                });
                return b;
              })(),
            ]);
            grid.appendChild(card);
          });
        });
      }

      // ---------- 对标雷达 ----------
      function renderRadar(root) {
        var tip = UI.el("div", { class: "tp-hint", text: "添加同垂类的对标账号，系统定时采样数据；出现爆款（超基线 3 倍）时在这里提醒你。" });
        root.appendChild(tip);

        var alertBox = UI.el("div");
        root.appendChild(alertBox);
        var listCard = UI.el("div", { class: "card" }, [
          UI.el("h3", { text: " monitors 对标账号" }),
          UI.el("div", { id: "radar-list" }),
        ]);
        root.appendChild(listCard);
        var addRow = UI.el("div", { class: "row" });
        var sel = UI.el("select", { class: "input" }, [
          UI.el("option", { value: "bilibili", text: "B站" }),
          UI.el("option", { value: "xiaohongshu", text: "小红书" }),
          UI.el("option", { value: "douyin", text: "抖音" }),
        ]);
        var input = UI.el("input", { class: "input", placeholder: "对标账号主页 URL" });
        input.style.flex = "1";
        var addBtn = UI.el("button", { class: "btn", text: "＋ 添加账号" });
        addRow.appendChild(sel); addRow.appendChild(input); addRow.appendChild(addBtn);
        listCard.appendChild(addRow);

        function renderList(accounts, alerts) {
          var list = listCard.querySelector("#radar-list");
          UI.clear(list);
          accounts.forEach(function (a) {
            var row = UI.el("div", { class: "tp-acct" }, [
              UI.el("div", {}, [
                UI.el("div", { class: "tp-acct-name", text: "🪪 " + a.name + "（" + a.platform + "）" }),
                UI.el("div", { class: "tp-acct-meta", text: "基线 " + fmtN(a.baseline_plays) + " 播放 · 已采样 " + a.samples + " 次 · 最近 " + a.last }),
              ]),
              UI.el("button", { class: "btn btn-ghost", text: "移除" }),
            ]);
            row.querySelector(".btn-ghost").addEventListener("click", function () {
              a._del = true; renderList(accounts, alerts);
            });
            list.appendChild(row);
          });
          (alerts || []).forEach(function (al) {
            alertBox.appendChild(
              UI.el("div", { class: "tp-alert" }, [
                UI.el("div", { class: "tp-alert-head" }, [
                  UI.el("span", { text: "🔥 爆款提醒 · " + al.account }),
                  UI.el("span", { class: "tp-mult", text: al.multiplier }),
                ]),
                UI.el("div", { class: "tp-alert-title", text: al.title }),
                UI.el("div", { class: "tp-alert-meta", text: al.detail }),
              ])
            );
          });
        }
        function fmtN(n) { return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n); }

        mockApi("/api/v2/topics/radar/accounts").then(function (r) {
          renderList(r.data.accounts, r.data.alerts);
        });

        addBtn.addEventListener("click", function () {
          var url = input.value.trim();
          if (!url) return;
          mockApi("/api/v2/topics/radar/accounts", { method: "POST", body: { platform: sel.value, url: url } }).then(function () {
            input.value = "";
            mockApi("/api/v2/topics/radar/accounts").then(function (r) { renderList(r.data.accounts, r.data.alerts); });
          });
        });
      }

      // ---------- 热榜趋势 ----------
      function renderTrends(root) {
        var tip = UI.el("div", { class: "tp-hint", text: "每小时采样一次热榜，累计形成热度曲线。上升期的话题建议 24 小时内跟进。" });
        root.appendChild(tip);
        mockApi("/api/v2/topics/trends").then(function (r) {
          r.data.topics.forEach(function (t) {
            var st = STAGE[t.stage] || STAGE.plateau;
            var row = UI.el("div", { class: "tp-trend" }, [
              UI.el("span", { class: "tp-rank", text: "#" + t.rank }),
              UI.el("div", { class: "tp-trend-main" }, [
                UI.el("div", { class: "tp-trend-title", text: t.title }),
                UI.el("div", { class: "tp-trend-meta", text: t.source + " · 热度 " + t.heat }),
              ]),
              UI.el("span", { class: "tp-stage " + st.cls, text: st.text, title: st.tip }),
              (function () {
                var b = UI.el("button", { class: "btn", text: "以此创作" });
                b.addEventListener("click", function () {
                  try { navigator.clipboard.writeText(t.title); } catch (e) {}
                  b.textContent = "✓ 已复制";
                  setTimeout(function () { b.textContent = "以此创作"; }, 1500);
                });
                return b;
              })(),
            ]);
            root.appendChild(row);
          });
        });
      }

      renderTab("daily");
    },
  };
})();
