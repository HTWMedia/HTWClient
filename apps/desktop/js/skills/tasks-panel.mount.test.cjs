const test = require("node:test");
const assert = require("node:assert");

/*
 * 挂载冒烟 + 交互冒烟：挡住"面板一挂载就抛异常、整个 app 白屏"这类最贵的错误，
 * 以及"按钮画出来了但点下去是空动作 / 画错了场合"这类最难自己发现的错误。
 * DOM 替身与 batch.mount.test.cjs 同一套。
 */

// 真正的 tasks.js 单例：下面「清空」那条用例要用它的 clearFinished() 反查按钮文案
// 有没有说实话。必须写在任何 withDom 建立 global.window 之前 —— tasks.js 求值时会把
// 自己的单例挂到 window 上，晚一步就把它冲掉了。
const realTasks = require("../tasks.js");

const CANCELABLE = ["marketvideo", "batch", "workflow"];

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    _attrs: {},
    _handlers: {},
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
    // 这两个之前一个空实现、一个压根没接线：面板的取消、重试、下载、清空、回到面板
    // 从来没有被任何测试执行过，于是它们画错场合、点了没反应都能全绿通过。
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    click() {
      const ev = { type: "click", target: this, preventDefault() {}, stopPropagation() {} };
      (this._handlers.click || []).forEach((h) => h.call(this, ev));
    },
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

// 记录形状照 js/tasks.js 的 newTask() 抄（status 固定从 running 起步），
// 免得用例自己编出一个 store 根本不会产生的对象。
function makeTask(o) {
  return Object.assign({
    id: "t_1", taskId: "srv_1", type: null, panel: "", title: "", status: "running",
    unknown: false, progress: null, step: null, transport: "none", degraded: false,
    domain: "agent", error: null, result: null, createdAt: 0, updatedAt: 0, endedAt: null,
  }, o);
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

function withDom(opts, fn) {
  const o = Array.isArray(opts) ? { tasks: opts } : (opts || {});
  const tasks = (o.tasks || []).slice();
  const listeners = [];
  const calls = { clearFinished: 0, cancel: [], shown: [], external: [] };
  const doc = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const prevDoc = global.document;
  const prevWin = global.window;
  const prevUI = global.UI;
  global.document = doc;
  global.window = {
    App: { showPanel: (p) => calls.shown.push(p) },
    htw: { openExternal: (u) => calls.external.push(u) },
    HTWApi: { base: "https://api.example.test" },
  };
  // noStore 模拟"tasks.js 晚于 skills 加载"：面板必须退化成空状态，
  // 而不是抛出去让 mountSkills() 标成「技能加载失败」。
  if (!o.noStore) {
    global.window.HTWTasks = {
      _internal: { canCancel: (d) => CANCELABLE.indexOf(d) >= 0 },
      list: () => tasks.slice(),
      onChange: (fn) => {
        listeners.push(fn);
        return function off() {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      clearFinished: () => {
        calls.clearFinished++;
        if (o.onClearFinished) o.onClearFinished(tasks);
      },
      cancel: (id) => {
        calls.cancel.push(id);
        return o.cancel ? o.cancel(id) : Promise.resolve(true);
      },
    };
  }
  global.UI = {
    el: (tag, attrs, kids) => {
      const n = makeNode(tag);
      if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else if (k === "onclick") n.addEventListener("click", v);
        else n._attrs[k] = v;
      }
      if (kids != null) n.appendChild(kids);
      return n;
    },
    clear: (n) => { while (n && n.children.length) n.removeChild(n.children[0]); return n; },
  };
  const ctx = {
    calls,
    get listenerCount() { return listeners.length; },
    // 换一批任务并广播：等价于 store 里 emitChange()
    setTasks(next) {
      tasks.length = 0;
      (next || []).forEach((t) => tasks.push(t));
      listeners.slice().forEach((l) => l());
    },
  };
  try { return fn(ctx); } finally {
    global.document = prevDoc;
    global.window = prevWin;
    global.UI = prevUI;
  }
}

// 挂一次并把 ctx 一起交出来。交互断言必须写在 body 里（在 withDom 作用域内执行）——
// withDom 一返回 global.window 就还原了，面板里的回调在那之后再点会读到 undefined。
function mountIn(opts, body) {
  return withDom(opts, (ctx) => {
    ctx.panel = makeNode("section");
    require("./tasks-panel.js").mount(ctx.panel);
    return body ? body(ctx) : ctx;
  });
}

function mount(tasks) {
  return mountIn({ tasks: tasks }).panel;
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
  withDom({ tasks: [] }, () => require("./tasks-panel.js").mount(panel));
  assert.strictEqual(panel.children.length, first);
});

test("有任务时能看到标题", () => {
  const panel = mount([makeTask({
    id: "t1", title: "短剧创作 · 都市逆袭", panel: "shortdrama",
    progress: 62, step: "合成中", transport: "sse", degraded: true,
  })]);
  assert.ok(panel.textContent.indexOf("短剧创作") >= 0, "应显示任务标题");
});

test("progress 为 null 不崩，也不画进度条", () => {
  const panel = mount([makeTask({
    id: "t2", title: "批量 · 商品A", panel: "batch", step: "处理中",
    transport: "poll", domain: "batch",
  })]);
  assert.ok(panel.textContent.indexOf("批量") >= 0);
  assert.strictEqual(panel.querySelectorAll("tk-bar").length, 0, "没有进度就不该画条");
});

test("取消按钮：已结束的记录不给，非可取消域也不给，运行中的可取消域才有且点了真的调 cancel", () => {
  // 已结束的批量任务：store.cancel 会以「任务已结束，无需取消」拒绝，
  // 在一条做完了的记录上摆取消按钮，点了只会闪一条红字。
  const done = mountIn({ tasks: [makeTask({ id: "td", title: "做完的批量", domain: "batch", status: "done", panel: "batch" })] });
  assert.strictEqual(findButton(done.panel, "取消"), null, "已结束的记录不该有取消按钮");

  // 运行中但域不可取消（agent 没有取消接口）。
  const agent = mountIn({ tasks: [makeTask({ id: "ta", title: "运行中的创作", domain: "agent", panel: "shortdrama" })] });
  assert.strictEqual(findButton(agent.panel, "取消"), null, "不可取消的域不该有取消按钮");

  // 运行中且域可取消。
  mountIn({ tasks: [makeTask({ id: "tb", title: "运行中的批量", domain: "batch", panel: "batch" })] }, (ctx) => {
    const btn = findButton(ctx.panel, "取消");
    assert.ok(btn, "运行中的可取消任务该有取消按钮");
    btn.click();
    assert.deepStrictEqual(ctx.calls.cancel, ["tb"], "点了取消必须真的调 store.cancel");
    assert.strictEqual(btn.textContent, "取消中…", "点了要进入取消中状态");
  });
});

test("下载：只有 downloadUrl 的完成记录也能下载，且按钮不会偷偷改成切面板", () => {
  // agent 域的云端产物常只给地址不给文件名，store 会把 fileName 置空、downloadUrl 照填。
  const task = makeTask({
    id: "tdl", title: "云端成片", domain: "agent", panel: "shortdrama", status: "done",
    result: { fileName: null, downloadUrl: "/api/v2/agent/file/abc" },
  });
  mountIn({ tasks: [task] }, (ctx) => {
    const btn = findButton(ctx.panel, "下载");
    assert.ok(btn, "有 downloadUrl 就该有下载按钮，哪怕没有 fileName");
    btn.click();
    assert.deepStrictEqual(ctx.calls.external, ["https://api.example.test/api/v2/agent/file/abc"],
      "相对地址要拼上 API 基址再打开");
    assert.deepStrictEqual(ctx.calls.shown, [], "叫「下载」的按钮不许悄悄把人切去别的面板");
  });
});

test("清空按钮的文案要说明失败记录也会被删掉 —— 用真正的 store 反查", () => {
  // 前提：clearFinished() 只保留 status === "running"，失败记录确实会被删。
  const store = realTasks._internal.createStore({
    api: { subscribeTask() {}, unsubscribeTask() {} },
    saveJson() {}, loadJson() { return Promise.resolve([]); },
    setTimeout() { return null; }, clearTimeout() {}, now() { return 0; },
  });
  const rec = store.register({ domain: "agent", taskId: "srv_x", panel: "shortdrama", title: "会失败的一条" });
  store.get(rec.id).status = "failed";
  store.clearFinished();

  mountIn({ tasks: [] }, (ctx) => {
    const btn = findButton(ctx.panel, "清空");
    assert.ok(btn, "应该有清空按钮");
    assert.strictEqual(store.list().length, 0, "前提：失败记录确实被 clearFinished 删掉了");
    assert.ok(String(btn.textContent).indexOf("失败") >= 0,
      "文案必须点明失败记录也会被清掉（重试入口只长在失败记录上），实际文案：" + btn.textContent);
    btn.click();
    assert.strictEqual(ctx.calls.clearFinished, 1, "点了要真的调 store.clearFinished");
  });
});

test("重挂后订阅要指向新容器：随后的 onChange 仍然刷新面板", () => {
  withDom({ tasks: [makeTask({ id: "t1", title: "第一条" })] }, (ctx) => {
    const panel = makeNode("section");
    const mod = require("./tasks-panel.js");
    mod.mount(panel);
    mod.mount(panel);   // boot 失败兜底里 mountSkills() 会被调第二次
    mod.mount(panel);
    assert.strictEqual(ctx.listenerCount, 1, "重挂不该叠加订阅");
    ctx.setTasks([makeTask({ id: "t2", title: "第二条" })]);
    assert.ok(panel.textContent.indexOf("第二条") >= 0,
      "重挂后的 onChange 必须渲染进当前面板，不能停在首次挂载时的旧 body 上");
  });
});

test("词表外的 status 不被悄悄丢掉，显形为「未知状态」", () => {
  const panel = mount([makeTask({ id: "t9", title: "状态怪的一条", status: "weird" })]);
  assert.ok(panel.textContent.indexOf("未知状态") >= 0, "词表外状态必须显形，不能无声消失");
  assert.ok(panel.textContent.indexOf("状态怪的一条") >= 0, "记录本身要渲染出来");
});

test("title 与 taskId 都为空时也给出可辨认的标题", () => {
  const panel = mount([makeTask({ id: "t8", taskId: "", title: "", domain: "batch" })]);
  assert.ok(/未命名任务/.test(panel.textContent), "不能渲染出空标题，实际：" + panel.textContent);
});

test("任务容器缺席时退化成空状态，不抛给 mountSkills", () => {
  const ctx = mountIn({ noStore: true });
  assert.ok(ctx.panel.textContent.indexOf("尚未就绪") >= 0, "容器缺席要有提示而不是抛异常");
});
