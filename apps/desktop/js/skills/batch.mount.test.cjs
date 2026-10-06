const test = require("node:test");
const assert = require("node:assert");

/*
 * 批量面板挂载冒烟测试：与 workflow.mount.test.cjs 同一套极小 DOM 替身，
 * 挡住"面板一挂载就抛异常、整个 app 白屏"这类最贵的错误。
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
      const cls = sel.replace(/^\./, "");
      const out = [];
      (function walk(n) {
        (n.children || []).forEach((c) => {
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
  const batch = require("./batch.js");
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
    fileInput: () => {
      const wrap = makeNode("label");
      wrap.input = makeNode("input");
      return wrap;
    },
    platformName: (p) => String(p || ""),
  };
  const panel = makeNode("section");
  batch.mount(panel);
  return panel;
}

test("mount: 挂载不抛异常，且渲染出内容", () => {
  withDom(() => {
    const panel = mountPanel();
    assert.ok(panel.children.length > 0, "面板挂载后应有内容");
    const tabs = panel.querySelectorAll("wf-tab");
    assert.strictEqual(tabs.length, 2, "应有 2 个 tab（发起批次/批次状态）");
  });
});

test("mount: 同一个 panel 重复挂载不会叠加（切导航回来时）", () => {
  withDom(() => {
    const panel = makeNode("section");
    const batch = require("./batch.js");
    batch.mount(panel);
    const first = panel.children.length;
    batch.mount(panel);
    assert.strictEqual(panel.children.length, first);
  });
});
