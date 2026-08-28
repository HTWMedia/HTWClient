(function (root, factory) {
  const ui = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = ui;
  if (typeof window !== "undefined") window.UI = ui;
})(typeof self !== "undefined" ? self : this, function () {
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "onclick") node.addEventListener("click", v);
      else if (k === "onchange") node.addEventListener("change", v);
      else if (k === "oninput") node.addEventListener("input", v);
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    }
    if (children != null) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function mount(parent, node) {
    if (Array.isArray(node)) { for (const n of node) parent.appendChild(n); }
    else parent.appendChild(node);
    return parent;
  }

  function showError(region, message) {
    clear(region);
    mount(region, el("div", { class: "error-box" }, [
      el("strong", { text: "出错了" }),
      el("div", { class: "error-detail", text: String(message) }),
    ]));
    return region;
  }

  var _mediaToken = null;
  var _sessionId = null;

  function showResult(region, data) {
    _mediaToken = (data && data.mediaToken) || null;
    _sessionId = (data && data.Id) || null;
    return presentResult(region, data);
  }

  function humanKey(k) {
    if (typeof k !== "string") return String(k);
    return k.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function isUrlKey(k) {
    return /url|link|href|src|uri/i.test(String(k));
  }

  function platformName(k) {
    const map = {
      bilibili: "B站", weibo: "微博", baidu: "百度", douyin: "抖音",
      xiaohongshu: "小红书", xhs: "小红书", toutiao: "今日头条",
    };
    return map[String(k)] || String(k);
  }

  function openExternal(url) {
    if (window.htw && typeof window.htw.openExternal === "function") window.htw.openExternal(url);
    else if (url) window.open(url, "_blank");
  }

  function linkNode(text, url) {
    return el("a", {
      class: "title-link",
      href: url,
      text: String(text),
      onclick: (e) => { e.preventDefault(); openExternal(url); },
    });
  }

  function resolveUrl(url) {
    if (typeof url !== "string") return url;
    if (/^https?:\/\//i.test(url)) return url;
    var base = (window.HTWApi && window.HTWApi.base) || "";
    if (!base) return url;
    try {
      var full = new URL(url, base).href;
      if (_mediaToken && _sessionId && full.indexOf("/Download/") >= 0) {
        var file = full.substring(full.lastIndexOf("/") + 1);
        full = new URL("/api/v2/creation/media-file?sessionId=" + encodeURIComponent(_sessionId) +
          "&fileName=" + encodeURIComponent(file) + "&token=" + encodeURIComponent(_mediaToken), base).href;
      } else if (_mediaToken && full.indexOf("/creation/media-file") >= 0) {
        full += (full.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(_mediaToken);
      }
      return full;
    } catch (e) { return url; }
  }

  function isImageUrl(key, val) {
    var s = String(val || "");
    if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(s)) return true;
    if (!/^https?:\/\//i.test(s)) return false;
    if (/image|cover|thumbnail|poster|pic/i.test(String(key || ""))) return true;
    try {
      var host = new URL(s).hostname.toLowerCase();
      if (/(img|image|cover|pic|thumbnail|poster|byteimg|bili|douyin|sns|cdn)/.test(host) && !/\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(s)) return true;
    } catch (e) {}
    return false;
  }
  function isAudioUrl(key, val) {
    var s = String(val || "");
    if (!/^https?:\/\//.test(s)) return false;
    if (/\.(mp3|wav|m4a|ogg|aac|flac)(\?|$)/i.test(s)) return true;
    return /audio|voice|tts/i.test(String(key || ""));
  }
  function isVideoUrl(key, val) {
    var s = String(val || "");
    if (/\.(mp4|webm|m4v|mov|ogv|avi)(\?|$)/i.test(s)) return true;
    if (!/^https?:\/\//.test(s)) return false;
    return /video|成片|影片|mp4/i.test(String(key || ""));
  }
  function videoNode(url) {
    var resolved = resolveUrl(url);
    return el("div", { class: "media-box" }, [
      el("video", { class: "result-video", src: resolved, controls: true, preload: "metadata" }),
      el("a", { class: "title-link", href: resolved, text: "下载视频", onclick: function (e) { e.preventDefault(); openExternal(resolved); } }),
    ]);
  }
  function isStatusKey(key) { return /status|state|result/i.test(String(key || "")); }
  function isRichText(s) {
    if (/\n/.test(s)) return true;
    if (s.length < 60) return false;
    return /^(#{1,6} |>\s|\s*\|.*\|\s*$)/m.test(s) || /\*\*|\[.+\]\(https?:|```/.test(s);
  }

  function imageNode(url) {
    var resolved = resolveUrl(url);
    var img = el("img", { class: "result-img", src: resolved, alt: url });
    img.addEventListener("click", function () { openExternal(resolved); });
    img.style.cursor = "pointer";
    return el("div", { class: "img-wrap" }, [
      img,
      el("a", { class: "title-link", href: resolved, text: "打开图片", onclick: function (e) { e.preventDefault(); openExternal(resolved); } }),
    ]);
  }
  function audioNode(url) {
    var resolved = resolveUrl(url);
    return el("div", { class: "audio-wrap" }, [
      el("audio", { controls: true, src: resolved, preload: "none" }),
      el("a", { class: "title-link", href: resolved, text: "下载音频", onclick: function (e) { e.preventDefault(); openExternal(resolved); } }),
    ]);
  }
  function statusBadge(val) {
    var s = String(val).toLowerCase();
    var cls = "status-badge ";
    if (/(success|ok|done|completed|valid|有效|已配置)/.test(s)) cls += "ok";
    else if (/(fail|error|invalid|expired|已失效|未配置|未检测)/.test(s)) cls += "bad";
    else if (/(pending|processing|running|ing|处理中|等待)/.test(s)) cls += "ing";
    else cls += "neutral";
    return el("span", { class: cls, text: String(val) });
  }

  function buildValue(key, val) {
    if (val && typeof val === "object") return buildNode(val, 1);
    var s = String(val == null ? "" : val);
    if (isImageUrl(key, s)) return imageNode(s);
    if (isAudioUrl(key, s)) return audioNode(s);
    if (isVideoUrl(key, s)) return videoNode(s);
    if (/^https?:\/\//.test(s)) return linkNode(s, s);
    if (isStatusKey(key)) return statusBadge(s);
    if (isRichText(s)) return el("div", { class: "kv-md" }, renderMarkdown(s));
    return el("span", { class: "kv-val", text: s });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(String(text)); return true; }
    catch (e) { return false; }
  }

  function buildKv(key, val) {
    const row = el("div", { class: "kv" });
    row.appendChild(el("span", { class: "kv-key", text: humanKey(key) }));
    row.appendChild(buildValue(key, val));
    return row;
  }

  function buildObject(obj) {
    const keys = Object.keys(obj).filter((k) => obj[k] != null);
    if (!keys.length) return el("div", { class: "result-text", text: "（空）" });
    return el("div", { class: "kv-list" }, keys.map((k) => buildKv(k, obj[k])));
  }

  function buildItem(item, index) {
    if (item == null) return el("div", { class: "result-text", text: "—" });
    if (typeof item !== "object") return el("div", { class: "result-text", text: String(item) });
    const o = item;
    const card = el("div", { class: "result-item" });
    const imgKey = ["image", "cover", "coverImage", "thumbnail", "thumb", "pic", "poster", "imageUrl"].find((k) => o[k] && typeof o[k] === "string" && isImageUrl(k, o[k]));
    if (imgKey) card.appendChild(imageNode(o[imgKey]));
    else if (o.url && isImageUrl("url", o.url)) card.appendChild(imageNode(o.url));
    const mediaKey = ["audio", "audioUrl", "voice", "mediaUrl", "videoUrl", "video"].find((k) => o[k] && typeof o[k] === "string" && isAudioUrl(k, o[k]));
    if (mediaKey) card.appendChild(audioNode(o[mediaKey]));
    const rank = o.rank != null ? o.rank : index;
    if (rank != null) card.appendChild(el("span", { class: "rank-badge", text: String(rank) }));
    const title = o.title != null ? o.title : o.name != null ? o.name : o.text != null ? o.text : null;
    if (title != null) {
      card.appendChild(o.url ? linkNode(title, o.url) : el("div", { class: "item-title", text: String(title) }));
    }
    const meta = [];
    if (o.score != null) meta.push(el("span", { class: "meta-score", text: "热度 " + o.score }));
    if (o.tag != null) meta.push(el("span", { class: "meta-tag", text: String(o.tag) }));
    if (meta.length) card.appendChild(el("div", { class: "item-meta" }, meta));
    const desc = o.desc != null ? o.desc : o.summary != null ? o.summary : o.content != null ? o.content : o.description != null ? o.description : null;
    if (desc != null && String(desc) !== String(title)) {
      card.appendChild(el("div", { class: "item-desc", text: String(desc) }));
    }
    const shown = new Set(["rank", "title", "name", "text", "url", "score", "tag", "desc", "summary", "content", "description", "image", "cover", "coverImage", "thumbnail", "thumb", "pic", "poster", "imageUrl", "audio", "audioUrl", "voice", "mediaUrl", "videoUrl", "video"]);
    const rest = Object.keys(o).filter((k) => !shown.has(k) && o[k] != null);
    if (rest.length) card.appendChild(el("div", { class: "item-rest" }, rest.map((k) => buildKv(k, o[k]))));
    return card;
  }

  function buildNode(value, depth) {
    if (Array.isArray(value)) {
      if (!value.length) return el("div", { class: "result-text", text: "（空列表）" });
      if (typeof value[0] === "string") {
        const imgs = value.filter((x) => isImageUrl("", x));
        const auds = value.filter((x) => isAudioUrl("", x));
        if (imgs.length === value.length) return el("div", { class: "img-grid" }, value.map((u) => imageNode(u)));
        if (auds.length === value.length) return el("div", { class: "audio-list" }, value.map((u) => audioNode(u)));
        return el("div", { class: "result-list" }, value.map((u) =>
          el("div", { class: "result-item" }, [ /^https?:\/\//.test(u) ? linkNode(u, u) : el("span", { class: "kv-val", text: u }) ])
        ));
      }
      return el("div", { class: "result-list" }, value.map((it, i) => buildItem(it, i + 1)));
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      const allArrays = keys.length > 0 && keys.every((k) => Array.isArray(value[k]));
      if (allArrays) {
        return el("div", { class: "result-sections" }, keys.map((k) =>
          el("div", { class: "result-section" }, [
            el("h4", { class: "section-title", text: platformName(k) }),
            buildNode(value[k], depth + 1),
          ])
        ));
      }
      return buildObject(value);
    }
    return el("div", { class: "result-text", text: String(value) });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function inlineMd(s) {
    s = s.replace(/`([^`]+)`/g, function (_, c) { return "<code>" + c + "</code>"; });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, t, u) {
      return '<a class="title-link" href="' + u + '" target="_blank">' + t + "</a>";
    });
    return s;
  }

  function splitRow(line) {
    return line.replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
  }

  // 兜底渲染器：先转义再生成自有标签，避免 XSS（marked 不可用时使用）。
  function fallbackMarkdown(text) {
    var raw = String(text == null ? "" : text)
      .replace(/^FINISHEDSEARCH#\s*/i, "")
      .replace(/FINISHED[^\n]*$/i, "")
      .trim();
    var esc = escapeHtml(raw);
    var lines = esc.split(/\r?\n/);
    var out = [];
    var i = 0;
    var listType = null;
    var listBuf = [];
    function flushList() {
      if (listType) { out.push("<" + listType + ">" + listBuf.join("") + "</" + listType + ">"); listType = null; listBuf = []; }
    }
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        flushList(); i++;
        var code = [];
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push("<pre class='md-code'>" + code.join("\n") + "</pre>");
        continue;
      }
      if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        flushList();
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        var t = "<table class='md-table'><thead><tr>" + head.map(function (c) { return "<th>" + inlineMd(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
        for (var ri = 0; ri < rows.length; ri++) {
          t += "<tr>" + rows[ri].map(function (c) { return "<td>" + inlineMd(c) + "</td>"; }).join("") + "</tr>";
        }
        t += "</tbody></table>";
        out.push(t);
        continue;
      }
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushList();
        var lvl = h[1].length;
        out.push("<h" + lvl + " class='md-h md-h" + lvl + "'>" + inlineMd(h[2]) + "</h" + lvl + ">");
        i++;
        continue;
      }
      if (/^&gt;\s?/.test(line)) {
        flushList();
        var q = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) { q.push(lines[i].replace(/^&gt;\s?/, "")); i++; }
        out.push("<blockquote class='md-quote'>" + inlineMd(q.join("<br/>")) + "</blockquote>");
        continue;
      }
      var ul = line.match(/^[-*]\s+(.*)$/);
      if (ul) { if (listType !== "ul") { flushList(); listType = "ul"; } listBuf.push("<li>" + inlineMd(ul[1]) + "</li>"); i++; continue; }
      var ol = line.match(/^\d+\.\s+(.*)$/);
      if (ol) { if (listType !== "ol") { flushList(); listType = "ol"; } listBuf.push("<li>" + inlineMd(ol[1]) + "</li>"); i++; continue; }
      if (/^(\s*[-*_]){3,}\s*$/.test(line)) { flushList(); out.push("<hr class='md-hr'/>"); i++; continue; }
      if (/^\s*$/.test(line)) { flushList(); i++; continue; }
      flushList();
      var p = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,6}\s)/.test(lines[i]) && !/^>\s?/.test(lines[i]) &&
             !/^[-*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) &&
             !/^```/.test(lines[i]) && !/^\|.*\|\s*$/.test(lines[i]) &&
             !/^(\s*[-*_]){3,}\s*$/.test(lines[i])) {
        p.push(lines[i]); i++;
      }
      out.push("<p class='md-p'>" + inlineMd(p.join("<br/>")) + "</p>");
    }
    flushList();
    var wrap = el("div", { class: "markdown-body" });
    wrap.innerHTML = out.join("");
    return wrap;
  }

  // 与 web 项目一致的 AI 输出清洗（去掉 FINISHED 标记与免责声明）。
  function cleanAiOutput(text) {
    if (!text) return "";
    return String(text)
      .replace(/FINISHEDSEARCH/g, "")
      .replace(/FINISHED/g, "")
      .replace(/This response is AI-generated, for reference only\.?/gi, "")
      .replace(/以上内容由AI生成[，,]仅供参考\.?/g, "")
      .replace(/^\s*[\r\n]+/g, "")
      .trim();
  }

  // 去掉可能执行脚本的结构（innerHTML 不会执行 <script>，但仍屏蔽 on* 与 javascript:）。
  function sanitizeHtml(html) {
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  }

  // 优先用 marked（与 web 项目同款解析器）；不可用时退回兜底渲染器。
  function renderMarkdown(text) {
    var cleaned = cleanAiOutput(text);
    var html = null;
    if (typeof window !== "undefined" && window.marked && typeof window.marked.parse === "function") {
      try {
        window.marked.setOptions({ breaks: true, gfm: true });
        html = sanitizeHtml(window.marked.parse(cleaned));
      } catch (e) {
        html = null;
      }
    }
    if (!html) html = fallbackMarkdown(cleaned).innerHTML;
    var wrap = el("div", { class: "markdown-body" });
    wrap.innerHTML = html;
    return wrap;
  }

  // 兼容服务端把结果包成 { Ok/ok, Data/data, ErrCode/errCode } 的情况。
  function unwrapEnvelope(d) {
    if (d && typeof d === "object" && !Array.isArray(d)) {
      var inner = d.data != null ? d.data : (d.Data != null ? d.Data : null);
      if (typeof inner === "string" && ("ok" in d || "Ok" in d || "errCode" in d || "ErrCode" in d)) {
        return inner;
      }
    }
    return d;
  }

  function copyButton(text) {
    const btn = el("button", { class: "btn copy-btn", text: "复制结果", onclick: async function () {
      const ok = await copyText(text);
      btn.textContent = ok ? "已复制" : "复制失败";
      setTimeout(function () { btn.textContent = "复制结果"; }, 1500);
    } });
    return btn;
  }

  function presentResult(region, data) {
    clear(region);
    if (data == null) {
      mount(region, el("div", { class: "result-text", text: "（无数据）" }));
      return region;
    }
    var value = unwrapEnvelope(data);
    if (typeof value === "string") {
      mount(region, renderMarkdown(value));
    } else {
      mount(region, buildNode(value, 0));
    }
    region.appendChild(copyButton(typeof value === "string" ? value : JSON.stringify(value, null, 2)));
    return region;
  }

  function renderResult(region, data) {
    return presentResult(region, data);
  }

  function spinner(text) {
    return el("div", { class: "spinner" }, [
      el("span", { class: "spinner-dot" }),
      el("span", { text: text || "处理中…" }),
    ]);
  }

  function fileInput(opts) {
    opts = opts || {};
    const input = el("input", { type: "file", accept: opts.accept || "" });
    if (opts.multiple) input.multiple = true;
    const wrap = el("label", { class: "file-input" }, [
      el("span", { class: "file-input-label", text: opts.label || "选择文件" }),
      input,
    ]);
    wrap.input = input;
    return wrap;
  }

  async function withLoading(button, fn) {
    const prev = button ? button.textContent : null;
    if (button) { button.disabled = true; clear(button); mount(button, spinner("处理中…")); }
    try {
      return await fn();
    } finally {
      if (button) { button.disabled = false; button.textContent = prev; }
    }
  }

  // markdown 里生成的链接统一走系统浏览器打开（.title-link 已有自身 onclick，这里处理 marked 生成的普通 <a>）
  if (typeof document !== "undefined") {
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (!a.classList.contains("title-link") && /^https?:\/\//i.test(href)) {
        e.preventDefault();
        openExternal(href);
      }
    });
  }

  return { el: el, clear: clear, mount: mount, showError: showError, showResult: showResult, renderResult: renderResult, spinner: spinner, fileInput: fileInput, withLoading: withLoading, esc: escapeHtml };
});
