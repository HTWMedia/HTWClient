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

// opts 说明（新增，缺省时行为与老用例一致）：
//   localOk     —— 选路判据：本机是否命中（shouldUseLocal 的返回值）
//   localState  —— api.localRouting 的内容（分因文案靠它）
//   calls       —— 收集 upload / call 的实参，供断言"发了什么、发去哪"
//   driveFetcher—— 让 pollTask 真的调 opts.fetcher（这样 draft-status 那条 GET 才会真的发出）
function mountPanel(pollResult, opts) {
  opts = opts || {};
  const calls = opts.calls || [];
  global.document = { createElement: makeNode, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const api = {
    base: "https://example.test",
    // 选路：草稿导出这条路径是否命中本机，由用例指定
    shouldUseLocal: (m, p) => opts.localOk === true && p === "/api/v2/edit/draft-export",
    localRouting: opts.localState || { enabled: false, ready: false, paired: false, compatible: false, store: null },
    localBase: opts.localOk === true ? "http://127.0.0.1:5099" : "",
    upload: (m, p, files, fields, onProgress, fileField) => {
      calls.push({ kind: "upload", m: m, p: p, fields: fields || {}, fileField: fileField || "file" });
      return Promise.resolve({ ok: true, taskId: "task-1" });
    },
    call: (m, p) => {
      calls.push({ kind: "call", m: m, p: p });
      if (opts.draftStatus && /\/api\/v2\/edit\/draft-status\//.test(p)) {
        return Promise.resolve({ ok: true, data: opts.draftStatus });
      }
      return Promise.resolve({ ok: true, data: {} });
    },
    pollTask: (id, pollOpts) => {
      // 只有显式要求时才驱动 fetcher：老用例靠 pollResult 直接给结论，
      // 让 fetcher 空跑一圈会把它们从"失败"变成"处理中"。
      if (opts.driveFetcher && pollOpts && typeof pollOpts.fetcher === "function") return pollOpts.fetcher(id);
      return Promise.resolve(pollResult);
    },
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

// ====== 草稿导出：服务端执行，但账号必须是调用方自己的 ======
//
// 2026-11-07 晚定下的三条：
//  ① 本地实例未就绪**不再**拦阻（本地实例已不下发，拦了就等于功能不可用）；
//  ② 不填登录态**必须拦下且不发请求**：站方不再用账号池代跑（htw 拍板）；
//  ③ 填了就随 form 字段提交（剥掉 "Cookie:" 前缀），进度走 draft-status 而非 edit/status。

function findById(root, id) {
  let hit = null;
  (function walk(n) {
    if (hit) return;
    if (n.id === id) { hit = n; return; }
    (n.children || []).forEach(walk);
  })(root);
  return hit;
}

function findAllByTag(root, tag) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach((c) => {
      if (c.tagName === tag) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}

async function clickDraft(panel) {
  const btn = findButtons(panel, "导出草稿")[0];
  assert.ok(btn, "应能找到「导出草稿」按钮");
  await btn.dispatch("click");
  await settle();
}

test("草稿导出：本地实例未就绪也照常提交，不再被本地门禁拦住", async () => {
  const calls = [];
  const panel = mountPanel({ ok: true, data: {} }, {
    calls: calls,
    localOk: false,
    localState: { enabled: false, ready: false, paired: false, compatible: false, store: null },
  });
  findById(panel, "edit-draft-cookie").value = "sessionid=abc; ttwid=xyz";
  await clickDraft(panel);
  const up = calls.find((c) => c.kind === "upload");
  assert.ok(up, "本地实例没就绪时也应把请求发出去（服务端执行）：" + JSON.stringify(calls));
  assert.strictEqual(up.p, "/api/v2/edit/draft-export");
  assert.ok(!/本地模式/.test(errorOf(panel) || ""),
    "不应再出现「去设置页开本地模式」的拦阻，实际：" + errorOf(panel));
});

test("草稿导出：不填登录态直接拦下，一个请求都不发", async () => {
  const calls = [];
  const panel = mountPanel({ ok: true, data: {} }, { calls: calls, localOk: false });
  await clickDraft(panel);
  const up = calls.find((c) => c.kind === "upload");
  assert.ok(!up, "没有登录态就不该提交（站方不再用账号池代跑）：" + JSON.stringify(calls));
  assert.ok(/登录态|Cookie/i.test(errorOf(panel) || ""),
    "应提示需要填登录态，实际：" + errorOf(panel));
});

test("草稿导出：登录态随 form 字段提交，进度走 draft-status，成片用服务端给的绝对地址", async () => {
  const calls = [];
  const panel = mountPanel(null, {
    calls: calls,
    localOk: false,
    driveFetcher: true,
    draftStatus: {
      taskId: "task-1", status: "completed", progress: 100,
      downloadUrl: "https://example.test/Download/draft.mp4",
    },
  });

  const cookieInput = findById(panel, "edit-draft-cookie");
  assert.ok(cookieInput, "草稿卡片应有登录态输入框 #edit-draft-cookie");
  assert.strictEqual(cookieInput.type, "password", "登录态默认应遮挡显示");
  // 从开发者工具复制常带 "Cookie: " 前缀与换行，客户端要自己剥掉
  cookieInput.value = "Cookie: sessionid=abc; ttwid=xyz\r\n";

  await clickDraft(panel);

  const up = calls.find((c) => c.kind === "upload");
  assert.ok(up, "应提交草稿： " + JSON.stringify(calls));
  assert.strictEqual(up.p, "/api/v2/edit/draft-export");
  assert.strictEqual(up.fields.jianyingCookie, "sessionid=abc; ttwid=xyz",
    "字段名必须是 jianyingCookie（后端 [FromForm]），且已剥掉 Cookie: 前缀，实际：" + JSON.stringify(up.fields));

  const polls = calls.filter((c) => c.kind === "call");
  assert.ok(polls.some((c) => /\/api\/v2\/edit\/draft-status\//.test(c.p)),
    "进度应查 draft-status：" + JSON.stringify(polls));
  assert.ok(!polls.some((c) => /\/api\/v2\/edit\/status\//.test(c.p)),
    "不许复用云端的 edit/status（粗剪/超分/包装的轮询会一起被带偏）：" + JSON.stringify(polls));

  const links = findAllByTag(panel, "A");
  const dl = links.find((a) => /Download\/draft\.mp4/.test(String(a.href || "")));
  assert.ok(dl, "应渲染成片链接，实际：" + JSON.stringify(links.map((a) => a.href)));
  assert.ok(/^https:\/\/example\.test\//.test(String(dl.href)),
    "服务端给的绝对地址原样使用，不能被二次拼前缀：" + dl.href);
});
