"use strict";

/*
 * SSE 分片解析：从 TCP 分片里还原完整事件。
 *
 * 为什么单独成文件而不是塞进 main.js：main.js 依赖 electron，node --test 里
 * require 不了；而"一条 data 跨两个 TCP 包到达"恰恰是最容易写错的地方，
 * 必须能脱离 Electron 直接单测。保持纯函数、不碰 http 对象。
 *
 * 服务端实际只发两种帧（见 D:\HTWCore.Web\Controllers\Api\V2\V2StreamController.cs）：
 *   data: {json}\n\n     —— 状态快照（默认 event: message）
 *   : ka\n\n             —— keepalive 注释，必须忽略，否则会被当成空事件推给界面
 * 结束时再补一帧 event: end\ndata: {}\n\n
 */

function parseBlock(block) {
  const lines = block.split("\n");
  let event = "message";
  const dataLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 空行与以 ':' 开头的注释行（含 keepalive）都不携带数据。
    if (!line || line.charAt(0) === ":") continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    // 规范里冒号后可选的单个空格要去掉，但只有一个 —— 值本身的前导空格要保留。
    if (value.charAt(0) === " ") value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  // 既没有 data 也没有自定义 event 名 ⇒ 这一整块是注释，不产出事件。
  if (!dataLines.length && event === "message") return null;
  return { event: event, data: dataLines.join("\n") };
}

function parseSseChunk(remainder, chunk) {
  const text = String(remainder || "") + (chunk == null ? "" : String(chunk));
  const events = [];
  let rest = text;
  for (;;) {
    const idx = rest.indexOf("\n\n");
    if (idx < 0) break;
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const ev = parseBlock(block);
    if (ev) events.push(ev);
  }
  return { events: events, remainder: rest };
}

module.exports = { parseSseChunk: parseSseChunk, parseBlock: parseBlock };