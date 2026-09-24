(function () {
  var Skills = (window.Skills = window.Skills || {});

  /*
   * 选题雷达
   * 数据来自服务端 /api/v2/topics/*（契约见后端 docs/prd-topic-selection.md §5）。
   * 响应字段统一经 HTWApi.normalize 转成 camelCase 后再读取（后端 POCO 是 PascalCase）。
   * 对应接口：
   *   GET    /api/v2/topics/daily
   *   GET    /api/v2/topics/radar/accounts
   *   POST   /api/v2/topics/radar/accounts
   *   DELETE /api/v2/topics/radar/accounts/{id}
   *   POST   /api/v2/topics/radar/sample
   *   GET    /api/v2/topics/trends
   *   POST   /api/v2/topics/feedback
   */

  var STAGE = {
    rising: { text: "↑ 上升期", cls: "tp-stage-up", tip: "上升期：建议 24 小时内跟进" },
    plateau: { text: "→ 平台期", cls: "tp-stage-flat", tip: "平台期：需要差异化角度切入" },
    fading: { text: "↓ 已过气", cls: "tp-stage-down", tip: "已过气：不建议再追" },
    unknown: { text: "○ 数据积累中", cls: "tp-stage-unknown", tip: "采样数据还不足，暂无法判定趋势" },
  };

  var HEALTH = {
    ok: { text: "采样正常", cls: "tp-health-ok" },
    waiting: { text: "等待首轮采样", cls: "tp-health-wait", tip: "刚添加，后台每 30 分钟采样一轮，请稍候" },
    nodata: { text: "抓不到作品", cls: "tp-health-bad", tip: "采样在跑但一直没抓到作品，多半是账号 URL 写错或平台登录态失效" },
    stale: { text: "采样已停摆", cls: "tp-health-bad", tip: "超过 6 小时没有新的采样，后台任务可能没在运行" },
  };

  function call(method, path, body) {
    return window.HTWApi.call(method, path, body);
  }

  function errText(e) {
    if (!e) return "请求失败";
    if (e.authMissing) return e.message;
    return e.message || String(e);
  }

  // 统一的取数：接口失败 / 业务失败都渲染成可见的错误区，不留白屏。
  function load(region, method, path, body, onData) {
    UI.clear(region);
    region.appendChild(UI.el("div", { class: "tp-hint", text: "加载中…" }));
    call(method, path, body).then(function (r) {
      if (!r || !r.ok) {
        UI.showError(region, (r && r.message) || "请求失败");
        return;
      }
      onData(r.data || {});
    }).catch(function (e) {
      UI.showError(region, errText(e));
    });
  }

  function emptyBox(text) {
    return UI.el("div", { class: "tp-empty", text: text });
  }

  function fmtN(n) {
    n = Number(n) || 0;
    return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n);
  }

  function fmtTime(s) {
    if (!s) return "—";
    var str = String(s);
    if (str.indexOf("T") > 0) str = str.replace("T", " ").slice(0, 16);
    return str.slice(0, 16);
  }

  function copyBtn(label, text, onCopied) {
    var b = UI.el("button", { class: "btn", text: label });
    b.addEventListener("click", function () {
      var done = function (ok) {
        var old = b.textContent;
        b.textContent = ok ? "✓ 已复制" : "复制失败";
        setTimeout(function () { b.textContent = old; }, 1500);
        if (onCopied) { try { onCopied(ok); } catch (e) { } }
      };
      try {
        var p = navigator.clipboard.writeText(String(text || ""));
        if (p && p.then) p.then(function () { done(true); }, function () { done(false); });
        else done(true);
      } catch (e) { done(false); }
    });
    return b;
  }

  Skills.topics = {
    mount: function (panel) {
      var UI = window.UI;
      UI.clear(panel);

      // Tab 导航
      var tabs = UI.el("div", { class: "tp-tabs" });
      var body = UI.el("div");
      var tabDefs = [
        { key: "daily", text: "今日选题" },
        { key: "radar", text: "对标雷达" },
        { key: "trends", text: "热榜趋势" },
        { key: "profile", text: "垂类画像" },
        { key: "outcome", text: "选题效果" },
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
        if (key === "profile") renderProfile(body);
        if (key === "outcome") renderOutcome(body);
      }

      // ---------- 今日选题 ----------
      function renderDaily(root) {
        var wrap = UI.el("div");
        root.appendChild(wrap);
        load(wrap, "GET", "/api/v2/topics/daily", null, function (d) {
          UI.clear(wrap);
          var cards = d.cards || [];
          wrap.appendChild(UI.el("div", {
            class: "tp-hint",
            text: d.date
              ? d.date + " 的选题：结合热榜趋势与你的垂类画像生成，每条都附带数据证据。"
              : "每天由服务端结合热榜趋势与你的垂类画像生成，每条选题都附带数据证据。",
          }));
          if (!d.profile_set) {
            wrap.appendChild(UI.el("div", {
              class: "tp-notice",
              text: d.profile_inferred
                ? "当前垂类画像是根据对标账号推断的，补全画像后推荐会更准。"
                : "尚未设置垂类画像，推荐暂未考虑你的垂类。可在「对标雷达」补充对标账号，画像会自动推断。",
            }));
          }
          if (!cards.length) { wrap.appendChild(emptyBox("今天还没有生成选题，稍后再来看看。")); return; }

          var grid = UI.el("div", { class: "tp-grid" });
          wrap.appendChild(grid);
          cards.forEach(function (c) {
            grid.appendChild(topicCard(c));
          });
        });
      }

      function topicCard(c) {
        var ev = c.evidence || {};
        var evText = "";
        var type = ev.type || "";
        if (type === "peer") evText = "对标 @" + (ev.refTitle || "") + " · " + (ev.metricLabel || "") + " " + (ev.metricValue || "");
        else if (type === "hot") evText = (ev.refTitle || "热榜话题") + " · " + (ev.metricValue || "");
        else if (type === "gap") evText = (ev.refTitle || "垂类内暂无同题材");
        else evText = ev.refTitle || "暂无证据说明";

        var children = [
          UI.el("div", { class: "tp-card-head" }, [
            UI.el("span", { class: "tp-badge", text: c.category || "未分类" }),
            UI.el("span", { class: "tp-score", text: "潜力 " + (c.score != null ? c.score : "—") }),
          ]),
          UI.el("div", { class: "tp-title", text: c.title || "" }),
        ];
        if (c.hook) children.push(UI.el("div", { class: "tp-hook", text: "钩子：" + c.hook }));
        children.push(UI.el("div", { class: "tp-evidence", text: "📌 " + evText }));
        if (c.niche_fit != null && c.niche_fit > 0) {
          children.push(UI.el("div", {
            class: "tp-niche",
            text: "垂类匹配 " + c.niche_fit + (c.niche_reason ? " · " + c.niche_reason : ""),
          }));
        }
        if (c.tags && c.tags.length) {
          children.push(UI.el("div", { class: "tp-tags", text: c.tags.map(function (t) { return "#" + t; }).join(" ") }));
        }

        var actions = UI.el("div", { class: "tp-actions" });
        // 「去创作」= 采纳（闭环第一环）+ 复制标题。以前只复制标题，
        // 服务端无从区分"推荐了没人做"和"做了没效果"，权重也就没法按真实效果调。
        actions.appendChild(copyBtn("🚀 去创作", c.title || "", function () {
          if (!c.id) return;
          call("POST", "/api/v2/topics/outcome/adopt", {
            TopicId: c.id,
            Title: c.title || "",
            EvidenceType: (c.evidence && c.evidence.type) || "",
            Source: "",
            Score: Number(c.score) || 0,
            NicheFit: c.niche_fit == null ? null : Number(c.niche_fit),
            Signals: c.signals || null,
          }).then(function () {
            // 采纳即入库，稍后可在「选题效果」里标记发布与回填。
          }).catch(function (e) {
            // 采纳失败不该挡住用户去创作，只记日志
            if (window.console) console.warn("adopt 失败", e);
          });
        }));
        var skip = UI.el("button", { class: "btn btn-ghost", text: "不感兴趣" });
        skip.addEventListener("click", function () {
          skip.disabled = true;
          call("POST", "/api/v2/topics/feedback", { TopicTitle: c.title || "", Reason: "不感兴趣" })
            .then(function () { skip.textContent = "已记录"; })
            .catch(function () { skip.disabled = false; skip.textContent = "不感兴趣"; });
        });
        actions.appendChild(skip);
        children.push(actions);

        return UI.el("div", { class: "tp-card" }, children);
      }

      // ---------- 对标雷达 ----------
      function renderRadar(root) {
        var tip = UI.el("div", { class: "tp-hint", text: "添加同垂类的对标账号，系统定时采样数据；出现爆款（超基线 3 倍）时在这里提醒你。" });
        root.appendChild(tip);

        var alertBox = UI.el("div");
        root.appendChild(alertBox);

        var listCard = UI.el("div", { class: "card" }, [
          UI.el("h3", { text: "对标账号" }),
          UI.el("div", { id: "radar-list" }),
        ]);
        root.appendChild(listCard);

        var sel = UI.el("select", { class: "input" }, [
          UI.el("option", { value: "bilibili", text: "B站" }),
          UI.el("option", { value: "xiaohongshu", text: "小红书" }),
          UI.el("option", { value: "douyin", text: "抖音" }),
        ]);
        var input = UI.el("input", { class: "input", placeholder: "对标账号主页 URL" });
        input.style.flex = "1";
        var addBtn = UI.el("button", { class: "btn", text: "＋ 添加账号" });
        var sampleBtn = UI.el("button", { class: "btn btn-ghost", text: "立即采样" });
        var addRow = UI.el("div", { class: "row" }, [sel, input, addBtn, sampleBtn]);
        listCard.appendChild(addRow);
        var addMsg = UI.el("div", { class: "tp-hint" });
        listCard.appendChild(addMsg);

        function renderList(accounts, alerts) {
          var list = listCard.querySelector("#radar-list");
          UI.clear(list);
          if (!accounts || !accounts.length) {
            list.appendChild(emptyBox("还没有对标账号。粘贴主页 URL 添加一个，后台会自动采样。"));
          }
          (accounts || []).forEach(function (a) {
            var h = HEALTH[a.health] || null;
            var meta = "基线 " + fmtN(a.baseline_plays) + " 播放 · 已采样 " + (a.samples || 0) + " 次 · 最近 " + fmtTime(a.last);
            var right = UI.el("div", { class: "tp-acct-right" }, [
              UI.el("button", { class: "btn btn-ghost", text: "移除" }),
            ]);
            right.querySelector(".btn-ghost").addEventListener("click", function () {
              removeAccount(a.id, right.querySelector(".btn-ghost"));
            });
            var row = UI.el("div", { class: "tp-acct" }, [
              UI.el("div", {}, [
                UI.el("div", { class: "tp-acct-name", text: "🪪 " + (a.name || "未命名") + "（" + (a.platform || "") + "）" }),
                UI.el("div", { class: "tp-acct-meta", text: meta }),
                h ? UI.el("div", { class: "tp-health " + h.cls, text: h.text, title: h.tip || "" }) : null,
              ]),
              right,
            ]);
            list.appendChild(row);
          });

          UI.clear(alertBox);
          (alerts || []).forEach(function (al) {
            alertBox.appendChild(
              UI.el("div", { class: "tp-alert" }, [
                UI.el("div", { class: "tp-alert-head" }, [
                  UI.el("span", { text: "🔥 爆款提醒 · " + (al.account || "") + (al.kind === "revisit" ? "（回访检出）" : "") }),
                  UI.el("span", { class: "tp-mult", text: al.multiplier || "" }),
                ]),
                UI.el("div", { class: "tp-alert-title", text: al.title || "" }),
                UI.el("div", { class: "tp-alert-meta", text: al.revisit_note || al.detail || "" }),
                (function () {
                  var row = UI.el("div", { class: "tp-actions" });
                  if (al.title) row.appendChild(copyBtn("以此创作", al.title));
                  var ig = UI.el("button", { class: "btn btn-ghost", text: "忽略" });
                  ig.addEventListener("click", function () {
                    ig.disabled = true;
                    call("POST", "/api/v2/topics/radar/alerts/" + al.id + "/dismiss", {})
                      .then(function () { ig.textContent = "已忽略"; refresh(); })
                      .catch(function (e) { ig.disabled = false; ig.textContent = "忽略"; UI.showError(alertBox, errText(e)); });
                  });
                  row.appendChild(ig);
                  return row;
                })(),
              ])
            );
          });
        }

        function refresh() {
          load(listCard.querySelector("#radar-list"), "GET", "/api/v2/topics/radar/accounts", null, function (d) {
            renderList(d.accounts || [], d.alerts || []);
          });
        }

        function removeAccount(id, btn) {
          if (id == null) return;
          btn.disabled = true;
          call("DELETE", "/api/v2/topics/radar/accounts/" + id).then(function () {
            refresh();
          }).catch(function (e) {
            btn.disabled = false;
            UI.showError(listCard.querySelector("#radar-list"), errText(e));
          });
        }

        addBtn.addEventListener("click", function () {
          var url = input.value.trim();
          if (!url) { addMsg.textContent = "请填写对标账号主页 URL"; return; }
          addMsg.textContent = "添加中…";
          addBtn.disabled = true;
          call("POST", "/api/v2/topics/radar/accounts", { platform: sel.value, url: url }).then(function (r) {
            addBtn.disabled = false;
            if (!r || !r.ok) { addMsg.textContent = (r && r.message) || "添加失败"; return; }
            input.value = "";
            addMsg.textContent = "已添加：" + ((r.data && r.data.name) || "新账号");
            refresh();
          }).catch(function (e) {
            addBtn.disabled = false;
            addMsg.textContent = errText(e);
          });
        });

        sampleBtn.addEventListener("click", function () {
          sampleBtn.disabled = true;
          sampleBtn.textContent = "采样中…";
          call("POST", "/api/v2/topics/radar/sample", {}).then(function (r) {
            sampleBtn.disabled = false;
            sampleBtn.textContent = "立即采样";
            if (!r || !r.ok) { addMsg.textContent = (r && r.message) || "采样失败"; return; }
            var d = r.data || {};
            addMsg.textContent = "采样完成：覆盖 " + (d.accounts || 0) + " 个账号，新增 " + (d.added || 0) + " 条数据";
            refresh();
          }).catch(function (e) {
            sampleBtn.disabled = false;
            sampleBtn.textContent = "立即采样";
            addMsg.textContent = errText(e);
          });
        });

        refresh();
      }

      // ---------- 热榜趋势 ----------
      function renderTrends(root) {
        // 某个源被风控时会连续失败并被退避跳过，表现只是"这个平台的榜单是空的"。
        // 把健康状态摆出来，用户才知道是源挂了而不是真的没有热榜。
        var healthBox = UI.el("div");
        root.appendChild(healthBox);
        loadHealth(healthBox);

        var wrap = UI.el("div");
        root.appendChild(wrap);
        load(wrap, "GET", "/api/v2/topics/trends", null, function (d) {
          UI.clear(wrap);
          var topics = d.topics || [];
          wrap.appendChild(UI.el("div", {
            class: "tp-hint",
            text: "每小时采样一次热榜，累计形成热度曲线。上升期的话题建议 24 小时内跟进。",
          }));
          if (d.degraded) {
            wrap.appendChild(UI.el("div", { class: "tp-notice", text: "采样已中断较久，趋势阶段暂不可信，下面是最近一次采到的榜单。" }));
          } else if (d.stale) {
            wrap.appendChild(UI.el("div", { class: "tp-notice", text: "榜单更新有延迟（距今 " + d.stale_minutes + " 分钟），阶段判定可能滞后。" }));
          }
          if (d.sampled_at) {
            wrap.appendChild(UI.el("div", { class: "tp-hint", text: "最近采样：" + fmtTime(d.sampled_at) }));
          }
          if (!topics.length) { wrap.appendChild(emptyBox("还没有热榜数据，等待后台采集。")); return; }

          topics.forEach(function (t) {
            var st = STAGE[t.stage] || STAGE.unknown;
            var heat = t.heat != null && t.heat !== "" ? String(t.heat) : fmtN(t.heatValue);
            var row = UI.el("div", { class: "tp-trend" }, [
              UI.el("span", { class: "tp-rank", text: "#" + (t.rank != null ? t.rank : "—") }),
              UI.el("div", { class: "tp-trend-main" }, [
                UI.el("div", { class: "tp-trend-title", text: t.title || "" }),
                UI.el("div", { class: "tp-trend-meta", text: (t.source || "") + " · 热度 " + heat }),
              ]),
              UI.el("span", { class: "tp-stage " + st.cls, text: st.text, title: st.tip }),
              copyBtn("以此创作", t.title || ""),
            ]);
            wrap.appendChild(row);
          });
        });
      }

      function loadHealth(box) {
        call("GET", "/api/v2/topics/health").then(function (r) {
          if (!r || !r.ok) return;
          var srcs = (r.data && r.data.sources) || [];
          if (!srcs.length) return;
          UI.clear(box);
          var row = UI.el("div", { class: "tp-actions" });
          srcs.forEach(function (s) {
            var label = UI.platformName(s.source) + (s.ok ? " 正常" : (s.cooling_down ? " 冷却中" : " 异常"));
            var tip = s.ok
              ? "最近一次成功：" + (s.last_success || "—")
              : "连续失败 " + (s.consecutive_failures || 0) + " 次" +
                (s.last_error ? "：" + s.last_error : "") +
                (s.skip_until ? "，冷却至 " + s.skip_until : "");
            row.appendChild(UI.el("span", {
              class: "tp-health " + (s.ok ? "tp-health-ok" : "tp-health-bad"),
              text: label,
              title: tip,
            }));
          });
          box.appendChild(row);
        }).catch(function () { });
      }

      // ---------- 垂类画像 ----------
      // 画像参与选题的垂类匹配度评分。后端 GET 会同时给 available_platforms（白名单）
      // 与 inferred_platforms（按对标账号推断的主阵地），没填画像时据此提示用户补全。
      function renderProfile(root) {
        var wrap = UI.el("div");
        root.appendChild(wrap);
        load(wrap, "GET", "/api/v2/topics/profile", null, function (d) {
          UI.clear(wrap);
          wrap.appendChild(UI.el("div", {
            class: "tp-hint",
            text: "垂类画像决定选题与你的匹配程度。不填也能用——系统会根据对标账号自动推断一个，下面会标出来。",
          }));
          if (!d.has_profile && d.effective_inferred && (d.inferred_platforms || []).length) {
            wrap.appendChild(UI.el("div", {
              class: "tp-notice",
              text: "当前用的是推断画像（主阵地：" + d.inferred_platforms.map(UI.platformName).join("、") +
                "）。补全下面的内容后，垂类匹配分会更准。",
            }));
          }
          if (d.has_profile) {
            wrap.appendChild(UI.el("div", { class: "tp-hint", text: "已保存画像，下面显示的是当前值。" }));
          }

          var boxes = {};
          var platRow = UI.el("div", { class: "tp-actions" });
          (d.available_platforms || []).forEach(function (p) {
            var cb = UI.el("input", { type: "checkbox" });
            cb.checked = (d.platforms || []).indexOf(p) >= 0;
            boxes[p] = cb;
            platRow.appendChild(UI.el("label", { class: "tp-plat" }, [cb, " " + UI.platformName(p)]));
          });
          if (!(d.available_platforms || []).length) {
            platRow.appendChild(UI.el("span", { class: "tp-hint", text: "后端未返回可选平台" }));
          }

          var inc = UI.el("input", { class: "input", placeholder: "想多看到的关键词，逗号分隔，如：AI 工具, 效率" });
          inc.value = (d.include_keywords || []).join(", ");
          var exc = UI.el("input", { class: "input", placeholder: "不想看到的关键词，逗号分隔，如：八卦, 明星" });
          exc.value = (d.exclude_keywords || []).join(", ");
          var aud = UI.el("textarea", { class: "input", placeholder: "目标受众，如：25-35 岁想提效的职场人" });
          aud.value = d.audience || "";

          var msg = UI.el("div", { class: "tp-hint" });
          var save = UI.el("button", { class: "btn", text: "保存画像" });
          save.addEventListener("click", function () {
            var picked = Object.keys(boxes).filter(function (p) { return boxes[p].checked; });
            save.disabled = true;
            msg.textContent = "保存中…";
            call("PUT", "/api/v2/topics/profile", {
              Platforms: picked,
              IncludeKeywords: splitKeywords(inc.value),
              ExcludeKeywords: splitKeywords(exc.value),
              Audience: aud.value.trim(),
            }).then(function (r) {
              save.disabled = false;
              if (!r || !r.ok) { msg.textContent = (r && r.message) || "保存失败"; return; }
              msg.textContent = "✓ 已保存，下次生成选题时生效。";
            }).catch(function (e) {
              save.disabled = false;
              msg.textContent = errText(e);
            });
          });

          wrap.appendChild(UI.el("div", { class: "card" }, [
            UI.el("h3", { text: "主阵地平台" }),
            platRow,
            UI.el("h3", { text: "想多看到的关键词" }),
            inc,
            UI.el("h3", { text: "不想看到的关键词" }),
            exc,
            UI.el("h3", { text: "目标受众" }),
            aud,
            UI.el("div", { class: "row" }, [save]),
            msg,
          ]));
        });
      }

      function splitKeywords(s) {
        return String(s || "").split(/[,，、\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      }

      // ---------- 选题效果（采纳 → 发布 → 回测）----------
      // outcome/stats 一次给全：汇总统计 + rows（每条选题的 stage 由服务端判定：
      // adopted / published / measured）。以服务端为准，不在本地另存一份状态。

      function renderOutcome(root) {
        UI.clear(root);              // 标记发布/回填后会整体重绘，不清会越堆越多
        var wrap = UI.el("div");
        root.appendChild(wrap);
        load(wrap, "GET", "/api/v2/topics/outcome/stats", null, function (d) {
          UI.clear(wrap);
          wrap.appendChild(UI.el("div", {
            class: "tp-hint",
            text: "选题的推荐权重会按你的真实效果自动调整：采纳得多、发出去效果好，这类选题以后会排得更靠前。",
          }));

          var pct = function (v) { return (Number(v) || 0) * 100; };
          var lines = [
            "采纳 " + (d.adopted || 0) + " 条 · 已发布 " + (d.published || 0) + " 条 · 已回填效果 " + (d.measured || 0) + " 条",
            "采纳率 " + pct(d.adoption_rate).toFixed(1) + "% · 命中率 " + pct(d.hit_rate).toFixed(1) + "%",
          ];
          var w = d.current_weights || {};
          lines.push("当前权重：证据 " + w.evidence + " · 热度趋势 " + w.momentum + " · 热度 " + w.heat + " · 垂类 " + w.niche);
          wrap.appendChild(UI.el("div", { class: "card" }, [
            UI.el("h3", { text: "效果统计" }),
            UI.el("div", { class: "tp-hint", text: lines.join("\n") }),
            d.baseline_ready
              ? UI.el("div", { class: "tp-hint", text: "你的平均播放基线：" + fmtN(d.baseline_views) + "，超过这个数算命中。" })
              : UI.el("div", { class: "tp-notice", text: "样本还不够（需要更多回填数据），暂时用默认基线判定命中。" }),
            tuningNote(d.tuning),
          ]));

          var rows = d.rows || [];
          var box = UI.el("div", { class: "card" }, [UI.el("h3", { text: "我采纳过的选题" })]);
          if (!rows.length) {
            box.appendChild(emptyBox("还没有记录。在「今日选题」点「去创作」采纳一条后，这里就能标记发布与回填效果。"));
          }
          rows.forEach(function (r) {
            box.appendChild(outcomeRow(r, function () { renderOutcome(root); }));
          });
          wrap.appendChild(box);
        });
      }

      function tuningNote(t) {
        if (!t) return UI.el("div");
        var head = t.applied
          ? "✓ 已按你的真实数据调整推荐权重"
          : "权重暂未调整（" + (t.reason || "样本不足") + "）";
        var kids = [UI.el("div", { class: "tp-hint", text: head })];
        (t.notes || []).forEach(function (n) {
          kids.push(UI.el("div", { class: "tp-evidence", text: n.signal + "：" + (n.note || n.detail || n.message || "") }));
        });
        return UI.el("div", {}, kids);
      }

      // 一条已采纳选题。stage 由服务端给：adopted → published → measured。
      function outcomeRow(r, onChange) {
        var STAGE_TEXT = { adopted: "已采纳，去发布", published: "已发布，待回填效果", measured: "已回填效果" };
        var meta = (STAGE_TEXT[r.stage] || "已采纳") +
          (r.publish_platform ? "（" + UI.platformName(r.publish_platform) + "）" : "");
        if (r.stage === "measured") {
          meta += " · 播放 " + fmtN(r.views) + " / 赞 " + fmtN(r.likes) + " / 评 " + fmtN(r.comments);
          if (r.multiplier) meta += " · " + r.multiplier + "× 基线";
        }
        var canMeasure = r.stage !== "measured";
        var row = UI.el("div", { class: "tp-acct" }, [
          UI.el("div", {}, [
            UI.el("div", { class: "tp-acct-name", text: r.title || "(无标题)" }),
            UI.el("div", { class: "tp-acct-meta", text: meta }),
            r.verdict_text ? UI.el("div", {
              class: "tp-health " + (r.verdict === "hit" ? "tp-health-ok" : (r.verdict === "weak" ? "tp-health-bad" : "tp-health-wait")),
              text: r.verdict_text,
            }) : null,
          ]),
          UI.el("div", { class: "tp-acct-right" }, [
            UI.el("button", { class: "btn btn-ghost", text: canMeasure ? (r.stage === "adopted" ? "标记发布" : "回填效果") : "重新回填" }),
          ]),
        ]);
        var btn = row.querySelector(".btn-ghost");
        var form = UI.el("div", { class: "tp-actions" });
        form.style.display = "none";
        btn.addEventListener("click", function () {
          var show = form.style.display === "none";
          form.style.display = show ? "flex" : "none";
          if (show) buildForm();
        });

        function buildForm() {
          UI.clear(form);
          if (r.stage === "adopted") {
            var sel = UI.el("select", { class: "input" }, [
              UI.el("option", { value: "douyin", text: "抖音" }),
              UI.el("option", { value: "xiaohongshu", text: "小红书" }),
              UI.el("option", { value: "bilibili", text: "B站" }),
              UI.el("option", { value: "toutiao", text: "今日头条" }),
              UI.el("option", { value: "weibo", text: "微博" }),
            ]);
            var url = UI.el("input", { class: "input", placeholder: "作品链接（可选）" });
            var ok = UI.el("button", { class: "btn", text: "提交" });
            ok.addEventListener("click", function () {
              ok.disabled = true;
              call("POST", "/api/v2/topics/outcome/publish", { TopicId: r.topic_id, Platform: sel.value, Url: url.value.trim() })
                .then(function (res) {
                  ok.disabled = false;
                  if (!res || !res.ok) { UI.showError(form, (res && res.message) || "标记失败"); return; }
                  onChange();
                }).catch(function (e) { ok.disabled = false; UI.showError(form, errText(e)); });
            });
            form.appendChild(sel); form.appendChild(url); form.appendChild(ok);
          } else {
            var v = UI.el("input", { class: "input", placeholder: "播放量" });
            v.value = r.views || "";
            var l = UI.el("input", { class: "input", placeholder: "点赞" });
            l.value = r.likes || "";
            var c = UI.el("input", { class: "input", placeholder: "评论" });
            c.value = r.comments || "";
            var ok2 = UI.el("button", { class: "btn", text: "提交" });
            ok2.addEventListener("click", function () {
              ok2.disabled = true;
              call("POST", "/api/v2/topics/outcome/metrics", {
                TopicId: r.topic_id,
                Views: Number(v.value) || 0,
                Likes: Number(l.value) || 0,
                Comments: Number(c.value) || 0,
              }).then(function (res) {
                ok2.disabled = false;
                if (!res || !res.ok) { UI.showError(form, (res && res.message) || "回填失败"); return; }
                onChange();
              }).catch(function (e) { ok2.disabled = false; UI.showError(form, errText(e)); });
            });
            form.appendChild(v); form.appendChild(l); form.appendChild(c); form.appendChild(ok2);
          }
        }

        return UI.el("div", {}, [row, form]);
      }

      renderTab("daily");
    },
  };
})();
