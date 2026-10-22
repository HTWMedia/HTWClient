const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const Supervisor = require("./local-supervisor.js");

// ---- 假 spawn / 假时钟 ----
//
// 全仓约定：不真起子进程、不开真端口（本机曾出现"子进程管道整体失效"的环境级故障，
// 真起会让测试依赖环境）。所以这里用**假 spawn**：一个能发事件的对象，
// 假 stdout 是 EventEmitter（喂行用），假 kill() 记调用。
//
// 假时钟同样不真等：delayFn 只登记（ms, 回调, 用途），
// 测试用 fire(用途) 手动推进 —— 退避序列与地址超时因此可以逐毫秒断言。

function createFakeSpawn() {
  const children = [];
  const spawnFn = function (binaryPath, args, options) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4000 + children.length;
    child.binaryPath = binaryPath;
    child.args = args;
    child.options = options;
    child.killCalls = [];
    child.kill = function (signal) {
      child.killCalls.push(signal === undefined ? "default" : signal);
      return true;
    };
    children.push(child);
    return child;
  };
  return { spawnFn: spawnFn, children: children };
}

function createFakeClock() {
  const timers = [];
  const delayFn = function (fn, ms, kind) {
    const timer = { ms: ms, fn: fn, kind: kind || "unknown", fired: false };
    timers.push(timer);
    return timer;
  };
  return {
    delayFn: delayFn,
    timers: timers,
    // 推进某一类计时器（不传 kind = 全部）。
    fire: function (kind) {
      const list = timers.filter(function (t) {
        return !t.fired && (!kind || t.kind === kind);
      });
      for (const t of list) {
        t.fired = true;
        t.fn();
      }
    },
    fireAll: function () {
      this.fire();
    },
    delaysOf: function (kind) {
      return timers.filter(function (t) {
        return t.kind === kind;
      }).map(function (t) {
        return t.ms;
      });
    },
  };
}

const BIN = "C:/tools/local-instance.exe";
const LINE = "[local-instance] listening http://127.0.0.1:51234\n";

// 什么使其变红：把 LISTENING_RE 的标记前缀改掉（哪怕只差一个字符），
// 就不再解析出地址 —— 用例 1/8 变红；把 running 的落状态删掉同样变红。
test("supervisor: stdout 标记行 → running 且 base 就是那一行的地址", (t) => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn });
  t.after(() => sup.dispose()); // 收掉真实计时器，别让 node --test 等满 15s
  const started = sup.start(BIN);
  assert.strictEqual(started.state, "starting", "spawn 之后先进入 starting");
  assert.strictEqual(started.base, "");

  fake.children[0].stdout.emit("data", LINE);

  const s = sup.status();
  assert.strictEqual(s.state, "running");
  assert.strictEqual(s.base, "http://127.0.0.1:51234");
  assert.strictEqual(s.reason, "");
  assert.strictEqual(s.pid, fake.children[0].pid);
  assert.strictEqual(sup.isRunning(), true);
});

// 什么使其变红：地址超时后不 kill 子进程（把 noAddress 分支里的 kill 去掉），
// 用例 2 的 killCalls 断言就空；把超时时长改掉则 delaysOf("addressTimeout") 不再是 [10]。
test("supervisor: 15s 内没等到地址 → failed(noAddress) 且子进程被 kill", () => {
  const fake = createFakeSpawn();
  const clock = createFakeClock();
  const sup = Supervisor.createSupervisor({
    spawnFn: fake.spawnFn,
    delayFn: clock.delayFn,
    addressTimeoutMs: 10,
  });
  sup.start(BIN);
  assert.deepStrictEqual(clock.delaysOf("addressTimeout"), [10], "按注入的地址超时计时");

  clock.fire("addressTimeout");

  const s = sup.status();
  assert.strictEqual(s.state, "failed");
  assert.strictEqual(s.reason, "noAddress");
  assert.strictEqual(s.base, "");
  assert.strictEqual(fake.children[0].killCalls.length, 1, "拿不到地址必须杀掉子进程");
  assert.strictEqual(sup.isRunning(), false);
});

// 什么使其变红：把"无路径 → failed(noBinary) 且不 spawn"这一分支删掉
// （或让它照样 spawn）→ 用例 3 的 children.length 断言就红。
test("supervisor: 没有可执行文件路径 → failed(noBinary) 且完全不 spawn", () => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn });

  const s = sup.start("");

  assert.strictEqual(s.state, "failed");
  assert.strictEqual(s.reason, "noBinary");
  assert.strictEqual(s.base, "");
  assert.strictEqual(fake.children.length, 0, "没有路径时不得起任何进程");
  assert.strictEqual(sup.isRunning(), false);
});

// 什么使其变红：退避时长写成别的序列（少一级、顺序换掉）→ delaysOf("backoff") 断言红；
// 把 maxRestarts 的判定写成 ">"（多重启一次）→ 第 4 次崩溃后仍会 spawn，用例 4 红。
test("supervisor: 崩溃 → 退避 1000/2000/4000 自动重启；第 4 次崩溃 → failed(crashed) 且不再拉起", () => {
  const fake = createFakeSpawn();
  const clock = createFakeClock();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn, delayFn: clock.delayFn });

  sup.start(BIN);
  assert.strictEqual(fake.children.length, 1);

  fake.children[0].emit("exit", 1, null);
  assert.deepStrictEqual(clock.delaysOf("backoff"), [1000], "第 1 次崩溃退避 1s");
  clock.fire("backoff");
  assert.strictEqual(fake.children.length, 2, "退避后拉起第 2 个进程");

  fake.children[1].emit("exit", 1, null);
  assert.deepStrictEqual(clock.delaysOf("backoff"), [1000, 2000], "第 2 次崩溃退避 2s");
  clock.fire("backoff");
  assert.strictEqual(fake.children.length, 3);

  fake.children[2].emit("exit", 1, null);
  assert.deepStrictEqual(clock.delaysOf("backoff"), [1000, 2000, 4000], "第 3 次崩溃退避 4s");
  clock.fire("backoff");
  assert.strictEqual(fake.children.length, 4, "一共自动重启 3 次");

  fake.children[3].emit("exit", 1, null);
  const s = sup.status();
  assert.strictEqual(s.state, "failed");
  assert.strictEqual(s.reason, "crashed");
  assert.strictEqual(fake.children.length, 4, "第 4 次崩溃之后不再拉起");
  assert.deepStrictEqual(clock.delaysOf("backoff"), [1000, 2000, 4000], "不再排新的退避");
});

// 什么使其变红：去掉"用户主动停止后不重启"的守卫（让 exit 一律走重启路径）→
// 用例 5 的 children.length 断言红；让 stop() 不落 stopped 状态也红。
test("supervisor: 用户 stop() → stopped；随后子进程再发 exit 不触发任何重启", () => {
  const fake = createFakeSpawn();
  const clock = createFakeClock();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn, delayFn: clock.delayFn });

  sup.start(BIN);
  fake.children[0].stdout.emit("data", LINE);
  assert.strictEqual(sup.status().state, "running");

  const s = sup.stop();
  assert.strictEqual(s.state, "stopped");
  assert.strictEqual(s.base, "");
  assert.strictEqual(fake.children[0].killCalls.length, 1, "停止必须杀掉子进程");

  const spawnCount = fake.children.length;
  fake.children[0].emit("exit", 0, null);
  clock.fireAll();

  assert.strictEqual(fake.children.length, spawnCount, "用户主动停止后不得自动重启");
  assert.strictEqual(sup.status().state, "stopped");
  assert.strictEqual(sup.isRunning(), false);
});

// 什么使其变红：dispose() 里不 kill 子进程 → 用例 6 的 killCalls 断言红。
test("supervisor: dispose() → 子进程被 kill（应用退出不留孤儿进程）", () => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn });

  sup.start(BIN);
  assert.strictEqual(fake.children.length, 1);

  sup.dispose();

  assert.strictEqual(fake.children[0].killCalls.length, 1, "退出必须停子进程");
});

// 什么使其变红：spawn 的 env 里少带 HTW_LOCAL=1 → 用例 7 的断言红；
// stdio 不是 ["ignore","pipe","pipe"] 或 windowsHide 不为 true 也红。
test("supervisor: spawn 必须带 HTW_LOCAL=1、管道化 stdout、windowsHide", (t) => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({
    spawnFn: fake.spawnFn,
    env: { PATH: "C:/bin" },
  });
  t.after(() => sup.dispose());

  sup.start(BIN);

  const options = fake.children[0].options;
  assert.strictEqual(options.env.HTW_LOCAL, "1", "子进程必须以本地实例角色启动");
  assert.strictEqual(options.env.PATH, "C:/bin", "其余环境变量原样透传");
  assert.deepStrictEqual(options.stdio, ["ignore", "pipe", "pipe"]);
  assert.strictEqual(options.windowsHide, true);
  assert.strictEqual(fake.children[0].binaryPath, BIN);
});

// 什么使其变红：不处理 stdout 的 "end"（末行没有换行符就永远解析不出来）→ 用例 8 红。
test("supervisor: 末行没有换行符时以 stdout 流结束补齐", (t) => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn });
  t.after(() => sup.dispose());

  sup.start(BIN);
  fake.children[0].stdout.emit("data", "[local-instance] listening http://127.0.0.1:51234");
  assert.strictEqual(sup.status().state, "starting", "还没看到完整行之前不算拿到地址");

  fake.children[0].stdout.emit("end");

  assert.strictEqual(sup.status().state, "running");
  assert.strictEqual(sup.status().base, "http://127.0.0.1:51234");
});

// 什么使其变红：任何一个导出常量被改字面量（STATE 的取值、默认超时、退避序列、
// 最大重启次数、正则 source）→ 用例 9 的逐字断言红；
// 少导出一个成员（例如把 LISTENING_RE 删掉）同样红。
test("supervisor: 导出契约（STATE / 常量 / LISTENING_RE）", () => {
  assert.deepStrictEqual(Supervisor.STATE, {
    idle: "idle",
    stopped: "stopped",
    starting: "starting",
    running: "running",
    failed: "failed",
    stopping: "stopping",
  });
  assert.strictEqual(Supervisor.DEFAULT_ADDRESS_TIMEOUT_MS, 15000);
  assert.deepStrictEqual(Supervisor.RESTART_BACKOFF_MS, [1000, 2000, 4000]);
  assert.strictEqual(Supervisor.MAX_RESTARTS, 3);
  assert.strictEqual(Supervisor.LISTENING_RE.source, "^\\[local-instance\\] listening (.+)$");
  assert.strictEqual(typeof Supervisor.createSupervisor, "function");
});

// 什么使其变红：把 handleChildGone 开头的陈旧守卫去掉（或让 clearAddressTimer
// 无条件执行）→ 旧子进程迟到的 exit 会作废**新**实例的地址超时计时器
// （新实例不吐地址就永远等不到 failed(noAddress)），并且多排一次退避，
// 退避到点再拉起一个进程 → 双实例 + 没人监管的孤儿进程。
// 断言任一条变红即说明守卫被拆了。
test("supervisor: stop → start 后旧子进程迟到的 exit 被忽略（不双实例、不作废新实例的地址超时）", () => {
  const fake = createFakeSpawn();
  const clock = createFakeClock();
  const sup = Supervisor.createSupervisor({
    spawnFn: fake.spawnFn,
    delayFn: clock.delayFn,
    addressTimeoutMs: 10,
  });

  sup.start(BIN);
  assert.strictEqual(fake.children.length, 1);
  sup.stop();
  assert.strictEqual(sup.status().state, "stopped");

  sup.start(BIN);
  assert.strictEqual(fake.children.length, 2, "重新启动 → 第二个进程");
  assert.strictEqual(sup.status().state, "starting");

  // 旧子进程的 exit 迟到（真实场景：点了停止之后进程过一会儿才真的退出）
  fake.children[0].emit("exit", 0, null);

  assert.strictEqual(fake.children.length, 2, "陈旧 exit 不得当场再拉起任何进程");
  assert.deepStrictEqual(clock.delaysOf("backoff"), [], "陈旧 exit 不得排退避");

  // 新实例一直没吐地址 → 它的地址超时必须**仍然有效**
  clock.fireAll();

  assert.strictEqual(fake.children.length, 2, "陈旧 exit 引发的退避不得再拉起进程");
  const s = sup.status();
  assert.strictEqual(s.state, "failed", "新实例拿不到地址必须照样 failed(noAddress)");
  assert.strictEqual(s.reason, "noAddress");
});

// 什么使其变红：退避等待期把状态写成 starting（而不是 stopped）→
// 退避期内的 start() 会被 starting 早退分支静默吞掉（不真的 spawn），
// attempt/pid 的断言也一起红。
test("supervisor: 崩溃退避期 = stopped + attempt>0 + pid=null；退避期内手动启动会真的拉起", () => {
  const fake = createFakeSpawn();
  const clock = createFakeClock();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn, delayFn: clock.delayFn });

  sup.start(BIN);
  fake.children[0].emit("exit", 1, null);

  const backoff = sup.status();
  assert.strictEqual(backoff.state, "stopped", "退避等待期没有进程，状态是 stopped");
  assert.strictEqual(backoff.attempt, 1, "attempt>0 表示这是崩溃退避中");
  assert.strictEqual(backoff.pid, null, "退避期没有 pid");

  // 退避期内用户手动点"启动" → 必须真的拉起（不能被 starting 早退分支吞掉）
  sup.start(BIN);
  assert.strictEqual(fake.children.length, 2, "退避期内手动启动 → 真的 spawn");
  assert.strictEqual(sup.status().state, "starting");
  assert.strictEqual(sup.status().attempt, 0, "手动启动 → 重启计数归零");

  // 原来的退避计时器必须作废（否则到点会多拉一个）
  clock.fire("backoff");
  assert.strictEqual(fake.children.length, 2, "手动启动后原退避计时器必须作废");
});

// 什么使其变红：把空路径当成"沿用上次配置过的路径"（start 里对空串不重置
// binaryPath）→ 实例没在跑的时候，这里会**再拉起一个进程**
//（children.length 变 2）→ 断言红；在跑的时候则不会落 failed(noBinary) → 也红。
test("supervisor: 已经配置过路径之后再 start(\"\") → failed(noBinary) 且不再 spawn", (t) => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn });
  t.after(() => sup.dispose());

  sup.start(BIN);
  assert.strictEqual(fake.children.length, 1);
  sup.stop(); // 实例停了，但路径还"配置过"

  const s = sup.start(""); // 用户把路径清空了再点启动

  assert.strictEqual(s.state, "failed");
  assert.strictEqual(s.reason, "noBinary");
  assert.strictEqual(fake.children.length, 1, "空路径不得沿用旧路径再拉一个进程");

  // 实例正在跑的时候也一样：只落 failed(noBinary)，不再多拉一个
  sup.start(BIN);
  assert.strictEqual(fake.children.length, 2);
  const s2 = sup.start("");
  assert.strictEqual(s2.state, "failed");
  assert.strictEqual(s2.reason, "noBinary");
  assert.strictEqual(fake.children.length, 2, "空路径不得沿用旧路径再拉一个进程");
});

// 什么使其变红：行尾只去 "\n" 不去 "\r"（把 .replace(/\r$/, "") 去掉）
// → 正则锚点前多一个 \r，解析不出地址 → 用例红。
test("supervisor: \\r\\n 行尾的标记行也能解析出地址", (t) => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn });
  t.after(() => sup.dispose());

  sup.start(BIN);
  fake.children[0].stdout.emit("data", "[local-instance] listening http://127.0.0.1:51234\r\n");

  assert.strictEqual(sup.status().state, "running");
  assert.strictEqual(sup.status().base, "http://127.0.0.1:51234");
});

// 什么使其变红：不按行缓冲（每来一个 chunk 就当一整行）→ 半行永远拼不起来
// → 用例红（拿不到地址，停在 starting）。
test("supervisor: 标记行跨两个 chunk 到达也能解析出地址", (t) => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn });
  t.after(() => sup.dispose());

  sup.start(BIN);
  fake.children[0].stdout.emit("data", "[local-instance] listening http://127.0.0.1:5123");
  assert.strictEqual(sup.status().state, "starting", "半行不算拿到地址");

  fake.children[0].stdout.emit("data", "4\n");

  assert.strictEqual(sup.status().state, "running");
  assert.strictEqual(sup.status().base, "http://127.0.0.1:51234");
});

// 什么使其变红：dispose() 不清计时器（或不靠世代号作废）→ 把挂起的计时器
// 全推一遍之后状态会被改（failed(noAddress)）或者又会拉起进程 → 用例红。
test("supervisor: dispose() 之后挂起的计时器不再回调（不改状态、不再拉起）", () => {
  const fake = createFakeSpawn();
  const clock = createFakeClock();
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn, delayFn: clock.delayFn });

  sup.start(BIN);
  fake.children[0].emit("exit", 1, null); // → 排了退避
  assert.strictEqual(clock.delaysOf("backoff").length, 1, "崩溃后确实排了退避");

  sup.dispose();
  const before = sup.status();

  clock.fireAll(); // 把所有挂起计时器都推一遍

  assert.strictEqual(fake.children.length, 1, "dispose 后不得再拉起任何进程");
  assert.deepStrictEqual(sup.status(), before, "dispose 后计时器回调不得再改状态");
});

// 什么使其变红：dispose() 只 kill 一次、不排超时强杀 → fire("killEscalation")
// 之后 killCalls 里没有 SIGKILL → 用例红。
test("supervisor: dispose() → 先 kill，超时还没退就强杀（SIGKILL）", () => {
  const fake = createFakeSpawn();
  const clock = createFakeClock();
  const sup = Supervisor.createSupervisor({
    spawnFn: fake.spawnFn,
    delayFn: clock.delayFn,
    killGraceMs: 50,
  });

  sup.start(BIN);
  sup.dispose();

  assert.deepStrictEqual(fake.children[0].killCalls, ["default"], "先礼貌地 kill 一次");
  assert.deepStrictEqual(clock.delaysOf("killEscalation"), [50], "排一个超时强杀");

  clock.fire("killEscalation");

  assert.deepStrictEqual(fake.children[0].killCalls, ["default", "SIGKILL"], "超时后强杀");
});

// 什么使其变红：强杀前不判断"进程是不是已经自己退了"（去掉 exitedProcs 判断）
// → 已经退出的进程也会被补一刀 SIGKILL → 用例红。
test("supervisor: 子进程已经自己退出 → 超时强杀不会再补一刀", () => {
  const fake = createFakeSpawn();
  const clock = createFakeClock();
  const sup = Supervisor.createSupervisor({
    spawnFn: fake.spawnFn,
    delayFn: clock.delayFn,
    killGraceMs: 50,
  });

  sup.start(BIN);
  sup.dispose();
  fake.children[0].emit("exit", 0, null); // 已经自己退了

  clock.fire("killEscalation");

  assert.deepStrictEqual(fake.children[0].killCalls, ["default"], "已经退了就不用再强杀");
});

// 什么使其变红：把 onState 外面那层 try/catch 去掉（异常直接冒泡）
// → 第一次状态变化就把监督器带崩（后续状态不再推进）→ 用例红。
test("supervisor: onState 回调抛错不拖垮监督器（异常走 onError 出口）", (t) => {
  const fake = createFakeSpawn();
  const errors = [];
  const sup = Supervisor.createSupervisor({
    spawnFn: fake.spawnFn,
    onState: function () {
      throw new Error("界面炸了");
    },
    onError: function (err, meta) {
      errors.push({ message: err && err.message, where: meta && meta.where });
    },
  });
  t.after(() => sup.dispose());

  const s = sup.start(BIN);
  assert.strictEqual(s.state, "starting", "回调抛错也要把状态推出去");
  assert.strictEqual(errors.length >= 1, true, "回调异常必须走错误出口");
  assert.strictEqual(errors[0].where, "onState");
  assert.strictEqual(errors[0].message, "界面炸了");

  fake.children[0].stdout.emit("data", LINE);
  assert.strictEqual(sup.status().state, "running", "后续状态变化照常推进");
});

// 什么使其变红：没有注入 onError 时把回调异常直接抛出去 → start() 自己就抛
// → 用例红（默认口径是"吞掉但不影响监督器"）。
test("supervisor: 没有注入 onError 时，onState 抛错被静默吞掉但监督器照常工作", (t) => {
  const fake = createFakeSpawn();
  const sup = Supervisor.createSupervisor({
    spawnFn: fake.spawnFn,
    onState: function () {
      throw new Error("界面炸了");
    },
  });
  t.after(() => sup.dispose());

  const s = sup.start(BIN);
  assert.strictEqual(s.state, "starting");

  fake.children[0].stdout.emit("data", LINE);
  assert.strictEqual(sup.status().state, "running");
});

// 原 env 对象**不得被污染**：HTW_LOCAL 是子进程专用的角色标记，
// 写进主进程自己的 env 就等于把整个应用变成"本地实例角色"
// （子进程若缺这个变量会以服务器角色启动：连数据库、绑非回环端口）。
// 什么使其变红：把 Object.assign({}, env) 改成直接改 env → 原对象上多出 HTW_LOCAL。
test("supervisor: 原 env 对象不被污染（HTW_LOCAL 只加在子进程那份副本上）", (t) => {
  const fake = createFakeSpawn();
  const env = { PATH: "C:/bin" };
  const sup = Supervisor.createSupervisor({ spawnFn: fake.spawnFn, env: env });
  t.after(() => sup.dispose());

  sup.start(BIN);

  assert.strictEqual(fake.children[0].options.env.HTW_LOCAL, "1", "子进程必须以本地实例角色启动");
  assert.strictEqual(env.HTW_LOCAL, undefined, "原 env 对象不得被污染");
  assert.deepStrictEqual(Object.keys(env), ["PATH"], "原 env 对象的键不得被改动");
});

// 这个模块**只做 CommonJS**（主进程专用）：它要 require("child_process")，
// 渲染层加载会直接抛。曾经有个渲染层全局分支 —— 那是死代码：
// 这个文件从未进 index.html，留着只会让人以为渲染层能用它。
// 什么使其变红：把渲染层分支加回来 → 断言里的渲染层全局命中。
test("supervisor: 只做 CommonJS（主进程专用），不留渲染层分支", () => {
  const src = readFileSync(require.resolve("./local-supervisor.js"), "utf-8");
  assert.ok(!/\bwindow\b/.test(src), "监督器模块里不该出现渲染层全局（那是死代码分支）");
  assert.ok(/module\.exports/.test(src), "必须是 CommonJS 导出");
});
