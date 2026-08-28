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
      UI.el("div", { class: "muted", text: "由服务端豆包「短剧编排」技能驱动：规划 → 剧本 → 分镜(Seedance) → 成片。" }),
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
        if (!s.ok) { UI.showError(region, "创作失败：" + s.err); return; }
        const d = s.data;
        convId = d.conversation_id || convId;
        document.getElementById("sd-conv").textContent = "会话号：" + (convId || "—");
        showStage((isContinue ? "▎续写：" + text + "\n" : "▎阶段输出：\n") + (d.text || ""));
        const v = extractVideoUrl(d.text);
        if (v) showVideo(v, "成片");
      } catch (e) {
        UI.showError(region, "创作异常：" + (e && e.message ? e.message : e));
      }
    }

    startBtn.addEventListener("click", function () {
      const t = idea.value.trim();
      if (!t) { UI.showError(region, "请输入剧情创意"); return; }
      UI.withLoading(startBtn, async function () { await doCompose(t, false); });
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
      UI.withLoading(shotsBtn, async function () { await doCompose(instr, true); });
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
        await doCompose("请将以上剧本与分镜合成为最终短剧成片视频", true);
      });
    });
  },
};
