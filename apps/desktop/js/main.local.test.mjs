import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * 主进程本地实例装配守卫。
 *
 * 为什么是"静态守卫"而不是主进程单测：main.js 依赖 electron，
 * node --test 起不来 electron 主进程，仓库里也没有这个先例。
 * 于是改成读源码做断言 —— 断言的是**形状**（通道名、在哪个回调体里、
 * 谁在谁前面），这些恰恰是最容易写错、且写错后症状最隐蔽的地方。
 *
 * 特别强调"精确到 before-quit 回调体内"：
 * 只断言"文件里出现过 dispose"是放错位置也绿的 —— 写在模块顶层
 * 或者写在某个没人调用的辅助函数里，测试照样过，而真正退出时
 * 子进程不会被停，孤儿进程占着回环端口。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

const mainJs = readFileSync(join(APP, "main.js"), "utf-8");
const preloadJs = readFileSync(join(APP, "preload.js"), "utf-8");

// 跳过字符串字面量（引号 / 反引号）里的内容，避免把里面的括号当成代码结构。
function skipString(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

// 取出 marker 所在的那次调用的源码片段（含调用括号）及其位置。
// marker 里不含括号，所以左括号取"marker 之前最近的左括号"。
function sliceCall(src, marker) {
  const markerIdx = src.indexOf(marker);
  assert.ok(markerIdx >= 0, `源码里找不到标记：${marker}`);
  const open = src.lastIndexOf("(", markerIdx + marker.length);
  assert.ok(open >= 0, `${marker} 附近找不到左括号`);
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) {
        return { text: src.slice(open, i + 1), start: open, end: i + 1 };
      }
    }
    i += 1;
  }
  throw new Error("括号不配对：" + marker);
}

// 取出 marker 之后第一个 { ... } 的源码片段（函数体 / 对象字面量）。
function blockAt(src, open) {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
    i += 1;
  }
  throw new Error("花括号不配对");
}

function blockAfter(src, marker) {
  const markerIdx = src.indexOf(marker);
  assert.ok(markerIdx >= 0, `源码里找不到标记：${marker}`);
  const open = src.indexOf("{", markerIdx + marker.length);
  assert.ok(open >= 0, `${marker} 之后找不到 {`);
  return blockAt(src, open);
}

// 取出 "名字:" 后面那个箭头函数的整个取值（参数表 + 函数体）。
// 不能直接用 sliceCall：箭头的参数表自带一对括号，配平就提前收尾了。
function arrowValue(src, marker) {
  const markerIdx = src.indexOf(marker);
  assert.ok(markerIdx >= 0, `源码里找不到标记：${marker}`);
  let i = markerIdx + marker.length;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] === "(") {
    let depth = 0;
    const parenStart = i;
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
      if (c === "(") depth += 1;
      else if (c === ")") { depth -= 1; if (depth === 0) { i += 1; break; } }
      i += 1;
    }
    assert.ok(i > parenStart, `${marker} 的参数列表不配对`);
    while (i < src.length && /\s/.test(src[i])) i += 1;
    assert.ok(src.startsWith("=>", i), `${marker} 后面不是箭头函数`);
    i += 2;
  }
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] === "{") return blockAt(src, i);
  // 表达式体：扫到顶层的 , } ) 为止
  let depth = 0;
  const start = i;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "(" || c === "[" || c === "{") { depth += 1; i += 1; continue; }
    if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth -= 1; i += 1; continue;
    }
    if (c === "," && depth === 0) break;
    i += 1;
  }
  return src.slice(start, i);
}

test("main.js 引入了本地实例监督器模块", () => {
  assert.ok(
    /require\(\s*["'][^"']*local-supervisor[^"']*["']\s*\)/.test(mainJs),
    "main.js 必须 require 本地实例监督器模块"
  );
});

test("main.js 注册了三个本地实例 IPC 通道与一个状态推送通道", () => {
  for (const ch of ["htw:localStart", "htw:localStop", "htw:localStatus"]) {
    assert.ok(mainJs.includes(`ipcMain.handle("${ch}"`), `缺 ipcMain.handle("${ch}")`);
  }
  assert.ok(mainJs.includes('"htw:localEvent"'), "缺状态推送通道 htw:localEvent");
});

test("htw:localStart 把可执行文件路径交给监督器", () => {
  const c = sliceCall(mainJs, 'ipcMain.handle("htw:localStart"');
  assert.ok(c.text.includes("binaryPath"), "localStart 必须接收路径参数");
  assert.ok(/\.start\s*\(/.test(c.text), "localStart 必须调用监督器的 start()");
});

test("htw:localStop 调停、htw:localStatus 查状态", () => {
  const stop = sliceCall(mainJs, 'ipcMain.handle("htw:localStop"');
  assert.ok(/\.stop\s*\(/.test(stop.text), "localStop 必须调用监督器的 stop()");
  const status = sliceCall(mainJs, 'ipcMain.handle("htw:localStatus"');
  assert.ok(/\.status\s*\(/.test(status.text), "localStatus 必须返回监督器的 status()");
});

test("监督器懒创建：没配置过本地实例就不创建，更不会 spawn", () => {
  assert.ok(
    /let\s+localSupervisor\s*=\s*null/.test(mainJs),
    "监督器应先置空（懒创建），而不是模块加载时就建好"
  );
  assert.ok(
    /function\s+ensureLocalSupervisor/.test(mainJs),
    "缺 ensureLocalSupervisor 懒创建入口"
  );
  const body = blockAfter(mainJs, "function ensureLocalSupervisor");
  assert.ok(body.includes("createSupervisor("), "ensureLocalSupervisor 内应创建监督器");
  // createSupervisor 只能在 ensureLocalSupervisor 体内被调用。
  const bodyStart = mainJs.indexOf("function ensureLocalSupervisor");
  const bodyEnd = bodyStart + body.length;
  const callIdx = mainJs.indexOf("createSupervisor(");
  assert.ok(
    callIdx >= bodyStart && callIdx < bodyEnd,
    "createSupervisor 不得在模块顶层被调用（必须懒创建，否则启动即有本地实例）"
  );
  assert.ok(
    !/^[ \t]*(const|let|var)\s+localSupervisor\s*=\s*createSupervisor/m.test(mainJs),
    "localSupervisor 不得在模块顶层直接用 createSupervisor 初始化"
  );
});

test("状态变化广播到所有窗口", () => {
  const body = blockAfter(mainJs, "function ensureLocalSupervisor");
  assert.ok(body.includes("onState"), "缺 onState 回调，状态变化不会外送");
  assert.ok(body.includes("getAllWindows()"), "状态应广播到所有窗口（多窗口都要看到）");
  assert.ok(body.includes('"htw:localEvent"'), "状态应通过 htw:localEvent 推送");
});

test("before-quit 回调体内停掉本地实例（dispose）", () => {
  const q = sliceCall(mainJs, 'app.on("before-quit"');
  assert.ok(
    /\bdispose\s*\(/.test(q.text),
    "before-quit 回调体内必须调用 dispose()，否则退出后留下孤儿进程占着回环端口"
  );
});

test("dispose 只出现在 before-quit 回调体内（放错位置也必须红）", () => {
  const q = sliceCall(mainJs, 'app.on("before-quit"');
  const re = /\bdispose\s*\(/g;
  let m;
  let seen = 0;
  while ((m = re.exec(mainJs)) !== null) {
    seen += 1;
    assert.ok(
      m.index >= q.start && m.index < q.end,
      "dispose() 必须写在 before-quit 回调体内，写在别处等于没在退出时停子进程"
    );
  }
  assert.ok(seen > 0, "文件里一处 dispose() 都没有");
});

test("退出时先停子进程，再断长连接", () => {
  const q = sliceCall(mainJs, 'app.on("before-quit"');
  const di = q.text.search(/\bdispose\s*\(/);
  const si = q.text.indexOf("streams.forEach");
  assert.ok(di >= 0, "before-quit 体内没有 dispose()");
  assert.ok(si >= 0, "before-quit 体内没有断长连接的代码");
  assert.ok(di < si, "必须先停本地实例子进程，再断长连接");
});

test("preload 暴露了本地实例的四个入口", () => {
  for (const name of ["localStart", "localStop", "localStatus", "onLocalEvent"]) {
    assert.ok(
      new RegExp("\\b" + name + "\\s*:").test(preloadJs),
      `preload 缺暴露项 ${name}`
    );
  }
});

test("preload 的本地实例入口走对应的 IPC 通道", () => {
  const start = arrowValue(preloadJs, "localStart:");
  assert.ok(start.includes('"htw:localStart"'), "localStart 必须走 htw:localStart");
  assert.ok(start.includes("binaryPath"), "localStart 必须把路径传给主进程");
  const stop = arrowValue(preloadJs, "localStop:");
  assert.ok(stop.includes('"htw:localStop"'), "localStop 必须走 htw:localStop");
  const status = arrowValue(preloadJs, "localStatus:");
  assert.ok(status.includes('"htw:localStatus"'), "localStatus 必须走 htw:localStatus");
});

test("preload 的 onLocalEvent 订阅 htw:localEvent 并返回取消订阅函数", () => {
  const c = arrowValue(preloadJs, "onLocalEvent:");
  assert.ok(c.includes('ipcRenderer.on("htw:localEvent"'), "onLocalEvent 必须订阅 htw:localEvent");
  assert.ok(c.includes("removeListener"), "onLocalEvent 必须返回取消订阅函数");
  assert.ok(/return\s+function/.test(c), "onLocalEvent 必须返回函数");
});
