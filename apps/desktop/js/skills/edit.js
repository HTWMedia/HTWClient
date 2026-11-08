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

  // 剪映云渲染的已知失败码 → 用户能看懂的原因与自助处理建议。
  // 执行端只回 "Render failed (code=...)"，不翻译的话用户无从下手。
  // 注意这里的「云端」指**剪映自己的渲染服务**（本机实例出站调它），不是本站云端。
  var RENDER_HINTS = [
    [/19070005/, "草稿里可能存在多条视频轨且上层轨道层级（render_index）未高于主轨。"
      + "剪映桌面端能容忍这种草稿，但剪映云渲染不接受：请把上层视频轨的相对层级调高后重新导出草稿包"],
  ];

  function failureHint(err) {
    const s = String(err || "");
    for (let i = 0; i < RENDER_HINTS.length; i++) {
      if (RENDER_HINTS[i][0].test(s)) return RENDER_HINTS[i][1];
    }
    return "";
  }

  // 执行端对草稿包做素材核对后返回 warnings（缺了哪些素材）。原样 JSON 用户看不懂，
  // 翻译成「缺什么、有什么后果、怎么办」。缺素材不会导致任务失败，只会让画面缺内容。
  function describeWarnings(warnings) {
    if (!warnings || !warnings.length) return "素材核对通过：草稿引用的素材都已随包上传。";
    const lines = warnings.map(function (w) {
      const files = (w.Files || w.files || []).slice(0, 5).join("、");
      const more = (w.Files || w.files || []).length > 5 ? " 等" : "";
      const type = { video: "视频", audio: "音频", image: "图片", font: "字体", effect: "特效", sticker: "贴纸" }[w.Type || w.type] || (w.Type || w.type) || "素材";
      return type + " ×" + (w.Count != null ? w.Count : "?") + "：" + files + more;
    });
    return "草稿包里缺少以下素材（成片里对应内容会缺失或黑屏）：\n" + lines.join("\n")
      + "\n如需完整画面，请把素材文件与 draft_content.json 一起打包后重新导出。";
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

      // statusPrefix：进度查询的路径前缀。默认是云端那三条（粗剪 / 超分 / 智能包装）共用的
      // /api/v2/edit/status/；草稿导出传 /api/v2/edit/draft-status/ —— 两条路由刻意分开，
      // 复用它会把仍在云端执行的任务轮询切到本地实例上（那边根本没有这些任务）。
      async function pollEdit(taskId, region, statusPrefix) {
        const prefix = statusPrefix || "/api/v2/edit/status/";
        return API.pollTask(taskId, {
          interval: 3000,
          // 智能包装全程 3-8 分钟（视频越长越久），10 分钟的上限会在成片前就超时
          timeout: 1800000,
          fetcher: async function (id) {
            const r = await API.call("GET", prefix + encodeURIComponent(id));
            if (!r.ok) return r;
            const d = r.data || {};
            if (d.status === "completed") return { ok: true, data: { status: "done", result: d } };
            if (d.status === "failed" || d.error) return { ok: true, data: { status: "failed", errCode: d.error || "EDIT_FAILED", errMsg: d.error || "处理失败" } };
            renderTask(region, d);
            return { ok: true, data: { status: "processing", progress: d.progress } };
          },
        });
      }

      // pollTask 失败时任务错误码在 res.code（pollEdit 把 status.error 塞进 errCode，
      // pollTask 再转成 code），不在 res.errCode —— 旧实现读后者恒为 undefined，
      // failureHint 一次都没生效过。这里按真实返回形状取码并拼接提示。
      function taskErrorText(res) {
        const rawCode = res && res.raw && (res.raw.errCode || res.raw.error);
        const code = [res && res.code, res && res.message, rawCode].filter(Boolean).join(" ");
        const hint = failureHint(code);
        return formatErr(res) + (hint ? "\n\n可能的原因：" + hint : "");
      }

      // 成片下载链接由服务端签过凭证，直接用；与营销/短剧面板同一套呈现方式。
      // 下载链接改走源站直连：Cloudflare 忽略 Range，大文件会被截断。
      function showVideo(region, url, title) {
        const full = url.charAt(0) === "/" ? API.base + url : url;
        const dlUrl = (window.HTWApi && typeof window.HTWApi.preferDirectUrl === "function")
          ? window.HTWApi.preferDirectUrl(full) : full;
        UI.clear(region);
        UI.mount(region, UI.el("div", {}, [
          UI.el("div", { class: "result-area-text", text: title }),
          UI.el("video", { controls: true, style: "width:100%;max-width:480px;border-radius:8px;background:#000", src: full }),
          UI.el("a", { class: "btn", href: dlUrl, download: "htw_edit_output.mp4", text: "下载成片" }),
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
        if (!res.ok) { UI.showError(region, taskErrorText(res)); return; }
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

      // ====== 草稿导出（服务端执行，用调用方自己的登录态）======
      //
      // 🔴 2026-11-07 晚回退：渲染恢复由**站点服务端**执行（上一版强制「只在本机执行」，
      //    本地实例未就绪就直接拒绝，而本地实例已决定不下发，那条判据会把草稿导出对所有人锁死）。
      //    回退只改「在哪执行」：Cookie 仍是**必填**，站方不代管账号池，按成片时长计费。
      const DRAFT_PATH = "/api/v2/edit/draft-export";
      // 进度查询与上面那条成对，且是**独立路由**（/edit/status 仍然只服务云端的
      // 粗剪 / 超分 / 智能包装）。走错一条的症状是"任务一直在跑、永远查不到"。
      const DRAFT_STATUS_PREFIX = "/api/v2/edit/draft-status/";
      // 剪映登录态落盘的槽位名 → userData/htw-jianying.json（与 AuthKey 同一个目录）。
      // 刻意**不进** htw-config.json 的五键白名单：那五个键每次必须整套一起写，
      // 多塞一个键，任何一处漏写就会把它悄悄清空。
      const JY_STORE = "jianying";

      const draftFile = UI.fileInput({ label: "选择 CapCut 草稿 ZIP", accept: ".zip" });
      const draftCookie = UI.el("input", {
        type: "password", id: "edit-draft-cookie",
        placeholder: "粘贴剪映登录态 Cookie（形如 sessionid=...; ttwid=...）",
      });
      const draftReveal = UI.el("input", { type: "checkbox", id: "edit-draft-reveal" });
      const draftSaveBtn = UI.el("button", { class: "btn", type: "button", id: "edit-draft-save", text: "保存到本机" });
      const draftClearBtn = UI.el("button", { class: "btn", type: "button", id: "edit-draft-clear", text: "清除" });
      const draftCookieNote = UI.el("div", { class: "detail-progress", id: "edit-draft-cookie-note" });
      const draftRegion = UI.el("div");
      const draftBtn = UI.el("button", { class: "btn", id: "edit-draft-btn", text: "导出草稿" });
      const draftCard = section("草稿导出 Draft-export", [
        draftFile,
        field("剪映登录态 Cookie（必填）", draftCookie),
        UI.el("div", { class: "row" }, [
          UI.el("label", { class: "field" }, [draftReveal, " 显示"]), draftSaveBtn, draftClearBtn,
        ]),
        draftCookieNote,
        hint("草稿导出用你自己的剪映账号渲染（服务端执行，但站方不代管账号），所以必须填 Cookie；"
          + "按成片时长计费。登录态保存本机，导出时随这一次请求发给本站，用完不落盘、不写日志。"
          + "取 Cookie：浏览器登录剪映网页版后，开发者工具 Network 里任一请求的请求头 Cookie 整段复制。"),
      ], draftBtn, draftRegion, "fa-file-zipper");

      // 落盘桥：主进程的通用 json 槽位（window.htw.loadJson / saveJson）。
      // 环境里没有它（浏览器直开 / 冒烟替身）时**不假装保存成功** —— 返回 null，
      // 调用方据此说明"只在本次运行内有效"。
      function jyBridge() {
        const h = (typeof window !== "undefined" && window.htw) || null;
        if (!h || typeof h.loadJson !== "function" || typeof h.saveJson !== "function") return null;
        return h;
      }

      // Cookie 归一化：从开发者工具复制常带 "Cookie:" 前缀与换行，
      // 服务端只认成对的值，带着前缀过去会被判成无效登录态。
      function cleanCookie(v) {
        return String(v == null ? "" : v)
          .replace(/^\s*cookie\s*:/i, "")
          .replace(/[\r\n\t]+/g, " ")
          .trim();
      }

      function setCookieNote(text) { if (draftCookieNote) draftCookieNote.textContent = text; }

      async function loadSavedCookie() {
        const h = jyBridge();
        if (!h) { setCookieNote("当前环境不能落盘：登录态只在本次运行内有效。"); return; }
        let saved = "";
        try {
          const j = await h.loadJson(JY_STORE);
          saved = (j && typeof j.cookie === "string") ? j.cookie : "";
        } catch (e) { saved = ""; }
        if (!saved) {
          setCookieNote("尚未保存登录态：填好后点「保存到本机」，下次打开就不用重填。");
          return;
        }
        // 读盘是异步的：用户可能已经先手输了一条，别把它盖掉。
        if (!cleanCookie(draftCookie.value)) draftCookie.value = saved;
        setCookieNote("已读取本机保存的登录态（" + saved.length + " 个字符）。");
      }

      async function persistCookie() {
        const cookie = cleanCookie(draftCookie.value);
        if (!cookie) { UI.showError(draftRegion, "请先填入剪映登录态 Cookie"); return; }
        if (cookie.indexOf("=") < 0) {
          UI.showError(draftRegion, "这看起来不是 Cookie：应形如 sessionid=...; ttwid=...（请求头里 Cookie 那一整段）。");
          return;
        }
        const h = jyBridge();
        if (!h) { UI.showError(draftRegion, "当前环境不能落盘，登录态只在本次运行内有效。"); return; }
        let saved = false;
        try { saved = (await h.saveJson(JY_STORE, { cookie: cookie, savedAt: Date.now() })) === true; } catch (e) { saved = false; }
        if (!saved) { UI.showError(draftRegion, "保存失败：本机配置文件写不进去。"); return; }
        UI.clear(draftRegion);
        setCookieNote("已保存到本机（userData/" + JY_STORE + ".json）。导出时会随那一次请求发给本站，服务端用完不落盘。");
      }

      async function clearSavedCookie() {
        draftCookie.value = "";
        const h = jyBridge();
        if (h) {
          // 清不掉也不该炸界面：内存里的值已经清空了，落盘那份下次覆盖即可。
          try { await h.saveJson(JY_STORE, { cookie: "" }); } catch (e) { /* 忽略 */ }
        }
        UI.clear(draftRegion);
        setCookieNote("已清除本机保存的登录态。");
      }

      // 「会不会落到本机」不再由这里判：服务端下发的能力清单里已没有 draft-export，
      // 所以 shouldUseLocal 对它恒为 false，请求一律打云端。本地实例即便还开着，
      // 也不接这条（服务端侧已无「就地执行」分支）。

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
      // 同一条能力有免费的本机路径（「草稿体检」），却把用户留在收费上传这条路上，
      // 一旦被发现就是信任问题。这里给一个明确的出口，而不是只字不提。
      const decLocalBtn = UI.el("button", { class: "btn btn-ghost", type: "button", id: "edit-dec-local", text: "去本地免费解密" });
      decLocalBtn.addEventListener("click", function () {
        const nav = document.querySelector('.nav-item[data-skill="draftcheck"]');
        if (nav) nav.click();
      });
      decCard.appendChild(hint("这条解密走云端、会计入额度。只是想拿到明文 JSON 的话，「草稿体检」在本机免费解密并导出，草稿不出这台机器。"));
      decCard.appendChild(UI.el("div", { class: "row" }, [decLocalBtn]));

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "剪辑 Edit" }),
        coarseCard, packCard, draftCard, srCard, decCard,
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

      draftBtn.addEventListener("click", function () {
        UI.withLoading(draftBtn, async function () {
          try {
            // Cookie 必填：渲染虽在服务端执行，但账号必须是调用方自己的（站方不做账号池代跑）。
            const cookie = cleanCookie(draftCookie.value);
            if (!cookie) {
              UI.showError(draftRegion, "请先填入剪映登录态 Cookie —— 草稿导出用你自己的账号渲染，不填导不了。");
              return;
            }
            if (cookie.indexOf("=") < 0) {
              UI.showError(draftRegion, "这看起来不是 Cookie：应形如 sessionid=...; ttwid=...（请求头里 Cookie 那一整段）。");
              return;
            }
            const files = await readFiles(draftFile);
            if (!files.length) { UI.showError(draftRegion, "请选择 ZIP 文件"); return; }
            // jianyingCookie 是 form 字段（后端签名里的 [FromForm]）。
            const up = await API.upload("POST", DRAFT_PATH, files, { jianyingCookie: cookie });
            if (!up.ok) { UI.showError(draftRegion, formatErr(up)); return; }
            const taskId = up.taskId || (up.data && up.data.taskId);
            if (!taskId) { UI.showError(draftRegion, "未返回 taskId: " + JSON.stringify(up.data)); return; }
            if (window.HTWTasks) window.HTWTasks.track({ domain: "edit", taskId: taskId, panel: "edit", title: "草稿导出" });
            UI.showResult(draftRegion, {
              message: "已提交渲染，taskId=" + taskId + "，处理中…\n" + describeWarnings(up.data && up.data.warnings),
            });
            const res = await pollEdit(taskId, draftRegion, DRAFT_STATUS_PREFIX);
            if (!res.ok) {
              // 失败时补一句口径：这条链路用的是你自己的剪映登录态，出错先看它是否失效。
              UI.showError(draftRegion, taskErrorText(res)
                + "\n\n如果提示与登录态有关：重新登录剪映网页版，换一条 Cookie 再试。");
              return;
            }
            const d = (res.data && res.data.result) || res.data || {};
            // downloadUrl 由服务端按本次请求的 Scheme+Host 拼成绝对地址（或剪映直链），
            // 这里不能再补前缀，否则会拼出双域名。
            const url = d && (d.downloadUrl || d.download_url);
            if (url) showVideo(draftRegion, url, "草稿导出完成");
            else UI.showResult(draftRegion, d);
          } catch (e) {
            UI.showError(draftRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      // 卡片挂上之后再读一次本机保存的登录态（异步，不阻塞面板渲染）。
      draftReveal.addEventListener("change", function () {
        draftCookie.type = draftReveal.checked ? "text" : "password";
      });
      draftSaveBtn.addEventListener("click", function () { persistCookie(); });
      draftClearBtn.addEventListener("click", function () { clearSavedCookie(); });
      loadSavedCookie();

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
