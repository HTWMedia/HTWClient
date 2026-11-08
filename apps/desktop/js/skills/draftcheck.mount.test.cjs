const test = require("node:test");
const assert = require("node:assert");

/*
 * 草稿体检面板挂载测试。
 *
 * 这个面板是**唯一在没配 AuthKey 时也能用**的功能，所以它有两个不能破的约定：
 *   ① 主进程给的失败原因（"多个草稿""没找到 draft_content.json"）必须原样显示 ——
 *      统一糊成"体检失败"等于把用户扔在原地；
 *   ② 没有本地通道时（浏览器直开）必须禁用按钮并说明原因，不能留一个点了没反应的按钮。
 *
 * 用极小 DOM 替身驱动真实 mount：不 mock 面板自己的逻辑，只替身 document / UI / htw。
 */

function makeNode(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    id: "",
    _attrs: {},
    _handlers: {},
    children: [],
    parentNode: null,
    style: {},
    disabled: false,
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
    click() { return this.dispatch("click"); },
  };
  return node;
}

const flush = () => Promise.resolve().then(() => new Promise((r) => setImmediate(r)));
async function settle() { for (let i = 0; i < 8; i++) await flush(); }

function findAll(root, pred) {
  const out = [];
  (function walk(n) {
    (n.children || []).forEach((c) => {
      if (pred(c)) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}
const findById = (root, id) => findAll(root, (n) => n.id === id)[0] || null;
const findButton = (root, text) => findAll(root, (n) => n.tagName === "BUTTON" && String(n.textContent).trim() === text)[0] || null;
const textOf = (root) => String(root.textContent || "");

let draftApi = null;

function mountPanel(htw) {
  global.document = {
    createElement: makeNode,
    createTextNode: (t) => ({ textContent: String(t), children: [] }),
    querySelector: () => null,
  };
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
    showError: () => {},
    showResult: () => {},
    withLoading: (btn, fn) => fn(),
  };
  global.window = { UI: ui, Skills: {} };
  if (htw) global.window.htw = htw;

  if (!draftApi) {
    require("./draftcheck.js");
    draftApi = global.window.Skills.draftcheck;
    assert.ok(draftApi && typeof draftApi.mount === "function", "draftcheck.js 应挂载 window.Skills.draftcheck.mount");
  }
  const panel = makeNode("section");
  draftApi.mount(panel);
  return panel;
}

function summary(over) {
  const s = {
    name: "带货视频-01", durationText: "3 分 12 秒", durationUs: 192000000,
    canvas: { ratio: "9:16", width: 1080, height: 1920 }, fps: 30, updatedAt: 0,
    trackCount: 4, videoTrackCount: 2,
    tracks: [
      { type: "video", label: "视频", segments: 12 },
      { type: "video", label: "视频", segments: 3 },
      { type: "text", label: "文字", segments: 12 },
      { type: "audio", label: "音频", segments: 2 },
    ],
    materialCounts: [{ label: "视频", count: 14 }, { label: "音频", count: 2 }],
    textChars: 320,
    media: { referenced: 16, missingCount: 0, missing: [], bytes: 1024 },
    folder: { files: 42, bytes: 3 * 1048576, partial: false },
    checks: [{ level: "ok", text: "素材核对通过：草稿引用的 16 个素材都在本机。" }],
    verdict: { level: "ok", text: "内容完整，可以直接导出成片。" },
  };
  Object.keys(over || {}).forEach((k) => { s[k] = over[k]; });
  return s;
}

function makeHtw(over) {
  const calls = [];
  const h = {
    calls: calls,
    draftInspect: (folder) => { calls.push({ kind: "inspect", folder: folder }); return Promise.resolve(over.inspect); },
    draftExport: (folder) => { calls.push({ kind: "export", folder: folder }); return Promise.resolve(over.exportResult); },
    draftPickFolder: () => Promise.resolve(over.picked || ""),
    loadJson: () => Promise.resolve(over.saved || null),
    saveJson: () => Promise.resolve(true),
  };
  return h;
}

test("体检成功：结论、轨道、素材、下一步按钮都渲染出来", async () => {
  const h = makeHtw({
    inspect: { ok: true, fileName: "draft_content.json", encrypted: true, summary: summary() },
  });
  const panel = mountPanel(h);
  const input = findById(panel, "draftcheck-path");
  input.value = "D:\\drafts\\带货视频-01";
  await findById(panel, "draftcheck-run").click();
  await settle();

  assert.strictEqual(h.calls.filter((c) => c.kind === "inspect").length, 1, "应只体检一次");
  assert.strictEqual(h.calls[0].folder, "D:\\drafts\\带货视频-01");
  const txt = textOf(panel);
  assert.match(txt, /内容完整，可以直接导出成片/, "结论必须出现");
  assert.match(txt, /3 分 12 秒/, "时长要显示出来");
  assert.match(txt, /1080 × 1920/);
  assert.match(txt, /视频 ×2（15 段）/, "视频轨要合并成一行（12+3 段）");
  assert.match(txt, /加密，已在本机解密/);
  assert.ok(findButton(panel, "导出解密后的 JSON"), "加密草稿应给出导出按钮");
  assert.ok(findButton(panel, "去导出成片 →"), "应能跳去导出成片");
});

test("缺素材：说出缺几个、缺的是什么，并给 warn 结论", async () => {
  const h = makeHtw({
    inspect: {
      ok: true, fileName: "draft_content.json", encrypted: true,
      summary: summary({
        media: {
          referenced: 16, missingCount: 2, bytes: 1024,
          missing: [{ name: "clip02.mp4", kind: "视频" }, { name: "bgm.mp3", kind: "音频" }],
        },
        verdict: { level: "warn", text: "能解密、能读，但会渲出残片：缺 2 个素材。" },
      }),
    },
  });
  const panel = mountPanel(h);
  findById(panel, "draftcheck-path").value = "D:\\drafts\\a";
  await findById(panel, "draftcheck-run").click();
  await settle();
  const txt = textOf(panel);
  assert.match(txt, /缺 2 个素材/);
  assert.match(txt, /clip02\.mp4/);
  assert.match(txt, /bgm\.mp3/);
});

test("主进程报错原样显示（多个草稿），不糊成“未知原因”", async () => {
  const h = makeHtw({
    inspect: { ok: false, error: "这个文件夹里有多个草稿，请选到具体那条草稿的文件夹（剪映里右键草稿 →「打开草稿文件夹」）" },
  });
  const panel = mountPanel(h);
  findById(panel, "draftcheck-path").value = "D:\\drafts";
  await findById(panel, "draftcheck-run").click();
  await settle();
  const txt = textOf(panel);
  assert.match(txt, /多个草稿/);
  assert.match(txt, /打开草稿文件夹/);
  assert.ok(!/未知原因/.test(txt));
});

test("空路径不发请求：直接提示先选文件夹", async () => {
  const h = makeHtw({ inspect: { ok: true, summary: summary() } });
  const panel = mountPanel(h);
  findById(panel, "draftcheck-path").value = "   ";
  await findById(panel, "draftcheck-run").click();
  await settle();
  assert.strictEqual(h.calls.length, 0, "空路径不该去读盘");
  assert.match(textOf(panel), /请先选择草稿文件夹/);
});

test("没有本地通道时禁用按钮并说明原因（浏览器直开）", () => {
  const panel = mountPanel(null);
  const pick = findById(panel, "draftcheck-pick");
  const run = findById(panel, "draftcheck-run");
  assert.strictEqual(pick.disabled, true);
  assert.strictEqual(run.disabled, true);
  assert.match(textOf(panel), /没有桌面客户端的本地通道/);
});

test("导出解密 JSON：显示写出的路径，并说明原草稿没动", async () => {
  const h = makeHtw({
    inspect: { ok: true, fileName: "draft_content.json", encrypted: true, summary: summary() },
    exportResult: { ok: true, path: "D:\\drafts\\a\\draft_content.decrypted.json", bytes: 2 * 1048576, encrypted: true },
  });
  const panel = mountPanel(h);
  findById(panel, "draftcheck-path").value = "D:\\drafts\\a";
  await findById(panel, "draftcheck-run").click();
  await settle();
  await findButton(panel, "导出解密后的 JSON").click();
  await settle();
  assert.strictEqual(h.calls.filter((c) => c.kind === "export").length, 1);
  const out = findById(panel, "draftcheck-export-out");
  assert.match(textOf(out), /draft_content\.decrypted\.json/);
  assert.match(textOf(out), /原草稿没有改动/);
});

test("明文草稿：导出按钮禁用并说明“已是明文”，不给假动作", async () => {
  const h = makeHtw({
    inspect: { ok: true, fileName: "draft_content.json", encrypted: false, summary: summary() },
  });
  const panel = mountPanel(h);
  findById(panel, "draftcheck-path").value = "D:\\drafts\\a";
  await findById(panel, "draftcheck-run").click();
  await settle();
  const btn = findById(panel, "draftcheck-export");
  assert.ok(btn);
  assert.strictEqual(btn.disabled, true);
  assert.match(String(btn.textContent), /已是明文/);
  assert.match(textOf(panel), /明文/, "基本信息里要写明是明文");
});
