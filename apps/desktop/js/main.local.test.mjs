import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import * as realFs from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
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
 *
 * ⚠️ **静态守卫的盲区（别把它读成"行为已被验证"）**：
 * 这些守卫只验**形状**（谁在谁前面、字段在不在），验不了**可达性**。
 * 例如把 dispose() 包进 `if (false) { … }` 里，所有守卫仍然全绿，
 * 而真正的退出行为是坏的。同理，try/catch 里的分支是不是真的被走到，
 * 静态守卫也看不出来。退出路径的行为需要真正的运行期验证（当前没有，
 * 依赖 Task 4/5 的端到端或人工验证）。
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

// 去掉注释（字符串字面量原样保留）。
// 静态守卫靠"代码里出现过某个词"来判定时，注释里恰好提到这个词就会误判为通过 ——
// 注释不是代码。例：广播回调的注释里写了 isDestroyed()，把真正的守卫删掉后
// 只看"这段代码里有没有 isDestroyed"仍然是绿的。
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
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
    out += c;
    i += 1;
  }
  return out;
}

// 取出 ipcMain.handle("<channel>", <箭头函数>) 里的箭头函数源码。
// 为什么要抠出来单独跑：main.js 依赖 electron，node --test 起不来主进程。
// 但处理函数本身是纯逻辑（校验路径 + 交给监督器），抠出来注入桩依赖后
// 就能**真的调它** —— 这比"源码里有没有某个词"这种形状守卫强得多。
function handlerArrow(src, channel) {
  const marker = `ipcMain.handle("${channel}"`;
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `源码里找不到标记：${marker}`);
  let i = idx + marker.length;
  while (i < src.length && /[\s,]/.test(src[i])) i += 1;
  assert.ok(src[i] === "(", `${channel} 的处理函数应以箭头函数的参数表开头`);
  const paramsStart = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "(") depth += 1;
    else if (c === ")") { depth -= 1; if (depth === 0) { i += 1; break; } }
    i += 1;
  }
  const params = src.slice(paramsStart, i);
  while (i < src.length && /\s/.test(src[i])) i += 1;
  assert.ok(src.startsWith("=>", i), `${channel} 的处理函数不是箭头函数`);
  i += 2;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  let body;
  if (src[i] === "{") {
    body = blockAt(src, i);
  } else {
    const start = i;
    let d = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
      if (c === "(" || c === "[" || c === "{") { d += 1; i += 1; continue; }
      if (c === ")" || c === "]" || c === "}") {
        if (d === 0) break;
        d -= 1; i += 1; continue;
      }
      if (c === "," && d === 0) break;
      i += 1;
    }
    body = src.slice(start, i);
  }
  return params + " => " + body;
}

// 用桩依赖把处理函数"装"起来：注入的键名就是它引用的自由变量名
// （fs / ensureLocalSupervisor / localSupervisor …）。
function makeHandler(channel, deps) {
  const arrow = handlerArrow(mainJs, channel);
  const names = Object.keys(deps);
  const values = names.map((n) => deps[n]);
  return new Function(...names, "return (" + arrow + ");")(...values);
}

function blockAfter(src, marker) {
  const markerIdx = src.indexOf(marker);
  assert.ok(markerIdx >= 0, `源码里找不到标记：${marker}`);
  const open = src.indexOf("{", markerIdx + marker.length);
  assert.ok(open >= 0, `${marker} 之后找不到 {`);
  const text = blockAt(src, open);
  // 返回区间：[start, end) 是这块代码在源码里的真实偏移。
  // 注意 end 要从 open（花括号的位置）算起，不是从 marker 算起 ——
  // marker 与 "{" 之间还隔着参数表，直接用 marker + 长度会把区间少算一截。
  return { text, start: open, end: open + text.length };
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

// ---- 可执行文件路径的前置校验 ----
//
// 什么使其变红：主进程不做存在性校验，直接把路径丢给 spawn ——
// child_process.spawn 对**不存在的文件不抛异常**，只异步发 'error'，
// 监督器把 'error' 与 'exit' 同路 → 退避重试 3 次 → failed(crashed)，
// 界面显示"连续启动后仍异常退出"。用户只是路径打错了一个字符。
// 这几条用例把处理函数抠出来**真的调**，验证行为（不只是代码形状）。

test("htw:localStart: 路径不存在 → 直接失败并说清是哪个文件，绝不 spawn", () => {
  const started = [];
  const fn = makeHandler("htw:localStart", {
    fs: realFs,
    ensureLocalSupervisor: () => ({
      start: (p) => { started.push(p); return { state: "starting", base: "", reason: "", attempt: 0, pid: 1 }; },
    }),
  });

  const missing = join(tmpdir(), "htw-no-such-local-instance-9d3f.exe");
  const r = fn({}, missing);

  assert.strictEqual(r.ok, false, "路径不存在时必须直接失败");
  assert.strictEqual(r.errMsg, "找不到该可执行文件：" + missing, "失败文案要带上路径");
  assert.deepStrictEqual(started, [], "路径不存在时不得 spawn 任何进程");
});

test("htw:localStart: 路径是个目录 → 同样直接失败（不是可执行文件）", () => {
  const started = [];
  const fn = makeHandler("htw:localStart", {
    fs: realFs,
    ensureLocalSupervisor: () => ({
      start: (p) => { started.push(p); return { state: "starting" }; },
    }),
  });

  const r = fn({}, tmpdir());

  assert.strictEqual(r.ok, false, "目录不是可执行文件，必须直接失败");
  assert.deepStrictEqual(started, [], "不得 spawn");
});

test("htw:localStart: 路径存在 → 原样交给监督器启动", () => {
  const started = [];
  const fn = makeHandler("htw:localStart", {
    fs: realFs,
    ensureLocalSupervisor: () => ({
      start: (p) => { started.push(p); return { state: "starting", base: "", reason: "", attempt: 0, pid: 1 }; },
    }),
  });

  const exe = process.execPath; // 一定存在的文件
  const r = fn({}, exe);

  assert.deepStrictEqual(started, [exe], "存在的路径必须交给监督器启动");
  assert.ok(r && r.state === "starting", "存在时返回监督器的状态载荷");
});

// 查状态不该凭空把监督器建出来（"懒创建"的口径要成立）。
// 什么使其变红：localStatus 无条件 ensureLocalSupervisor() → 查一次状态就多一个监督器实例。
test("htw:localStatus: 监督器还没建 → 直接回 idle，不创建它", () => {
  let created = 0;
  const fn = makeHandler("htw:localStatus", {
    localSupervisor: null,
    ensureLocalSupervisor: () => {
      created += 1;
      return { status: () => ({ state: "idle", base: "", reason: "", attempt: 0, pid: null }) };
    },
  });

  const st = fn();

  assert.strictEqual(st.state, "idle", "没配置过时状态就是 idle");
  assert.strictEqual(st.base, "");
  assert.strictEqual(created, 0, "查状态不该创建监督器");
});

test("htw:localStatus: 监督器已经在 → 返回它的真实状态", () => {
  const fn = makeHandler("htw:localStatus", {
    localSupervisor: { status: () => ({ state: "running", base: "http://127.0.0.1:51234", reason: "", attempt: 0, pid: 42 }) },
    ensureLocalSupervisor: () => { throw new Error("不该创建监督器"); },
  });

  const st = fn();

  assert.strictEqual(st.state, "running");
  assert.strictEqual(st.base, "http://127.0.0.1:51234");
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
  assert.ok(body.text.includes("createSupervisor("), "ensureLocalSupervisor 内应创建监督器");
  // createSupervisor 只能在 ensureLocalSupervisor 体内被调用。
  // 用 blockAfter 返回的真实区间 [start, end)（起点是函数体的 "{"）。
  const callIdx = mainJs.indexOf("createSupervisor(");
  assert.ok(
    callIdx >= body.start && callIdx < body.end,
    "createSupervisor 不得在模块顶层被调用（必须懒创建，否则启动即有本地实例）"
  );
  assert.ok(
    !/^[ \t]*(const|let|var)\s+localSupervisor\s*=\s*createSupervisor/m.test(mainJs),
    "localSupervisor 不得在模块顶层直接用 createSupervisor 初始化"
  );
});

test("状态变化广播到所有窗口", () => {
  const body = blockAfter(mainJs, "function ensureLocalSupervisor");
  assert.ok(body.text.includes("onState"), "缺 onState 回调，状态变化不会外送");
  assert.ok(body.text.includes("getAllWindows()"), "状态应广播到所有窗口（多窗口都要看到）");
  assert.ok(body.text.includes('"htw:localEvent"'), "状态应通过 htw:localEvent 推送");
});

test("状态广播前必须确认窗口没被销毁（isDestroyed 守卫）", () => {
  // 只切 onState 回调体这一段，不做全文 includes ——
  // 全文 includes 会让"别处恰好有个 isDestroyed"也算数，等于没守卫。
  // 再剥掉注释：注释里提到 isDestroyed 不算守卫（注释不是代码）。
  const cb = stripComments(arrowValue(mainJs, "onState:"));
  // 必须真的**调用** isDestroyed()：只做字符串匹配的话，
  // `if (w.isDestroyed) { … }`（把方法当属性用）也能过 —— 那是误写，
  // 运行时不会按预期判断窗口死活。
  assert.ok(
    /isDestroyed\s*\(\s*\)/.test(cb),
    "onState 广播前必须调用 isDestroyed() 确认窗口还活着：窗口销毁后 send() 会抛错，打断整个广播"
  );
  // 顺序：先判活，再 send。反了等于没守卫（send 已经把异常抛出去了）。
  const guardIdx = cb.search(/isDestroyed\s*\(\s*\)/);
  const sendIdx = cb.search(/\.send\s*\(/);
  assert.ok(sendIdx >= 0, "onState 广播里必须有 send()");
  assert.ok(guardIdx < sendIdx, "isDestroyed() 必须在 send() 之前");
});

test("广播到单个窗口失败不能打断其它窗口（try/catch）", () => {
  const cb = stripComments(arrowValue(mainJs, "onState:"));
  assert.ok(/\btry\b/.test(cb), "onState 广播必须有 try：isDestroyed() 与 send() 之间有竞态窗口");
  assert.ok(/\bcatch\b/.test(cb), "onState 广播必须有 catch：单个窗口失败不能影响其它窗口");
});

test("before-quit 回调体内停掉本地实例（dispose）", () => {
  const q = sliceCall(mainJs, 'app.on("before-quit"');
  assert.ok(
    /\bdispose\s*\(/.test(q.text),
    "before-quit 回调体内必须调用 dispose()，否则退出后留下孤儿进程占着回环端口"
  );
});

test("dispose 的位置守卫是白名单式的：退出路径上必须有，别处允许有", () => {
  // 意图：**退出路径必须停子进程** —— 不停就会留下孤儿进程占着回环端口。
  // 所以硬约束只有一条：真正退出时的那一次 dispose 必须发生在 before-quit 回调体内。
  // 至于文件别处（比如日后给监督器加"重启前先 dispose 旧实例"这类调用）再出现 dispose()，
  // 是合理的用法，不该被这条守卫误伤 —— 早期版本要求"全文每一处 dispose 都在
  // before-quit 里"，对后续任务来说过紧。
  const q = sliceCall(mainJs, 'app.on("before-quit"');
  const re = /\bdispose\s*\(/g;
  let m;
  let inside = 0;
  while ((m = re.exec(mainJs)) !== null) {
    if (m.index >= q.start && m.index < q.end) inside += 1;
  }
  assert.ok(inside > 0, "before-quit 回调体内必须有一处 dispose()：退出路径必须停子进程");
});

test("退出时先停子进程，再断长连接", () => {
  const q = sliceCall(mainJs, 'app.on("before-quit"');
  const di = q.text.search(/\bdispose\s*\(/);
  const si = q.text.indexOf("streams.forEach");
  assert.ok(di >= 0, "before-quit 体内没有 dispose()");
  assert.ok(si >= 0, "before-quit 体内没有断长连接的代码");
  assert.ok(di < si, "必须先停本地实例子进程，再断长连接");
});

// 配置的读写要包含第 4 键 localBinary（可执行文件路径要落盘），
// 而既有三键 apiBase/apiKey/localBase 一个都不能少 —— 少一个就等于把另一个清空。
// 什么使其变红：load/save 漏掉 localBinary（路径每次启动都要重输），
// 或漏掉既有三键之一（配置被写残）。
test("配置读写包含 localBinary，既有三键一字不动", () => {
  const load = sliceCall(mainJs, 'ipcMain.handle("htw:loadConfig"');
  const save = sliceCall(mainJs, 'ipcMain.handle("htw:saveConfig"');
  for (const key of ["apiBase", "apiKey", "localBase", "localBinary"]) {
    assert.ok(load.text.includes(key), `htw:loadConfig 必须读出 ${key}`);
    assert.ok(save.text.includes(key), `htw:saveConfig 必须写入 ${key}`);
  }
});

// 配置的第 5 键：本地模式总开关 localEnabled（布尔，缺省 false = 不切本地）。
// 既有四键一个都不能少；布尔口径只认 true（"true" / 1 都不算开）。
// 什么使其变红：load/save 漏掉 localEnabled（开关每次启动都要重勾），
// 或把它写成宽松的真值判断（字符串 "true" 也会被当成开 → 流量被切到本地去）。
test("配置读写包含第 5 键 localEnabled（布尔，只认 true），既有四键一字不动", () => {
  const load = sliceCall(mainJs, 'ipcMain.handle("htw:loadConfig"');
  const save = sliceCall(mainJs, 'ipcMain.handle("htw:saveConfig"');
  for (const key of ["apiBase", "apiKey", "localBase", "localBinary", "localEnabled"]) {
    assert.ok(load.text.includes(key), `htw:loadConfig 必须读出 ${key}`);
    assert.ok(save.text.includes(key), `htw:saveConfig 必须写入 ${key}`);
  }
  assert.ok(
    /localEnabled\s*:\s*[^\n,]*localEnabled\s*===\s*true/.test(load.text),
    "loadConfig 的 localEnabled 只认布尔 true（键不存在即缺省关）"
  );
  assert.ok(
    /localEnabled\s*:\s*[^\n,]*localEnabled\s*===\s*true/.test(save.text),
    "saveConfig 的 localEnabled 只认布尔 true"
  );
});

// preload 的配置兜底也要带第 5 键（缺省关）：否则主进程通道断时，
// 渲染层拿到的配置里没有这个键，开关状态就成了"未定义"。
test("preload 的配置兜底带 localEnabled:false（缺省关）", () => {
  const body = blockAfter(preloadJs, "function loadConfig()").text;
  assert.ok(/localEnabled\s*:\s*false/.test(body), "loadConfig 的兜底必须带 localEnabled:false");
});

// 渲染层必须加载端点能力清单模块：它挂在 window.HTWLocalCapabilities 上，
// 缺了它 app.js 就拉不到清单（清单永远为空 → 永远走云端，且没有任何报错提示）。
test("index.html 加载了端点能力清单模块", () => {
  const indexHtml = readFileSync(join(APP, "index.html"), "utf-8");
  assert.ok(
    indexHtml.includes('src="js/local-capabilities.js"'),
    "index.html 必须加载 js/local-capabilities.js（否则渲染层拉不到端点能力清单）"
  );
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

test("preload 的失败兜底不伪造状态：只有 ok:false，不含 state/base/pid/reason", () => {
  // 什么使其变红：把兜底改回伪造状态（例如回 { state:"idle", base:"", pid:null }），
  // 下游就分不出"IPC 挂了"和"确实未配置/确实已停"了。
  for (const name of ["localStart", "localStop", "localStatus"]) {
    const v = stripComments(arrowValue(preloadJs, name + ":"));
    assert.ok(/\bok\s*:\s*false/.test(v), `${name} 的失败兜底必须显式声明 ok:false`);
    assert.ok(/errMsg/.test(v), `${name} 的失败兜底必须带 errMsg（渲染层要能显示失败原因）`);
    for (const f of ["state", "base", "pid", "reason"]) {
      assert.ok(
        !new RegExp("\\b" + f + "\\s*:").test(v),
        `${name} 的失败兜底不得伪造 ${f} 字段：事实未知时不能断言实例状态`
      );
    }
  }
});
