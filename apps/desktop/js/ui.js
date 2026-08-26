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

  function showResult(region, data) {
    clear(region);
    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    mount(region, el("pre", { class: "result-box", text: text }));
    return region;
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

  return { el: el, clear: clear, mount: mount, showError: showError, showResult: showResult, spinner: spinner, fileInput: fileInput, withLoading: withLoading };
});
