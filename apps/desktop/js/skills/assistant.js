window.Skills = window.Skills || {};
window.Skills.assistant = (function () {
  var UI = window.UI;
  const api = window.HTWApi;
  const htw = window.htw;
  const MARKED = window.marked;

  const PERSONA = "你是 HTW 工作台的智能助手，请用简体中文帮助用户了解本软件各功能模块的用法，并回答他们关于使用、配置、故障排查等方面的问题。回答简洁、有条理。";
  // 上下文只取最后 12 条；数组本身也要有上限 —— 一次会话里聊几百轮会一直堆在内存里
  // （persist 每次写的虽然是最后 50 条，但 history 自己从来没被裁过）。
  const MAX_CTX = 12;
  const MAX_HISTORY = 200;
  const MAX_PERSIST = 50;
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
        "填写要合成的文本，选择一个发音人（清冷女声、纪录片男声、温柔男声等）。",
        "提交后生成音频，结果里可直接下载。",
      ],
    },
    "视频创作": {
      title: "视频创作",
      summary: "根据素材或参考，自动生成短视频。",
      points: [
        "入口：创作 → 视频创作。",
        "先选一个视频类型（口播知识、知识科普、带货种草、剧情短剧、Vlog、新闻资讯、教程讲解、情感故事、企业宣传），它决定画面风格与配音。",
        "可上传本地素材，或填入参考视频链接让系统借鉴风格。",
        "填写主题后提交，页面会实时显示当前步骤与进度；需要你拍板的环节会出现「确认 / 重新生成 / 精修」三个按钮。",
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
    "选题": {
      title: "选题雷达",
      summary: "每天给出可做的选题，并跟踪对标账号的爆款。",
      points: [
        "入口：选题。",
        "「今日选题」每天生成若干条带数据证据的选题，可一键复制标题去创作。",
        "「对标雷达」添加同垂类账号主页，系统定时采样，出现爆款（超基线 3 倍）时提醒你。",
        "「热榜趋势」按上升期 / 平台期 / 已过气标注话题；上升期建议 24 小时内跟进。",
      ],
    },
    "智能体": {
      title: "智能体（一键成片）",
      summary: "按主题直接跑完整条流水线出片。",
      points: [
        "入口：工具 → 智能体 Agent。",
        "填写主题后可选平台、时长、风格、比例、模式（快速 / 完整）与配音。",
        "提交后自动完成脚本、画面、配音与合成。",
      ],
    },
    "工具": {
      title: "工具",
      summary: "通用 AI 工具集合。",
      points: [
        "入口：工具。",
        "包含语音转写、语音翻译、内容总结、歌词提取、人声伴奏分离、语音合成、图像生成与识别、智能体成片、字幕提取、模板搜索。",
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

  function pushHistory(entry) {
    history.push(entry);
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  }

  function appendUser(text) {
    pushHistory({ role: "user", text: text });
    renderBubble("user", escapeText(text));
  }

  function appendAssistant(text) {
    pushHistory({ role: "assistant", text: text });
    // 模型输出是不可信内容，marked 的结果必须先过 UI.sanitizeHtml 再 innerHTML
    // （以前这里直接塞 parse 结果，等于给模型输出开了脚本执行通道）。
    const html = MARKED ? UI.sanitizeHtml(MARKED.parse(text || "")) : escapeText(text);
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
    if (htw && htw.saveJson) htw.saveJson(STORE_NAME, history.slice(-MAX_PERSIST));
  }

  // 模型回复末尾常粘着 FINISHED 这类协议收尾标记（后面还跟着一句标题），展示前清掉。
  function clean(s) {
    return UI && UI.cleanText ? UI.cleanText(s) : s;
  }

  function extractAnswer(r) {
    if (!r || !r.data) return "";
    if (typeof r.data === "string") return clean(r.data);
    if (r.data.result != null) return clean(r.data.result);
    if (r.data.data && r.data.data.result != null) return clean(r.data.data.result);
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
      // 走 HTWApi：自动带上 AuthKey 请求头并统一解信封。
      // 之前直接调 htw.call 没传 key，服务端收到的是空 AuthKey。
      const r = await api.call("POST", "/api/backend/chat", { Prompt: buildPrompt() });
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
      // 历史文件可能来自旧版本（没有上限），读进来也按当前上限裁一次
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      saved.forEach((m) => {
        // 历史记录同样来自模型输出，恢复时也要过一遍过滤。
        const html = m.role === "user"
          ? escapeText(m.text)
          : (MARKED ? UI.sanitizeHtml(MARKED.parse(m.text || "")) : escapeText(m.text));
        renderBubble(m.role, html);
      });
    } else {
      appendInfo("你好，我是 HTW 助手。点击上方功能标签可快速了解某个功能，也可以直接在下面提问。");
    }
  }

  return { mount: render };
})();
