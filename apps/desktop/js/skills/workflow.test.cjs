const test = require("node:test");
const assert = require("node:assert");
const wf = require("./workflow.js");
const I = wf._internal;

/*
 * 工作流面板的纯逻辑验证（不启动浏览器）。
 * 覆盖的都是"写错了不会报错、但用户会看到错东西"的地方：
 * 状态文案、哪些状态该轮询、批量部分成功怎么报、下标怎么显示。
 */

test("stage: 已知状态有中文文案与样式类", () => {
  assert.strictEqual(I.stage("awaiting-publish").text, "待你确认");
  // 待确认是唯一需要人介入的状态，样式必须与运行中区分开（醒目）
  assert.notStrictEqual(I.stage("awaiting-publish").cls, I.stage("produce").cls);
  assert.strictEqual(I.stage("completed").cls, "wf-ok");
  assert.strictEqual(I.stage("failed").cls, "wf-bad");
});

test("stage: 未知状态兜底不崩，且不谎报成功", () => {
  const s = I.stage("some-new-stage");
  assert.strictEqual(s.text, "some-new-stage");
  // 服务端加了新阶段时前端不能默默显示成"已完成"
  assert.notStrictEqual(s.cls, "wf-ok");
  assert.strictEqual(I.stage(null).text, "未知");
});

test("isWatching: 活动段与待确认都算，终态不算", () => {
  ["produce", "package", "compose", "publishing", "awaiting-publish"].forEach((s) => {
    assert.strictEqual(I.isWatching({ stage: s }), true, s + " 应当被盯着");
  });
  // 终态继续轮询是纯浪费 —— 尤其"待确认"要盯着，而 completed/failed 不能盯
  ["completed", "failed", "cancelled"].forEach((s) => {
    assert.strictEqual(I.isWatching({ stage: s }), false, s + " 不该被盯着");
  });
});

test("isWatching: 空输入不抛", () => {
  assert.strictEqual(I.isWatching(null), false);
  assert.strictEqual(I.isWatching({}), false);
});

test("batchSummary: 部分成功要报出是哪几条（下标转 1 起）", () => {
  const s = I.batchSummary({
    total: 3,
    accepted: 2,
    // 服务端返回的是**原始下标**（0 起），用户看到的是第几条
    rejected: [{ index: 1, error: "提交过于频繁，请下一分钟补交剩余条目" }],
  });
  assert.strictEqual(s.accepted, 2);
  assert.strictEqual(s.rejectedCount, 1);
  assert.match(s.lines[0], /已启动 2 条，共提交 3 条/);
  assert.match(s.lines[1], /第 2 条未启动/);   // index=1 → 第 2 条
});

test("batchSummary: 全部成功不带任何未启动行", () => {
  const s = I.batchSummary({ total: 5, accepted: 5, rejected: [] });
  assert.strictEqual(s.rejectedCount, 0);
  assert.strictEqual(s.lines.length, 1);
});

test("batchSummary: 空输入不崩", () => {
  const s = I.batchSummary(null);
  assert.strictEqual(s.accepted, 0);
  assert.strictEqual(s.lines.length, 1);
});

test("parseTags: 后端给的是 JSON 字符串（DB 列是 TEXT）", () => {
  assert.deepStrictEqual(I.parseTags('["AI","效率"]'), ["AI", "效率"]);
  // 坏数据不能把整个面板搞崩
  assert.deepStrictEqual(I.parseTags("not json"), []);
  assert.deepStrictEqual(I.parseTags(""), []);
  assert.deepStrictEqual(I.parseTags(null), []);
  // 非数组也不能当数组用
  assert.deepStrictEqual(I.parseTags('{"a":1}'), []);
});

test("parseJson: 合规结论可能是字符串也可能是对象", () => {
  assert.deepStrictEqual(I.parseJson('{"evaluated":true,"safe":true}'), { evaluated: true, safe: true });
  assert.deepStrictEqual(I.parseJson({ evaluated: false }), { evaluated: false });
  assert.strictEqual(I.parseJson(""), null);
  assert.strictEqual(I.parseJson("坏数据"), null);
});

test("explain: 402/429/503 给出人话而不是裸数字", () => {
  // 这三个码有专门业务含义，透出数字等于让用户猜
  assert.match(I.explain({ code: 402 }), /时长已用完/);
  assert.match(I.explain({ code: 429 }), /频繁|并发/);
  assert.match(I.explain({ code: 503 }), /没有可用的剪映账号/);
  // 其他错误透传服务端文案
  assert.strictEqual(I.explain({ code: 400, message: "请输入视频主题" }), "请输入视频主题");
  assert.strictEqual(I.explain(null), "请求失败");
});

test("fmtTime: 截到分钟，空值给占位", () => {
  assert.strictEqual(I.fmtTime("2026-10-03 09:30:12"), "2026-10-03 09:30");
  assert.strictEqual(I.fmtTime("2026-10-03T09:30:12"), "2026-10-03 09:30");
  assert.strictEqual(I.fmtTime(""), "—");
  assert.strictEqual(I.fmtTime(null), "—");
});

test("轮询有上限，不会无限挂着", () => {
  assert.ok(I.POLL_MS >= 3000, "间隔太短会把服务端问爆");
  assert.ok(I.POLL_LIMIT_MS > 0 && I.POLL_LIMIT_MS <= 60 * 60 * 1000,
    "轮询必须有上限，否则会一直问一个可能已经死掉的任务");
});

test("平台清单与服务端 WorkflowPublishConfig 对齐", () => {
  var ids = I.PLATFORMS.map((p) => p.id);
  assert.ok(ids.indexOf("douyin") >= 0);
  assert.ok(ids.indexOf("xhs") >= 0);
  assert.ok(ids.indexOf("bili") >= 0);
});

test("CONTENT_TYPES 覆盖服务端内容形态（video/narration/article/weitoutiao）", () => {
  var ids = I.CONTENT_TYPES.map((t) => t.id);
  assert.deepStrictEqual(ids, ["video", "narration", "article", "weitoutiao"]);
});

test("normalizeContentType: 与服务端 NormalizeContentType 同口径（空/未知按 video，narration 保留）", () => {
  assert.strictEqual(I.normalizeContentType("video"), "video");
  assert.strictEqual(I.normalizeContentType("narration"), "narration");
  assert.strictEqual(I.normalizeContentType("article"), "article");
  assert.strictEqual(I.normalizeContentType("weitoutiao"), "weitoutiao");
  // 服务端历史数据与旧客户端请求里没有这个字段 —— 必须落回 video，不能变 undefined
  assert.strictEqual(I.normalizeContentType(""), "video");
  assert.strictEqual(I.normalizeContentType(null), "video");
  assert.strictEqual(I.normalizeContentType("WEITOUTIAO"), "weitoutiao", "大小写不敏感");
  assert.strictEqual(I.normalizeContentType("podcast"), "video");
});

test("isTextContent: 只有图文两形态为真（narration 走视频线）", () => {
  assert.strictEqual(I.isTextContent("article"), true);
  assert.strictEqual(I.isTextContent("weitoutiao"), true);
  assert.strictEqual(I.isTextContent("video"), false);
  // narration 虽是独立形态，但走 produce/package 全链 —— 不是图文线
  assert.strictEqual(I.isTextContent("narration"), false);
  assert.strictEqual(I.isTextContent(null), false);
});

test("模块导出 mount 供 app.js 挂载", () => {
  assert.strictEqual(typeof wf.mount, "function");
});
