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
    disabled: undefined,
    // input / textarea 的取值：面板读它才知道用户填了什么
    value: "",
    set textContent(v) { this._text = String(v == null ? "" : v); this.children = []; },
    get textContent() {
      if (this._text != null && !this.children.length) return this._text;
      return this.children.map((c) => c.textContent || "").join("");
    },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ""; },
    get childNodes() { return this.children; },
    appendChild(child) {
      if (child == null) return child;
      if (Array.isArray(child)) { child.forEach((c) => this.appendChild(c)); return child; }
      // 字符串按文本节点处理
      if (typeof child === "string") { this.children.push({ textContent: child, children: [] }); return child; }
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    // DOM 的 Element.append(...nodes)：复核卡就是用 box.append.apply(box, kids)
    // 一次挂多个子节点的，替身必须支持多参，否则测不到真实渲染。
    append() {
      for (let i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
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
    closest(sel) {
      const cls = String(sel).replace(/^\./, "");
      let n = this;
      while (n) {
        if (n.className && String(n.className).split(/\s+/).indexOf(cls) >= 0) return n;
        n = n.parentNode;
      }
      return null;
    },
    querySelectorAll(sel) {
      // 只支持 .class 一种选择器 —— 面板里实际用到的就这一种
      const cls = sel.replace(/^\./, "");
      const out = [];
      (function walk(n) {
        n.children.forEach((c) => {
          if (c.className && String(c.className).split(/\s+/).indexOf(cls) >= 0) out.push(c);
          if (c.querySelectorAll) walk(c);
        });
      })(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  node.classList = {
    _node: node,
    add(c) { const s = new Set(String(node.className || "").split(/\s+/).filter(Boolean)); s.add(c); node.className = [...s].join(" "); },
    remove(c) { const s = new Set(String(node.className || "").split(/\s+/).filter(Boolean)); s.delete(c); node.className = [...s].join(" "); },
    contains(c) { return String(node.className || "").split(/\s+/).indexOf(c) >= 0; },
  };
  return node;
}

// opts.call 覆盖 HTWApi.call（批量启动的响应形状就靠它喂进来），
// opts.noTasks 模拟任务中心容器缺席。
// global.UI 一并还原：交互用例各自 mountPanel()（内部 installUi），不再靠上一条
// 用例漏出的 UI 残存。
function withDom(opts, fn) {
  const o = (typeof opts === "function") ? {} : (opts || {});
  const body = (typeof opts === "function") ? opts : fn;
  const tracks = [];
  const doc = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const prevDoc = global.document;
  const prevWin = global.window;
  const prevUI = global.UI;
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
  const restore = () => { global.document = prevDoc; global.window = prevWin; global.UI = prevUI; };
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

// 语义与真实 ui.js 对齐的 UI 替身：showError 先 clear 再挂 error-box（不整区原样吞文本）。
function installUi() {
  global.UI = {
    el: (tag, attrs, kids) => {
      const n = makeNode(tag);
      if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else if (k === "onclick") n.addEventListener("click", v);
        else n[k] = v;
      }
      if (kids != null) n.appendChild(kids);
      return n;
    },
    clear: (n) => { while (n && n.children.length) n.removeChild(n.children[0]); return n; },
    showError: (region, message) => {
      UI.clear(region);
      region.appendChild(UI.el("div", { class: "error-box" }, [
        UI.el("strong", { text: "出错了" }),
        UI.el("div", { class: "error-detail", text: String(message || "") }),
      ]));
      return region;
    },
    withLoading: (btn, fn) => fn(),
    // workflow 面板的 narration 形态用 fileInput 选真人出镜素材（A-roll）
    fileInput: () => {
      const wrap = makeNode("label");
      wrap.input = makeNode("input");
      return wrap;
    },
    platformName: (p) => String(p || ""),
  };
}

function mountPanel() {
  installUi();
  const wf = require("./workflow.js");
  const panel = makeNode("section");
  wf.mount(panel);
  return panel;
}

// —— 交互测试工具 ——

function connectedToRoot(node, root) {
  let p = node;
  while (p) { if (p === root) return true; p = p.parentNode; }
  return false;
}

function bodyText(panel) {
  const body = panel.querySelectorAll("wf-body")[0] || panel;
  return body.textContent || "";
}

function tabFor(panel, text) {
  return panel.querySelectorAll("wf-tab").find((t) => (t.textContent || "").indexOf(text) >= 0);
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
    installUi();
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

/* ------------------------------------------------------------------
 * 提交结果路径（与批量面板同款回归的看护）：
 * 错误/结果提示只能写进 msg 自己（它与「开始工作流」/「批量启动」按钮同属
 * 一个 wf-section），把 UI.showError / UI.clear 打到 msg.parentNode 上会把
 * 整个表单节连按钮一起清掉 —— 症状是"点完提交，按钮凭空消失"，且同一页
 * 没法再试一次。
 * ------------------------------------------------------------------ */

test("单条提交失败（ok=false）：错误写入提示区，「开始工作流」按钮保留", async () => {
  await withDom({
    call: (method, path) => {
      assert.strictEqual(path, "/api/v2/workflow/create", "应打在工作流创建端点");
      return Promise.resolve({ ok: false, code: 400, message: "主题不能为空" });
    },
  }, async () => {
    const panel = mountPanel();
    const topic = findByTag(panel, "INPUT");
    topic.value = "秋天的第一杯奶茶";
    findButton(panel, "开始工作流").click();
    await flush();
    const go = findButton(panel, "开始工作流");
    assert.ok(go && connectedToRoot(go, panel), "提交失败后「开始工作流」按钮应还在页面上");
    assert.ok(/主题不能为空/.test(bodyText(panel)), "错误原因应可见");
  });
});

test("批量启动失败（ok=false）：错误写入提示区，「批量启动」按钮与表单保留", async () => {
  await withDom({
    call: () => Promise.resolve({ ok: false, code: 400, message: "批量启动需要更高档位" }),
  }, async () => {
    const panel = mountPanel();
    findByTag(panel, "TEXTAREA").value = "a\nb";
    findButton(panel, "批量启动").click();
    await flush();
    const btn = findButton(panel, "批量启动");
    assert.ok(btn && connectedToRoot(btn, panel), "批量启动失败后按钮应还在页面上");
    const topic = findByTag(panel, "INPUT");
    assert.ok(topic && connectedToRoot(topic, panel), "主题输入框不应随批量启动失败被清掉（msg 在主题表单那节）");
    const go = findButton(panel, "开始工作流");
    assert.ok(go && connectedToRoot(go, panel), "「开始工作流」按钮不应随批量启动失败被清掉");
    assert.ok(/批量启动需要更高档位/.test(bodyText(panel)), "失败原因应可见");
  });
});

test("批量启动部分成功：明细留在本页，按钮保留，可跳转到进行中", async () => {
  await withDom({
    call: (method, path) => {
      if (method === "POST" && path.indexOf("/api/v2/workflow/create-batch") >= 0) {
        return Promise.resolve({
          ok: true, data: {
            total: 2, accepted: 1,
            rejected: [{ index: 1, error: "提交过于频繁" }],
            items: [{ index: 0, workflowId: "W1", topic: "秋天的第一杯奶茶" }],
          },
        });
      }
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        return Promise.resolve({ ok: true, data: { items: [] } });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async (ctx) => {
    const panel = mountPanel();
    findByTag(panel, "TEXTAREA").value = "a\nb";
    findButton(panel, "批量启动").click();
    await flush();
    const btn = findButton(panel, "批量启动");
    assert.ok(btn && connectedToRoot(btn, panel), "部分成功也应保留「批量启动」按钮，不得清掉整个表单");
    const go = findButton(panel, "开始工作流");
    assert.ok(go && connectedToRoot(go, panel), "「开始工作流」按钮不得随批量启动的结果展示被清掉");
    const topic = findByTag(panel, "INPUT");
    assert.ok(topic && connectedToRoot(topic, panel), "主题输入框不得随批量启动的结果展示被清掉");
    assert.ok(/提交过于频繁/.test(bodyText(panel)), "被拒条目的原因要摊在页面上");
    const goSee = findButton(panel, "查看进行中的工作流");
    assert.ok(goSee && connectedToRoot(goSee, panel), "应有跳转按钮");
    assert.strictEqual(ctx.tracks.length, 1, "登记口径不变：只登记真起来的");
    // 跳转按钮真的能切到进行中
    goSee.click();
    await flush();
    assert.ok(tabFor(panel, "进行中").classList.contains("active"), "点跳转后「进行中」页签应高亮");
    assert.ok(/现在没有进行中的工作流/.test(bodyText(panel)), "进行中页应真的渲染出来");
  });
});

test("单条提交成功：切到「进行中」且页签高亮同步", async () => {
  await withDom({
    call: (method, path) => {
      if (method === "POST" && path.indexOf("/api/v2/workflow/create") >= 0) {
        assert.strictEqual(path, "/api/v2/workflow/create");
        return Promise.resolve({ ok: true, taskId: "W9", data: { workflowId: "W9" } });
      }
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        return Promise.resolve({ ok: true, data: { items: [] } });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async (ctx) => {
    const panel = mountPanel();
    findByTag(panel, "INPUT").value = "秋天的第一杯奶茶";
    findButton(panel, "开始工作流").click();
    await flush();
    assert.ok(tabFor(panel, "进行中").classList.contains("active"), "切到进行中后，该页签应高亮");
    assert.ok(!tabFor(panel, "发起工作流").classList.contains("active"), "发起工作流页签不应再高亮");
    assert.strictEqual(ctx.tracks.length, 1, "成功登记一条");
    assert.strictEqual(ctx.tracks[0].taskId, "W9");
  });
});

/* ------------------------------------------------------------------
 * 出片模式：视频线必须带 Mode=Full（先联网调研再写脚本）。
 * Quick 只靠模型记忆直接写，而发布文案那步是带联网搜索的 —— 2026-10-29
 * 实测两条线讲成了两个故事（成片说「校园专属账户」，文案说「数字人民币钱包」）。
 * 图文线不出片，Mode 留空即可。
 * ------------------------------------------------------------------ */

function captureCreate() {
  let body = null;
  return {
    get body() { return body; },
    call: (method, path, payload) => {
      if (method === "POST" && path.indexOf("/api/v2/workflow/create") >= 0) {
        body = payload;
        return Promise.resolve({ ok: true, data: { workflowId: "W1" } });
      }
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        return Promise.resolve({ ok: true, data: { items: [] } });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  };
}

test("单条提交：视频线带 Mode=Full", async () => {
  const cap = captureCreate();
  await withDom({ call: cap.call }, async () => {
    const panel = mountPanel();
    findByTag(panel, "INPUT").value = "秋天的第一杯奶茶";
    findButton(panel, "开始工作流").click();
    await flush();
    assert.strictEqual(cap.body.ContentType, "video");
    assert.strictEqual(cap.body.Mode, "Full", "视频线必须走 Full，否则与联网文案脱节");
  });
});

test("单条提交：图文线 Mode 留空（不出片，不需要调研）", async () => {
  const cap = captureCreate();
  await withDom({ call: cap.call }, async () => {
    const panel = mountPanel();
    findByTag(panel, "INPUT").value = "阳台种菜";
    findButton(panel, "图文文章").click();
    findButton(panel, "开始工作流").click();
    await flush();
    assert.strictEqual(cap.body.ContentType, "article");
    assert.strictEqual(cap.body.Mode, "");
  });
});

test("批量启动：视频线同样带 Mode=Full", async () => {
  let body = null;
  await withDom({
    call: (method, path, payload) => {
      if (method === "POST" && path.indexOf("/api/v2/workflow/create-batch") >= 0) {
        body = payload;
        return Promise.resolve({ ok: true, data: { total: 1, accepted: 1, rejected: [], items: [{ index: 0, workflowId: "W1", topic: "a" }] } });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const panel = mountPanel();
    findByTag(panel, "TEXTAREA").value = "a";
    findButton(panel, "批量启动").click();
    await flush();
    assert.strictEqual(body.ContentType, "video");
    assert.strictEqual(body.Mode, "Full");
  });
});

test("批量启动响应缺失（ok 无 data）：留本页说明情况，按钮保留", async () => {
  await withDom({
    call: () => Promise.resolve({ ok: true, data: null }),
  }, async () => {
    const panel = mountPanel();
    findByTag(panel, "TEXTAREA").value = "a\nb";
    findButton(panel, "批量启动").click();
    await flush();
    const btn = findButton(panel, "批量启动");
    assert.ok(btn && connectedToRoot(btn, panel), "响应异常不该把按钮清掉");
    assert.ok(!/已启动 0 条/.test(bodyText(panel)), "不得把响应异常报成「已启动 0 条」");
    assert.ok(/启动结果/.test(bodyText(panel)), "应给出「启动结果未知」的说明");
  });
});

/* ------------------------------------------------------------------
 * 数字人（AI 主播）：只挂在「口播解读」下，与「视频成片」严格分开。
 * 服务端契约：create 请求带 DigitalHumanId / DigitalHumanVoiceType /
 * DigitalHumanVoiceResourceId 三件套；缺一条服务端会整条忽略数字人，
 * 所以客户端要么三个都带，要么一个都不带。
 * ------------------------------------------------------------------ */

const DH_ITEM = {
  resourceId: "7592140027379961097",
  name: "天意-温柔",
  voiceType: "zh_female_iclvop_xstaiyangkepu",
  voiceResourceId: "7585495838223273226",
  isVip: false,
  coverUrl: "https://cdn.example.test/dh.jpg",
};

test("数字人入口只在口播解读出现，视频成片不显示", () => {
  withDom(() => {
    const panel = mountPanel();
    const dhBtn = findButton(panel, "选择数字人形象");
    assert.ok(dhBtn, "应渲染数字人选择按钮（默认隐藏）");
    assert.strictEqual(dhBtn.closest(".wf-section").style.display, "none", "视频成片不该出现数字人入口");
    findButton(panel, "口播解读").click();
    assert.strictEqual(dhBtn.closest(".wf-section").style.display, "", "口播解读应展开展示数字人入口");
  });
});

test("口播解读选数字人：提交带三件套、ARoll 清空、批量入口收起", async () => {
  let body = null;
  await withDom({
    call: (method, path, payload) => {
      if (method === "GET" && path.indexOf("/api/v2/digital-human/list") >= 0) {
        return Promise.resolve({ ok: true, data: { items: [DH_ITEM] } });
      }
      if (method === "POST" && path.indexOf("/api/v2/workflow/create") >= 0) {
        body = payload;
        return Promise.resolve({ ok: true, data: { workflowId: "W1" } });
      }
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        return Promise.resolve({ ok: true, data: { items: [] } });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const panel = mountPanel();
    findByTag(panel, "INPUT").value = "AI 芯片战";
    findButton(panel, "口播解读").click();
    findButton(panel, "选择数字人形象").click();
    await flush();
    findButton(panel, "天意-温柔").click();
    await flush();

    // 选中后：真人素材区收起，批量入口收起（create-batch 没有数字人字段）
    assert.strictEqual(findButton(panel, "批量启动").closest(".wf-section").style.display, "none",
      "选中数字人后批量入口应收起，避免静默忽略数字人");

    findButton(panel, "开始工作流").click();
    await flush();
    assert.strictEqual(body.ContentType, "narration");
    assert.strictEqual(body.DigitalHumanId, DH_ITEM.resourceId);
    assert.strictEqual(body.DigitalHumanVoiceType, DH_ITEM.voiceType);
    assert.strictEqual(body.DigitalHumanVoiceResourceId, DH_ITEM.voiceResourceId);
    assert.deepStrictEqual(body.ARollMaterialIds, [], "数字人与真人素材互斥，不应再带 A-roll");
  });
});

test("数字人选中后切回视频成片：提交不带任何数字人字段", async () => {
  let body = null;
  await withDom({
    call: (method, path, payload) => {
      if (method === "GET" && path.indexOf("/api/v2/digital-human/list") >= 0) {
        return Promise.resolve({ ok: true, data: { items: [DH_ITEM] } });
      }
      if (method === "POST" && path.indexOf("/api/v2/workflow/create") >= 0) {
        body = payload;
        return Promise.resolve({ ok: true, data: { workflowId: "W1" } });
      }
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        return Promise.resolve({ ok: true, data: { items: [] } });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const panel = mountPanel();
    findByTag(panel, "INPUT").value = "秋天的第一杯奶茶";
    findButton(panel, "口播解读").click();
    findButton(panel, "选择数字人形象").click();
    await flush();
    findButton(panel, "天意-温柔").click();
    await flush();
    findButton(panel, "视频成片").click();
    findButton(panel, "开始工作流").click();
    await flush();
    assert.strictEqual(body.ContentType, "video");
    assert.ok(!("DigitalHumanId" in body), "视频成片不得携带数字人字段");
    assert.ok(!("DigitalHumanVoiceType" in body));
    assert.ok(!("DigitalHumanVoiceResourceId" in body));
  });
});

/* ------------------------------------------------------------------
 * 轮询去重：终止转进（某条跑到终态）会 renderRunning 重画并给仍在跑的
 * 条目重新 track —— 旧计时器若不撤，同一分钟会对同一条发出多份
 * status 查询，且计时器条数会随每次反复越滚越多。
 * ------------------------------------------------------------------ */

test("轮询不叠加：一条到终态重画后，仍在跑的条目只有一个轮询计时器", async () => {
  const statusSeen = { W1: 0, W2: 0 };
  let historyCalls = 0;
  await withDom({
    call: (method, path) => {
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        historyCalls++;
        const items = historyCalls === 1
          ? [
              { workflowId: "W1", topic: "t1", stage: "produce", createdAt: "2026-10-28T10:00:00" },
              { workflowId: "W2", topic: "t2", stage: "compose", createdAt: "2026-10-28T10:00:00" },
            ]
          : [
              // 第 2 次：W1 已到终态，不再出现在盯守列表里
              { workflowId: "W2", topic: "t2", stage: "compose", createdAt: "2026-10-28T10:00:00" },
            ];
        return Promise.resolve({ ok: true, data: { items } });
      }
      if (method === "GET" && path.indexOf("/api/v2/workflow/status?workflowId=W1") >= 0) {
        statusSeen.W1++;
        return Promise.resolve({ ok: true, data: { workflowId: "W1", stage: "done" } });
      }
      if (method === "GET" && path.indexOf("/api/v2/workflow/status?workflowId=W2") >= 0) {
        statusSeen.W2++;
        return Promise.resolve({ ok: true, data: { workflowId: "W2", stage: "compose" } });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = mountPanel();
      tabFor(panel, "进行中").click();
      await flush();
      assert.strictEqual(historyCalls, 1, "前提：进行中页首次加载");
      // 第一个轮询窗口：W1、W2 各被问一次
      mock.timers.tick(6000);
      await flush();
      assert.strictEqual(statusSeen.W1, 1, "W1 首个窗口问一次");
      assert.strictEqual(statusSeen.W2, 1, "W2 首个窗口问一次");
      // W1 到终态 → clearInterval + renderRunning：第 2 次 history 给出只剩 W2
      // → track(W2) 若不去重，旧 W2 计时器还挂着，下一个窗口会问两次
      mock.timers.tick(6000);
      await flush();
      assert.strictEqual(statusSeen.W1, 1, "W1 到终态后不得再被轮询");
      assert.strictEqual(statusSeen.W2, 2, "W2 在下一个窗口只应被问一次（计时器去重）");
      // 再过一个窗口，同样只问一次
      mock.timers.tick(6000);
      await flush();
      assert.strictEqual(statusSeen.W2, 3, "去重后每个 6 秒窗口恰好一次");
    } finally {
      mock.timers.reset();
    }
  });
});

/* ------------------------------------------------------------------
 * 终态提示：盯守中的工作流到终态（最常见是失败）会被 isWatching 过滤出
 * 「进行中」列表 —— 用户眼里的症状是「出片中的卡片凭空消失了」，失败原因
 * 只能去历史页的小字里找。track 的终态分支必须把「哪条结束了、为什么」
 * 留一条提示在「进行中」页上（root 在同一次挂载内持续存活，提示也随之驻留）。
 * ------------------------------------------------------------------ */

test("终态提示：盯守中的工作流失败后，「进行中」留下带原因的结束提示，切页签回来仍在", async () => {
  let historyCalls = 0;
  let statusW1 = 0;
  await withDom({
    call: (method, path) => {
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        historyCalls++;
        const items = historyCalls === 1
          ? [
              { workflowId: "W1", topic: "高原旅行九个鲜为人知的取景点", stage: "produce", createdAt: "2026-10-28T10:12:00" },
              { workflowId: "W2", topic: "t2", stage: "compose", createdAt: "2026-10-28T10:00:00" },
            ]
          : [
              // W1 已终态，不再出现在盯守列表里
              { workflowId: "W2", topic: "t2", stage: "compose", createdAt: "2026-10-28T10:00:00" },
            ];
        return Promise.resolve({ ok: true, data: { items } });
      }
      if (path.indexOf("/api/v2/workflow/status?workflowId=W1") >= 0) {
        statusW1++;
        // 真实形状：合规闸拦下，stage=failed 且带原因（服务端原样文案）
        return Promise.resolve({
          ok: true,
          data: {
            workflowId: "W1", topic: "高原旅行九个鲜为人知的取景点",
            stage: "failed", error: "合规检查未通过：检测到风险点，发布前请复核",
          },
        });
      }
      if (path.indexOf("/api/v2/workflow/status?workflowId=W2") >= 0) {
        return Promise.resolve({ ok: true, data: { workflowId: "W2", topic: "t2", stage: "compose" } });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = mountPanel();
      tabFor(panel, "进行中").click();
      await flush();
      assert.strictEqual(historyCalls, 1, "前提：进行中页首次加载");
      // 第一个窗口：W1 报告失败终态
      mock.timers.tick(6000);
      await flush();
      assert.strictEqual(statusW1, 1, "前提：W1 被问过一次");
      // 失败原因必须留在「进行中」页面上，而不是卡片静默消失
      assert.ok(bodyText(panel).indexOf("高原旅行九个鲜为人知的取景点") >= 0,
        "结束提示要写明是哪一条（主题）");
      assert.ok(bodyText(panel).indexOf("合规检查未通过：检测到风险点，发布前请复核") >= 0,
        "失败原因要可见，不能只去历史页找");
      // 切走再切回来：同一次挂载内提示不丢
      tabFor(panel, "发起工作流").click();
      await flush();
      tabFor(panel, "进行中").click();
      await flush();
      assert.ok(bodyText(panel).indexOf("合规检查未通过：检测到风险点，发布前请复核") >= 0,
        "切页签回来提示仍在");
      // 仍在跑的 W2 轮询口径不变：每窗口一次
      mock.timers.tick(6000);
      await flush();
      assert.strictEqual(statusW1, 1, "失败的那条不再被轮询");
    } finally {
      mock.timers.reset();
    }
  });
});

/* ------------------------------------------------------------------
 * 取消即时提示：不是只有「跑到终态」会让人一头雾水 —— 点了「取消」
 * 成功后卡片随即消失（isWatching 过滤掉 cancelled），不在成功路径上
 * 当场留一句话，用户面对的就是「我点了取消，然后什么都没发生」。
 * 取消的即时提示与随后计时器拿回的真实 cancelled 记录按 workflowId
 * 去重，不得双提示。
 * ------------------------------------------------------------------ */

test("取消即时留痕：取消成功后「进行中」当场出现已取消提示，且与随后真实取消记录去重", async () => {
  let historyCalls = 0;
  let statusW1 = 0;
  let cancelCalls = 0;
  await withDom({
    call: (method, path) => {
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        historyCalls++;
        // 第 2 次重画：W1 已是 cancelled，被 isWatching 过滤出盯守列表
        const items = historyCalls === 1
          ? [{ workflowId: "W1", topic: "取消也要留痕", stage: "produce", createdAt: "2026-10-28T10:00:00" }]
          : [];
        return Promise.resolve({ ok: true, data: { items } });
      }
      if (method === "POST" && path.indexOf("/api/v2/workflow/cancel") >= 0) {
        cancelCalls++;
        return Promise.resolve({ ok: true, data: {} });
      }
      if (path.indexOf("/api/v2/workflow/status?workflowId=W1") >= 0) {
        statusW1++;
        // 取消请求成功后的真实形状：stage=cancelled（服务端原样文案）
        return Promise.resolve({
          ok: true,
          data: { workflowId: "W1", topic: "取消也要留痕", stage: "cancelled" },
        });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = mountPanel();
      tabFor(panel, "进行中").click();
      await flush();
      assert.strictEqual(historyCalls, 1, "前提：进行中页首次加载");
      const cancelBtn = findButton(panel, "取消");
      assert.ok(cancelBtn, "前提：盯守中的条目带「取消」按钮");
      cancelBtn.click();
      await flush();
      assert.strictEqual(cancelCalls, 1, "前提：取消请求发出过一次");
      assert.strictEqual(historyCalls, 2, "取消成功应触发一次重画（第 2 次 history）");
      const text = bodyText(panel);
      assert.ok(text.indexOf("已取消") >= 0, "取消成功要当场留提示，不能只有卡片静默消失");
      assert.ok(text.indexOf("取消也要留痕") >= 0, "提示要写明是哪一条（主题）");
      // 随后计时器拿回真实 cancelled 记录：按 workflowId 去重，仍是恰一条，且不再重复轮询
      mock.timers.tick(6000);
      await flush();
      const text2 = bodyText(panel);
      assert.strictEqual(text2.split("已结束").length - 1, 1, "即时提示与真实取消记录去重，不得双提示");
      assert.ok(text2.indexOf("已取消") >= 0 && text2.indexOf("取消也要留痕") >= 0,
        "去重之后提示仍在，口径与真实记录一致");
      assert.strictEqual(statusW1, 1, "取消后的真实状态拿到即停，不得重复轮询");
    } finally {
      mock.timers.reset();
    }
  });
});

/* ------------------------------------------------------------------
 * 复核面板（2026-10-29 实测缺陷回归）：
 * 1) box.appendChild.apply(box, kids) 只挂第一个子节点 —— 复核卡只剩标题，
 *    正文、合规、候选标题和「确认发布/再等等」全被吞掉；
 * 2) 复核数据必须来自 status：history 列表项没有 content/tags/
 *    compliance/titleCandidates，拿它渲染等于让人盲确认；
 * 3) 连点「查看并确认发布」会叠出多张卡。
 * ------------------------------------------------------------------ */

function reviewStatusStub(extra, onApprove) {
  return (method, path, body) => {
    if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
      return Promise.resolve({
        ok: true,
        data: {
          items: [{
            workflowId: "W1", topic: "秋天的第一杯奶茶", stage: "awaiting-publish",
            title: "系统标题", createdAt: "2026-10-28T10:00:00",
          }],
        },
      });
    }
    if (path.indexOf("/api/v2/workflow/status?workflowId=W1") >= 0) {
      return Promise.resolve({
        ok: true,
        data: Object.assign({
          workflowId: "W1", topic: "秋天的第一杯奶茶", stage: "awaiting-publish",
          title: "系统标题",
          content: "这是即将发布的正文。",
          tags: '["奶茶","秋天"]',
          compliance: '{"evaluated":true,"safe":true,"note":""}',
          titleCandidates: [
            { title: "系统标题", score: 80, reasons: ["大纲"] },
            { title: "秋天必喝清单", score: 61, reasons: ["有钩子"] },
          ],
          downloadUrl: "https://cdn.example.test/a.mp4",
        }, extra || {}),
      });
    }
    if (method === "POST" && path.indexOf("/api/v2/workflow/approve") >= 0) {
      return Promise.resolve(onApprove ? onApprove(body) : { ok: true, data: {} });
    }
    return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
  };
}

async function openFirstReview() {
  const panel = mountPanel();
  tabFor(panel, "进行中").click();
  await flush();
  findButton(panel, "查看并确认发布").click();
  await flush();
  return panel;
}

test("复核面板：把 status 的完整内容挂进卡里（正文/标签/合规/候选/确认与返回按钮）", async () => {
  await withDom({ call: reviewStatusStub() }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = await openFirstReview();
      const reviews = panel.querySelectorAll("wf-review");
      assert.strictEqual(reviews.length, 1, "点一次只应有一张复核卡");
      const text = reviews[0].textContent;
      assert.ok(text.indexOf("这是即将发布的正文。") >= 0, "正文不得被 appendChild 吞掉");
      assert.ok(text.indexOf("#奶茶") >= 0 && text.indexOf("#秋天") >= 0, "标签要可见");
      assert.ok(text.indexOf("合规检查通过") >= 0, "合规结论要可见");
      assert.ok(text.indexOf("秋天必喝清单") >= 0, "标题候选要可见");
      assert.ok(findButton(reviews[0], "确认发布"), "必须能点确认发布");
      assert.ok(findButton(reviews[0], "再等等"), "必须能关掉复核卡");
      assert.ok(findButton(reviews[0], "先看成片"), "有成片时给预览入口");
    } finally {
      mock.timers.reset();
    }
  });
});

test("复核面板：连点「查看并确认发布」不叠第二张卡", async () => {
  await withDom({ call: reviewStatusStub() }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = mountPanel();
      tabFor(panel, "进行中").click();
      await flush();
      const btn = findButton(panel, "查看并确认发布");
      btn.click();
      btn.click();          // 连点：第二次不得再请求/再挂一张
      await flush();
      assert.strictEqual(panel.querySelectorAll("wf-review").length, 1);
    } finally {
      mock.timers.reset();
    }
  });
});

test("复核面板：标题候选再点一次取消选择，退回系统标题", async () => {
  await withDom({ call: reviewStatusStub() }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = await openFirstReview();
      const review = panel.querySelectorAll("wf-review")[0];
      const cands = review.querySelectorAll("wf-title-cand");
      assert.strictEqual(cands.length, 2);
      assert.ok(cands[0].classList.contains("is-current"), "初始高亮当前标题");

      cands[1].click();
      assert.ok(review.querySelector("wf-title-picked").textContent.indexOf("秋天必喝清单") >= 0,
        "选中候选后应显示将使用的标题");
      assert.ok(cands[1].classList.contains("is-current") && !cands[0].classList.contains("is-current"));

      cands[1].click();
      assert.ok(review.querySelector("wf-title-picked").textContent.indexOf("系统标题") >= 0,
        "再点已选中的候选必须退回系统标题（旧实现取消不掉）");
      assert.ok(cands[0].classList.contains("is-current"), "高亮应回到当前标题");
    } finally {
      mock.timers.reset();
    }
  });
});

test("复核面板：合规发现风险时展示风险等级与 Issues，确认时带 AcknowledgeRisk", async () => {
  let approveBody = null;
  const stub = reviewStatusStub({
    compliance: '{"evaluated":true,"safe":false,"note":"检测到风险点",'
      + '"riskLevel":"medium","issues":["绝对化用语","疑似引流"]}',
  }, (body) => { approveBody = body; return { ok: true, data: {} }; });

  await withDom({ call: stub }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = await openFirstReview();
      const review = panel.querySelectorAll("wf-review")[0];
      const text = review.textContent;
      assert.ok(text.indexOf("发现风险") >= 0, "必须明说合规发现了风险");
      assert.ok(text.indexOf("风险等级：中") >= 0, "风险等级要翻译成人话");
      assert.ok(text.indexOf("绝对化用语") >= 0 && text.indexOf("疑似引流") >= 0,
        "Issues 必须逐条展示，不能只给一句『未通过』");
      assert.ok(!findButton(review, "确认发布"),
        "有风险时不能再出现普通『确认发布』按钮，以免误点");
      findButton(review, "我已确认风险，仍然发布").click();
      await flush();
      assert.ok(approveBody, "点击后应发出 approve 请求");
      assert.strictEqual(approveBody.AcknowledgeRisk, true,
        "人工确认风险后请求体必须带 AcknowledgeRisk");
    } finally {
      mock.timers.reset();
    }
  });
});

test("复核面板：没有合规结论时不带 AcknowledgeRisk（没判定 ≠ 用户确认过风险）", async () => {
  let approveBody = null;
  const stub = reviewStatusStub({
    compliance: '{"evaluated":false,"safe":false,"riskLevel":"unknown","note":"合规服务暂时不可用"}',
  }, (body) => { approveBody = body; return { ok: false, code: 400, message: "合规检查没跑完" }; });

  await withDom({ call: stub }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = await openFirstReview();
      const review = panel.querySelectorAll("wf-review")[0];
      assert.ok(review.textContent.indexOf("没有合规检查结论") >= 0);
      assert.ok(review.textContent.indexOf("合规服务暂时不可用") >= 0, "原因要原样透出");
      const btn = findButton(review, "确认发布");
      assert.ok(btn, "没判定过仍可尝试提交，由服务端把关");
      btn.click();
      await flush();
      assert.strictEqual(approveBody.AcknowledgeRisk, undefined,
        "未判定时绝不能替用户声明『已确认风险』");
    } finally {
      mock.timers.reset();
    }
  });
});

test("进行中卡片：warning 必须可见（非致命降级不能只留在日志里）", async () => {
  const stub = (method, path) => {
    if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
      return Promise.resolve({
        ok: true,
        data: {
          items: [{
            workflowId: "W2", topic: "主题", stage: "compose",
            title: "", createdAt: "2026-10-28T10:00:00",
            warning: "缩略图未生成：生图服务没有返回图片",
          }],
        },
      });
    }
    return Promise.resolve({ ok: true, data: {} });
  };
  await withDom({ call: stub }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = mountPanel();
      tabFor(panel, "进行中").click();
      await flush();
      assert.ok(bodyText(panel).indexOf("缩略图未生成") >= 0, "warning 必须显示在卡片上");
    } finally {
      mock.timers.reset();
    }
  });
});

test("复核打开时若已不是待确认（别处处理过），不开卡而刷新列表", async () => {
  await withDom({ call: reviewStatusStub({ stage: "completed" }) }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = await openFirstReview();
      assert.strictEqual(panel.querySelectorAll("wf-review").length, 0,
        "状态已变就不该再给复核入口");
    } finally {
      mock.timers.reset();
    }
  });
});

/* ------------------------------------------------------------------
 * 页签竞态（2026-10-29 实测）：
 * 轮询终态分支直接 renderRunning(root)，而 root 是三个页签共用的 body。
 * 用户正在「发起工作流」填主题时，另一条到终态就把整张表单冲掉；
 * 页签高亮还停在「发起工作流」。终态重画必须只看当前页签。
 * ------------------------------------------------------------------ */

test("轮询终态不冲掉其它页签：在发起页时到终态，表单保留，切回进行中仍看到结束提示", async () => {
  let historyCalls = 0;
  let statusCalls = 0;
  await withDom({
    call: (method, path) => {
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        historyCalls++;
        return Promise.resolve({
          ok: true,
          data: {
            items: historyCalls === 1
              ? [{ workflowId: "W1", topic: "跑到一半", stage: "produce", createdAt: "2026-10-28T10:00:00" }]
              : [],
          },
        });
      }
      if (path.indexOf("/api/v2/workflow/status?workflowId=W1") >= 0) {
        statusCalls++;
        return Promise.resolve({
          ok: true,
          data: { workflowId: "W1", topic: "跑到一半", stage: "completed" },
        });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = mountPanel();
      tabFor(panel, "进行中").click();
      await flush();
      tabFor(panel, "发起工作流").click();
      await flush();
      const topic = findByTag(panel, "INPUT");
      topic.value = "我正在填的主题";

      mock.timers.tick(6000);
      await flush();
      assert.strictEqual(statusCalls, 1, "前提：终态被问到");

      const after = findByTag(panel, "INPUT");
      assert.ok(after && after.parentNode, "发起表单不得被后台重画整份冲掉");
      assert.strictEqual(after.value, "我正在填的主题", "已填主题不得丢失");
      assert.ok(tabFor(panel, "发起工作流").classList.contains("active"), "页签高亮不应错位");
      assert.ok(bodyText(panel).indexOf("已结束") < 0, "不得把进行中的内容画到发起页上");

      tabFor(panel, "进行中").click();
      await flush();
      const text = bodyText(panel);
      assert.ok(text.indexOf("跑到一半") >= 0 && text.indexOf("已完成") >= 0,
        "切回进行中后，结束提示仍要在（root._wfExits 不丢）");
      assert.ok(text.indexOf("现在没有进行中的工作流") >= 0);
    } finally {
      mock.timers.reset();
    }
  });
});

/* ------------------------------------------------------------------
 * 发起表单的本地状态：页签往返不重置（形态/主题/平台勾选）。
 * ------------------------------------------------------------------ */

test("页签往返不丢发起表单：主题、内容形态、平台勾选都保留", async () => {
  await withDom(async () => {
    const panel = mountPanel();
    const topic = findByTag(panel, "INPUT");
    topic.value = "保留我";
    findButton(panel, "图文文章").click();

    const plat = panel.querySelectorAll("wf-plat")[0];
    const cb = plat.children.find((c) => c.tagName === "INPUT");
    assert.strictEqual(cb.checked, true, "抖音默认勾选");
    cb.checked = false;
    (cb._handlers.change || []).forEach((fn) => fn({ type: "change" }));

    tabFor(panel, "历史").click();
    await flush();
    tabFor(panel, "发起工作流").click();
    await flush();

    const topicAgain = findByTag(panel, "INPUT");
    assert.strictEqual(topicAgain.value, "保留我", "主题不得被页签往返清空");
    const activeType = panel.querySelectorAll("wf-type").find((x) => x.classList.contains("active"));
    assert.strictEqual(activeType.textContent, "图文文章", "内容形态不得被重置");
    const platAgain = panel.querySelectorAll("wf-plat")[0];
    assert.strictEqual(platAgain.children.find((c) => c.tagName === "INPUT").checked, false,
      "用户取消的平台勾选不得被重置");
  });
});

test("空提交提示随输入消失（主题与批量两份）", async () => {
  await withDom(async () => {
    const panel = mountPanel();
    findButton(panel, "开始工作流").click();
    await flush();
    assert.ok(bodyText(panel).indexOf("请先填主题") >= 0);

    const topic = findByTag(panel, "INPUT");
    topic.value = "填了";
    (topic._handlers.input || []).forEach((fn) => fn({ type: "input" }));
    assert.ok(bodyText(panel).indexOf("请先填主题") < 0, "填了主题后提示应消失");

    findButton(panel, "批量启动").click();
    await flush();
    assert.ok(bodyText(panel).indexOf("请先填写至少一个主题") >= 0);

    const ta = findByTag(panel, "TEXTAREA");
    ta.value = "a";
    (ta._handlers.input || []).forEach((fn) => fn({ type: "input" }));
    assert.ok(bodyText(panel).indexOf("请先填写至少一个主题") < 0, "填了批量主题后提示应消失");
  });
});

test("「待你确认」放慢轮询：6 秒窗口不问，30 秒窗口才问一次且不停更", async () => {
  let statusCalls = 0;
  await withDom({
    call: (method, path) => {
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        return Promise.resolve({
          ok: true,
          data: {
            items: [{
              workflowId: "W1", topic: "等你确认", stage: "awaiting-publish",
              title: "标题", createdAt: "2026-10-28T10:00:00",
            }],
          },
        });
      }
      if (path.indexOf("/api/v2/workflow/status?workflowId=W1") >= 0) {
        statusCalls++;
        return Promise.resolve({
          ok: true,
          data: { workflowId: "W1", topic: "等你确认", stage: "awaiting-publish" },
        });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = mountPanel();
      tabFor(panel, "进行中").click();
      await flush();
      mock.timers.tick(6000);
      await flush();
      assert.strictEqual(statusCalls, 0, "待确认是静息态，6 秒窗口不该打扰服务端");
      mock.timers.tick(24000);
      await flush();
      assert.strictEqual(statusCalls, 1, "30 秒窗口问一次");
    } finally {
      mock.timers.reset();
    }
  });
});

/* ------------------------------------------------------------------
 * 图文文章：downloadUrl 是封面 JPG，不是成片。按钮沿用「成片」会让人
 * 以为文章也生成了视频（2026-10-29 实测 article 下载到 .jpg）。
 * ------------------------------------------------------------------ */

test("图文文章：下载/预览按钮说「封面」而不是「成片」", async () => {
  await withDom({
    call: (method, path) => {
      if (method === "GET" && path.indexOf("/api/v2/workflow/history") >= 0) {
        return Promise.resolve({
          ok: true,
          data: {
            items: [{
              workflowId: "W2", topic: "阳台种菜新手最容易犯的三个错",
              contentType: "article", stage: "awaiting-publish",
              title: "阳台种菜新手最容易犯的三个错，你中了几个？",
              downloadUrl: "/MediaFiles/cover_x.jpg",
              createdAt: "2026-10-29T07:25:00",
            }],
          },
        });
      }
      if (path.indexOf("/api/v2/workflow/status?workflowId=W2") >= 0) {
        return Promise.resolve({
          ok: true,
          data: {
            workflowId: "W2", contentType: "article", stage: "awaiting-publish",
            title: "阳台种菜新手最容易犯的三个错，你中了几个？",
            content: "文章正文。", tags: '["阳台种菜"]',
            downloadUrl: "/MediaFiles/cover_x.jpg",
          },
        });
      }
      return Promise.resolve({ ok: false, code: 500, message: "stub 未处理：" + path });
    },
  }, async () => {
    const mock = require("node:test").mock;
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const panel = mountPanel();
      tabFor(panel, "进行中").click();
      await flush();
      assert.ok(findButton(panel, "下载封面"), "图文卡片的下载按钮应说「封面」");
      assert.ok(!findButton(panel, "下载成片"), "不得把封面叫成成片");
      findButton(panel, "查看并确认发布").click();
      await flush();
      const review = panel.querySelectorAll("wf-review")[0];
      assert.ok(review, "复核卡要打开");
      assert.ok(findButton(review, "先看封面"), "复核卡的预览按钮应说「封面」");
      assert.ok(!findButton(review, "先看成片"));
    } finally {
      mock.timers.reset();
    }
  });
});
