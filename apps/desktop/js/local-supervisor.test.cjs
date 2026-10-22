const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
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

// 契约面：导出的常量与状态取值是机器契约，别处按字面量取用。
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
