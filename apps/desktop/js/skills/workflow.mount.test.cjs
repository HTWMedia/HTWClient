const test = require("node:test");
const assert = require("node:assert");

/*
 * 挂载冒烟测试：验证 mount(panel) 在没有真实浏览器时也不抛异常。
 *
 * 做法是自建一个极小 DOM 替身（只实现 el/appendChild/removeChild/querySelectorAll）。
 * 这不是要替代真机验证 —— 真机上还得看一眼渲染效果 —— 但它能挡住
 * "面板一挂载就抛异常、整个 app 白屏"这类最贵的错误。
 */

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    _attrs: {},
    children: [],
    parentNode: null,
    isConnected: true,
    style: {},
    set textContent(v) { this._text = String(v == null ? "" : v); this.children = []; },
    get textContent() {
      if (this._text != null && !this.children.length) return this._text;
      return this.children.map((c) => c.textContent || "").join("");
    },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ""; },
    appendChild(child) {
      if (child == null) return child;
      if (Array.isArray(child)) { child.forEach((c) => this.appendChild(c)); return child; }
      // 字符串按文本节点处理
      if (typeof child === "string") { this.children.push({ textContent: child, children: [] }); return child; }
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    addEventListener() { /* 交互不在冒烟范围 */ },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    closest() { return null; },
    querySelectorAll(sel) {
      // 只支持 .class 一种选择器 —— 面板里实际用到的就这一种
      const cls = sel.replace(/^\./, "");
      const out = [];
      (function walk(n) {
        n.children.forEach((c) => {
          if (c.className && String(c.className).split(/\s+/).indexOf(cls) >= 0) out.push(c);
          walk(c);
        });
      })(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  return node;
}

function withDom(fn) {
  const doc = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const prevDoc = global.document;
  const prevWin = global.window;
  global.document = doc;
  global.window = { HTWApi: { call: () => Promise.resolve({ ok: true, data: {} }) } };
  try { return fn(); } finally {
    global.document = prevDoc;
    global.window = prevWin;
  }
}

function mountPanel() {
  const wf = require("./workflow.js");
  // UI.el / clear / showError 都要在
  global.UI = {
    el: (tag, attrs, kids) => {
      const n = makeNode(tag);
      if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else n._attrs[k] = v;
      }
      if (kids != null) n.appendChild(kids);
      return n;
    },
    clear: (n) => { while (n && n.children.length) n.removeChild(n.children[0]); return n; },
    showError: (region, msg) => { region.textContent = String(msg); return region; },
    withLoading: (btn, fn) => fn(),
    // workflow 面板的 narration 形态用 fileInput 选真人出镜素材（A-roll）
    fileInput: () => {
      const wrap = makeNode("label");
      wrap.input = makeNode("input");
      return wrap;
    },
    platformName: (p) => String(p || ""),
  };
  const panel = makeNode("section");
  wf.mount(panel);
  return panel;
}

test("mount: 挂载不抛异常，且渲染出内容", () => {
  withDom(() => {
    const panel = mountPanel();
    assert.ok(panel.children.length > 0, "面板挂载后应有内容");
    // 默认停在「发起工作流」tab：应有 3 个 tab 按钮 + 表单卡片
    const tabs = panel.querySelectorAll("wf-tab");
    assert.strictEqual(tabs.length, 3, "应有 3 个 tab");
  });
});

test("mount: 同一个 panel 重复挂载不会叠加（切导航回来时）", () => {
  withDom(() => {
    const panel = makeNode("section");
    const wf = require("./workflow.js");
    wf.mount(panel);
    const first = panel.children.length;
    wf.mount(panel);
    // mount 开头有 UI.clear，重复挂载应当覆盖而不是不断叠加
    assert.strictEqual(panel.children.length, first);
  });
});
