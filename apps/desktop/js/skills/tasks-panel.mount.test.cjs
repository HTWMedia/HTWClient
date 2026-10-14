const test = require("node:test");
const assert = require("node:assert");

/*
 * 挂载冒烟：挡住"面板一挂载就抛异常、整个 app 白屏"这类最贵的错误。
 * DOM 替身与 batch.mount.test.cjs 同一套。
 */

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    _attrs: {},
    children: [],
    parentNode: null,
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
    addEventListener() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
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

function withDom(tasks, fn) {
  const doc = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const prevDoc = global.document;
  const prevWin = global.window;
  global.document = doc;
  global.window = {
    HTWTasks: {
      list: () => tasks,
      onChange: () => function () {},
      clearFinished: () => {},
      cancel: () => Promise.resolve(true),
    },
    App: { showPanel: () => {} },
  };
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
  };
  try { return fn(); } finally {
    global.document = prevDoc;
    global.window = prevWin;
  }
}

function mount(tasks) {
  return withDom(tasks, () => {
    const mod = require("./tasks-panel.js");
    const panel = makeNode("section");
    mod.mount(panel);
    return panel;
  });
}

test("mount: 挂载不抛异常且渲染出内容", () => {
  const panel = mount([]);
  assert.ok(panel.children.length > 0, "面板挂载后应有内容");
});

test("mount: 重复挂载不叠加（切导航回来时）", () => {
  const panel = mount([]);
  const first = panel.children.length;
  // 第二次挂载同样要在 DOM 替身里跑：真实环境 window 永远存在，
  // 裸调会因 window undefined 而抛错，那不是面板的问题。
  withDom([], () => require("./tasks-panel.js").mount(panel));
  assert.strictEqual(panel.children.length, first);
});

test("有任务时能看到标题", () => {
  const panel = mount([{
    id: "t1", title: "短剧创作 · 都市逆袭", panel: "shortdrama", status: "running",
    progress: 62, step: "合成中", transport: "sse", degraded: true,
    domain: "agent", unknown: false, error: null, result: null, updatedAt: 0,
  }]);
  assert.ok(panel.textContent.indexOf("短剧创作") >= 0, "应显示任务标题");
});

test("progress 为 null 不崩，也不画进度条", () => {
  const panel = mount([{
    id: "t2", title: "批量 · 商品A", panel: "batch", status: "running",
    progress: null, step: "处理中", transport: "poll", degraded: false,
    domain: "batch", unknown: false, error: null, result: null, updatedAt: 0,
  }]);
  assert.ok(panel.textContent.indexOf("批量") >= 0);
  assert.strictEqual(panel.querySelectorAll("tk-bar").length, 0, "没有进度就不该画条");
});
