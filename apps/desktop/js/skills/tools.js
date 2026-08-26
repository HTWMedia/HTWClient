(function () {
  const Skills = (window.Skills = window.Skills || {});

  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }
  function opt(v, t) { return window.UI.el("option", { value: v, text: t || v }); }

  Skills.tools = {
    mount: function (panel) {
      const UI = window.UI;
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
              if (d.status === "completed") return { ok: true, data: { status: "done", result: d } };
              if (d.status === "failed" || d.error) return { ok: true, data: { status: "failed", errCode: d.error || "FAILED", errMsg: d.error || "处理失败" } };
              return { ok: true, data: { status: "processing" } };
            },
          });
        };
      }
      const pollVoice = makePoll(function (id) { return "/api/v2/voice/status/" + encodeURIComponent(id); });
      const pollImage = makePoll(function (id) { return "/api/v2/image/status?taskId=" + encodeURIComponent(id); });
      const pollAgent = makePoll(function (id) { return "/api/v2/agent/status?taskId=" + encodeURIComponent(id); });
      const pollSub = makePoll(function (id) { return "/api/v2/subtitle/status/" + encodeURIComponent(id); });

      function field(labelText, input) {
        return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
      }
      function section(title, bodyNodes, actionNodes, region, icon) {
        const head = icon ? UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]) : UI.el("h3", { text: title });
        const kids = [head].concat(bodyNodes);
        const actions = Array.isArray(actionNodes) ? actionNodes : [actionNodes];
        kids.push(UI.el("div", { class: "row" }, actions));
        kids.push(region);
        return UI.el("div", { class: "card" }, kids);
      }

      const voiceFile = UI.fileInput({ label: "选择音频", accept: "audio/*" });
      const uploadRegion = UI.el("div");
      const voiceUploadBtn = UI.el("button", { class: "btn", text: "上传音频" });
      let voiceFileId = null;

      const transFmt = UI.el("select", {}, [opt("txt"), opt("doc"), opt("srt")]);
      const transLang = UI.el("input", { type: "text", placeholder: "语言 如 zh" });
      const transTranslate = UI.el("input", { type: "checkbox" });
      const transRole = UI.el("input", { type: "text", placeholder: "角色" });
      const transAlign = UI.el("input", { type: "checkbox" });
      const transcribeRegion = UI.el("div");
      const transcribeBtn = UI.el("button", { class: "btn", text: "转写" });

      const translateLang = UI.el("input", { type: "text", placeholder: "目标语言" });
      const translateRegion = UI.el("div");
      const translateBtn = UI.el("button", { class: "btn", text: "翻译" });

      const summarizeRegion = UI.el("div");
      const summarizeBtn = UI.el("button", { class: "btn", text: "总结" });

      const lyricsRegion = UI.el("div");
      const lyricsBtn = UI.el("button", { class: "btn", text: "歌词提取" });

      const sepType = UI.el("select", {}, [opt("human"), opt("music")]);
      const separateRegion = UI.el("div");
      const separateBtn = UI.el("button", { class: "btn", text: "人声/伴奏分离" });

      const ttsText = UI.el("textarea", { placeholder: "要合成的文本" });
      const ttsSpeaker = UI.el("input", { type: "text", placeholder: "speaker" });
      const ttsRegion = UI.el("div");
      const ttsBtn = UI.el("button", { class: "btn", text: "语音合成" });

      const voiceUploadCard = section("音频上传 Upload", [voiceFile], voiceUploadBtn, uploadRegion, "fa-upload");
      const transcribeCard = section("语音转写 Transcribe", [
        field("转写格式", transFmt), field("语言", transLang), field("翻译", transTranslate), field("角色", transRole), field("对齐文本", transAlign),
      ], transcribeBtn, transcribeRegion, "fa-language");
      const translateCard = section("翻译 Translate", [field("目标语言", translateLang)], translateBtn, translateRegion, "fa-language");
      const summarizeCard = section("总结 Summarize", [], summarizeBtn, summarizeRegion, "fa-align-left");
      const lyricsCard = section("歌词提取 Lyrics", [], lyricsBtn, lyricsRegion, "fa-music");
      const separateCard = section("人声/伴奏分离 Separate", [field("分离类型", sepType)], separateBtn, separateRegion, "fa-scissors");
      const ttsCard = section("语音合成 TTS", [field("TTS 文本", ttsText), field("TTS speaker", ttsSpeaker)], ttsBtn, ttsRegion, "fa-comment-dots");

      const imgPrompt = UI.el("textarea", { placeholder: "提示词" });
      const imgModel = UI.el("input", { type: "text", value: "default", placeholder: "模型" });
      const imgRatio = UI.el("input", { type: "text", placeholder: "比例 如 16:9" });
      const imgRes = UI.el("input", { type: "text", placeholder: "分辨率" });
      const imgNeg = UI.el("textarea", { placeholder: "负向提示词" });
      const imgGenRegion = UI.el("div");
      const imgGenBtn = UI.el("button", { class: "btn", text: "生成图片" });
      const imgFile = UI.fileInput({ label: "选择图片", accept: "image/*" });
      const imgRecRegion = UI.el("div");
      const imgRecBtn = UI.el("button", { class: "btn", text: "识别图片" });
      const imgGenCard = section("图像生成 Generate", [field("提示词", imgPrompt), field("模型", imgModel), field("比例", imgRatio), field("分辨率", imgRes), field("负向提示词", imgNeg)], imgGenBtn, imgGenRegion, "fa-wand-magic-sparkles");
      const imgRecCard = section("图像识别 Recognize", [imgFile], imgRecBtn, imgRecRegion, "fa-image");

      const agentTopic = UI.el("input", { type: "text", placeholder: "主题" });
      const agentPlatform = UI.el("select", {}, [opt("xhs"), opt("bilibili"), opt("douyin"), opt("toutiao")]);
      const agentLength = UI.el("input", { type: "number", value: "60" });
      const agentStyle = UI.el("input", { type: "text", placeholder: "风格" });
      const agentRatio = UI.el("input", { type: "text", placeholder: "比例" });
      const agentMode = UI.el("input", { type: "text", placeholder: "模式" });
      const agentRef = UI.el("textarea", { placeholder: "参考文本" });
      const agentVoice = UI.el("input", { type: "text", placeholder: "配音" });
      const agentBtn = UI.el("button", { class: "btn", text: "一键成片" });
      const agentRegion = UI.el("div");
      const agentCard = section("智能体 Agent", [
        field("主题", agentTopic), field("平台", agentPlatform), field("时长", agentLength), field("风格", agentStyle), field("比例", agentRatio), field("模式", agentMode), field("参考文本", agentRef), field("配音", agentVoice),
      ], agentBtn, agentRegion, "fa-robot");

      const subFile = UI.fileInput({ label: "选择视频", accept: "video/*" });
      const subFormat = UI.el("select", {}, [opt("txt"), opt("srt")]);
      const subEngine = UI.el("select", {}, [opt("ocr"), opt("kimi")]);
      const subBtn = UI.el("button", { class: "btn", text: "提取字幕" });
      const subRegion = UI.el("div");
      const subCard = section("字幕提取 Subtitle", [subFile, field("格式", subFormat), field("引擎", subEngine)], subBtn, subRegion, "fa-closed-captioning");

      const tplKeyword = UI.el("input", { type: "text", placeholder: "关键词" });
      const tplPage = UI.el("input", { type: "number", value: "1" });
      const tplBtn = UI.el("button", { class: "btn", text: "搜索模板" });
      const tplRegion = UI.el("div");
      const tplCard = section("模板搜索 Template", [field("关键词", tplKeyword), field("页码", tplPage)], tplBtn, tplRegion, "fa-layer-group");

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "工具 Tools" }),
        UI.el("div", { class: "card-grid" }, [
          voiceUploadCard, transcribeCard, translateCard, summarizeCard, lyricsCard, separateCard, ttsCard,
          imgGenCard, imgRecCard, agentCard, subCard, tplCard,
        ]),
      ]));

      voiceUploadBtn.addEventListener("click", function () {
        UI.withLoading(voiceUploadBtn, async function () {
          try {
            const files = await readFiles(voiceFile);
            if (!files.length) { UI.showError(uploadRegion, "请选择音频"); return; }
            const up = await API.upload("POST", "/api/v2/voice/upload", files, {});
            if (!up.ok) { UI.showError(uploadRegion, formatErr(up)); return; }
            voiceFileId = up.data && up.data.fileId;
            UI.showResult(uploadRegion, { fileId: voiceFileId });
          } catch (e) { UI.showError(uploadRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      function needVoice(region) { if (!voiceFileId) { UI.showError(region, "请先上传音频"); return false; } return true; }
      function pollVoiceTask(region, taskId) {
        return pollVoice(taskId).then(function (res) {
          if (!res.ok) { UI.showError(region, formatErr(res)); return; }
          UI.showResult(region, res.data);
        });
      }

      transcribeBtn.addEventListener("click", function () {
        if (!needVoice(transcribeRegion)) return;
        UI.withLoading(transcribeBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/voice/transcribe", { fileId: voiceFileId, format: transFmt.value, language: transLang.value, translate: transTranslate.checked, role: transRole.value, alignText: transAlign.checked });
            if (!up.ok) { UI.showError(transcribeRegion, formatErr(up)); return; }
            UI.showResult(transcribeRegion, { message: "已提交 taskId=" + (up.data && up.data.taskId) });
            await pollVoiceTask(transcribeRegion, up.data && up.data.taskId);
          } catch (e) { UI.showError(transcribeRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      translateBtn.addEventListener("click", function () {
        if (!needVoice(translateRegion)) return;
        UI.withLoading(translateBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/voice/translate", { fileId: voiceFileId, language: translateLang.value });
            if (!up.ok) { UI.showError(translateRegion, formatErr(up)); return; }
            await pollVoiceTask(translateRegion, up.data && up.data.taskId);
          } catch (e) { UI.showError(translateRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      summarizeBtn.addEventListener("click", function () {
        if (!needVoice(summarizeRegion)) return;
        UI.withLoading(summarizeBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/voice/summarize", { fileId: voiceFileId });
            if (!up.ok) { UI.showError(summarizeRegion, formatErr(up)); return; }
            await pollVoiceTask(summarizeRegion, up.data && up.data.taskId);
          } catch (e) { UI.showError(summarizeRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      lyricsBtn.addEventListener("click", function () {
        if (!needVoice(lyricsRegion)) return;
        UI.withLoading(lyricsBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/voice/lyrics", { fileId: voiceFileId });
            if (!up.ok) { UI.showError(lyricsRegion, formatErr(up)); return; }
            await pollVoiceTask(lyricsRegion, up.data && up.data.taskId);
          } catch (e) { UI.showError(lyricsRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
      separateBtn.addEventListener("click", function () {
        if (!needVoice(separateRegion)) return;
        UI.withLoading(separateBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/voice/separate", { fileId: voiceFileId, type: sepType.value });
            if (!up.ok) { UI.showError(separateRegion, formatErr(up)); return; }
            await pollVoiceTask(separateRegion, up.data && up.data.taskId);
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
            await pollVoiceTask(ttsRegion, up.data && up.data.taskId);
          } catch (e) { UI.showError(ttsRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      imgGenBtn.addEventListener("click", function () {
        const p = imgPrompt.value.trim();
        if (!p) { UI.showError(imgGenRegion, "请输入提示词"); return; }
        UI.withLoading(imgGenBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/image/generate", { prompt: p, model: imgModel.value, ratio: imgRatio.value, resolution: imgRes.value, negativePrompt: imgNeg.value });
            if (!up.ok) { UI.showError(imgGenRegion, formatErr(up)); return; }
            await pollImage(up.data && up.data.taskId).then(function (res) { if (!res.ok) { UI.showError(imgGenRegion, formatErr(res)); return; } UI.showResult(imgGenRegion, res.data); });
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
            UI.showResult(imgRecRegion, up.data);
          } catch (e) { UI.showError(imgRecRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      agentBtn.addEventListener("click", function () {
        const t = agentTopic.value.trim();
        if (!t) { UI.showError(agentRegion, "请输入主题"); return; }
        UI.withLoading(agentBtn, async function () {
          try {
            const up = await API.call("POST", "/api/v2/agent/one-click", { topic: t, platform: agentPlatform.value, length: agentLength.value, style: agentStyle.value, ratio: agentRatio.value, mode: agentMode.value, referenceText: agentRef.value, voice: agentVoice.value });
            if (!up.ok) { UI.showError(agentRegion, formatErr(up)); return; }
            const tid = up.data && up.data.taskId;
            UI.showResult(agentRegion, { message: "已提交 taskId=" + tid, statusUrl: up.data && up.data.statusUrl, streamUrl: up.data && up.data.streamUrl });
            if (tid) { await pollAgent(tid).then(function (res) { if (!res.ok) { UI.showError(agentRegion, formatErr(res)); return; } UI.showResult(agentRegion, res.data); }); }
          } catch (e) { UI.showError(agentRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });

      subBtn.addEventListener("click", function () {
        UI.withLoading(subBtn, async function () {
          try {
            const files = await readFiles(subFile);
            if (!files.length) { UI.showError(subRegion, "请选择视频"); return; }
            const up = await API.upload("POST", "/api/v2/subtitle/extract", files, { format: subFormat.value, engine: subEngine.value });
            if (!up.ok) { UI.showError(subRegion, formatErr(up)); return; }
            await pollSub(up.data && up.data.taskId).then(function (res) { if (!res.ok) { UI.showError(subRegion, formatErr(res)); return; } UI.showResult(subRegion, res.data); });
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
            UI.showResult(tplRegion, up.data);
          } catch (e) { UI.showError(tplRegion, "请求异常: " + (e && e.message ? e.message : String(e))); }
        });
      });
    },
  };
})();
