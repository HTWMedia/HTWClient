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
    _handlers: {},
    children: [],
    parentNode: null,
    isConnected: true,
    style: {},
    // input / textarea 的取值：面板读它才知道用户填了什么
    value: "",
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
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    click() {
      (this._handlers.click || []).forEach((h) => h.call(this, { type: "click", target: this }));
    },
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

// opts.call 覆盖 HTWApi.call（批量启动的响应形状就靠它喂进来），
// opts.noTasks 模拟任务中心容器缺席。
// 注意这里刻意**不**还原 global.UI：下面那条「重复挂载」用例正是靠上一条
// 用例留下的 global.UI 才能跑起来的，还原它反而会把既有用例弄红。
function withDom(opts, fn) {
  const o = (typeof opts === "function") ? {} : (opts || {});
  const body = (typeof opts === "function") ? opts : fn;
  const tracks = [];
  const doc = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const prevDoc = global.document;
  const prevWin = global.window;
  global.document = doc;
  global.window = {
    HTWApi: {
      base: "https://api.example.test",
      call: o.call || (() => Promise.resolve({ ok: true, data: {} })),
    },
  };
  if (!o.noTasks) {
    global.window.HTWTasks = {
      track: (opts2) => { tracks.push(opts2); return { id: "t_" + (tracks.length + 1) }; },
    };
  }
  const restore = () => { global.document = prevDoc; global.window = prevWin; };
  try {
    const out = body({ tracks });
    // body 可能是 async：直接 return 它的 Promise 会让 finally 在 Promise **settle 之前**
    // 就把 global.window 还原掉，面板里那些 await 之后的回调就读到 undefined 了。
    if (out && typeof out.then === "function") {
      return out.then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
    }
    restore();
    return out;
  } catch (e) {
    restore();
    throw e;
  }
}

function findByTag(root, tag) {
  let found = null;
  (function walk(n) {
    (n.children || []).forEach((c) => {
      if (found) return;
      if (c.tagName === tag) { found = c; return; }
      walk(c);
    });
  })(root);
  return found;
}

function findButton(root, label) {
  let found = null;
  (function walk(n) {
    (n.children || []).forEach((c) => {
      if (found) return;
      if (c.tagName === "BUTTON" && String(c.textContent).indexOf(label) >= 0) { found = c; return; }
      walk(c);
    });
  })(root);
  return found;
}

// 批量启动的处理器是 Promise 链，断言要等微任务跑完
async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
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

/* ------------------------------------------------------------------
 * 批量启动：一次起 N 条工作流，每条都要登记进任务中心。
 *
 * 这圈登记此前没有被任何测试执行过 —— DOM 替身的 addEventListener 原本是空的
 * （按钮点不动），而 workflow.test.cjs 里那个 batchSummary 夹具又刻意不带 items
 * 数组。结果就是：服务端一旦把 items 改名，循环静默地一条都不登记，套件照样全绿。
 * 下面的用例把按钮真的点起来，响应形状也按 WorkflowController.CreateBatch 的
 * 实际返回喂进去。
 * ------------------------------------------------------------------ */

function driveBatchStart(batchData) {
  return withDom({
    call: (method, path) => {
      assert.strictEqual(path, "/api/v2/workflow/create-batch", "批量启动打错了端点");
      return Promise.resolve({ ok: true, data: batchData });
    },
  }, async (ctx) => {
    const panel = mountPanel();
    const ta = findByTag(panel, "TEXTAREA");
    assert.ok(ta, "批量区要有主题输入框");
    ta.value = "秋天的第一杯奶茶\n阳台种菜翻车实录";
    const btn = findButton(panel, "批量启动");
    assert.ok(btn, "要有「批量启动」按钮");
    btn.click();
    await flush();
    return ctx.tracks;
  });
}

test("批量启动：响应里的 items 逐条登记进任务中心", async () => {
  const tracks = await driveBatchStart({
    total: 2, accepted: 2, rejected: [],
    items: [{ index: 0, workflowId: "W1", topic: "秋天的第一杯奶茶" },
            { index: 1, workflowId: "W2", topic: "阳台种菜翻车实录" }],
  });
  assert.strictEqual(tracks.length, 2, "一次批量起两条，必须登记两条");
  assert.deepStrictEqual(tracks.map((x) => x.taskId), ["W1", "W2"], "标识取 items[].workflowId");
  assert.ok(tracks.every((x) => x.domain === "workflow"), "域必须是 workflow，否则状态端点会拼错");
  assert.ok(tracks.every((x) => x.panel === "workflow"));
  // 标题带主题，用户才分得清是哪一条
  assert.ok(tracks[0].title.indexOf("秋天的第一杯奶茶") >= 0, "标题要带主题，实际：" + tracks[0].title);
  assert.ok(tracks[1].title.indexOf("阳台种菜翻车实录") >= 0, "标题要带主题，实际：" + tracks[1].title);
});

test("批量启动：只登记真起来了的（rejected 的那几条服务端压根没有记录）", async () => {
  const tracks = await driveBatchStart({
    total: 2, accepted: 1, rejected: [{ index: 1, error: "提交过于频繁" }],
    items: [{ index: 0, workflowId: "W1", topic: "秋天的第一杯奶茶" }],
  });
  assert.strictEqual(tracks.length, 1);
  assert.strictEqual(tracks[0].taskId, "W1");
});

test("批量启动：响应里没有 items 时一条都不登记（不拿 accepted 瞎编）", async () => {
  // 这条是用来看住形状的：若哪天服务端把 items 改名，下一条会红，
  // 而这一条也会把「不能拿 accepted 顶替」这个约定钉住 ——
  // 登记一条不存在的任务 = 任务中心里一条永远收敛不了的「进行中」。
  const tracks = await driveBatchStart({ total: 2, accepted: 2, rejected: [] });
  assert.strictEqual(tracks.length, 0, "拿不到逐条标识时宁可一条都不登记");
});

test("批量启动：items 里没有 workflowId 的条目不产生记录（用真正的 track 反查）", async () => {
  // 面板侧如实转发、不自己吞（吞了这条形状错误就再也看不见了），
  // 真正挡住它的是容器自己的 taskId 守卫 —— 这里用出货的 track 反查，不靠假设。
  const realTasks = require("../tasks.js");
  const before = realTasks.list().length;
  const tracks = await driveBatchStart({
    total: 1, accepted: 1, rejected: [],
    items: [{ index: 0, topic: "没有标识的一条" }],
  });
  assert.strictEqual(tracks.length, 1, "面板把这一条也交给了容器");
  assert.strictEqual(tracks[0].taskId, undefined);
  assert.strictEqual(
    realTasks.track({ domain: "workflow", taskId: tracks[0].taskId, panel: "workflow", title: "批量工作流" }),
    null);
  assert.strictEqual(realTasks.list().length, before,
    "没有标识的条目不许产生一条永远收敛不了的记录");
});

test("批量启动：任务中心容器缺席时面板照常提交，不抛给用户", async () => {
  await withDom({
    noTasks: true,
    call: () => Promise.resolve({ ok: true, data: { total: 1, accepted: 1, rejected: [], items: [{ index: 0, workflowId: "W1", topic: "a" }] } }),
  }, async () => {
    const panel = mountPanel();
    findByTag(panel, "TEXTAREA").value = "a";
    findButton(panel, "批量启动").click();   // 抛出去的话这里就是未捕获异常
    await flush();
  });
});
