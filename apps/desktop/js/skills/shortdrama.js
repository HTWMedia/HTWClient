'use strict';

const api = window.HTWApi;
const UI = window.UI;
const Skills = (window.Skills = window.Skills || {});

function formatErr(r) {
  if (!r) return "未知错误";
  if (r.errCode) return "[" + r.errCode + "] " + (r.errMsg || "");
  return r.errMsg || r.message || "请求失败";
}

// /api/studio/* 返回 v1 信封 { success, data, error }，需单独归一化
function studioResult(r) {
  if (!r || !r.ok) return { ok: false, err: formatErr(r) };
  const d = r.data || {};
  if (d.success === false) return { ok: false, err: d.error || "调用失败" };
  return { ok: true, data: d };
}

function extractVideoUrl(text) {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s"'<>]*douyinvod\.com[^\s"'<>]*/i);
  return m ? m[0] : null;
}

// 复用营销成片同款创作管线时，从 status / artifact 中提取成片 URL（字段名大小写兼容）
function pick(o, a, b) { return o == null ? undefined : (o[a] !== undefined ? o[a] : o[b]); }
function tryParse(s) { try { return typeof s === "string" ? JSON.parse(s) : s; } catch (e) { return null; } }
function findVideoUrl(d) {
  const keys = ["videoUrl", "VideoUrl", "url", "Url", "mediaFile", "MediaFile", "resultUrl", "ResultUrl", "downloadUrl", "DownloadUrl", "resultPath", "ResultPath", "video", "Video", "mp4", "Mp4"];
  const out = [];
  const artRaw = d && (d.Artifact !== undefined ? d.Artifact : d.artifact);
  const art = artRaw ? tryParse(artRaw) : null;
  if (art) keys.forEach(k => { if (art[k]) out.push(art[k]); });
  if (d) keys.forEach(k => { if (d[k]) out.push(d[k]); });
  return out[0] || null;
}

Skills.shortdrama = {
  mount: function (root) {
    UI.clear(root);
    let convId = null;

    function field(labelText, input) {
      return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
    }
    function section(title, bodyNodes, actionNode, regionNode, icon) {
      const head = UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]);
      return UI.el("div", { class: "card" }, [head].concat(bodyNodes).concat([UI.el("div", { class: "row" }, [actionNode]), regionNode]));
    }

    const idea = UI.el("textarea", { placeholder: "剧情创意 / 梗概（必填）。例：帮我做个短剧：30秒科幻短片，地球上最后一个机器人在废墟里种花", rows: 4 });
    const startBtn = UI.el("button", { class: "btn primary", id: "sd-start", text: "开始创作" });

    const continueInput = UI.el("input", { type: "text", placeholder: "续写 / 细化指令（保留上文，推进下一阶段）" });
    const continueBtn = UI.el("button", { class: "btn", id: "sd-continue", text: "继续" });
    const shotPrompt = UI.el("textarea", { placeholder: "分镜画面描述（可选，留空用剧情创意生成）。例：机器人低头，手指轻触破土而出的小花，暖光", rows: 3 });
    const shotsBtn = UI.el("button", { class: "btn", id: "sd-shots", text: "生成分镜(Seedance)" });
    const docBtn = UI.el("button", { class: "btn", id: "sd-doc", text: "查看剧本" });
    const composeBtn = UI.el("button", { class: "btn", id: "sd-compose", text: "合成成片" });

    const stageOut = UI.el("div", { id: "sd-stage", class: "resultbox" });
    const mediaOut = UI.el("div", { id: "sd-media" });
    const region = UI.el("div", { id: "sd-progress" });

    UI.mount(root, UI.el("div", {}, [
      UI.el("h2", { text: "短剧创作 ShortDrama" }),
       UI.el("div", { class: "muted", text: "由服务端豆包「短剧编排」技能驱动：规划 → 剧本 → 分镜(Seedance) → 成片。若豆包/Seedance 不可用，自动切换「剪映素材库」管线兜底合成（不走 Seedance）。" }),
      section("剧情设定", [
        field("剧情创意", idea),
        UI.el("div", { class: "row" }, [startBtn, UI.el("span", { class: "muted", id: "sd-conv", text: "会话号：—" })]),
        stageOut,
      ], startBtn, region, "fa-clapperboard"),
      section("创作推进", [
        field("续写指令", continueInput),
        UI.el("div", { class: "row" }, [continueBtn]),
        field("分镜画面描述", shotPrompt),
        UI.el("div", { class: "row" }, [shotsBtn, docBtn, composeBtn]),
        mediaOut,
      ], continueBtn, region, "fa-film"),
    ]));

    function showStage(text) {
      const block = UI.el("div", { class: "scriptbox" }, [UI.el("pre", { text: text || "(空)" })]);
      stageOut.appendChild(block);
      stageOut.scrollTop = stageOut.scrollHeight;
    }
    function showVideo(url, label) {
      const src = /^https?:\/\//.test(url) ? url : url;
      const box = UI.el("div", { class: "field inline uprow" }, [
        UI.el("video", { src: src, controls: true, autoplay: true, muted: true, loop: true, style: "max-width:100%" }),
        UI.el("a", { class: "btn", href: src, download: true, text: (label || "下载") + "（链接有时效）" }),
      ]);
      mediaOut.appendChild(box);
    }

    async function doCompose(text, isContinue) {
      try {
        const r = await api.post("/api/studio/compose", { text: text, conversationId: convId || undefined });
        const s = studioResult(r);
        if (!s.ok) return { ok: false, err: s.err };
        const d = s.data;
        convId = d.conversation_id || convId;
        document.getElementById("sd-conv").textContent = "会话号：" + (convId || "—");
        showStage((isContinue ? "▎续写：" + text + "\n" : "▎阶段输出：\n") + (d.text || ""));
        const v = extractVideoUrl(d.text);
        if (v) showVideo(v, "成片");
        return { ok: true, text: d.text || "", video: v };
      } catch (e) {
        return { ok: false, err: (e && e.message ? e.message : e) };
      }
    }

    // 兜底：豆包短剧技能 / Seedance 不可用时，改用营销成片同款 VideoCreationService 管线（剪映素材库 + 即梦，不使用 Seedance）
    let fbRunning = false;
    function noteFallback() {
      region.insertAdjacentHTML("beforeend", '<div class="progresslog"><div>豆包短剧技能暂不可用，已切换「剪映素材库」管线兜底合成（不走 Seedance）。</div></div>');
    }
    async function fallbackCompose(theme) {
      if (fbRunning) return;
      fbRunning = true;
      try {
        const up = await api.post("/api/v2/creation/start", {
          type: "video",
          topic: theme,
          videoTypeId: "shortdrama",
          enableSeedance: false,
        });
        if (!up.ok) { UI.showError(region, "兜底合成失败：" + formatErr(up)); return; }
        const sessionId = up.data && up.data.sessionId;
        if (!sessionId) { UI.showError(region, "兜底合成未返回 sessionId"); return; }
        fbPoll(sessionId);
      } catch (e) {
        UI.showError(region, "兜底合成异常：" + (e && e.message ? e.message : e));
      } finally {
        fbRunning = false;
      }
    }
    async function fbPoll(sessionId) {
      try {
        const r = await api.get(`/api/v2/creation/status?sessionId=${encodeURIComponent(sessionId)}&type=video`);
        const d = r && r.data;
        if (!d) return;
        const status = pick(d, "Status", "status");
        const label = pick(d, "CurrentStepLabel", "currentStepLabel");
        const logs = pick(d, "ProgressLogs", "progressLogs");
        let html = "";
        if (label) html += `<div class="detail-step">${UI.esc(label)} <span class="badge ${UI.esc(status)}">${UI.esc(status)}</span></div>`;
        if (logs && logs.length) html += '<div class="progresslog">' + logs.map(l => `<div>${UI.esc(l)}</div>`).join("") + "</div>";
        region.innerHTML = html;

        const artRaw = d && (d.Artifact !== undefined ? d.Artifact : d.artifact);
        const art = artRaw ? tryParse(artRaw) : null;
        if (art && art.type === "video_script" && art.scriptText) {
          showStage("▎兜底剧本（剪映素材库管线）：\n" + art.scriptText);
        }

        const vurl = findVideoUrl(d);
        if (vurl) {
          const src = /^https?:\/\//.test(vurl)
            ? "/api/v2/creation/proxy-media?url=" + encodeURIComponent(vurl)
            : (vurl.charAt(0) === "/" ? vurl : "/api/v2/creation/media-file?sessionId=" + encodeURIComponent(sessionId) + "&fileName=" + encodeURIComponent(vurl));
          showVideo(src, "兜底成片");
        }

        if (status === "running") {
          setTimeout(() => fbPoll(sessionId), 2000);
        } else if (status === "waiting_approval") {
          const stepId = pick(d, "CurrentStepId", "currentStepId");
          const approve = () => api.post("/api/v2/creation/approve", { sessionId: sessionId, type: "video" })
            .then(() => setTimeout(() => fbPoll(sessionId), 1000))
            .catch(e => UI.showError(region, "确认步骤失败：" + (e && e.message ? e.message : e)));
          approve();
        } else if (status === "failed") {
          UI.showError(region, "兜底合成失败：" + (pick(d, "Error", "error") || "未知错误"));
        }
      } catch (e) {
        UI.showError(region, "兜底状态错误：" + (e && e.message ? e.message : e));
      }
    }

    startBtn.addEventListener("click", function () {
      const t = idea.value.trim();
      if (!t) { UI.showError(region, "请输入剧情创意"); return; }
      UI.withLoading(startBtn, async function () {
        const r = await doCompose(t, false);
        if (!r.ok || !r.text) { noteFallback(); await fallbackCompose(t); }
      });
    });

    continueBtn.addEventListener("click", function () {
      const t = continueInput.value.trim();
      if (!t) { UI.showError(region, "请输入续写指令"); return; }
      if (!convId) { UI.showError(region, "请先「开始创作」"); return; }
      UI.withLoading(continueBtn, async function () { await doCompose(t, true); });
    });

    shotsBtn.addEventListener("click", function () {
      if (!convId) { UI.showError(region, "请先「开始创作」"); return; }
      const hint = shotPrompt.value.trim();
      const instr = hint
        ? ("请基于以下提示调用 Seedance 生成分镜视频：" + hint)
        : "请基于以上剧本调用 Seedance 生成分镜视频";
      UI.withLoading(shotsBtn, async function () {
        const r = await doCompose(instr, true);
        if (!r.ok || !r.text) { noteFallback(); await fallbackCompose(idea.value.trim()); }
      });
    });

    docBtn.addEventListener("click", function () {
      if (!convId) { UI.showError(region, "请先「开始创作」"); return; }
      UI.withLoading(docBtn, async function () {
        try {
          const r = await api.get("/api/studio/doc/" + encodeURIComponent(convId));
          const s = studioResult(r);
          if (!s.ok) { UI.showError(region, "读取剧本失败：" + s.err); return; }
          showStage("▎剧本文档：\n" + (s.data.doc_text || "(空)"));
        } catch (e) {
          UI.showError(region, "读取剧本异常：" + (e && e.message ? e.message : e));
        }
      });
    });

    composeBtn.addEventListener("click", function () {
      if (!convId) { UI.showError(region, "请先「开始创作」"); return; }
      UI.withLoading(composeBtn, async function () {
        const r = await doCompose("请将以上剧本与分镜合成为最终短剧成片视频", true);
        if (!r.ok || !r.video) { noteFallback(); await fallbackCompose(idea.value.trim()); }
      });
    });
  },
};
