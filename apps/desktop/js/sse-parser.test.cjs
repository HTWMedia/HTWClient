const test = require("node:test");
const assert = require("node:assert");
const { parseSseChunk } = require("./sse-parser.js");

/*
 * 服务端 V2StreamController 下发的帧只有两种：
 *   "data: {json}\n\n"   —— 状态快照
 *   ": ka\n\n"           —— keepalive 注释
 *   "event: end\ndata: {}\n\n"
 * 最易错的是一条 data 被 TCP 拆到两个包里，所以解析必须是无状态的
 * （靠 remainder 续接），不能假设一个 chunk 就是一个完整事件。
 */

test("单包内的一个完整事件", () => {
  const r = parseSseChunk("", 'data: {"status":"running"}\n\n');
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].event, "message");
  assert.strictEqual(r.events[0].data, '{"status":"running"}');
  assert.strictEqual(r.remainder, "");
});

test("keepalive 注释行必须被忽略", () => {
  const r = parseSseChunk("", ": ka\n\n");
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.remainder, "");
});

test("一个事件跨三个 chunk 到达", () => {
  let r = parseSseChunk("", 'data: {"sta');
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.remainder, 'data: {"sta');

  r = parseSseChunk(r.remainder, 'tus":"run');
  assert.strictEqual(r.events.length, 0);

  r = parseSseChunk(r.remainder, 'ning"}\n');
  assert.strictEqual(r.events.length, 0);

  r = parseSseChunk(r.remainder, "\n");
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].data, '{"status":"running"}');
  assert.strictEqual(r.remainder, "");
});

test("end 事件带自定义 event 名", () => {
  const r = parseSseChunk("", "event: end\ndata: {}\n\n");
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].event, "end");
  assert.strictEqual(r.events[0].data, "{}");
});

test("同一次调用里多个事件", () => {
  const r = parseSseChunk("", 'data: {"n":1}\n\ndata: {"n":2}\n\n');
  assert.strictEqual(r.events.length, 2);
  assert.strictEqual(r.remainder, "");
});

test("末尾不完整的块留在 remainder 里", () => {
  const r = parseSseChunk("", 'data: {"n":1}\n\ndata: {"n":2');
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.remainder, 'data: {"n":2');
});

test("多行 data 用换行拼接（按 SSE 规范）", () => {
  const r = parseSseChunk("", "data: a\ndata: b\n\n");
  assert.strictEqual(r.events[0].data, "a\nb");
});

test("没有前导空格的值也能取到", () => {
  const r = parseSseChunk("", "data:{\"n\":1}\n\n");
  assert.strictEqual(r.events[0].data, '{"n":1}');
});