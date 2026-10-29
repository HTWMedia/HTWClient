const test = require("node:test");
const assert = require("node:assert");

/*
 * 选题面板挂载测试。锁住几条曾经真实踩过的坑：
 *  1) 写操作必须 POST 到动词路径 —— 生产网关只放行 GET/POST，PUT/DELETE 会在路由之前变 405；
 *  2) 接口回 ok:false 时不能当成成功（不感兴趣 / 忽略 / 移除都是这样栽过）；
 *  3) 效果页的调权备注读 reason（服务端字段），并显示 from → to 的权重变化；
 *  4) 画像关键词只按分隔符切，「AI 工具」不能被拆成两个词；
 *  5) 「去创作」要把标题写进创作面板并跳过去（PRD §4.1），不能只复制。
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

const flush = () => Promise.resolve().then(() => new Promise((r) => setImmediate(r)));
async function settle() { for (let i = 0; i < 8; i++) await flush(); }

function allText(n) {
  if (!n) return "";
  if (n.children && n.children.length) return n.children.map(allText).join(" ");
  return String(n.textContent == null ? "" : n.textContent);
}

function findButtons(root, text) {
  return querySelectorAll(root, "button").filter((b) => String(b.textContent || "").trim() === text);
}

function findTab(root, text) {
  return findButtons(root, text)[0];
}

async function openTab(panel, text) {
  const tab = findTab(panel, text);
  assert.ok(tab, "应能找到页签：" + text);
  await tab.dispatch("click");
  await settle();
  return tab;
}

function findInputByPlaceholder(root, ph) {
  return querySelectorAll(root, "input").filter((i) => i.placeholder === ph)[0];
}

// 模块级只初始化一次：window/document 必须先就位，topics.js 与 ui.js 都在加载时抓 window
global.document = {
  createElement: makeNode,
  createTextNode: (t) => ({ textContent: String(t), children: [], tagName: "#text" }),
  // ui.js 加载时会挂一个全局 click 代理（把 markdown 链接交给系统浏览器），这里只需存在
  addEventListener() { },
};
global.window = { Skills: {} };
global.window.UI = require("../ui.js");
// 浏览器里 UI 是全局，Node 里要显式补上（topics.js 内部直接用裸 UI）
global.UI = global.window.UI;
require("./topics.js");

assert.ok(global.window.Skills.topics && typeof global.window.Skills.topics.mount === "function",
  "topics.js 应挂载 window.Skills.topics.mount");

function mountPanel(routes) {
  const calls = [];
  global.window.HTWApi = {
    base: "",
    call(method, path, body) {
      calls.push({ method, path, body });
      const h = routes[method + " " + path] || routes[path];
      if (typeof h === "function") return Promise.resolve(h(method, path, body));
      if (h !== undefined) return Promise.resolve(h);
      return Promise.resolve({ ok: true, data: {} });
    },
  };
  const panel = makeNode("section");
  global.window.Skills.topics.mount(panel);
  return { panel, calls };
}

function callsTo(calls, method, path) {
  return calls.filter((c) => c.method === method && c.path === path);
}

test("对标雷达：移除账号走 POST /accounts/{id}/delete，失败时留在原地并提示", async () => {
  const { panel, calls } = mountPanel({
    "GET /api/v2/topics/daily": { ok: true, data: { cards: [] } },
    "GET /api/v2/topics/radar/accounts": {
      ok: true,
      data: {
        accounts: [{ id: 42, name: "隔壁老王", platform: "bilibili", baseline_plays: 8000, samples: 3, last: "2026-10-29T10:00:00", health: "ok", url: "https://space.bilibili.com/1" }],
        alerts: [],
      },
    },
    "POST /api/v2/topics/radar/accounts/42/delete": { ok: false, message: "账号不存在" },
  });

  await openTab(panel, "对标雷达");
  assert.match(allText(panel), /隔壁老王/);
  assert.match(allText(panel), /B站/, "账号行应显示平台名");

  const remove = findButtons(panel, "移除")[0];
  assert.ok(remove, "应有「移除」按钮");
  await remove.dispatch("click");
  assert.strictEqual(String(remove.textContent).trim(), "确认移除", "第一次点击只进入确认态");

  await remove.dispatch("click");
  await settle();

  assert.strictEqual(callsTo(calls, "POST", "/api/v2/topics/radar/accounts/42/delete").length, 1,
    "移除必须 POST 到动词路径");
  assert.strictEqual(calls.filter((c) => c.method === "DELETE").length, 0, "不应再发 DELETE（生产网关 405）");
  assert.match(allText(panel), /账号不存在/, "失败必须显示出来，不能被当成移除成功");
  assert.strictEqual(String(remove.textContent).trim(), "移除", "失败后按钮要恢复可点");
  assert.strictEqual(remove.disabled, false);
});

test("垂类画像：保存走 POST /profile/save，关键词按逗号/顿号切而不用空白切", async () => {
  const { panel, calls } = mountPanel({
    "GET /api/v2/topics/daily": { ok: true, data: { cards: [] } },
    "GET /api/v2/topics/profile": {
      ok: true,
      data: { available_platforms: ["bilibili", "douyin"], platforms: ["bilibili"], include_keywords: [], exclude_keywords: [], audience: "" },
    },
    "POST /api/v2/topics/profile/save": { ok: true, data: {} },
  });

  await openTab(panel, "垂类画像");
  const inc = findInputByPlaceholder(panel, "想多看到的关键词，逗号分隔，如：AI 工具, 效率");
  assert.ok(inc, "应有「想多看到的关键词」输入框");
  inc.value = "AI 工具，副业、效率; 职场 成长";

  const save = findButtons(panel, "保存画像")[0];
  await save.dispatch("click");
  await settle();

  const sent = callsTo(calls, "POST", "/api/v2/topics/profile/save");
  assert.strictEqual(sent.length, 1, "保存必须 POST /profile/save");
  assert.deepStrictEqual(sent[0].body.IncludeKeywords, ["AI 工具", "副业", "效率", "职场 成长"],
    "空白不是分隔符：「AI 工具」必须保持一个词");
  assert.deepStrictEqual(sent[0].body.Platforms, ["bilibili"]);
  assert.strictEqual(calls.filter((c) => c.method === "PUT").length, 0, "不应再发 PUT（生产网关 405）");
  assert.match(allText(panel), /已保存/);
});

test("今日选题：不感兴趣失败时不显示成功，错误写在卡片里", async () => {
  global.window.App = { showPanel() { } };
  global.window.Skills.create = { setTopic() { } };
  const { panel, calls } = mountPanel({
    "GET /api/v2/topics/daily": {
      ok: true,
      data: {
        date: "2026-10-29",
        profile_set: true,
        cards: [{
          id: "tp_20261029_001",
          title: "打工人一周备餐指南",
          category: "美食",
          score: 87,
          evidence: { type: "peer", refTitle: "本周备餐挑战", metricValue: "5.2×", refUrl: "https://www.xiaohongshu.com/explore/x" },
        }, {
          // 服务端在无趋势时给的 MetricValue 自带前导「·」，直接拼接会出现「· · 数据积累中」
          id: "tp_20261029_002",
          title: "西班牙宣布全国哀悼3天",
          category: "热榜趋势",
          score: 81,
          evidence: { type: "hot", refTitle: "热榜 · 热度 3386.7万", metricValue: "· 数据积累中" },
        }],
      },
    },
    "POST /api/v2/topics/feedback": { ok: false, message: "记录失败：请求过于频繁" },
  });

  await settle();
  assert.match(allText(panel), /打工人一周备餐指南/);
  assert.match(allText(panel), /查看来源/, "证据卡应带来源链接");
  const text = allText(panel);
  assert.ok(text.indexOf("· ·") < 0, "证据里的前导「·」不能拼成「· ·」");
  assert.match(text, /热榜 · 热度 3386\.7万 · 数据积累中/, "证据各段应以单个「 · 」连接");

  const skip = findButtons(panel, "不感兴趣")[0];
  assert.ok(skip, "应有「不感兴趣」按钮");
  await skip.dispatch("click");
  await settle();

  assert.strictEqual(callsTo(calls, "POST", "/api/v2/topics/feedback").length, 1);
  assert.strictEqual(String(skip.textContent).trim(), "不感兴趣", "失败不能改成「已记录」");
  assert.strictEqual(skip.disabled, false, "失败后应可重试");
  assert.match(allText(panel), /记录失败：请求过于频繁/, "错误必须可见");
});

test("今日选题：去创作把标题写进创作面板并采纳（adopt 带上 topicId）", async () => {
  const prefs = [];
  const navigations = [];
  global.window.App = { showPanel(name) { navigations.push(name); } };
  global.window.Skills.create = { setTopic(text) { prefs.push(text); } };
  const { panel, calls } = mountPanel({
    "GET /api/v2/topics/daily": {
      ok: true,
      data: {
        profile_set: true,
        cards: [{ id: "tp_1", title: "AI 工具每周复盘", category: "科技", score: 91, evidence: { type: "hot", refTitle: "榜单", metricValue: "+44%" } }],
      },
    },
    "POST /api/v2/topics/outcome/adopt": { ok: true, data: {} },
  });

  await settle();
  const go = findButtons(panel, "🚀 去创作")[0];
  assert.ok(go, "应有「去创作」按钮");
  await go.dispatch("click");
  await settle();

  assert.deepStrictEqual(prefs, ["AI 工具每周复盘"], "标题应写入创作面板主题框");
  assert.deepStrictEqual(navigations, ["create"], "应跳到创作面板");
  const adopt = callsTo(calls, "POST", "/api/v2/topics/outcome/adopt");
  assert.strictEqual(adopt.length, 1, "去创作同时要采纳，效果统计才有数据");
  assert.strictEqual(adopt[0].body.TopicId, "tp_1");
});

test("选题效果：调权备注读 reason 并显示权重变化", async () => {
  const { panel } = mountPanel({
    "GET /api/v2/topics/daily": { ok: true, data: { cards: [] } },
    "GET /api/v2/topics/outcome/stats": {
      ok: true,
      data: {
        adopted: 2, published: 1, measured: 1, hits: 1,
        adoption_rate: 0.5, hit_rate: 1,
        baseline_ready: true, baseline_views: 5200,
        current_weights: { evidence: 1.2, momentum: 0.9, heat: 1, niche: 1.1 },
        tuning: {
          applied: true,
          notes: [{ signal: "niche", reason: "垂类命中率高，权重上调", from: 1, to: 1.1 }],
        },
        rows: [],
      },
    },
  });

  await openTab(panel, "选题效果");
  const text = allText(panel);
  assert.match(text, /采纳 2 条/);
  assert.match(text, /命中 1 条/);
  assert.match(text, /当前权重：证据 1\.20/);
  assert.match(text, /✓ 已按你的真实数据调整推荐权重/);
  assert.match(text, /垂类命中率高，权重上调/, "备注读的是 reason 字段");
  assert.match(text, /1\.00 → 1\.10/, "权重变化应展示 from → to");
  assert.match(text, /还没有记录/, "无记录时给空态而不是白屏");
});

test("选题效果：回填表单校验播放量，合法值才提交 metrics", async () => {
  const { panel, calls } = mountPanel({
    "GET /api/v2/topics/daily": { ok: true, data: { cards: [] } },
    "GET /api/v2/topics/outcome/stats": {
      ok: true,
      data: {
        adopted: 1, published: 1, measured: 0, hits: 0,
        adoption_rate: 1, hit_rate: 0, baseline_ready: false,
        current_weights: {},
        rows: [{ topic_id: "tp_9", title: "已发布的选题", stage: "published", publish_platform: "douyin" }],
      },
    },
    "POST /api/v2/topics/outcome/metrics": { ok: true, data: {} },
  });

  await openTab(panel, "选题效果");
  assert.match(allText(panel), /已发布，待回填效果（抖音）/);

  const open = findButtons(panel, "回填效果")[0];
  assert.ok(open, "应有「回填效果」按钮");
  await open.dispatch("click");
  await settle();

  const submit = findButtons(panel, "提交")[0];
  assert.ok(submit, "应展开发回填表单");
  await submit.dispatch("click");
  await settle();
  assert.strictEqual(callsTo(calls, "POST", "/api/v2/topics/outcome/metrics").length, 0, "空播放量不应提交");
  assert.match(allText(panel), /请填写播放量/, "应提示播放量必填");

  findInputByPlaceholder(panel, "播放量").value = "12000";
  await submit.dispatch("click");
  await settle();

  const sent = callsTo(calls, "POST", "/api/v2/topics/outcome/metrics");
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].body.Views, 12000);
  assert.strictEqual(sent[0].body.TopicId, "tp_9");
});
