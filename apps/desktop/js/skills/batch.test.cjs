const test = require("node:test");
const assert = require("node:assert");
const batch = require("./batch.js");
const I = batch._internal;

/*
 * 批量面板的纯逻辑验证（不启动浏览器、不发请求）。
 * 批量是工作室档功能，出错最贵的地方都在"提交前后"：
 * 条目解析错一行、payload 少个字段、部分被拒没摊开 —— 这里逐个钉住。
 */

test("KINDS 与服务端三种批量 kind 对齐", () => {
  const ids = I.KINDS.map((k) => k.id);
  assert.deepStrictEqual(ids, ["market-video", "cut-same", "smart-package"]);
});

test("parseItemLines: 商品名|卖点|折扣 三段齐全", () => {
  const r = I.parseItemLines("便携榨汁杯|Type-C充电 6叶刀头|双11立减30");
  assert.strictEqual(r.errors.length, 0);
  assert.deepStrictEqual(r.items, [{
    productName: "便携榨汁杯",
    sellPoints: "Type-C充电 6叶刀头",
    discountActivity: "双11立减30",
  }]);
});

test("parseItemLines: 后两段可省略，空行跳过，两侧空白裁掉", () => {
  const r = I.parseItemLines("\n  户外露营灯  \n\n保温杯|316不锈钢 \n");
  assert.strictEqual(r.errors.length, 0);
  assert.deepStrictEqual(r.items, [
    { productName: "户外露营灯", sellPoints: "", discountActivity: "" },
    { productName: "保温杯", sellPoints: "316不锈钢", discountActivity: "" },
  ]);
});

test("parseItemLines: 缺商品名的行进 errors（行号 1 起），不混进 items", () => {
  const r = I.parseItemLines("|只有卖点\n正常商品");
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].line, 1);
  assert.strictEqual(r.items[0].productName, "正常商品");
});

test("parseItemLines: 空输入给空结果不抛", () => {
  for (const t of [null, "", "   "]) {
    const r = I.parseItemLines(t);
    assert.strictEqual(r.items.length, 0);
    assert.strictEqual(r.errors.length, 0);
  }
});

test("marketVideoRequest: 条目字段与服务端 BatchMarketVideoItem 对齐", () => {
  const parsed = I.parseItemLines("商品A|卖点1|立减10");
  const body = I.marketVideoRequest("批次一", parsed, "9:16", "15-30", ["mat1", "mat2"]);
  assert.strictEqual(body.Name, "批次一");
  assert.strictEqual(body.Items.length, 1);
  const it = body.Items[0];
  // 这些字段名服务端按属性绑定，写错一个整条参数就静默丢成默认值
  assert.strictEqual(it.ProductName, "商品A");
  assert.strictEqual(it.SellPoints, "卖点1");
  assert.strictEqual(it.Ratio, "9:16");
  assert.strictEqual(it.Duration, "15-30");
  assert.strictEqual(it.DiscountActivity, "立减10");
  assert.deepStrictEqual(it.Materials, ["mat1", "mat2"]);
});

test("marketVideoRequest: 素材列表按条拷贝而非共享引用", () => {
  const mats = ["mat1"];
  const body = I.marketVideoRequest("", I.parseItemLines("A\nB"), "16:9", "15-30", mats);
  body.Items[0].Materials.push("mat2");
  assert.deepStrictEqual(body.Items[1].Materials, ["mat1"]);
});

test("videoRequest: N 个文件 = N 条，文件名去扩展名当条目名", () => {
  const entries = [
    { fileName: "a.mp4", baseName: "a", materialId: "m1" },
    { fileName: "cut v2.MOV", baseName: "cut v2", materialId: "m2" },
  ];
  const body = I.videoRequest("smart-package", "批次", "", entries);
  assert.strictEqual(body.Items.length, 2);
  assert.strictEqual(body.Items[0].ProductName, "a");
  assert.deepStrictEqual(body.Items[0].Materials, ["m1"]);
  assert.strictEqual(body.Items[1].ProductName, "cut v2");
  // 智能包装不需要模板地址
  assert.strictEqual(body.DraftPackageUrl, undefined);
});

test("videoRequest: 剪同款整批共用 draftPackageUrl", () => {
  const entries = [{ fileName: "a.mp4", baseName: "a", materialId: "m1" }];
  const body = I.videoRequest("cut-same", "批次", "https://example.com/pkg.zip", entries);
  assert.strictEqual(body.DraftPackageUrl, "https://example.com/pkg.zip");
  assert.strictEqual(body.Items[0].DraftPackageUrl, "https://example.com/pkg.zip");
});

test("isFinished: pending/running 归零才算跑完", () => {
  assert.strictEqual(I.isFinished({ summary: { completed: 3, failed: 1 } }), true);
  assert.strictEqual(I.isFinished({ summary: { completed: 2, running: 1 } }), false);
  assert.strictEqual(I.isFinished({ summary: { pending: 5 } }), false);
  // 空输入不能误判为已完成 —— 轮询循环依赖这个判断
  assert.strictEqual(I.isFinished(null), true);
  assert.strictEqual(I.isFinished({}), true);
});

test("summaryText: 有什么报什么，全空给总数兜底", () => {
  assert.strictEqual(I.summaryText({ summary: { completed: 2, running: 1, failed: 1 } }), "完成 2 · 处理中 1 · 失败 1");
  assert.strictEqual(I.summaryText({ summary: { pending: 3 }, total: 3 }), "排队 3");
  assert.strictEqual(I.summaryText({ total: 5 }), "共 5 条");
  assert.strictEqual(I.summaryText(null), "共 0 条");
});

test("submitSummary: 被拒条目带 1 起序号与原因（档位不符是整批被拒）", () => {
  const s = I.submitSummary({
    total: 3, accepted: 0,
    rejected: [{ index: 0, error: "批量出片是工作室档功能（¥199/月，含 4 路并发渲染与批量接口），请升级后使用：/Home/Recharge" }],
  });
  assert.strictEqual(s.accepted, 0);
  assert.strictEqual(s.rejectedCount, 1);
  assert.match(s.lines[1], /第 1 条未启动/);
  assert.match(s.lines[1], /工作室档/);
});

test("submitSummary: 空输入不崩", () => {
  const s = I.submitSummary(null);
  assert.strictEqual(s.accepted, 0);
  assert.strictEqual(s.lines.length, 1);
});

test("itemStatus: 已知状态有中文文案，终态样式与运行中区分", () => {
  assert.strictEqual(I.itemStatus("completed").cls, "wf-ok");
  assert.strictEqual(I.itemStatus("failed").cls, "wf-bad");
  assert.strictEqual(I.itemStatus("running").cls, "wf-run");
  // 服务端加新状态时不能显示成成功
  assert.notStrictEqual(I.itemStatus("some-new").cls, "wf-ok");
  assert.strictEqual(I.itemStatus(null).text, "未知");
});

test("explain: 402/503 给人话，其余透传（档位升级提示在 message 里）", () => {
  assert.match(I.explain({ code: 402 }), /时长已用完/);
  assert.match(I.explain({ code: 503 }), /没有可用的剪映账号/);
  assert.strictEqual(I.explain({ code: 404, message: "批次不存在或已过期" }), "批次不存在或已过期");
  assert.strictEqual(I.explain(null), "请求失败");
});

test("fmtTime: 截到分钟，空值给占位", () => {
  assert.strictEqual(I.fmtTime("2026-10-05 09:30:12"), "2026-10-05 09:30");
  assert.strictEqual(I.fmtTime("2026-10-05T09:30:12"), "2026-10-05 09:30");
  assert.strictEqual(I.fmtTime(null), "—");
});

test("轮询节奏与上限", () => {
  assert.ok(I.POLL_MS >= 3000, "间隔太短会把服务端问爆");
  assert.ok(I.POLL_LIMIT_MS > 0 && I.POLL_LIMIT_MS <= 2 * 60 * 60 * 1000, "轮询必须有上限");
});

test("模块导出 mount 供 app.js 挂载", () => {
  assert.strictEqual(typeof batch.mount, "function");
});
