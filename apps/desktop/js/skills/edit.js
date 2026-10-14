(function () {
  var Skills = (window.Skills = window.Skills || {});

  // 配音音色与 web 端「媒体编辑 - 视频粗剪」同一套。
  // 以前桌面端这里是个「配音文案」输入框，填的内容被当成 voice 传给后端 —— 后端只认音色 id，
  // 于是无论填什么都是默认音色，用户以为在写解说词。
  var VOICES = [
    ["zh_female_qinglengnv", "清冷女声"],
    ["ICL_zh_female_jilupianxq2", "纪录片女声"],
    ["ICL_zh_male_jilupianjmh", "纪录片男声"],
    ["zh_female_aoyunliuyuxi", "奥运刘雨熙"],
    ["ICL_zh_female_basidigua2", "活泼女声"],
    ["ICL_zh_male_momodianying", "电影男声"],
    ["zh_female_luoliwm_emo_v2_mars_bigtts", "萝莉女声"],
    ["zh_male_yourougongzi_emo_v2_mars_bigtts", "温柔男声"],
    ["BV009_DPE_streaming", "标准男声"],
    ["BV104_streaming", "标准女声"],
  ];

  var PACK_EXTS = [".mp4", ".mov", ".m4v"];

  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }

  Skills.edit = {
    mount: function (panel) {
      var UI = window.UI;
      const API = window.HTWApi;
      UI.clear(panel);

      async function readFiles(wrap) {
        const arr = [];
        const list = wrap.input.files;
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          const buf = await f.arrayBuffer();
          arr.push({ name: f.name, buffer: buf });
        }
        return arr;
      }

      function extOf(name) {
        const dot = String(name || "").lastIndexOf(".");
        return dot < 0 ? "" : String(name).substring(dot).toLowerCase();
      }

      function progressNode(text, pct) {
        const inner = UI.el("div", { style: "height:100%;background:#3b82f6;width:" + pct + "%" });
        const bar = UI.el("div", { style: "height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin:6px 0" }, [inner]);
        return UI.el("div", {}, [
          UI.el("div", { class: "detail-progress", text: text }),
          bar,
          UI.el("div", { class: "detail-progress", text: "进度 " + pct + "%" }),
        ]);
      }

      // 上传阶段：api.js 的 onProgress 只给字节数，百分比自己算
      function renderUpload(region, p) {
        const total = (p && p.total) || 0;
        const loaded = (p && p.loaded) || 0;
        const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        const mb = (loaded / 1048576).toFixed(1) + "MB / " + (total / 1048576).toFixed(1) + "MB";
        UI.clear(region);
        UI.mount(region, progressNode("正在上传文件… " + mb, pct));
      }

      function renderTask(region, d) {
        const pct = parseInt(d.progress, 10) || 0;
        UI.clear(region);
        UI.mount(region, progressNode(d.currentStep || "处理中…", pct));
      }

      async function pollEdit(taskId, region) {
        return API.pollTask(taskId, {
          interval: 3000,
          // 智能包装全程 3-8 分钟（视频越长越久），10 分钟的上限会在成片前就超时
          timeout: 1800000,
          fetcher: async function (id) {
            const r = await API.call("GET", "/api/v2/edit/status/" + encodeURIComponent(id));
            if (!r.ok) return r;
            const d = r.data || {};
            if (d.status === "completed") return { ok: true, data: { status: "done", result: d } };
            if (d.status === "failed" || d.error) return { ok: true, data: { status: "failed", errCode: d.error || "EDIT_FAILED", errMsg: d.error || "处理失败" } };
            renderTask(region, d);
            return { ok: true, data: { status: "processing", progress: d.progress } };
          },
        });
      }

      // 成片下载链接由服务端签过凭证，直接用；与营销/短剧面板同一套呈现方式
      function showVideo(region, url, title) {
        const full = url.charAt(0) === "/" ? API.base + url : url;
        UI.clear(region);
        UI.mount(region, UI.el("div", {}, [
          UI.el("div", { class: "result-area-text", text: title }),
          UI.el("video", { controls: true, style: "width:100%;max-width:480px;border-radius:8px;background:#000", src: full }),
          UI.el("a", { class: "btn", href: full, download: "htw_edit_output.mp4", text: "下载成片" }),
        ]));
      }

      function submitAndPoll(files, path, fields, fileField, region) {
        return API.upload("POST", path, files, fields, function (p) { renderUpload(region, p); }, fileField);
      }

      async function runTask(files, path, fields, fileField, region, title) {
        const up = await submitAndPoll(files, path, fields, fileField, region);
        if (!up.ok) { UI.showError(region, formatErr(up)); return; }
        const taskId = up.taskId || (up.data && up.data.taskId);
        if (!taskId) { UI.showError(region, "未返回 taskId: " + JSON.stringify(up.data)); return; }
        // 标题沿用面板自己给这一趟定的名字（粗剪完成 / 包装完成 / 超分完成），只是去掉结尾的
        // 「完成」：记录在跑的时候就写「完成」是自相矛盾的。这三个入口共用 runTask，
        // 不带区分度的话任务中心里三条剪辑记录全都长一个样。
        // 判空再调：容器缺席时静默跳过，否则这一行抛出的 TypeError 会被按钮的 catch
        // 接成「请求异常」，一次其实已经提交成功的剪辑被报成失败。
        if (window.HTWTasks) window.HTWTasks.track({ domain: "edit", taskId: taskId, panel: "edit", title: String(title || "剪辑处理").replace(/完成$/, "") });
        const res = await pollEdit(taskId, region);
        if (!res.ok) { UI.showError(region, formatErr(res)); return; }
        const d = (res.data && res.data.result) || res.data;
        const url = d && (d.downloadUrl || d.download_url);
        if (url) showVideo(region, url, title);
        else UI.showResult(region, d);
      }

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
      function hint(text) {
        return UI.el("div", { class: "detail-progress", text: text });
      }

      // ====== 粗剪 ======
      const coarseFile = UI.fileInput({ label: "选择视频", accept: "video/*" });
      coarseFile.input.id = "edit-coarse-file";
      const coarseVoice = UI.el("select", { id: "edit-coarse-voice" },
        VOICES.map(function (v) { return UI.el("option", { value: v[0], text: v[1] }); }));
      const coarseMin = UI.el("input", { type: "number", id: "edit-coarse-min", value: "60", placeholder: "最短秒数" });
      const coarseMax = UI.el("input", { type: "number", id: "edit-coarse-max", value: "180", placeholder: "最长秒数" });
      const coarseBlur = UI.el("input", { type: "checkbox", id: "edit-coarse-blur" });
      const coarseRegion = UI.el("div", { id: "edit-coarse-result" });
      const coarseBtn = UI.el("button", { class: "btn", id: "edit-coarse-btn", text: "开始粗剪" });
      const coarseCard = section("视频粗剪 Coarse-cut",
        [
          coarseFile,
          field("配音音色", coarseVoice),
          field("目标时长（秒）", UI.el("div", { class: "row" }, [coarseMin, coarseMax])),
          UI.el("label", { class: "field" }, [coarseBlur, " 模糊原字幕（模糊后由 AI 重新生成字幕）"]),
        ],
        coarseBtn, coarseRegion, "fa-scissors");
      coarseCard.appendChild(hint("将长视频智能快速地剪辑成带解说与字幕的短视频，全程约 5-8 分钟。"));

      // ====== 智能包装 ======
      const packFile = UI.fileInput({ label: "选择视频（mp4 / mov / m4v）", accept: ".mp4,.mov,.m4v" });
      packFile.input.id = "edit-pack-file";
      const packRegion = UI.el("div", { id: "edit-pack-result" });
      const packBtn = UI.el("button", { class: "btn", id: "edit-pack-btn", text: "开始包装" });
      const packCard = section("智能包装 Smart-package", [packFile], packBtn, packRegion, "fa-wand-magic-sparkles");
      packCard.appendChild(hint("AI 自动加字幕、音效、贴纸并突出重点内容，直接输出成片，全程约 3-8 分钟；建议时长 30 秒 - 20 分钟、分辨率 1080P 以内，成片 24 小时后自动删除。"));

      const draftFile = UI.fileInput({ label: "选择 CapCut 草稿 ZIP", accept: ".zip" });
      const draftRegion = UI.el("div");
      const draftBtn = UI.el("button", { class: "btn", text: "导出草稿" });
      const draftCard = section("草稿导出 Draft-export", [draftFile], draftBtn, draftRegion, "fa-file-zipper");

      // ====== 剪同款（套用剪映官方模板出片） ======
      // 与 web 端「媒体编辑 - 剪同款」同一条链路：搜模板 → 选模板 → 上传素材 → 云端渲染出片。
      // 桌面端之所以要单独一套接口，是因为它用 AuthKey 鉴权、不带 session cookie，走不了 MVC 端点。
      let csSelected = null;          // 当前选中的模板
      let csCards = [];               // [{ tpl, node }]，用于切换选中高亮

      const csKeyword = UI.el("input", { type: "text", id: "edit-cutsame-keyword", value: "旅行", placeholder: "如：旅行 / 美食 / 卡点" });
      const csSearchBtn = UI.el("button", { class: "btn", id: "edit-cutsame-search", text: "搜索模板" });
      const csGrid = UI.el("div", { id: "edit-cutsame-grid", style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:10px 0" });
      const csPick = UI.el("div", { class: "detail-progress", id: "edit-cutsame-pick", text: "未选择模板" });
      const csFile = UI.fileInput({ label: "选择视频素材（可多选）", accept: ".mp4,.mov,.m4v", multiple: true });
      csFile.input.id = "edit-cutsame-file";
      const csRegion = UI.el("div", { id: "edit-cutsame-result" });
      const csBtn = UI.el("button", { class: "btn", id: "edit-cutsame-btn", text: "开始套模板" });
      const csCard = section("剪同款 Cut-same",
        [
          field("模板关键词", csKeyword),
          UI.el("div", { class: "row" }, [csSearchBtn]),
          csGrid,
          csPick,
          csFile,
        ],
        csBtn, csRegion, "fa-clapperboard");
      csCard.appendChild(hint("搜索模板不消耗次数；提交后才开始套模板。素材少于模板片段数时会自动循环复用，多个素材则依次填入。全程约 1-3 分钟。"));

      function csCardStyle(on) {
        return "border:2px solid " + (on ? "#3b82f6" : "#e5e7eb") + ";border-radius:8px;padding:8px;cursor:pointer;background:#fff";
      }

      function selectTemplate(tpl, node) {
        csSelected = tpl;
        for (const c of csCards) c.node.setAttribute("style", csCardStyle(c.node === node));
        csPick.textContent = "已选：" + (tpl.name || "未命名模板");
        UI.clear(csRegion);
      }

      function renderTemplates(list) {
        UI.clear(csGrid);
        csCards = [];
        if (!list.length) {
          UI.mount(csGrid, UI.el("div", { class: "detail-progress", text: "没有找到相关模板，换个关键词试试" }));
          return;
        }
        for (const t of list) {
          const usable = !!t.available;
          const meta = (t.fragmentCount ? t.fragmentCount + " 个片段 · " : "") +
            ((t.durationMs || 0) / 1000).toFixed(1) + "s" +
            (t.usageAmount ? " · " + t.usageAmount + " 人用过" : "") +
            (usable ? "" : " · 暂不可用");
          const node = UI.el("div", { style: csCardStyle(false) }, [
            t.coverUrl
              ? UI.el("img", { src: t.coverUrl, style: "width:100%;height:120px;object-fit:cover;border-radius:6px;background:#f3f4f6" })
              : UI.el("div", { style: "width:100%;height:120px;background:#f3f4f6;border-radius:6px" }),
            UI.el("div", { text: t.name || "未命名模板", style: "font-size:13px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" }),
            UI.el("div", { class: "detail-progress", text: meta }),
          ]);
          // 付费/未解锁模板拿不到草稿包，选了也渲染不出来 —— 直接置灰并说明原因，
          // 比让用户提交完才失败要好。
          node.addEventListener("click", function () {
            if (!usable) { UI.showError(csRegion, "该模板暂不可用（付费或未解锁），请换一个"); return; }
            selectTemplate(t, node);
          });
          if (!usable) node.style.opacity = "0.5";
          csCards.push({ tpl: t, node: node });
          UI.mount(csGrid, node);
        }
      }

      async function searchTemplates() {
        const kw = (csKeyword.value || "").trim();
        if (!kw) { UI.showError(csRegion, "请输入模板关键词"); return; }
        UI.clear(csRegion);
        UI.clear(csGrid);
        UI.mount(csGrid, UI.el("div", { class: "detail-progress", text: "正在搜索模板…" }));
        try {
          const r = await API.call("GET", "/api/v2/edit/cutsame/search?keyword=" + encodeURIComponent(kw) + "&count=20");
          if (!r.ok) { UI.clear(csGrid); UI.showError(csRegion, formatErr(r)); return; }
          renderTemplates((r.data && r.data.templates) || []);
        } catch (e) {
          UI.clear(csGrid);
          UI.showError(csRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
        }
      }

      const srFile = UI.fileInput({ label: "选择视频", accept: "video/*" });
      const srW = UI.el("input", { type: "number", value: "1920", placeholder: "宽" });
      const srH = UI.el("input", { type: "number", value: "1080", placeholder: "高" });
      const srRegion = UI.el("div");
      const srBtn = UI.el("button", { class: "btn", text: "超分" });
      const srCard = section("超分 Super-res", [srFile, field("宽", srW), field("高", srH)], srBtn, srRegion, "fa-expand");

      const decFile = UI.fileInput({ label: "选择 .json 草稿", accept: ".json" });
      const decRegion = UI.el("div");
      const decBtn = UI.el("button", { class: "btn", text: "解密" });
      const decCard = section("解密 Decrypt", [decFile], decBtn, decRegion, "fa-lock-open");

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "剪辑 Edit" }),
        coarseCard, packCard, csCard, draftCard, srCard, decCard,
      ]));

      coarseBtn.addEventListener("click", function () {
        UI.withLoading(coarseBtn, async function () {
          try {
            const files = await readFiles(coarseFile);
            if (!files.length) { UI.showError(coarseRegion, "请先选择视频文件"); return; }
            await runTask(files, "/api/v2/edit/coarse-cut", {
              voice: coarseVoice.value,
              durationMin: coarseMin.value || "60",
              durationMax: coarseMax.value || "180",
              blur: coarseBlur.checked ? "true" : "false",
            }, "video", coarseRegion, "粗剪完成");
          } catch (e) {
            UI.showError(coarseRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      packBtn.addEventListener("click", function () {
        UI.withLoading(packBtn, async function () {
          try {
            const files = await readFiles(packFile);
            if (!files.length) { UI.showError(packRegion, "请先选择视频文件"); return; }
            // 与 web 端 Tab4 同一条校验：后端也会拦，但后端要等文件传完才报错，
            // 前端先拦一次能省掉几百 MB 的无效上传。
            if (PACK_EXTS.indexOf(extOf(files[0].name)) < 0) {
              UI.showError(packRegion, "仅支持 mp4/mov/m4v 视频文件");
              return;
            }
            await runTask(files, "/api/v2/edit/smart-package", {}, "file", packRegion, "包装完成");
          } catch (e) {
            UI.showError(packRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      csSearchBtn.addEventListener("click", function () {
        UI.withLoading(csSearchBtn, searchTemplates);
      });

      csBtn.addEventListener("click", function () {
        UI.withLoading(csBtn, async function () {
          try {
            if (!csSelected) { UI.showError(csRegion, "请先搜索并选择一个模板"); return; }
            const files = await readFiles(csFile);
            if (!files.length) { UI.showError(csRegion, "请先选择视频素材"); return; }
            // 与 web 端同一条校验：后端也会拦，但后端要等文件传完才报错，
            // 前端先拦一次能省掉几百 MB 的无效上传。
            for (const f of files) {
              if (PACK_EXTS.indexOf(extOf(f.name)) < 0) {
                UI.showError(csRegion, "仅支持 mp4/mov/m4v 视频文件：" + f.name);
                return;
              }
            }
            if (files.length > 20) { UI.showError(csRegion, "素材最多 20 个"); return; }
            // 多文件共用一个字段名 videos：后端 List<IFormFile> 才能全部收到
            const up = await API.upload("POST", "/api/v2/edit/cutsame/submit", files,
              { draftPackageUrl: csSelected.draftPackageUrl },
              function (p) { renderUpload(csRegion, p); }, "videos");
            if (!up.ok) { UI.showError(csRegion, formatErr(up)); return; }
            const taskId = up.taskId || (up.data && up.data.taskId);
            if (!taskId) { UI.showError(csRegion, "未返回 taskId: " + JSON.stringify(up.data)); return; }
            if (window.HTWTasks) window.HTWTasks.track({ domain: "edit", taskId: taskId, panel: "edit", title: "剪同款" });
            const res = await pollEdit(taskId, csRegion);
            if (!res.ok) { UI.showError(csRegion, formatErr(res)); return; }
            const d = (res.data && res.data.result) || res.data;
            const url = d && (d.downloadUrl || d.download_url);
            if (url) showVideo(csRegion, url, "套模板完成");
            else UI.showResult(csRegion, d);
          } catch (e) {
            UI.showError(csRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      draftBtn.addEventListener("click", function () {
        UI.withLoading(draftBtn, async function () {
          try {
            const files = await readFiles(draftFile);
            if (!files.length) { UI.showError(draftRegion, "请选择 ZIP 文件"); return; }
            const up = await API.upload("POST", "/api/v2/edit/draft-export", files, {});
            if (!up.ok) { UI.showError(draftRegion, formatErr(up)); return; }
            const taskId = up.taskId || (up.data && up.data.taskId);
            if (!taskId) { UI.showError(draftRegion, "未返回 taskId: " + JSON.stringify(up.data)); return; }
            if (window.HTWTasks) window.HTWTasks.track({ domain: "edit", taskId: taskId, panel: "edit", title: "草稿导出" });
            UI.showResult(draftRegion, { message: "已提交，taskId=" + taskId + "，处理中…", warnings: up.data.warnings });
            const res = await pollEdit(taskId, draftRegion);
            if (!res.ok) { UI.showError(draftRegion, formatErr(res)); return; }
            UI.showResult(draftRegion, res.data);
          } catch (e) {
            UI.showError(draftRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      srBtn.addEventListener("click", function () {
        UI.withLoading(srBtn, async function () {
          try {
            const files = await readFiles(srFile);
            if (!files.length) { UI.showError(srRegion, "请选择视频文件"); return; }
            await runTask(files, "/api/v2/edit/super-res", { width: srW.value, height: srH.value }, "video", srRegion, "超分完成");
          } catch (e) {
            UI.showError(srRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      decBtn.addEventListener("click", function () {
        UI.withLoading(decBtn, async function () {
          try {
            const files = await readFiles(decFile);
            if (!files.length) { UI.showError(decRegion, "请选择 .json 文件"); return; }
            const up = await API.upload("POST", "/api/v2/edit/decrypt", files, {});
            if (!up.ok) { UI.showError(decRegion, formatErr(up)); return; }
            UI.showResult(decRegion, up.data);
          } catch (e) {
            UI.showError(decRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });
    },
  };
})();
