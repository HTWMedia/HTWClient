(function () {
  var Skills = (window.Skills = window.Skills || {});

  /*
   * 草稿体检（本地 · 免 AuthKey）。
   *
   * 这是给"刚下载、还没有 AuthKey"的人用的第一个面板：选一条剪映草稿 →
   * 本机解密 + 统计 → 告诉他这条草稿能不能出片、缺什么。
   *
   * 三条硬约束：
   *   1) 全程不发请求 —— 这里一次 API.call 都没有，所以没有 Key 也能用；
   *   2) 失败文案直接用主进程返回的中文原因（"多个草稿""没有找到 draft_content.json"），
   *      不要统一糊成"体检失败"，那句话对用户没有任何下一步；
   *   3) 结论必须落到"能不能出片"上，不能只罗列参数。
   */

  // 主进程通道：浏览器直开 / 冒烟替身里没有 htw，面板要退化成"只读说明"而不是报错。
  function bridge() {
    var h = (typeof window !== "undefined" && window.htw) || null;
    if (!h || typeof h.draftInspect !== "function") return null;
    return h;
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }

  function formatClock(ms) {
    var d = new Date(Number(ms));
    if (!ms || isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function levelClass(level) {
    if (level === "error") return "dc-error";
    if (level === "warn") return "dc-warn";
    if (level === "ok") return "dc-ok";
    return "dc-info";
  }

  Skills.draftcheck = {
    mount: function (panel) {
      var UI = window.UI;
      UI.clear(panel);

      var h = bridge();
      // 当前体检成功的目录：导出按钮要用它，所以必须在 renderSummary 之前声明。
      var state = { folder: "" };

      function row(k, v, extra) {
        return UI.el("div", { class: "dc-row" }, [
          UI.el("div", { class: "dc-k", text: k }),
          UI.el("div", { class: "dc-v" }, [UI.el("span", { text: v })].concat(extra || [])),
        ]);
      }

      function chip(text) {
        return UI.el("span", { class: "meta-tag", text: text });
      }

      // ---- 结果区 ----
      var result = UI.el("div", { id: "draftcheck-result" });

      function renderEmpty() {
        UI.clear(result);
        UI.mount(result, UI.el("div", { class: "hint", text: "还没有体检任何草稿。选一个文件夹，几秒内出结论。" }));
      }

      function renderError(msg) {
        UI.clear(result);
        UI.mount(result, UI.el("div", { class: "error-box" }, [
          UI.el("strong", { text: "这条草稿没能体检" }),
          UI.el("div", { class: "error-detail", text: String(msg || "") }),
        ]));
      }

      function renderSummary(info) {
        var s = info.summary || {};
        var media = s.media || {};
        var folder = s.folder || null;
        var canvas = s.canvas || {};

        var box = UI.el("div", { class: "dc-result" }, [
          UI.el("div", { class: "dc-verdict " + levelClass((s.verdict || {}).level) }, [
            UI.el("i", { class: "fa-solid " + ((s.verdict || {}).level === "ok" ? "fa-circle-check" : "fa-triangle-exclamation") }),
            " " + ((s.verdict || {}).text || ""),
          ]),
        ]);

        // 基本信息
        var infoRows = [
          row("草稿名", s.name || "未命名"),
          row("时长", s.durationText || "0 秒"),
          row("画布", (canvas.width || 0) + " × " + (canvas.height || 0)
            + (canvas.ratio ? "（" + canvas.ratio + "）" : "")),
        ];
        if (s.fps) infoRows.push(row("帧率", s.fps + " fps"));
        infoRows.push(row("草稿文件", info.fileName + "（" + (info.encrypted ? "加密，已在本机解密" : "明文") + "）"));
        if (s.updatedAt) infoRows.push(row("最后修改", formatClock(s.updatedAt)));
        if (folder) {
          infoRows.push(row("目录体积", formatBytes(folder.bytes) + " · " + folder.files + " 个文件"
            + (folder.partial ? "（超过统计上限，只算了前 2 万个）" : "")));
        }
        box.appendChild(UI.el("div", { class: "dc-section-title", text: "这条草稿" }));
        infoRows.forEach(function (n) { box.appendChild(n); });

        // 轨道
        var byLabel = {};
        (s.tracks || []).forEach(function (t) {
          var b = byLabel[t.label] = byLabel[t.label] || { tracks: 0, segments: 0 };
          b.tracks++;
          b.segments += Number(t.segments) || 0;
        });
        var trackChips = Object.keys(byLabel).map(function (label) {
          var b = byLabel[label];
          return chip(label + " ×" + b.tracks + "（" + b.segments + " 段）");
        });
        if (!trackChips.length) trackChips = [UI.el("span", { class: "hint", text: "没有任何轨道" })];
        box.appendChild(UI.el("div", { class: "dc-section-title", text: "轨道 · " + (s.trackCount || 0) + " 条" }));
        box.appendChild(UI.el("div", { class: "dc-chips" }, trackChips));

        // 素材
        var matChips = (s.materialCounts || []).map(function (m) { return chip(m.label + " " + m.count); });
        if (s.textChars != null) matChips.push(chip("文案 " + s.textChars + " 字"));
        box.appendChild(UI.el("div", { class: "dc-section-title", text: "素材引用" }));
        box.appendChild(UI.el("div", { class: "dc-chips" }, matChips.length ? matChips : [UI.el("span", { class: "hint", text: "没有引用素材" })]));
        box.appendChild(UI.el("div", { class: "dc-row" }, [
          UI.el("div", { class: "dc-k", text: "本机核对" }),
          UI.el("div", { class: "dc-v" }, [
            UI.el("span", {
              class: media.missingCount ? "dc-bad" : "dc-good",
              text: media.missingCount
                ? "引用的 " + (media.referenced || 0) + " 个里缺 " + media.missingCount + " 个"
                : "引用的 " + (media.referenced || 0) + " 个素材都在本机",
            }),
          ]),
        ]));
        if (media.missingCount) {
          var miss = UI.el("div", { class: "dc-missing" });
          (media.missing || []).forEach(function (m) {
            miss.appendChild(UI.el("div", { class: "dc-missing-item", text: "· " + m.kind + "：" + m.name }));
          });
          if (media.missingCount > (media.missing || []).length) {
            miss.appendChild(UI.el("div", {
              class: "dc-missing-item",
              text: "… 还有 " + (media.missingCount - (media.missing || []).length) + " 个，未列出",
            }));
          }
          box.appendChild(miss);
        }

        // 体检项
        var checks = s.checks || [];
        if (checks.length) {
          box.appendChild(UI.el("div", { class: "dc-section-title", text: "体检项" }));
          var list = UI.el("div", { class: "dc-checks" });
          checks.forEach(function (c) {
            list.appendChild(UI.el("div", { class: "dc-check " + levelClass(c.level) }, [
              UI.el("i", {
                class: "fa-solid " + (c.level === "ok" ? "fa-circle-check"
                  : (c.level === "info" ? "fa-circle-info" : "fa-triangle-exclamation")),
              }),
              UI.el("span", { text: " " + c.text }),
            ]));
          });
          box.appendChild(list);
        }

        // 下一步
        var actions = UI.el("div", { class: "dc-actions" });
        var exportBtn = UI.el("button", { class: "btn", type: "button", id: "draftcheck-export", text: "导出解密后的 JSON" });
        if (!info.encrypted) {
          exportBtn.disabled = true;
          exportBtn.textContent = "已是明文，无需导出";
        }
        var goExport = UI.el("button", { class: "btn btn-ghost", type: "button", id: "draftcheck-goto-edit", text: "去导出成片 →" });
        actions.appendChild(exportBtn);
        actions.appendChild(goExport);
        box.appendChild(actions);

        var exportOut = UI.el("div", { class: "hint", id: "draftcheck-export-out" });
        box.appendChild(exportOut);

        UI.clear(result);
        UI.mount(result, box);

        exportBtn.addEventListener("click", function () {
          UI.withLoading(exportBtn, async function () {
            var r = null;
            try { r = await h.draftExport(state.folder); } catch (e) { r = { ok: false, error: e && e.message }; }
            if (!r || !r.ok) {
              exportOut.textContent = "导出失败：" + ((r && r.error) || "未知原因");
              return;
            }
            exportOut.textContent = "已写出：" + r.path + "（" + formatBytes(r.bytes) + "，原草稿没有改动）";
          });
        });

        goExport.addEventListener("click", function () {
          var nav = document.querySelector('.nav-item[data-skill="edit"]');
          if (nav && typeof nav.click === "function") nav.click();
        });
      }

      // ---- 顶部操作区 ----
      var pathInput = UI.el("input", {
        type: "text",
        id: "draftcheck-path",
        placeholder: "C:\\Users\\你\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft\\我的草稿",
      });
      var pickBtn = UI.el("button", { class: "btn", type: "button", id: "draftcheck-pick", text: "选择文件夹…" });
      var runBtn = UI.el("button", { class: "btn secondary", type: "button", id: "draftcheck-run", text: "开始体检" });
      var note = UI.el("div", { class: "hint", id: "draftcheck-note" });

      var card = UI.el("div", { class: "card" }, [
        UI.el("h3", {}, [UI.el("i", { class: "fa-solid fa-stethoscope" }), " 选一条剪映草稿"]),
        UI.el("div", { class: "row" }, [pathInput, pickBtn, runBtn]),
        note,
        result,
      ]);

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "草稿体检 Draft Check" }),
        // 一句话说明由 app.js 的 SKILL_DESCRIPTIONS 统一渲染（切面板时自动出现），
        // 这里不再重复一遍"本地执行/不要 Key"——两行同义话叠在一起只会更乱。
        card,
      ]));

      if (!h) {
        // 浏览器直开 / 非桌面环境：说明真实原因，别留一个点了没反应的按钮。
        pickBtn.disabled = true;
        runBtn.disabled = true;
        note.textContent = "当前环境没有桌面客户端的本地通道（可能是浏览器直开）。请下载 Windows 客户端使用草稿体检。";
        renderEmpty();
        return;
      }

      note.textContent = "怎么找路径：剪映里右键草稿 →「打开草稿文件夹」，复制地址栏里的路径。";
      renderEmpty();

      pickBtn.addEventListener("click", function () {
        UI.withLoading(pickBtn, async function () {
          var picked = "";
          try { picked = await h.draftPickFolder(); } catch (e) { picked = ""; }
          if (!picked) return; // 用户取消：什么都不做，不要报错
          pathInput.value = picked;
          runBtn.click();
        });
      });

      runBtn.addEventListener("click", function () {
        UI.withLoading(runBtn, async function () {
          var folder = String(pathInput.value || "").trim();
          if (!folder) { renderError("请先选择草稿文件夹（或把路径粘到输入框里）。"); return; }
          var info = null;
          try { info = await h.draftInspect(folder); } catch (e) {
            info = { ok: false, error: (e && e.message) || String(e) };
          }
          if (!info || !info.ok) { renderError((info && info.error) || "未知原因"); return; }
          state.folder = folder;
          renderSummary(info);
          // 记住上次体检的目录：下次打开直接点"开始体检"就行（路径不是秘密，不涉及登录态）。
          try { h.saveJson("draftcheck", { folder: folder, at: Date.now() }); } catch (e) { /* 存不下也不影响本次 */ }
        });
      });

      // 回填上次的目录：只填不跑 —— 挂载时自动读盘会让启动变慢，也不是用户此刻的意图。
      if (typeof h.loadJson === "function") {
        Promise.resolve(h.loadJson("draftcheck")).then(function (j) {
          var last = j && typeof j.folder === "string" ? j.folder : "";
          if (last && !pathInput.value) pathInput.value = last;
        }).catch(function () { /* 读不到就当没有 */ });
      }
    },
  };
})();
