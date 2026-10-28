const test = require("node:test");
const assert = require("node:assert");

/*
 * 剪辑面板挂载测试：只钉住「任务失败 → failureHint 提示」这一条链路。
 * 背景：pollTask 失败时错误码在 res.code，而旧实现读 res.errCode（恒为 undefined），
 * 渲染类失败的「可能的原因」提示一次都没显示过。这里用极小 DOM 替身驱动
 * 「超分」按钮的失败路径，锁死提示必须真的出现在结果区。
 */

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    _attrs: {},
    _handlers: {},
    children: [],
    parentNode: null,
    isConnected: true,
    style: {},
    set textContent(v) { this._text = String(v == null ? "" : v); this.children = []; },
    get textContent() {
      if (this._text != null && !this.children.length) return this._text;
      return this.children.map((c) => c.textContent || "").join("");
    },
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
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    dispatch(type) { return Promise.all((this._handlers[type] || []).map((fn) => fn({}))); },
  };
  return node;
}

const flush = () => Promise.resolve().then(() => new Promise((r) => setImmediate(r)));
async function settle() { for (let i = 0; i < 8; i++) await flush(); }

function findButtons(root, text) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach((c) => {
      if (c.tagName === "BUTTON" && String(c.textContent || "").trim() === text) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}

function findAllInputs(root, tag) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach((c) => {
      if (c.tagName === tag) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}

// poll 结果可编程：驱动「失败提示」与「无匹配码不提示」两条路径
let editApi = null;
function mountPanel(pollResult) {
  global.document = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const api = {
    base: "https://example.test",
    upload: () => Promise.resolve({ ok: true, taskId: "task-1" }),
    call: () => Promise.resolve({ ok: true, data: {} }),
    pollTask: () => Promise.resolve(pollResult),
  };
  // edit.js mount 内取的是 window.UI / window.HTWApi，两个都要挂在 window 上
  const ui = {
    el: (tag, attrs, kids) => {
      const n = makeNode(tag);
      if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else n[k] = v;
      }
      if (kids != null) n.appendChild(kids);
      return n;
    },
    clear: (n) => { while (n && n.children.length) n.removeChild(n.children[0]); return n; },
    mount: (n, kid) => n.appendChild(kid),
    showError: (region, message) => { region._error = String(message || ""); return region; },
    showResult: (region, data) => { region._result = data; return region; },
    withLoading: (btn, fn) => fn(),
    fileInput: () => {
      const wrap = makeNode("label");
      wrap.input = makeNode("input");
      // readFiles 直接读 wrap.input.files（input 并不挂在 DOM 树里），这里必须预先塞好
      wrap.input.files = [fakeFile];
      return wrap;
    },
  };
  // fileInput 的替身：给每个输入都塞同一份文件，避免按位置区分是哪个面板
  const fakeFile = { name: "a.mp4", arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(8)); } };
  global.window = { HTWApi: api, UI: ui, Skills: global.window && global.window.Skills };

  // edit.js 是纯 IIFE（无 module.exports），挂载入口在 window.Skills.edit 上；
  // 模块只会执行一次，之后的挂载复用同一份 edit
  if (!editApi) {
    require("./edit.js");
    editApi = global.window.Skills.edit;
    assert.ok(editApi && typeof editApi.mount === "function", "edit.js 应挂载 window.Skills.edit.mount");
  }
  const panel = makeNode("section");
  editApi.mount(panel);
  // mount 时 UI.fileInput 已被调用，统一补上文件
  findAllInputs(panel, "INPUT").forEach((i) => { i.files = [fakeFile]; });
  return panel;
}

function errorOf(panel) {
  let msg = "";
  (function walk(n) {
    if (n._error != null) msg += n._error + "\n";
    (n.children || []).forEach(walk);
  })(panel);
  return msg;
}

async function clickSuperRes(panel) {
  const btn = findButtons(panel, "超分")[0];
  assert.ok(btn, "应能找到「超分」按钮");
  await btn.dispatch("click");
  await settle();
}

test("超分任务失败且错误码命中已知渲染失败（19070005）时显示原因提示", async () => {
  const panel = mountPanel({
    ok: false, code: "EDIT_FAILED",
    message: "Render failed (code=19070005)", raw: { status: "failed", errCode: "EDIT_FAILED" },
  });
  await clickSuperRes(panel);
  const msg = errorOf(panel);
  assert.match(msg, /Render failed/);
  assert.match(msg, /可能的原因/);
  assert.match(msg, /render_index/);
});

test("超分任务失败但错误码未知时不拼接原因提示", async () => {
  const panel = mountPanel({
    ok: false, code: "EDIT_FAILED", message: "超分服务暂时不可用，请稍后重试", raw: {},
  });
  await clickSuperRes(panel);
  const msg = errorOf(panel);
  assert.match(msg, /超分服务暂时不可用/);
  assert.ok(!/可能的原因/.test(msg), "未命中已知码时不应出现原因提示");
});
