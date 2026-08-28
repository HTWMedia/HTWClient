window.Skills = window.Skills || {};
window.Skills.assistant = (function () {
  var UI = window.UI;
  const htw = window.htw;
  const MARKED = window.marked;

  const PERSONA = "你是 HTW 工作台的智能助手，请用简体中文帮助用户了解本软件各功能模块的用法，并回答他们关于使用、配置、故障排查等方面的问题。回答简洁、有条理。";
  const MAX_CTX = 12;
  const STORE_NAME = "assistant-chat";

  const FEATURES = {
    "语音转写": {
      title: "语音转写（工具）",
      summary: "把音频或视频里的说话内容转写成文字稿。",
      points: [
        "入口：工具 → 语音转写。",
        "上传音频/视频文件，或填写视频链接。",
        "「区分角色」：勾选后模型会尝试按说话人分段（如 说话人1 / 说话人2）。",
        "「对齐文本」：勾选后可粘贴参考文本，模型会按原文校正转写结果，适合已有字幕/文稿需要对齐的情况。",
        "提交后异步生成，可在任务列表中查看进度与结果。",
      ],
    },
    "语音合成": {
      title: "语音合成（工具）",
      summary: "把文字转换成语音配音。",
      points: [
        "入口：工具 → 语音合成。",
        "选择发音人（如 清冷女声、温柔男声 等），可调节语速。",
        "「智能体配音」：可选一个智能体作为配音角色，用于对白类内容。",
        "提交后生成音频，可在任务列表下载。",
      ],
    },
    "视频创作": {
      title: "视频创作",
      summary: "根据素材或参考，自动生成短视频。",
      points: [
        "入口：创作 → 视频。",
        "三种类型：混剪（多素材自动剪辑）、口播（单人讲解）、数字人（虚拟形象播报）。",
        "可上传本地素材，或填入参考视频/图文链接让系统借鉴风格。",
        "填写标题、要求后提交，轮询任务详情查看成片。",
      ],
    },
    "图片创作": {
      title: "图片创作",
      summary: "用文字描述或参考图生成图片。",
      points: [
        "入口：创作 → 图片。",
        "文生图：填写画面描述与风格、比例。",
        "参考生图：上传参考图，让结果贴近其风格/构图。",
        "提交后生成图片，可在任务列表查看与下载。",
      ],
    },
    "文章创作": {
      title: "文章创作",
      summary: "辅助撰写图文文案。",
      points: [
        "入口：创作 → 文章。",
        "填写主题/要点，选择平台风格（如 小红书、公众号），生成文案。",
        "生成结果可直接复制用于发布。",
      ],
    },
    "发布": {
      title: "发布",
      summary: "把内容一键发布到多个平台。",
      points: [
        "入口：发布。",
        "发布前需先配置各平台的 Cookie（见「Cookie 配置」）。",
        "选择已配置的平台，填写标题/正文/素材，提交后由服务端推送。",
        "可在任务队列/历史中查看发布状态。",
      ],
    },
    "Cookie 配置": {
      title: "Cookie 配置（发布）",
      summary: "为各平台发布填写登录凭据。",
      points: [
        "入口：发布 → 顶部「Cookie 配置」。",
        "选择平台（如 抖音、小红书、B站 等），粘贴对应账号的 Cookie。",
        "未配置时平台行会提示，且提交发布前会拦截未配置的平台。",
        "可点击「测试连接」校验 Cookie 是否有效。",
      ],
    },
    "洞察": {
      title: "洞察（数据分析）",
      summary: "分析账号或作品的数据表现。",
      points: [
        "入口：洞察。",
        "可分析指定账号/作品的播放、互动等数据。",
        "支持把视频链接交给模型做画面/内容分析。",
      ],
    },
    "剪辑": {
      title: "剪辑",
      summary: "对视频做基础剪辑处理。",
      points: [
        "入口：剪辑。",
        "上传视频后可做裁剪、片段处理等操作（具体能力依服务端而定）。",
      ],
    },
    "工具": {
      title: "工具",
      summary: "通用 AI 工具集合。",
      points: [
        "入口：工具。",
        "包含语音转写、语音合成等通用能力，后续会持续扩展。",
      ],
    },
  };

  let history = [];
  let busy = false;
  let messagesEl = null;
  let inputEl = null;
  let sendBtn = null;

  function ui(tag, attrs, children) { return UI.el(tag, attrs, children); }

  function escapeText(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function renderBubble(role, html) {
    const wrap = ui("div", { class: "chat-bubble " + (role === "user" ? "chat-user" : "chat-assistant") });
    const body = ui("div", { class: "chat-bubble-body" });
    body.innerHTML = html;
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return wrap;
  }

  function appendUser(text) {
    history.push({ role: "user", text: text });
    renderBubble("user", escapeText(text));
  }

  function appendAssistant(text) {
    history.push({ role: "assistant", text: text });
    const html = MARKED ? MARKED.parse(text || "") : escapeText(text);
    renderBubble("assistant", html);
    persist();
  }

  function appendInfo(text) {
    const wrap = ui("div", { class: "chat-info" });
    wrap.textContent = text;
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    const wrap = ui("div", { class: "chat-bubble chat-assistant", id: "chat-typing" });
    const body = ui("div", { class: "chat-bubble-body" });
    body.textContent = "正在思考…";
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function hideTyping() {
    const t = document.getElementById("chat-typing");
    if (t) t.remove();
  }

  function buildPrompt() {
    const ctx = history.slice(-MAX_CTX);
    const lines = ctx.map((m) => (m.role === "user" ? "用户：" : "助手：") + m.text);
    return PERSONA + "\n\n以下是历史对话：\n" + lines.join("\n");
  }

  function persist() {
    if (htw && htw.saveJson) htw.saveJson(STORE_NAME, history.slice(-50));
  }

  function extractAnswer(r) {
    if (!r || !r.data) return "";
    if (typeof r.data === "string") return r.data;
    if (r.data.result != null) return r.data.result;
    if (r.data.data && r.data.data.result != null) return r.data.data.result;
    return "";
  }

  async function ask(text) {
    if (busy) return;
    const q = (text || "").trim();
    if (!q) return;
    appendUser(q);
    busy = true;
    if (sendBtn) sendBtn.disabled = true;
    showTyping();
    try {
      const r = await htw.call("POST", "/api/backend/chat", { Prompt: buildPrompt() });
      hideTyping();
      const ans = extractAnswer(r);
      if (ans && String(ans).trim()) {
        appendAssistant(String(ans).trim());
      } else {
        appendAssistant("（暂时没有收到回答，可能是服务端未配置对话模型或网络异常，请稍后再试。你也可以点击上方功能标签查看功能介绍。）");
      }
    } catch (e) {
      hideTyping();
      appendInfo("请求失败：" + (e && e.message ? e.message : e));
    } finally {
      busy = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function showFeature(name) {
    const f = FEATURES[name];
    if (!f) return;
    const lines = ["**" + f.title + "**", "", f.summary, "", "要点："];
    f.points.forEach((p) => lines.push("- " + p));
    appendAssistant(lines.join("\n"));
  }

  function clearAll() {
    history = [];
    persist();
    if (messagesEl) messagesEl.innerHTML = "";
    appendInfo("对话已清空。点击上方功能标签可快速了解某个功能，或在下方直接提问。");
  }

  function render(panel) {
    panel.innerHTML = "";
    panel.appendChild(ui("h2", { text: "助手 Assistant" }));

    const chips = ui("div", { class: "chat-chips" });
    Object.keys(FEATURES).forEach((name) => {
      const b = ui("button", { class: "chip", type: "button", text: name });
      b.addEventListener("click", () => { if (!busy) showFeature(name); });
      chips.appendChild(b);
    });
    panel.appendChild(chips);

    messagesEl = ui("div", { class: "chat-messages" });
    panel.appendChild(messagesEl);

    const bar = ui("div", { class: "chat-input-bar" });
    inputEl = ui("textarea", { class: "chat-input", rows: "2", placeholder: "想了解某个功能，或有任何问题，都可以问我…（Enter 发送，Shift+Enter 换行）" });
    sendBtn = ui("button", { class: "btn", type: "button", text: "发送" });
    const clearBtn = ui("button", { class: "btn btn-ghost", type: "button", text: "清空" });
    bar.appendChild(inputEl);
    bar.appendChild(sendBtn);
    bar.appendChild(clearBtn);
    panel.appendChild(bar);

    sendBtn.addEventListener("click", () => { ask(inputEl.value); inputEl.value = ""; });
    clearBtn.addEventListener("click", clearAll);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const v = inputEl.value;
        inputEl.value = "";
        ask(v);
      }
    });

    const saved = htw && htw.loadJson ? htw.loadJson(STORE_NAME) : null;
    if (saved && Array.isArray(saved) && saved.length) {
      history = saved;
      saved.forEach((m) => {
        const html = m.role === "user" ? escapeText(m.text) : (MARKED ? MARKED.parse(m.text || "") : escapeText(m.text));
        renderBubble(m.role, html);
      });
    } else {
      appendInfo("你好，我是 HTW 助手。点击上方功能标签可快速了解某个功能，也可以直接在下面提问。");
    }
  }

  return { mount: render };
})();
