(function () {
  var Skills = (window.Skills = window.Skills || {});

  function formatErr(r) {
    if (!r) return "未知错误";
    // 非 v2 信封的端点（如 /api/doubao/generate-video）失败体是 { success:false, error }，
    // normalize 只会给出一句 HTTP 状态描述；这里把服务端的 error 原文捞回来。
    var raw = r.raw;
    var msg = raw && typeof raw === "object" && typeof raw.error === "string" && raw.error
      ? raw.error
      : r.message;
    if (r.code) return "[" + r.code + "] " + (msg || "");
    return msg || "请求失败";
  }
  function opt(v, t) { return window.UI.el("option", { value: v, text: t || v }); }

  Skills.tools = {
    mount: function (panel) {
      var UI = window.UI;
      const API = window.HTWApi;
      UI.clear(panel);

      async function readFiles(wrap) {
        const arr = [];
        const list = wrap.input.files;
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          arr.push({ name: f.name, buffer: await f.arrayBuffer() });
        }
        return arr;
      }
      function makePoll(buildUrl) {
        return function (id) {
          return API.pollTask(id, {
            interval: 3000, timeout: 600000,
            fetcher: async function (tid) {
              const r = await API.call("GET", buildUrl(tid));
              if (!r.ok) return r;
              const d = r.data || {};
              // 任务过期或不属于当前账号时服务端返回 notfound：直接收敛成失败，
              // 否则轮询会一直空转到超时，用户只能看到「处理中…」。
              if (d.status === "notfound") return { ok: false, code: "", message: "任务不存在或已过期" };
              if (d.status === "completed") return { ok: true, data: { status: "done", result: d } };
              if (d.status === "failed" || d.error) return { ok: true, data: { status: "failed", errCode: d.error || "FAILED", errMsg: d.error || "处理失败" } };
              return { ok: true, data: { status: "processing" } };
            },
          });
        };
      }
      const pollVoice = makePoll(function (id) { return "/api/v2/voice/status/" + encodeURIComponent(id); });
      const pollImage = makePoll(function (id) { return "/api/v2/image/status?taskId=" + encodeURIComponent(id); });
      const pollSub = makePoll(function (id) { return "/api/v2/subtitle/status/" + encodeURIComponent(id); });

      function field(labelText, input) {
        return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
      }
      // 勾选项不能走 field()：.field 是纵向 flex（标签在上、控件在下），
      // 套在 checkbox 上会变成「一行文字 + 下面一个孤零零的方框」。
      // 用 .stepchk 内联（与创作面板的「可选步骤」同一套样式）。
      function checkField(text, input) {
        return UI.el("label", { class: "stepchk" }, [input, UI.el("span", { text: text })]);
      }
      function section(title, bodyNodes, actionNodes, region, icon) {
        const head = icon ? UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]) : UI.el("h3", { text: title });
        const kids = [head].concat(bodyNodes);
        const actions = Array.isArray(actionNodes) ? actionNodes : [actionNodes];
        kids.push(UI.el("div", { class: "row" }, actions));
        kids.push(region);
        return UI.el("div", { class: "card" }, kids);
      }

      // ---------- 结果展示：把任务状态解析成给人看的内容 ----------
      // 状态接口返回的是 { taskId, status, resultFile, downloadUrl, ... } 这类
      // 机器字段。直接铺出来既难读也把内部细节露在外面，所以每个工具单独取
      // 真正有意义的部分：正文、音频、图片或模板卡片。
      function openExternal(url) {
        if (!url) return;
        if (window.htw && typeof window.htw.openExternal === "function") window.htw.openExternal(url);
        else window.open(url, "_blank");
      }
      function absoluteUrl(u) {
        if (!u) return "";
        var s = String(u);
        if (/^https?:\/\//i.test(s)) return s;
        if (/^\/\//.test(s)) return "https:" + s;
        var base = "";
        try { base = API.resolveTarget("GET", s.split("?")[0]) || API.base || ""; }
        catch (e) { base = API.base || ""; }
        try { return base ? new URL(s, base).href : s; } catch (e) { return s; }
      }
      function badge(text, tone) {
        return UI.el("span", { class: "status-badge " + (tone || "ok"), text: text });
      }
      function resultHead(label, extras) {
        return UI.el("div", { class: "tool-result-head" }, [badge(label)].concat(extras || []));
      }
      function metaLine(text) {
        return UI.el("div", { class: "tool-result-meta", text: text });
      }
      function actionsRow(nodes) {
        return UI.el("div", { class: "tool-result-actions" }, nodes.filter(Boolean));
      }
      function copyBtn(text, label) {
        var name = label || "复制结果";
        var btn = UI.el("button", { class: "btn btn-ghost", text: name });
        btn.addEventListener("click", async function () {
          try {
            await navigator.clipboard.writeText(String(text || ""));
            btn.textContent = "已复制";
          } catch (e) { btn.textContent = "复制失败"; }
          setTimeout(function () { btn.textContent = name; }, 1500);
        });
        return btn;
      }
      function downloadBtn(url, label) {
        return UI.el("button", { class: "btn", text: label || "下载", onclick: function () { openExternal(url); } });
      }
      function pending(region, text) {
        UI.clear(region);
        UI.mount(region, UI.el("div", { class: "result-text", text: text || "已提交，正在处理…" }));
      }
      function fmtClock(sec) {
        var s = Math.max(0, Number(sec) || 0);
        var m = Math.floor(s / 60);
        var r = Math.floor(s % 60);
        return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
      }
      function fmtCount(v) {
        var n = Number(v) || 0;
        if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + " 万";
        return String(n);
      }
      async function fetchResultText(url) {
        var path = url;
        var abs = /^https?:\/\//i.test(String(url));
        if (abs) {
          try { var u = new URL(url); path = u.pathname + u.search; } catch (e) { path = url; }
        }
        var res = await API.download("GET", path);
        if (!res || !res.ok || !res.data) throw new Error((res && res.error) || "下载结果失败");
        var bytes = res.data instanceof ArrayBuffer ? new Uint8Array(res.data) : res.data;
        return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
      }
      function renderTextResult(region, label, downloadUrl, metaText) {
        var dl = downloadUrl ? absoluteUrl(downloadUrl) : "";
        UI.clear(region);
        UI.mount(region, resultHead(label));
        var body = UI.el("div");
        UI.mount(region, body);
        if (!dl) {
          UI.mount(body, UI.el("div", { class: "result-text", text: "结果已生成，但没有可下载的文件。" }));
          return Promise.resolve();
        }
        UI.mount(body, UI.spinner("正在加载结果…"));
        return fetchResultText(downloadUrl).then(function (text) {
          UI.clear(body);
          if (text) UI.mount(body, UI.el("div", { class: "tool-result-text", text: text }));
          else UI.mount(body, UI.el("div", { class: "result-text", text: "结果已生成，点击「下载结果」查看。" }));
          UI.mount(region, actionsRow([
            downloadBtn(dl, "下载结果"),
            text ? copyBtn(text) : null,
          ]));
          if (metaText) UI.mount(region, metaLine(metaText));
        }).catch(function () {
          UI.clear(body);
          UI.mount(body, UI.el("div", { class: "result-text", text: "结果已生成，但预览加载失败，请直接下载。" }));
          UI.mount(region, actionsRow([downloadBtn(dl, "下载结果")]));
        });
      }
      function renderAudioResult(region, label, url, metaText) {
        var src = absoluteUrl(url);
        UI.clear(region);
        UI.mount(region, resultHead(label));
        if (!src) {
          UI.mount(region, UI.el("div", { class: "result-text", text: "任务已完成，但没有返回音频地址。" }));
          return;
        }
        UI.mount(region, UI.el("div", { class: "audio-wrap" }, [
          UI.el("audio", { controls: true, src: src, preload: "none" }),
        ]));
        UI.mount(region, actionsRow([downloadBtn(src, "下载音频"), copyBtn(src, "复制音频链接")]));
        if (metaText) UI.mount(region, metaLine(metaText));
      }
      function renderVideoResult(region, label, url, metaText) {
        var src = absoluteUrl(url);
        UI.clear(region);
        UI.mount(region, resultHead(label));
        if (!src) {
          UI.mount(region, UI.el("div", { class: "result-text", text: "任务已完成，但暂未拿到成片地址。" }));
          return;
        }
        UI.mount(region, UI.el("div", { class: "media-box" }, [
          UI.el("video", { class: "result-video", src: src, controls: true, preload: "metadata" }),
        ]));
        UI.mount(region, actionsRow([downloadBtn(src, "下载视频"), copyBtn(src, "复制视频链接")]));
        if (metaText) UI.mount(region, metaLine(metaText));
      }
      function renderImageResult(region, d) {
        var urls = [];
        (d.localFiles || []).forEach(function (u) { urls.push(absoluteUrl(u)); });
        (d.imageUrls || []).forEach(function (u) { urls.push(absoluteUrl(u)); });
        UI.clear(region);
        if (!urls.length) {
          UI.mount(region, UI.el("div", { class: "result-text", text: "任务已完成，但没有返回图片。" }));
          return;
        }
        UI.mount(region, resultHead("生成完成", [
          UI.el("span", { class: "tool-result-meta", text: "共 " + urls.length + " 张" }),
        ]));
        var grid = UI.el("div", { class: "img-grid" });
        urls.forEach(function (u) {
          var img = UI.el("img", { class: "result-img", src: u, alt: "生成图片" });
          img.style.cursor = "pointer";
          img.addEventListener("click", function () { openExternal(u); });
          grid.appendChild(img);
        });
        UI.mount(region, grid);
        UI.mount(region, metaLine("点击图片可在浏览器中打开原图"));
      }
      function renderLyricsResult(region, d) {
        var lines = Array.isArray(d.lyrics) ? d.lyrics : [];
        var text = lines.map(function (it) {
          var content = (it && (it.content || it.text)) || "";
          var t = it && it.time;
          var stamp = t && typeof t.start === "number" ? "[" + fmtClock(t.start) + "] " : "";
          return stamp + content;
        }).filter(function (s) { return s.trim(); }).join("\n");
        UI.clear(region);
        UI.mount(region, resultHead("歌词提取完成", [
          UI.el("span", { class: "tool-result-meta", text: "共 " + lines.length + " 行" }),
        ]));
        if (text) {
          UI.mount(region, UI.el("div", { class: "tool-result-text", text: text }));
          UI.mount(region, actionsRow([copyBtn(text, "复制歌词")]));
        } else {
          UI.mount(region, UI.el("div", { class: "result-text", text: "未识别到歌词。" }));
        }
      }
      async function renderVoiceResult(region, kind, d) {
        if (!d) { UI.showError(region, "任务未返回结果"); return; }
        if (d.status === "notfound") { UI.showError(region, "任务不存在或已过期"); return; }
        if (d.status === "failed") { UI.showError(region, d.error || "处理失败"); return; }
        if (d.status !== "completed") { pending(region, "处理中…"); return; }

        if (kind === "lyrics") { renderLyricsResult(region, d); return; }
        if (kind === "tts") {
          renderAudioResult(region, "语音合成完成", d.audioUrl || d.downloadUrl || "");
          return;
        }
        if (kind === "separate") {
          renderAudioResult(region, "分离完成", d.downloadUrl || "", "可直接试听或下载分离后的音频");
          return;
        }
        var label = kind === "translate" ? "翻译完成" : kind === "summarize" ? "总结完成" : "转写完成";
        await renderTextResult(region, label, d.downloadUrl);
      }
      function renderSubtitleResult(region, d) {
        if (!d) { UI.showError(region, "任务未返回结果"); return; }
        if (d.status === "notfound") { UI.showError(region, "任务不存在或已过期"); return; }
        if (d.status === "failed") { UI.showError(region, d.error || "处理失败"); return; }
        if (d.status !== "completed") { pending(region, "处理中…"); return; }
        var text = d.result || "";
        UI.clear(region);
        UI.mount(region, resultHead("字幕提取完成", [
          UI.el("span", { class: "tool-result-meta", text: "共 " + (d.lineCount || 0) + " 条 · " + String(d.format || "txt").toUpperCase() }),
        ]));
        if (text) {
          UI.mount(region, UI.el("div", { class: "tool-result-text", text: text }));
          UI.mount(region, actionsRow([copyBtn(text, "复制字幕")]));
        } else {
          UI.mount(region, UI.el("div", { class: "result-text", text: "未提取到字幕内容。" }));
        }
      }
      function renderRecognizeResult(region, d) {
        var text = (d && (d.result || d.text)) || "";
        UI.clear(region);
        UI.mount(region, resultHead("识别完成"));
        if (text) {
          UI.mount(region, UI.renderMarkdown(text));
          UI.mount(region, actionsRow([copyBtn(text)]));
        } else {
          UI.mount(region, UI.el("div", { class: "result-text", text: "未返回识别内容。" }));
        }
      }
      function renderTemplateResult(region, d) {
        var list = (d && d.list) || [];
        UI.clear(region);
        if (!list.length) {
          UI.mount(region, UI.el("div", { class: "result-text", text: "未找到相关模板，换个关键词试试。" }));
          return;
        }
        var items = list.map(function (t) {
          var meta = [];
          if (t.category) meta.push(t.category);
          if (t.durationMs) meta.push((t.durationMs / 1000).toFixed(1) + " 秒");
          if (t.fragmentCount) meta.push("片段 " + t.fragmentCount);
          if (t.usageAmount) meta.push("使用 " + fmtCount(t.usageAmount));
          if (t.likeCount) meta.push("点赞 " + fmtCount(t.likeCount));
          if (t.authorName) meta.push("作者 " + t.authorName);
          return {
            title: t.name || t.id || "未命名模板",
            cover: t.coverUrl || "",
            desc: meta.join(" · "),
            url: t.templateUrl || t.videoUrl || t.draftPackageUrl || "",
          };
        });
        // showResult 会清空结果区，所以先渲染列表，再把统计标题插到最前面。
        UI.showResult(region, items);
        region.insertBefore(resultHead("模板搜索完成", [
          UI.el("span", { class: "tool-result-meta", text: "共 " + list.length + " 个" }),
        ]), region.firstChild);
      }

      // 音频选择合入每个语音工具卡片内；点击操作时自动上传。
      // 缓存按 文件名:字节数 记录，但服务端上传文件有生命周期（会被清理），
      // 隔天再用同一个文件会拿到一个已经失效的 fileId，且报错信息完全看不出原因
      // —— 所以缓存必须带时效，过期后重新上传。
      const uploadCache = {};
      const UPLOAD_CACHE_TTL = 30 * 60 * 1000;
      async function uploadAudio(fileInput, region) {
        const files = await readFiles(fileInput);
        if (!files.length) { UI.showError(region, "请选择音频"); return null; }
        const f = files[0];
        const key = f.name + ":" + f.buffer.byteLength;
        const hit = uploadCache[key];
        if (hit && Date.now() - hit.at < UPLOAD_CACHE_TTL) return hit.fileId;
        const up = await API.upload("POST", "/api/v2/voice/upload", files, {});
        if (!up.ok) { UI.showError(region, formatErr(up)); return null; }
        const id = up.data && up.data.fileId;
        if (!id) { UI.showError(region, formatErr(up)); return null; }
        uploadCache[key] = { fileId: id, at: Date.now() };
        return id;
      }

      const transFile = UI.fileInput({ label: "选择音频/视频", accept: "audio/*,video/*" });
      const transFmt = UI.el("select", {}, [opt("txt"), opt("doc"), opt("srt")]);
      const transLang = UI.el("input", { type: "text", placeholder: "语言 如 zh" });
      const transTranslate = UI.el("input", { type: "checkbox" });
      const transRoleChk = UI.el("input", { type: "checkbox" });
      const transAlignChk = UI.el("input", { type: "checkbox" });
      const transAlignText = UI.el("textarea", { placeholder: "对齐参考文本：粘贴参考文本，用于把音频对齐到该文本（仅勾选「对齐文本」时生效）" });
      const transAlignField = UI.el("div", { class: "field" }, [UI.el("label", { text: "对齐参考文本" }), transAlignText]);
      function syncAlign() { transAlignField.style.display = transAlignChk.checked ? "" : "none"; }
      transAlignChk.addEventListener("change", syncAlign);
      syncAlign();
      const transcribeRegion = UI.el("div");
      const transcribeBtn = UI.el("button", { class: "btn", text: "转写" });
      const transcribeCard = section("语音转写 Transcribe", [
        transFile,
        field("转写格式", transFmt), field("语言", transLang),
        UI.el("div", { class: "field" }, [
          UI.el("div", { class: "steprow" }, [
            checkField("翻译", transTranslate),
            checkField("区分角色", transRoleChk),
            checkField("对齐文本", transAlignChk),
          ]),
        ]),
        transAlignField,
      ], transcribeBtn, transcribeRegion, "fa-language");

      const translateFile = UI.fileInput({ label: "选择音频/视频", accept: "audio/*,video/*" });
      const translateLang = UI.el("input", { type: "text", placeholder: "目标语言" });
      const translateRegion = UI.el("div");
      const translateBtn = UI.el("button", { class: "btn", text: "翻译" });
      const translateCard = section("翻译 Translate", [translateFile, field("目标语言", translateLang)], translateBtn, translateRegion, "fa-language");

      const summarizeFile = UI.fileInput({ label: "选择音频/视频", accept: "audio/*,video/*" });
      const summarizeRegion = UI.el("div");
      const summarizeBtn = UI.el("button", { class: "btn", text: "总结" });
      const summarizeCard = section("总结 Summarize", [summarizeFile], summarizeBtn, summarizeRegion, "fa-align-left");

      const lyricsFile = UI.fileInput({ label: "选择音频/视频", accept: "audio/*,video/*" });
      const lyricsRegion = UI.el("div");
      const lyricsBtn = UI.el("button", { class: "btn", text: "歌词提取" });
      const lyricsCard = section("歌词提取 Lyrics", [lyricsFile], lyricsBtn, lyricsRegion, "fa-music");

      const separateFile = UI.fileInput({ label: "选择音频/视频", accept: "audio/*,video/*" });
      const sepType = UI.el("select", {}, [opt("human"), opt("music")]);
      const separateRegion = UI.el("div");
      const separateBtn = UI.el("button", { class: "btn", text: "人声/伴奏分离" });
      const separateCard = section("人声/伴奏分离 Separate", [separateFile, field("分离类型", sepType)], separateBtn, separateRegion, "fa-scissors");

      const ttsText = UI.el("textarea", { placeholder: "要合成的文本" });
      const TTS_SPEAKERS = [
        ["zh_female_qinglengnv", "清冷女声"], ["ICL_zh_female_jilupianxq2", "纪录片女声"],
        ["ICL_zh_male_jilupianjmh", "纪录片男声"], ["zh_female_aoyunliuyuxi", "奥运刘雨熙"],
        ["ICL_zh_female_basidigua2", "活泼女声"], ["ICL_zh_male_momodianying", "电影男声"],
        ["zh_female_luoliwm_emo_v2_mars_bigtts", "萝莉女声"], ["zh_male_yourougongzi_emo_v2_mars_bigtts", "温柔男声"],
        ["BV009_DPE_streaming", "标准男声"], ["BV104_streaming", "标准女声"],
        ["ICL_zh_female_szrlili2_jianying", "活力女声(剪映)"], ["ICL_zh_female_szrliuwan2_jianying", "温柔女声(剪映)"],
        ["ICL_zh_female_szrtangtang_jianying", "糖糖女声(剪映)"], ["ICL_zh_female_szryanyan_jianying", "妍妍女声(剪映)"],
        ["ICL_zh_male_szrlimu_jianying", "立木男声(剪映)"], ["ICL_zh_male_szryaohang_jianying", "耀航男声(剪映)"],
        ["zh_female_luolizy_emo_v2_mars_bigtts", "萝莉女声(zy)"],
      ];
      function speakerOptions(extra) {
        const arr = [];
        (extra || []).forEach(function (e) { arr.push(opt(e[0], e[1])); });
        TTS_SPEAKERS.forEach(function (s) { arr.push(opt(s[0], s[1])); });
        return arr;
      }
      const ttsSpeaker = UI.el("select", {}, speakerOptions());
      const ttsRegion = UI.el("div");
      const ttsBtn = UI.el("button", { class: "btn", text: "语音合成" });
      const ttsCard = section("语音合成 TTS", [field("TTS 文本", ttsText), field("发音人", ttsSpeaker)], ttsBtn, ttsRegion, "fa-comment-dots");

      const imgPrompt = UI.el("textarea", { placeholder: "提示词" });
      const imgRatio = UI.el("select", {}, [opt("16:9", "16:9 横屏"), opt("9:16", "9:16 竖屏"), opt("1:1", "1:1 正方形"), opt("4:3", "4:3"), opt("3:4", "3:4"), opt("3:2", "3:2"), opt("2:3", "2:3"), opt("21:9", "21:9 超宽屏")]);
      const imgRes = UI.el("select", {}, [opt("1k", "1K (标准)"), opt("2k", "2K (高清)"), opt("4k", "4K (超清)")]);
      const imgNeg = UI.el("textarea", { placeholder: "负向提示词" });
      const imgGenRegion = UI.el("div");
      const imgGenBtn = UI.el("button", { class: "btn", text: "生成图片" });
      const imgFile = UI.fileInput({ label: "选择图片", accept: "image/*" });
      const imgRecRegion = UI.el("div");
      const imgRecBtn = UI.el("button", { class: "btn", text: "识别图片" });
      const imgGenCard = section("图像生成 Generate", [field("提示词", imgPrompt), field("比例", imgRatio), field("分辨率", imgRes), field("负向提示词", imgNeg)], imgGenBtn, imgGenRegion, "fa-wand-magic-sparkles");
      const imgRecCard = section("图像识别 Recognize", [imgFile], imgRecBtn, imgRecRegion, "fa-image");

      // 文生视频走豆包 Seedance 的**服务端异步任务**（/api/doubao/generate-video）：
      // 提交只入队、立刻拿 jobId，再按服务端节奏轮询结果。
      //
      // 为什么不用旧同步接口 /api/studio/video：它要把 HTTP 连接挂满整个生成过程
      // （提交 + 确认 + 轮询），实测 700s 左右被客户端判死，而豆包侧其实还在正常出片
      // —— 那条成片就被白丢了。异步之后「生成多久」与「客户端等多久」解耦，
      // 面板关掉任务也在服务端继续跑。
      const vdPrompt = UI.el("textarea", { placeholder: "例：生成一段5秒视频：一只柴犬在沙滩海边奔跑" });
      const vdBtn = UI.el("button", { class: "btn", text: "生成视频" });
      const vdRegion = UI.el("div");

      // 服务端阶段名 → 人话。uploading/submitting/confirming/finalizing 这类
      // 内部词不该直接铺给用户看。
      const VD_STAGE_TEXT = {
        queued: "已排队，前面还有视频任务在生成…",
        uploading: "正在上传参考图…",
        submitting: "已提交生成服务，等待受理…",
        polling: "正在生成画面，通常需要 1~5 分钟…",
        confirming: "正在确认画面细节…",
        finalizing: "正在取回成片…",
      };
      // 客户端最多等多久。服务端单任务预算是 Doubao:VideoGen:JobTimeoutSeconds
      // （默认 2400s = 40 分钟），这里留 1 分钟余量：比服务端先放弃，
      // 等于把一条仍在跑的任务判成失败。
      const VD_WAIT_MS = 41 * 60 * 1000;
      // 服务端在入队回包里给了 retry_after_seconds（10s），拿不到时按同值兜底。
      const VD_POLL_MS = 10000;

      // 🔴 /api/doubao 是首个用**手写 snake_case** 的端点（job_id / video_url /
      // elapsed_seconds）。api.js 的 camelize 只把 PascalCase 的首字母调小写，
      // snake_case 原样保留 —— 按 camelCase 读会静默拿到 undefined，
      // 表现为「任务成功了却说没拿到成片地址」。这里统一收口成一份视图对象，
      // 顺带兼容 PascalCase（万一以后改成 DTO 投影）。
      function vdNorm(d) {
        d = d || {};
        function num(a, b) {
          var v = d[a] !== undefined && d[a] !== null ? d[a] : d[b];
          return Number(v) || 0;
        }
        return {
          jobId: d.job_id || d.jobId || d.JobId || "",
          status: d.status || d.Status || "",
          stage: d.stage || d.Stage || "",
          elapsed: num("elapsed_seconds", "elapsedSeconds"),
          retry: num("retry_after_seconds", "retryAfterSeconds"),
          videoUrl: d.video_url || d.videoUrl || d.VideoUrl || "",
          model: d.model || d.Model || "",
          text: d.text || d.Text || "",
          error: d.error || d.Error || "",
        };
      }

      function vdStageText(v) {
        if (VD_STAGE_TEXT[v.stage]) return VD_STAGE_TEXT[v.stage];
        if (v.status === "queued") return VD_STAGE_TEXT.queued;
        return "正在生成视频…";
      }
      function vdWaitLine(v) {
        var text = vdStageText(v);
        if (v.elapsed > 0) text += "（已等待 " + fmtClock(v.elapsed) + "）";
        return text;
      }

      // 轮询一个服务端视频任务，返回 { ok:true, data(视图对象) } 或 { ok:false, message }。
      // 终态只有 succeeded / failed；queued 与 running 都按在跑处理。
      async function pollVideoJob(jobId, region, intervalMs) {
        var started = Date.now();
        var wait = intervalMs > 0 ? intervalMs : VD_POLL_MS;
        while (true) {
          const r = await API.call("GET", "/api/doubao/generate-video/jobs/" + encodeURIComponent(jobId));
          if (!r.ok) {
            // 404 = 任务过了服务端保留期（默认 180 分钟），再问也不会有结果。
            if (r.code === 404) return { ok: false, message: "任务记录已过期，请到豆包网页会话查看结果" };
            return { ok: false, message: formatErr(r) };
          }
          const v = vdNorm(r.data);
          if (v.status === "succeeded") return { ok: true, data: v };
          if (v.status === "failed") return { ok: false, message: v.error || "视频生成失败" };

          pending(region, vdWaitLine(v));
          if (Date.now() - started > VD_WAIT_MS) {
            return { ok: false, message: "等待超时：任务可能仍在服务端生成，请稍后到豆包网页会话查看" };
          }
          if (v.retry > 0) wait = Math.max(3000, Math.min(60000, v.retry * 1000));
          await new Promise(function (res) { setTimeout(res, wait); });
        }
      }

      const vdCard = section("视频生成 Video Gen", [
        field("画面描述", vdPrompt),
        UI.el("div", { class: "hint", text: "生成约 1~5 分钟；任务在服务端排队执行，可切到别的面板，任务中心会接着跟踪" }),
      ], vdBtn, vdRegion, "fa-video");

      const subFile = UI.fileInput({ label: "选择视频", accept: "video/*" });
      const subFormat = UI.el("select", {}, [opt("txt"), opt("srt")]);
      // 引擎必须可选：Kimi 免费档经常被上游拥堵降级（REASON_SERVER_OVERLOADED_FOR_FREE_USER），
      // 凭据失效时整条链路也会失败；OCR 走服务端 failover 链（DeepSeek 为主力），
      // 服务端已改网格拼图（30 帧/一次请求），请求次数比旧版逐帧少一半，作为回退更稳。
      // 之前写死 kimi，凭据一挂桌面端就没有任何退路。
      const subEngine = UI.el("select", {}, [
        opt("kimi", "Kimi 整段理解（默认，更快；免费档拥堵时可能失败）"),
        opt("ocr", "OCR 抽帧识别（DeepSeek 通道，更稳的回退）"),
      ]);
      const subBtn = UI.el("button", { class: "btn", text: "提取字幕" });
      const subRegion = UI.el("div");
      const subCard = section("字幕提取 Subtitle", [subFile, field("格式", subFormat), field("引擎", subEngine)], subBtn, subRegion, "fa-closed-captioning");

      const tplKeyword = UI.el("input", { type: "text", placeholder: "关键词" });
      const tplPage = UI.el("input", { type: "number", value: "1" });
      const tplBtn = UI.el("button", { class: "btn", text: "搜索模板" });
      const tplRegion = UI.el("div");
      const tplCard = section("模板搜索 Template", [field("关键词", tplKeyword), field("页码", tplPage)], tplBtn, tplRegion, "fa-layer-group");

      // 按「语音 / 视频 / 图片」分组，避免 11 张卡片一字排开。
      const TAB_GROUPS = [
        { id: "voice", label: "语音", icon: "fa-microphone", cards: [transcribeCard, translateCard, summarizeCard, lyricsCard, separateCard, ttsCard] },
        { id: "video", label: "视频", icon: "fa-clapperboard", cards: [subCard, vdCard, tplCard] },
        { id: "image", label: "图片", icon: "fa-image", cards: [imgGenCard, imgRecCard] },
      ];
      let activeTab = "voice";
      try { activeTab = localStorage.getItem("htw.tools.tab") || "voice"; } catch (e) { /* 隐私模式不可用 */ }
      if (!TAB_GROUPS.some(function (g) { return g.id === activeTab; })) activeTab = "voice";

      const tabBar = UI.el("div", { class: "tabbar tools-tabs" });
      const tabBodies = {};
      const tabBtns = {};
      TAB_GROUPS.forEach(function (g) {
        const grid = UI.el("div", { class: "card-grid" }, g.cards);
        grid.style.display = g.id === activeTab ? "" : "none";
        tabBodies[g.id] = grid;
        const btn = UI.el("div", { class: "tab" + (g.id === activeTab ? " on" : "") }, [
          UI.el("i", { class: "fa-solid " + g.icon }), g.label,
        ]);
        btn.addEventListener("click", function () { selectTab(g.id); });
        tabBtns[g.id] = btn;
        tabBar.appendChild(btn);
      });
      function selectTab(id) {
        activeTab = id;
        TAB_GROUPS.forEach(function (g) {
          const on = g.id === id;
          if (tabBtns[g.id]) tabBtns[g.id].classList.toggle("on", on);
          if (tabBodies[g.id]) tabBodies[g.id].style.display = on ? "" : "none";
        });
        try { localStorage.setItem("htw.tools.tab", id); } catch (e) { /* 忽略 */ }
      }

      UI.mount(panel, UI.el("div", {}, [UI.el("h2", { text: "工具 Tools" }), tabBar].concat(
        TAB_GROUPS.map(function (g) { return tabBodies[g.id]; })
      )));

      function pollVoiceTask(region, taskId, kind) {
        return pollVoice(taskId).then(function (res) {
          if (!res.ok) { UI.showError(region, formatErr(res)); return; }
          return renderVoiceResult(region, kind, res.data);
        });
      }

      transcribeBtn.addEventListener("click", function () {
        UI.withLoading(transcribeBtn, async function () {
          try {
            const fid = await uploadAudio(transFile, transcribeRegion);
            if (!fid) return;
            const up = await API.call("POST", "/api/v2/voice/transcribe", { fileId: fid, format: transFmt.value, language: transLang.value, translate: transTranslate.checked, role: transRoleChk.checked, alignText: transAlignChk.checked ? transAlignText.value.trim() : "" });
            if (!up.ok) { UI.showError(transcribeRegion, formatErr(up)); return; }
            const tid = up.taskId || (up.data && up.data.taskId);
            pending(transcribeRegion, "已提交，正在转写…");
            // 判空再调：任务中心容器缺席（脚本没加载或顺序变了）时必须是静默跳过，
            // 否则这一行会抛 TypeError，被下面的 catch 接成「请求异常」——
            // 一次其实已经提交成功的任务会被报成失败，而且面板从此不再开始轮询。
            if (window.HTWTasks) window.HTWTasks.track({ domain: "voice", taskId: tid, panel: "tools", title: "语音转写" });
            await pollVoiceTask(transcribeRegion, tid, "transcribe");
          } catch (e) { UI.showError(transcribeRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      translateBtn.addEventListener("click", function () {
        UI.withLoading(translateBtn, async function () {
          try {
            const fid = await uploadAudio(translateFile, translateRegion);
            if (!fid) return;
            const up = await API.call("POST", "/api/v2/voice/translate", { fileId: fid, language: translateLang.value });
            if (!up.ok) { UI.showError(translateRegion, formatErr(up)); return; }
            const tid = up.taskId || (up.data && up.data.taskId);
            pending(translateRegion, "已提交，正在翻译…");
            if (window.HTWTasks) window.HTWTasks.track({ domain: "voice", taskId: tid, panel: "tools", title: "语音翻译" });
            await pollVoiceTask(translateRegion, tid, "translate");
          } catch (e) { UI.showError(translateRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      summarizeBtn.addEventListener("click", function () {
        UI.withLoading(summarizeBtn, async function () {
          try {
            const fid = await uploadAudio(summarizeFile, summarizeRegion);
            if (!fid) return;
            const up = await API.call("POST", "/api/v2/voice/summarize", { fileId: fid });
            if (!up.ok) { UI.showError(summarizeRegion, formatErr(up)); return; }
            const tid = up.taskId || (up.data && up.data.taskId);
            pending(summarizeRegion, "已提交，正在生成总结…");
            if (window.HTWTasks) window.HTWTasks.track({ domain: "voice", taskId: tid, panel: "tools", title: "音频内容总结" });
            await pollVoiceTask(summarizeRegion, tid, "summarize");
          } catch (e) { UI.showError(summarizeRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      lyricsBtn.addEventListener("click", function () {
        UI.withLoading(lyricsBtn, async function () {
          try {
            const fid = await uploadAudio(lyricsFile, lyricsRegion);
            if (!fid) return;
            const up = await API.call("POST", "/api/v2/voice/lyrics", { fileId: fid });
            if (!up.ok) { UI.showError(lyricsRegion, formatErr(up)); return; }
            const tid = up.taskId || (up.data && up.data.taskId);
            pending(lyricsRegion, "已提交，正在识别歌词…");
            if (window.HTWTasks) window.HTWTasks.track({ domain: "voice", taskId: tid, panel: "tools", title: "歌词识别" });
            await pollVoiceTask(lyricsRegion, tid, "lyrics");
          } catch (e) { UI.showError(lyricsRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      separateBtn.addEventListener("click", function () {
        UI.withLoading(separateBtn, async function () {
          try {
            const fid = await uploadAudio(separateFile, separateRegion);
            if (!fid) return;
            const up = await API.call("POST", "/api/v2/voice/separate", { fileId: fid, type: sepType.value });
            if (!up.ok) { UI.showError(separateRegion, formatErr(up)); return; }
            const tid = up.taskId || (up.data && up.data.taskId);
            pending(separateRegion, "已提交，正在分离音轨…");
            if (window.HTWTasks) window.HTWTasks.track({ domain: "voice", taskId: tid, panel: "tools", title: "人声/伴奏分离" });
            await pollVoiceTask(separateRegion, tid, "separate");
          } catch (e) { UI.showError(separateRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      ttsBtn.addEventListener("click", function () {
        const t = ttsText.value.trim();
        if (!t) { UI.showError(ttsRegion, "请输入文本"); return; }
        UI.withLoading(ttsBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/voice/tts", { text: t, speaker: ttsSpeaker.value });
            if (!up.ok) { UI.showError(ttsRegion, formatErr(up)); return; }
            const tid = up.taskId || (up.data && up.data.taskId);
            pending(ttsRegion, "已提交，正在合成语音…");
            if (window.HTWTasks) window.HTWTasks.track({ domain: "voice", taskId: tid, panel: "tools", title: "文本转语音" });
            await pollVoiceTask(ttsRegion, tid, "tts");
          } catch (e) { UI.showError(ttsRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      imgGenBtn.addEventListener("click", function () {
        const p = imgPrompt.value.trim();
        if (!p) { UI.showError(imgGenRegion, "请输入提示词"); return; }
        UI.withLoading(imgGenBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/image/generate", { prompt: p, model: "v4.5", ratio: imgRatio.value, resolution: imgRes.value, negativePrompt: imgNeg.value });
            if (!up.ok) { UI.showError(imgGenRegion, formatErr(up)); return; }
            const tid = up.taskId || (up.data && up.data.taskId);
            pending(imgGenRegion, "已提交，正在生成图片…");
            if (window.HTWTasks) window.HTWTasks.track({ domain: "image", taskId: tid, panel: "tools", title: "图片生成" });
            await pollImage(tid).then(function (res) {
              if (!res.ok) { UI.showError(imgGenRegion, formatErr(res)); return; }
              renderImageResult(imgGenRegion, res.data);
            });
          } catch (e) { UI.showError(imgGenRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      imgRecBtn.addEventListener("click", function () {
        UI.withLoading(imgRecBtn, async function () {
          try {
            const files = await readFiles(imgFile);
            if (!files.length) { UI.showError(imgRecRegion, "请选择图片"); return; }
            const up = await API.upload("POST", "/api/v2/image/recognize", files, {});
            if (!up.ok) { UI.showError(imgRecRegion, formatErr(up)); return; }
            renderRecognizeResult(imgRecRegion, up.data);
          } catch (e) { UI.showError(imgRecRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      vdBtn.addEventListener("click", function () {
        const p = vdPrompt.value.trim();
        if (!p) { UI.showError(vdRegion, "请输入画面描述"); return; }
        UI.withLoading(vdBtn, async function () {
          pending(vdRegion, "正在提交任务…");
          try {
            const r = await API.call("POST", "/api/doubao/generate-video", { prompt: p });
            if (!r.ok) { UI.showError(vdRegion, formatErr(r)); return; }
            const queued = vdNorm(r.data);
            if (!queued.jobId) { UI.showError(vdRegion, "服务端没有返回任务号，请稍后重试"); return; }
            // 登记到任务中心：面板的轮询只在本面板可见时进行，切走就停；
            // 登记之后任务中心会按自己的节奏接着问，用户能关窗口、切面板，
            // 稍后回来照样看到出片/失败，不用守着这一页。
            if (window.HTWTasks) window.HTWTasks.track({
              domain: "videogen",
              taskId: queued.jobId,
              panel: "tools",
              title: "视频生成 · " + p.replace(/\s+/g, " ").slice(0, 20),
            });
            pending(vdRegion, "任务已提交，" + vdStageText(queued));
            // 入队回包给的是秒（retry_after_seconds），轮询函数按毫秒收。
            const res = await pollVideoJob(queued.jobId, vdRegion, queued.retry * 1000);
            if (!res.ok) { UI.showError(vdRegion, res.message); return; }
            const job = res.data;
            const meta = [];
            if (job.model) meta.push("模型：" + job.model);
            if (job.elapsed > 0) meta.push("耗时 " + fmtClock(job.elapsed));
            renderVideoResult(vdRegion, "视频生成完成", job.videoUrl, meta.join(" · "));
            if (job.text) UI.mount(vdRegion, UI.el("div", { class: "tool-result-meta", text: String(job.text) }));
          } catch (e) { UI.showError(vdRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      subBtn.addEventListener("click", function () {
        UI.withLoading(subBtn, async function () {
          try {
            const files = await readFiles(subFile);
            if (!files.length) { UI.showError(subRegion, "请选择视频"); return; }
            const up = await API.upload("POST", "/api/v2/subtitle/extract", files, { format: subFormat.value, engine: subEngine.value || "kimi" });
            if (!up.ok) { UI.showError(subRegion, formatErr(up)); return; }
            const tid = up.taskId || (up.data && up.data.taskId);
            pending(subRegion, "已提交，正在提取字幕…");
            if (window.HTWTasks) window.HTWTasks.track({ domain: "subtitle", taskId: tid, panel: "tools", title: "字幕提取" });
            await pollSub(tid).then(function (res) {
              if (!res.ok) { UI.showError(subRegion, formatErr(res)); return; }
              renderSubtitleResult(subRegion, res.data);
            });
          } catch (e) { UI.showError(subRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      tplBtn.addEventListener("click", function () {
        const k = tplKeyword.value.trim();
        if (!k) { UI.showError(tplRegion, "请输入关键词"); return; }
        UI.withLoading(tplBtn, async function () {
          try {
            const up = await API.call("GET", "/api/v2/template/search?keyword=" + encodeURIComponent(k) + "&page=" + (tplPage.value || 1) + "&pageSize=20");
            if (!up.ok) { UI.showError(tplRegion, formatErr(up)); return; }
            renderTemplateResult(tplRegion, up.data);
          } catch (e) { UI.showError(tplRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
    },
  };
})();
