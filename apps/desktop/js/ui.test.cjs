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
