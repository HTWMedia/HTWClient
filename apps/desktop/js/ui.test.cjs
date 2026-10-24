const test = require("node:test");
const assert = require("node:assert");
const UI = require("./ui.js");

// 极小 DOM 替身（形态照 local.block.test.cjs 的 makeNode，按 ui.js 的需要裁剪）。
function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    children: [],
    parentNode: null,
    style: {},
    textContent: "",
    appendChild(child) {
      if (child == null) return child;
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    get firstChild() { return this.children.length ? this.children[0] : null; },
    addEventListener() {},
    setAttribute(k, v) { this["_attr_" + k] = v; },
    getAttribute(k) { return this["_attr_" + k]; },
    closest() { return null; },
    querySelectorAll() { return []; },
  };
  return node;
}

const doc = {
  createElement: makeNode,
  createTextNode: (t) => ({ textContent: String(t), children: [] }),
};

function showErrorDoc() {
  const prev = global.document;
  global.document = doc;
  const region = makeNode("div");
  return { region, restore: () => { global.document = prev; } };
}

// showError 的分支口径（M1）：
// - "本地执行不可用"（4007）→ 专用标题（既有行为，钉住不回退）；
// - "本地执行失败："（本地已选定但执行失败）→ 标题"本地执行失败"（M1 新增分支）；
// - 其它 → "出错了"（既有行为）。
test("ui.showError: 4007 文案 → 标题「本地执行不可用」，剥掉代码前缀", () => {
  const { region, restore } = showErrorDoc();
  try {
    UI.showError(region, "[4007] 本地执行不可用，请检查网络或服务器状态。");
    const box = region.children[0];
    assert.strictEqual(box.children[0].textContent, "本地执行不可用");
    assert.strictEqual(box.children[1].textContent, "本地执行不可用，请检查网络或服务器状态。",
      "详情里剥掉 [4007] 前缀，实际：" + box.children[1].textContent);
  } finally { restore(); }
});

// 🔴 M1：本地已选定但执行失败（markLocalFailed 形状）必须有独立标题，
// 不然用户会把"该查本机实例"的失败当成普通错误。
test("ui.showError: 本地失败文案 → 标题「本地执行失败」", () => {
  const { region, restore } = showErrorDoc();
  try {
    UI.showError(region, "[500] 本地执行失败：本地实例内部错误");
    const box = region.children[0];
    assert.strictEqual(box.children[0].textContent, "本地执行失败",
      "实际标题：" + box.children[0].textContent);
    assert.strictEqual(box.children[1].textContent, "本地执行失败：本地实例内部错误",
      "详情里剥掉代码前缀，实际：" + box.children[1].textContent);
  } finally { restore(); }
});

test("ui.showError: 本地失败即使裹在「请求异常」前缀里也认得出（错误体带标记的形态）", () => {
  const { region, restore } = showErrorDoc();
  try {
    // chunkedUpload 抛出的 Error 走面板 catch 分支时会拼上"请求异常: "前缀。
    UI.showError(region, "请求异常: 本地执行失败：分片 0 上传失败（分片 0）");
    const box = region.children[0];
    assert.strictEqual(box.children[0].textContent, "本地执行失败");
  } finally { restore(); }
});

test("ui.showError: 普通错误 → 标题「出错了」（不误标为本地失败）", () => {
  const { region, restore } = showErrorDoc();
  try {
    UI.showError(region, "未能连接服务器");
    const box = region.children[0];
    assert.strictEqual(box.children[0].textContent, "出错了");
  } finally { restore(); }
});

// ---- 最近请求列表（逐请求选路可观测性）----
//
// 数据源在 api.js（routingHistory 快照，最新在后，形状 { time, method, path, local, ok }）；
// 这里钉住呈现口径：行文案格式、本地/云端后缀、失败标记、空态、末 8 条截断。

// 本地时区固定时点的毫秒时间戳（用构造器建，避免依赖时区写死 UTC 数）。
const ROUTING_T = new Date(2026, 9, 24, 12, 34, 56).getTime();
function routingEntry(over) {
  return Object.assign({ time: ROUTING_T, method: "POST", path: "/api/v2/image/chat", local: true, ok: true }, over);
}

function routingDoc() {
  const prev = global.document;
  global.document = doc;
  const box = makeNode("div");
  return { box, restore: () => { global.document = prev; } };
}

test("ui.renderRoutingList: 行文案 = HH:MM:SS METHOD /path ·本地（本地成功行）", () => {
  const { box, restore } = routingDoc();
  try {
    UI.renderRoutingList(box, [routingEntry({ local: true })]);
    assert.strictEqual(box.children.length, 1);
    assert.strictEqual(box.children[0].textContent,
      "12:34:56 POST /api/v2/image/chat ·本地",
      "实际行文案：" + box.children[0].textContent);
  } finally { restore(); }
});

test("ui.renderRoutingList: 云端行后缀「·云端」", () => {
  const { box, restore } = routingDoc();
  try {
    UI.renderRoutingList(box, [routingEntry({ local: false, path: "/api/v2/asr/text" })]);
    assert.strictEqual(box.children[0].textContent, "12:34:56 POST /api/v2/asr/text ·云端");
  } finally { restore(); }
});

test("ui.renderRoutingList: 失败行（ok:false）带 ✕ 前缀，一眼可辨", () => {
  const { box, restore } = routingDoc();
  try {
    UI.renderRoutingList(box, [routingEntry({ ok: false })]);
    const text = box.children[0].textContent;
    assert.ok(text.startsWith("✕ "), "失败行应以 ✕ 开头，实际：" + text);
    assert.ok(text.includes("·本地"), "失败行仍要标出走了哪边，实际：" + text);
  } finally { restore(); }
});

test("ui.renderRoutingList: 空列表 → 空态文案「暂无请求记录」", () => {
  const { box, restore } = routingDoc();
  try {
    UI.renderRoutingList(box, []);
    assert.strictEqual(box.children.length, 1);
    assert.strictEqual(box.children[0].textContent, "暂无请求记录");
    // 空数组与 null/undefined 同口径：都是"没有记录"。
    UI.renderRoutingList(box, null);
    assert.strictEqual(box.children[0].textContent, "暂无请求记录");
  } finally { restore(); }
});

test("ui.renderRoutingList: 末 8 条截断（10 条入只显示 8 条，老在上新在下）", () => {
  const { box, restore } = routingDoc();
  try {
    const entries = [];
    for (let i = 0; i < 10; i++) {
      entries.push(routingEntry({ time: ROUTING_T + i * 1000, path: "/api/v2/p/" + i }));
    }
    UI.renderRoutingList(box, entries);
    assert.strictEqual(box.children.length, 8, "应只显示末 8 条，实际 " + box.children.length + " 条");
    // routingHistory 最新在后 → 显示的是第 2..9 条（0 起下标），按时间正序排。
    assert.ok(box.children[0].textContent.endsWith("/api/v2/p/2 ·本地"),
      "第一行应是最老的保留记录 p/2，实际：" + box.children[0].textContent);
    assert.ok(box.children[7].textContent.endsWith("/api/v2/p/9 ·本地"),
      "最后一行应是最新记录 p/9，实际：" + box.children[7].textContent);
  } finally { restore(); }
});

test("ui.renderRoutingList: 容器为 null 时安全跳过（元素不在页面也不抛）", () => {
  const prev = global.document;
  global.document = doc;
  try {
    assert.strictEqual(UI.renderRoutingList(null, [routingEntry()]), null);
  } finally { global.document = prev; }
});
