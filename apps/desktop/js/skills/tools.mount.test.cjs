const test = require("node:test");
const assert = require("node:assert");

/*
 * 工具面板「视频生成」挂载测试（2026-11-03 切换到服务端异步接口）。
 *
 * 锁住的契约：
 *  1) 提交走 POST /api/doubao/generate-video（服务端默认异步，立刻回 202 + job_id），
 *     旧同步接口 /api/studio/video 不许再被调用 —— 它要把连接挂满整个生成过程，
 *     700s 左右被客户端判死，豆包侧却还在出片，那条成片就白丢了；
 *  2) 拿到 job_id 后按 GET /api/doubao/generate-video/jobs/{jobId} 轮询，
 *     queued / running 都算在跑，只有 succeeded / failed 是终态；
 *  3) 轮询期间要把阶段翻译成人话（queued/polling…不能直接铺给用户）；
 *  4) 成功内嵌播放并带模型与耗时；失败显示服务端 error 原文；
 *     任务过期（404）收敛成「已过期」而不是一直转圈。
 */

function makeClassList(node) {
  const read = () => node.className.split(/\s+/).filter(Boolean);
  return {
    add(c) { const s = read(); if (s.indexOf(c) < 0) s.push(c); node.className = s.join(" "); },
    remove(c) { node.className = read().filter((x) => x !== c).join(" "); },
    contains(c) { return read().indexOf(c) >= 0; },
  };
}

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    id: "",
    href: "",
    title: "",
    type: "",
    placeholder: "",
    value: "",
    checked: false,
    disabled: false,
    src: "",
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
    get firstChild() { return this.children[0] || null; },
    appendChild(child) {
      if (child == null) return child;
      if (Array.isArray(child)) { child.forEach((c) => this.appendChild(c)); return child; }
      if (typeof child === "string") {
        const t = { textContent: child, children: [], tagName: "#text" };
        this.children.push(t);
        return t;
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    dispatch(type) {
      const ev = { type, preventDefault() { }, stopPropagation() { }, key: "" };
      return Promise.all((this._handlers[type] || []).map((fn) => fn(ev)));
    },
    querySelector(sel) { return querySelectorAll(this, sel)[0] || null; },
    querySelectorAll(sel) { return querySelectorAll(this, sel); },
  };
  node.classList = makeClassList(node);
  return node;
}

function matches(node, sel) {
  if (sel[0] === ".") return node.classList.contains(sel.slice(1));
  if (sel[0] === "#") return node.id === sel.slice(1);
  return node.tagName === String(sel).toUpperCase();
}

function querySelectorAll(root, sel) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach((c) => {
      if (!c.tagName || c.tagName === "#text") return;
      if (matches(c, sel)) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}

function allText(n) {
  if (!n) return "";
  if (n.children && n.children.length) return n.children.map(allText).join(" ");
  return String(n.textContent == null ? "" : n.textContent);
}

// 模块级只初始化一次：window/document 必须先就位，tools.js 与 ui.js 都在加载时抓 window
global.document = {
  createElement: makeNode,
  createTextNode: (t) => ({ textContent: String(t), children: [], tagName: "#text" }),
  addEventListener() { },
};
global.window = { Skills: {} };
global.window.UI = require("../ui.js");
global.UI = global.window.UI;
require("./tools.js");

assert.ok(global.window.Skills.tools && typeof global.window.Skills.tools.mount === "function",
  "tools.js 应挂载 window.Skills.tools.mount");

// 轮询等待是 10s 一个间隔，测试里把 setTimeout 压成立即执行：
// 只影响本文件里的等待，不改变生产代码的节奏。
function withInstantTimers(fn) {
  const real = global.setTimeout;
  global.setTimeout = (cb) => real(cb, 0);
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.setTimeout = real; });
}

// 按钮的点击处理器是 fire-and-forget（withLoading 的 Promise 没被 return），
// dispatch 只等到"处理器被调用"就返回。所以必须显式等结果出现，
// 不能靠固定次数的微任务冲刷 —— 那样会偶发早于第三次轮询就断言。
async function waitUntil(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 3000)) {
    if (predicate()) return true;
    await new Promise((r) => setImmediate(r));
  }
  return predicate();
}

function mountPanel(onCall) {
  const calls = [];
  global.window.HTWApi = {
    base: "",
    resolveTarget() { return ""; },
    call(method, path, body) {
      calls.push({ method, path, body });
      return Promise.resolve(onCall(method, path, body, calls) || { ok: true, data: {} });
    },
    pollTask() { throw new Error("视频生成不应走通用 pollTask"); },
    upload() { throw new Error("视频生成不应上传文件"); },
    download() { throw new Error("视频生成不应下载文件"); },
  };
  const panel = makeNode("section");
  global.window.Skills.tools.mount(panel);
  return { panel, calls };
}

function videoCard(panel) {
  const card = querySelectorAll(panel, "div").find((c) =>
    String(c.className || "").split(/\s+/).indexOf("card") >= 0 && allText(c).indexOf("视频生成") >= 0);
  assert.ok(card, "应能找到「视频生成」卡片");
  return card;
}

function submitVideo(panel) {
  const card = videoCard(panel);
  const textarea = querySelectorAll(card, "textarea")[0];
  const btn = querySelectorAll(card, "button").pop();
  assert.ok(textarea, "应有画面描述输入框");
  assert.ok(btn, "应有生成视频按钮");
  return { card, textarea, btn };
}

test("视频生成：走异步接口，提交拿 jobId 后轮询到成功并内嵌播放", async () => {
  const jobs = [];
  const snapshots = [];
  let panelRef = null;
  // 🔴 服务端这个端点回的是手写 snake_case（api.js 的 camelize 不动 snake_case），
  // 桩数据必须照抄真实形状，否则按 camelCase 读字段的 bug 会被测试掩盖 ——
  // 第一版就是这么漏过去的：任务成功却显示「没拿到成片地址」。
  const { panel, calls } = mountPanel((method, path, body, all) => {
    if (method === "POST" && path === "/api/doubao/generate-video") {
      return {
        ok: true,
        data: {
          job_id: "job-abc",
          status: "queued",
          stage: "queued",
          retry_after_seconds: 10,
          poll_url: "/api/doubao/generate-video/jobs/job-abc",
        },
      };
    }
    if (method === "GET" && /^\/api\/doubao\/generate-video\/jobs\/job-abc$/.test(path)) {
      snapshots.push(allText(panelRef));
      const n = jobs.length;
      jobs.push(n);
      if (n === 0) return { ok: true, data: { status: "queued", stage: "queued", elapsed_seconds: 0 } };
      if (n === 1) return { ok: true, data: { status: "running", stage: "polling", elapsed_seconds: 42 } };
      return {
        ok: true,
        data: {
          status: "succeeded",
          stage: "done",
          video_url: "https://cdn.example.com/a.mp4",
          model: "seedance_v2.0",
          elapsed_seconds: 96,
          text: "5 秒柴犬奔跑",
        },
      };
    }
    return { ok: true, data: {} };
  });

  panelRef = panel;
  // 任务中心容器：提交成功必须先登记，否则面板一被切走，这条任务就再没人问了。
  const tracked = [];
  global.window.HTWTasks = { track: (o) => { tracked.push(o); return {}; } };
  const { textarea, btn } = submitVideo(panel);
  textarea.value = "一只柴犬在沙滩海边奔跑";

  await withInstantTimers(async () => {
    await btn.dispatch("click");
    await waitUntil(() => querySelectorAll(panel, "video").length > 0 || /出错了/.test(allText(panel)));
  });

  const submit = calls.filter((c) => c.method === "POST" && c.path === "/api/doubao/generate-video");
  assert.strictEqual(submit.length, 1, "必须提交到异步接口");
  assert.deepStrictEqual(submit[0].body, { prompt: "一只柴犬在沙滩海边奔跑" });

  assert.strictEqual(calls.filter((c) => /studio\/video/.test(c.path)).length, 0,
    "不许再走同步的 /api/studio/video");
  assert.strictEqual(calls.filter((c) => c.method === "GET").length, 3, "queued → running → succeeded 各轮询一次");

  const video = querySelectorAll(panel, "video")[0];
  assert.ok(video, "成功后应内嵌 <video>");
  assert.strictEqual(video.src, "https://cdn.example.com/a.mp4");

  const text = allText(panel);
  assert.match(text, /视频生成完成/);
  assert.match(text, /模型：seedance_v2\.0/);
  assert.match(text, /耗时 01:36/, "耗时应按分:秒展示");

  assert.ok(snapshots.some((s) => /排队/.test(s)), "排队阶段要显示人话，实际：" + JSON.stringify(snapshots));
  assert.ok(snapshots.some((s) => /正在生成画面/.test(s)), "轮询阶段要显示人话");
  assert.ok(snapshots.some((s) => /已等待 00:42/.test(s)), "轮询要带已等待时长");

  assert.strictEqual(tracked.length, 1, "提交成功后必须登记到任务中心（面板切走就没人再问了）");
  assert.strictEqual(tracked[0].domain, "videogen");
  assert.strictEqual(tracked[0].taskId, "job-abc", "登记的必须是服务端 jobId，不是别的 id");
  assert.strictEqual(tracked[0].panel, "tools");
  assert.match(tracked[0].title, /一只柴犬/, "标题带上描述片段，任务中心里才认得出是哪条");
  delete global.window.HTWTasks;
});

test("视频生成：任务失败显示服务端 error 原文，不留假成功", async () => {
  const { panel } = mountPanel((method, path) => {
    if (method === "POST") return { ok: true, data: { job_id: "job-bad", status: "queued", stage: "queued" } };
    if (method === "GET") {
      return { ok: true, data: { status: "failed", stage: "failed", error: "访问频繁，请稍后再试" } };
    }
    return { ok: true, data: {} };
  });

  const { textarea, btn } = submitVideo(panel);
  textarea.value = "测试失败路径";

  await withInstantTimers(async () => {
    await btn.dispatch("click");
    await waitUntil(() => /访问频繁/.test(allText(panel)));
  });

  const text = allText(panel);
  assert.match(text, /访问频繁，请稍后再试/);
  assert.strictEqual(querySelectorAll(panel, "video").length, 0, "失败时不应出现播放器");
});

test("视频生成：任务记录过期（404）收敛成明确提示，不空转到超时", async () => {
  let polls = 0;
  const { panel } = mountPanel((method) => {
    if (method === "POST") return { ok: true, data: { jobId: "job-gone", status: "queued" } };
    polls++;
    return { ok: false, code: 404, message: "请求失败" };
  });

  const { textarea, btn } = submitVideo(panel);
  textarea.value = "测试过期路径";

  await withInstantTimers(async () => {
    await btn.dispatch("click");
    await waitUntil(() => /任务记录已过期/.test(allText(panel)));
  });

  assert.strictEqual(polls, 1, "404 之后必须停止轮询");
  assert.match(allText(panel), /任务记录已过期/);
});

test("视频生成：提交失败时把服务端 error 显示出来", async () => {
  const { panel } = mountPanel((method) => {
    if (method === "POST") {
      return { ok: false, code: 400, message: "请求参数有误", raw: { success: false, error: "Prompt is required" } };
    }
    return { ok: true, data: {} };
  });

  const { textarea, btn } = submitVideo(panel);
  textarea.value = "x";

  await withInstantTimers(async () => {
    await btn.dispatch("click");
    await waitUntil(() => /Prompt is required/.test(allText(panel)));
  });

  assert.match(allText(panel), /Prompt is required/);
});
