const test = require("node:test");
const assert = require("node:assert");
const T = require("./tasks.js");
const I = T._internal;

/*
 * watch 的三条路径都要覆盖：SSE 正常、静默降级到轮询、重启后重新接上。
 * 用假依赖而不是真网络 —— 这些是状态机问题，不是网络问题。
 */

function fakeDeps(over) {
  const d = {
    api: {
      subscribeTask: () => "sid",
      unsubscribeTask: () => {},
      call: async () => ({ ok: true, data: { status: "running" } }),
      post: async () => ({ ok: true }),
    },
    saveJson: () => Promise.resolve(true),
    loadJson: () => Promise.resolve(null),
    // 与真实 preload 的 onStreamEvent 同形：订阅一个回调，回调收到 {streamId,type,payload}。
    subscribe: (cb) => { d._cbs.push(cb); return function () { d._cbs = d._cbs.filter((f) => f !== cb); }; },
    now: () => Date.now(),
    setTimeout: (fn, ms) => { d._timers.push({ fn, ms }); return d._timers.length; },
    clearTimeout: () => {},
    _timers: [],
    _cbs: [],
    // 主进程把事件按 streamId 广播给所有订阅者；容器自己按 streamId 过滤。
    emit: (streamId, type, payload) => { d._cbs.slice().forEach((cb) => cb({ streamId, type, payload })); },
  };
  return Object.assign(d, over || {});
}

// 轮询型域（batch）注册后立即查一次，让断言能直接看到落库后的状态。
async function settle() {
  await new Promise((r) => setImmediate(r));
}

test("SSE 域：收到事件就更新记录，不轮询", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A1", panel: "shortdrama", title: "短剧" });
  d.emit("agent:A1", "data", '{"status":"running","progress":40}');
  await new Promise((r) => setImmediate(r));
  const cur = store.get(t.id);
  assert.strictEqual(cur.progress, 40);
  assert.strictEqual(cur.transport, "sse");
  assert.strictEqual(cur.degraded, false);
});

test("载荷判定终态后自动停掉观察", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A2" });
  d.emit("agent:A2", "data", '{"status":"completed"}');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.get(t.id).status, "done");
});

test("partial_failed 也要收尾（发布域最常见的结局）", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "publish", taskId: "P1" });
  d.emit("publish:P1", "data", '{"status":"partial_failed"}');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.get(t.id).status, "failed", "partial_failed 属终态，不能让连接白挂到 60 分钟上限；且它必须落成失败而不是成功");
});

test("非 SSE 域：直接轮询，不订阅", async () => {
  const d = fakeDeps();
  let subscribed = 0;
  d.api.subscribeTask = () => { subscribed++; return "sid"; };
  const store = I.createStore(d);
  store.register({ domain: "batch", taskId: "B1", panel: "batch", title: "批量" });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(subscribed, 0, "batch 域服务端没有推送，不该发起订阅");
  assert.strictEqual(store.list()[0].transport, "poll");
});

test("订阅失败要静默降级，不能抛给界面", async () => {
  const d = fakeDeps();
  d.api.subscribeTask = () => { throw new Error("BASE_NOT_ALLOWED"); };
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A3" });
  await new Promise((r) => setImmediate(r));
  const cur = store.get(t.id);
  assert.strictEqual(cur.transport, "poll");
  assert.strictEqual(cur.degraded, true, "降级要被记住，用于排查实际降级率");
  assert.strictEqual(cur.status, "running", "降级不影响任务本身");
});

test("degraded 只增不减", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A4" });
  store.get(t.id).degraded = true;
  d.emit("agent:A4", "data", '{"status":"running"}');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.get(t.id).degraded, true, "degraded 是历史事实，恢复推送后也不能抹掉");
});

test("重启恢复：还在跑的任务重新接上", async () => {
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([
    { id: "t_old", domain: "batch", taskId: "B9", panel: "batch", title: "批量",
      status: "running", unknown: false, progress: 10, step: null,
      transport: "none", degraded: false, result: null, error: null,
      createdAt: 1, updatedAt: 2, endedAt: null, type: null },
  ]);
  d.api.call = async () => ({ ok: true, data: { status: "running", progress: 55 } });
  const store = I.createStore(d);
  await store.restore();
  const cur = store.get("t_old");
  assert.ok(cur, "记录应被载入");
  assert.strictEqual(cur.status, "running");
  assert.strictEqual(cur.progress, 55);
  assert.strictEqual(cur.transport, "poll");
});

test("重启恢复：服务端已无此任务 -> interrupted", async () => {
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([
    { id: "t_gone", domain: "agent", taskId: "A0", panel: "shortdrama", title: "短剧",
      status: "running", unknown: false, progress: null, step: null,
      transport: "none", degraded: false, result: null, error: null,
      createdAt: 1, updatedAt: 2, endedAt: null, type: null },
  ]);
  d.api.call = async () => ({ ok: true, data: { status: "notfound" } });
  const store = I.createStore(d);
  await store.restore();
  assert.strictEqual(store.get("t_gone").status, "interrupted");
});

test("重启恢复：网络故障不能误判任务已死", async () => {
  // 服务端的任务管理器多是进程内存态，客户端启动瞬间它可能还没就绪。
  // 此时把 running 改成 interrupted 就是误报，用户会以为白等了半小时。
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([
    { id: "t_net", domain: "agent", taskId: "A7", panel: "shortdrama", title: "短剧",
      status: "running", unknown: false, progress: null, step: null,
      transport: "none", degraded: false, result: null, error: null,
      createdAt: 1, updatedAt: 2, endedAt: null, type: null },
  ]);
  d.api.call = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
  const store = I.createStore(d);
  await store.restore();
  const cur = store.get("t_net");
  assert.strictEqual(cur.status, "running", "网络故障时必须保持 running");
  assert.strictEqual(cur.unknown, true);
});

test("取消：发 PascalCase 请求体，成功后置 canceled", async () => {
  const d = fakeDeps();
  const seen = [];
  d.api.post = async (p, body) => { seen.push([p, body]); return { ok: true }; };
  const store = I.createStore(d);
  const t = store.register({ domain: "marketvideo", taskId: "M1", panel: "marketing", title: "营销" });
  await store.cancel(t.id);
  assert.deepStrictEqual(seen[0][0], "/api/v2/market-video/cancel");
  assert.deepStrictEqual(seen[0][1], { TaskId: "M1" });
  assert.strictEqual(store.get(t.id).status, "canceled");
});

test("取消：不在白名单的域直接拒绝", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "A8" });
  await assert.rejects(() => store.cancel(t.id));
});

test("清空已完成不影响运行中", async () => {
  const d = fakeDeps();
  const store = I.createStore(d);
  const a = store.register({ domain: "agent", taskId: "K1" });
  const b = store.register({ domain: "agent", taskId: "K2" });
  store.get(b.id).status = "done";
  store.clearFinished();
  const left = store.list().map((t) => t.id);
  assert.ok(left.includes(a.id));
  assert.ok(!left.includes(b.id));
});

test("落盘：状态变化触发写盘", async () => {
  const d = fakeDeps();
  let saves = 0;
  d.saveJson = (name, data) => { saves++; return Promise.resolve(true); };
  const store = I.createStore(d);
  store.register({ domain: "agent", taskId: "S1" });
  await new Promise((r) => setImmediate(r));
  assert.ok(saves >= 1, "登记时就该落一次盘");
});

test("落盘失败不得影响任务", async () => {
  const d = fakeDeps();
  d.saveJson = () => Promise.reject(new Error("ENOSPC"));
  const store = I.createStore(d);
  store.register({ domain: "agent", taskId: "S2" });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(store.list().length, 1, "写盘失败也要保住内存态");
});

/* ------------------------------------------------------------------
 * 以下按域推导。workflow 与 batch 的状态响应里没有 status 字段
 * （/api/v2/workflow/status、/api/v2/batch/status），只推 applyPayload
 * 的话这两条记录会永远停在 running。
 * ------------------------------------------------------------------ */

test("workflow：awaiting-publish 仍在等人工，不能算结束", async () => {
  // active 只在服务端自己会推的那四个 stage 上为真，awaiting-publish（等人点确认）
  // 它也是假 —— 但那段没结束。只看 active 会把一条等用户的流水线直接标成已完成。
  const d = fakeDeps();
  d.api.call = async () => ({ ok: true, data: { workflowId: "W1", stage: "awaiting-publish", active: false } });
  const store = I.createStore(d);
  const t = store.register({ domain: "workflow", taskId: "W1", panel: "workflow", title: "流水线" });
  await settle();
  assert.strictEqual(store.get(t.id).status, "running");
});

test("workflow：stage 走到终态才收工，且分得清成功失败", async () => {
  const done = fakeDeps();
  done.api.call = async () => ({ ok: true, data: { workflowId: "W2", stage: "completed", active: false } });
  const s1 = I.createStore(done);
  const a = s1.register({ domain: "workflow", taskId: "W2" });
  await settle();
  assert.strictEqual(s1.get(a.id).status, "done");

  const bad = fakeDeps();
  bad.api.call = async () => ({ ok: true, data: { workflowId: "W3", stage: "failed", active: false, error: "合规不通过" } });
  const s2 = I.createStore(bad);
  const b = s2.register({ domain: "workflow", taskId: "W3" });
  await settle();
  assert.strictEqual(s2.get(b.id).status, "failed");

  const stop = fakeDeps();
  stop.api.call = async () => ({ ok: true, data: { workflowId: "W4", stage: "cancelled", active: false } });
  const s3 = I.createStore(stop);
  const c = s3.register({ domain: "workflow", taskId: "W4" });
  await settle();
  assert.strictEqual(s3.get(c.id).status, "canceled");
});

test("workflow：拿不到 stage 时退回按 active 判终态", async () => {
  const d = fakeDeps();
  d.api.call = async () => ({ ok: true, data: { workflowId: "W5", active: false } });
  const store = I.createStore(d);
  const t = store.register({ domain: "workflow", taskId: "W5" });
  await settle();
  assert.strictEqual(store.get(t.id).status, "done");
});

test("batch：pending/running 没归零前不算结束", async () => {
  const d = fakeDeps();
  d.api.call = async () => ({ ok: true, data: { batchId: "C1", summary: { completed: 2, running: 1, pending: 3 } } });
  const store = I.createStore(d);
  const t = store.register({ domain: "batch", taskId: "C1", panel: "batch", title: "批量" });
  await settle();
  assert.strictEqual(store.get(t.id).status, "running");
});

test("batch：全部完成 -> done", async () => {
  const d = fakeDeps();
  d.api.call = async () => ({ ok: true, data: { batchId: "C2", summary: { completed: 5, failed: 0, cancelled: 0, expired: 0 } } });
  const store = I.createStore(d);
  const t = store.register({ domain: "batch", taskId: "C2", panel: "batch", title: "批量" });
  await settle();
  assert.strictEqual(store.get(t.id).status, "done");
});

test("batch：有失败条目 -> failed，且优先于取消与过期", async () => {
  const d = fakeDeps();
  d.api.call = async () => ({ ok: true, data: { batchId: "C3", summary: { completed: 1, failed: 2, cancelled: 1, expired: 1 } } });
  const store = I.createStore(d);
  const t = store.register({ domain: "batch", taskId: "C3", panel: "batch", title: "批量" });
  await settle();
  assert.strictEqual(store.get(t.id).status, "failed");
});

test("batch：整批取消 -> canceled", async () => {
  const d = fakeDeps();
  d.api.call = async () => ({ ok: true, data: { batchId: "C4", summary: { completed: 0, cancelled: 4 } } });
  const store = I.createStore(d);
  const t = store.register({ domain: "batch", taskId: "C4", panel: "batch", title: "批量" });
  await settle();
  assert.strictEqual(store.get(t.id).status, "canceled");
});

test("batch：出现过期条目 -> interrupted，绝不报成功", async () => {
  // expired 是 BatchController 清理掉条目记录后的状态：服务端已经不知道这条成片
  // 到底出没出来，产物也取不回来 —— 结局不可知，不能算成功。
  const d = fakeDeps();
  d.api.call = async () => ({ ok: true, data: { batchId: "C5", summary: { completed: 9, expired: 1 } } });
  const store = I.createStore(d);
  const t = store.register({ domain: "batch", taskId: "C5", panel: "batch", title: "批量" });
  await settle();
  assert.strictEqual(store.get(t.id).status, "interrupted", "一条过期就足以让整批不能报成功");
});

test("batch：summary 里什么线索都没有就不推导，保持 running", async () => {
  const d = fakeDeps();
  d.api.call = async () => ({ ok: true, data: { batchId: "C6" } });
  const store = I.createStore(d);
  const t = store.register({ domain: "batch", taskId: "C6", panel: "batch", title: "批量" });
  await settle();
  assert.strictEqual(store.get(t.id).status, "running", "拿不到就留 running，「不知道」不是「已结束」");
});

test("落盘：无 status 的载荷也要排节流写盘", async () => {
  // workflow/batch 的载荷永远没有 status 字段（见 deriveStatus），落盘节流必须挂在
  // applyPayload 无条件盖上的 updatedAt 上，否则「只有进度在变」的任务永远写不进盘。
  const d = fakeDeps();
  const store = I.createStore(d);
  const t = store.register({ domain: "agent", taskId: "D1" });
  await settle();
  const before = d._timers.length;
  d.emit("agent:D1", "data", '{"progress":42}');
  await settle();
  assert.strictEqual(store.get(t.id).progress, 42);
  assert.strictEqual(store.get(t.id).status, "running", "没有 status 就不许判终态");
  assert.ok(d._timers.length > before, "载荷即便没有 status 也要排上写盘");
});

/* ------------------------------------------------------------------
 * 以下是评审后的补充用例：失效判定、单条轮询链、终态保护、恢复时的上限。
 * ------------------------------------------------------------------ */

// 手动推进的假定时器：clearTimeout 真的会销掉句柄，只有 tick() 才真的触发回调。
// 上面那个假 setTimeout 只把回调塞进数组、从不执行也从不销句柄 —— 正好漏掉
// 「旧句柄被覆盖成孤儿定时器」这类问题，所以计数类断言必须换这套。
function manualTimers(d) {
  let seq = 0;
  const pending = new Map();
  d.setTimeout = (fn, ms) => { const id = ++seq; pending.set(id, { fn, ms }); return id; };
  d.clearTimeout = (id) => { pending.delete(id); };
  d.tick = async () => {
    const items = Array.from(pending.values());
    pending.clear();
    items.forEach((x) => x.fn());
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };
  // 只看某个毫秒数上还挂着几个定时器（轮询是 POLL_MS，落盘节流是 SAVE_DEBOUNCE_MS）。
  d.pendingOf = (ms) => Array.from(pending.values()).filter((x) => x.ms === ms).length;
  return d;
}

function savedTask(id, domain, taskId, over) {
  return Object.assign({
    id, domain, taskId, panel: "", title: "",
    status: "running", unknown: false, progress: null, step: null,
    transport: "none", degraded: false, result: null, error: null,
    createdAt: 1, updatedAt: 2, endedAt: null, type: null,
  }, over || {});
}

test("恢复：服务端回真 HTTP 404 -> interrupted", async () => {
  // 这一条要按 api.js 的真实形状写：normalize() 返回 {ok, code, message, raw}，
  // HTTP 状态落在 code 上，从不产生 status 字段。WorkflowController 对消失的任务
  // 回 FailApi(404, ..., 404)，HTTP 404 与 ErrCode=404 同时具备。
  // 之前只认 r.status，等于分支是死代码：服务端重启后消失的任务会落进「没查着」，
  // 永远停在 running，每 3 秒轮询一次 —— 恢复本来就是为了防这个僵尸。
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([savedTask("t_404", "agent", "A0")]);
  d.api.call = async () => ({ ok: false, code: 404, message: "工作流不存在或已过期" });
  const store = I.createStore(d);
  await store.restore();
  assert.strictEqual(store.get("t_404").status, "interrupted");
  assert.strictEqual(store.get("t_404").unknown, false);
});

test("恢复：401 属「没查着」，不能判死", async () => {
  // 404 与 401 只差「服务端到底还有没有这条任务」这一件事。
  // 分不清的后果是对称的：判死会把一条还在跑的任务永久钉死，用户白等；
  // 判活会让已经没了的任务永远挂着。只能认「服务端明说这条没了」这一种证据。
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([savedTask("t_401", "agent", "A6")]);
  d.api.call = async () => ({ ok: false, code: 401, message: "AuthKey 无效" });
  const store = I.createStore(d);
  await store.restore();
  const cur = store.get("t_401");
  assert.strictEqual(cur.status, "running", "鉴权没过不等于任务没了");
  assert.strictEqual(cur.unknown, true);
});

test("恢复后的轮询链只有一条，不会随 tick 翻倍", async () => {
  // restore 先查一轮并排好下一次，watch 若又立刻查一轮，句柄被覆盖的那条链就再也
  // 没人能取消，会和新的链一起每 3 秒各发一次请求 —— 每 tick 翻倍，且永不收敛。
  const d = manualTimers(fakeDeps());
  let calls = 0;
  d.api.call = async () => { calls++; return { ok: true, data: { status: "running" } }; };
  d.loadJson = () => Promise.resolve([savedTask("t_chain", "batch", "B7")]);
  const store = I.createStore(d);
  await store.restore();
  assert.strictEqual(calls, 1, "恢复只查这一次，watch 不能再立刻查一遍");
  assert.strictEqual(d.pendingOf(I.POLL_MS), 1, "同一个任务只允许挂一个轮询定时器");
  await d.tick();
  assert.strictEqual(calls, 2, "一轮 tick 一次");
  assert.strictEqual(d.pendingOf(I.POLL_MS), 1, "旧句柄必须被销掉，不能留成孤儿");
  await d.tick();
  assert.strictEqual(calls, 3, "第二轮仍是一次（之前这里是 4）");
  await d.tick();
  assert.strictEqual(calls, 4, "第三轮仍是一次");
});

test("推送域恢复后不留轮询定时器", async () => {
  // SSE 域由推送驱动。恢复时的确认查询已经查过一轮，剩下的交给推送，
  // 再叠一个 3 秒轮询就是同一份状态被读两遍，与降级机制的设计正好相反。
  const d = manualTimers(fakeDeps());
  let calls = 0;
  d.api.call = async () => { calls++; return { ok: true, data: { status: "running" } }; };
  d.loadJson = () => Promise.resolve([savedTask("t_push", "agent", "A8")]);
  const store = I.createStore(d);
  await store.restore();
  assert.strictEqual(store.get("t_push").transport, "sse", "推送域恢复后由推送驱动");
  assert.strictEqual(calls, 1, "确认查询已经查过");
  assert.strictEqual(d.pendingOf(I.POLL_MS), 0, "推送域不许同时挂一个 3 秒轮询");
  await d.tick();
  assert.strictEqual(calls, 1, "不能再多查");
});

test("取消：已经出结果的任务不许被改写", async () => {
  // 重复点击或迟到的取消会把一条真实的 done / failed 改写成 canceled，
  // 用户等出来的那一趟就此从记录里消失。
  const d = fakeDeps();
  let posted = 0;
  d.api.post = async () => { posted++; return { ok: true }; };
  const store = I.createStore(d);
  const t = store.register({ domain: "marketvideo", taskId: "OK1" });
  d.emit("marketvideo:OK1", "data", '{"status":"completed"}');
  await settle();
  assert.strictEqual(store.get(t.id).status, "done");
  await assert.rejects(() => store.cancel(t.id));
  assert.strictEqual(store.get(t.id).status, "done", "真实结局不能被迟到的取消覆盖");
  assert.strictEqual(posted, 0, "已终态就不该再发取消请求");
});

test("取消：api 还没就绪时也不能同步抛出", async () => {
  // 调用方一律按「返回 Promise」处理；同步抛出去会变成未捕获异常而不是一次拒绝。
  const d = fakeDeps();
  d.api = {
    subscribeTask: () => "sid",
    unsubscribeTask: () => {},
    call: async () => ({ ok: true, data: { status: "running" } }),
  };
  const store = I.createStore(d);
  const t = store.register({ domain: "marketvideo", taskId: "NOPOST" });
  await settle();
  const p = store.cancel(t.id);
  assert.ok(p && typeof p.then === "function", "cancel 必须返回 Promise，而不是同步抛出");
  await assert.rejects(() => p);
});

test("恢复：超上限的落盘文件照样被裁掉", async () => {
  // 上限只在 register 上设的话，恢复就是绕过它的那道口子：文件被手改过或写坏过时，
  // 整个列表会原样灌进来。
  const d = fakeDeps();
  const many = [];
  for (let i = 0; i < 260; i++) {
    many.push(savedTask("t_big_" + i, "batch", "B" + i, { status: "done", createdAt: i, endedAt: i }));
  }
  d.loadJson = () => Promise.resolve(many);
  const store = I.createStore(d);
  await store.restore();
  assert.strictEqual(store.list().length, I.MAX_RECORDS, "落盘文件与 register 共用同一套预算");
});

test("同一任务的两条记录互不牵连", async () => {
  // 退订函数按 streamId 存的话，第二条 watch 会覆盖第一条的，
  // 于是取消任意一条都会把另一条的回调一起拆掉，那条就再也收不到推送了。
  const d = fakeDeps();
  const store = I.createStore(d);
  const a = store.register({ domain: "marketvideo", taskId: "DUP" });
  const b = store.register({ domain: "marketvideo", taskId: "DUP" });
  await settle();
  assert.strictEqual(d._cbs.length, 2, "两条记录各挂一个回调");
  await store.cancel(a.id);
  d.emit("marketvideo:DUP", "data", '{"progress":77}');
  await settle();
  assert.strictEqual(store.get(a.id).status, "canceled");
  assert.strictEqual(store.get(b.id).progress, 77, "b 还活着，必须还收得到推送");
});

test("默认依赖按调用时解析：HTWApi 晚到也能订阅", async () => {
  // window.HTWApi 是 api.js 求值完才挂上的，而单例在本模块求值时就建好了。
  // 要是那一刻把全局快照下来，subscribeTask 会被冻成 undefined ——
  // watch 抛错、被吞掉、每条任务静默降级成轮询，界面上一点症状都没有。
  const MOD = require.resolve("./tasks.js");
  const prevWindow = global.window;
  const subs = [];
  let streamCb = null;
  global.window = {
    htw: {
      saveJson: () => Promise.resolve(true),
      loadJson: () => Promise.resolve(null),
      onStreamEvent: (cb) => { streamCb = cb; return function () {}; },
    },
  };
  delete require.cache[MOD];
  try {
    const Lazy = require("./tasks.js"); // 此刻 window.HTWApi 还不存在
    global.window.HTWApi = {
      subscribeTask: (domain, taskId) => { subs.push(domain + ":" + taskId); return "sid"; },
    };
    const t = Lazy.register({ domain: "agent", taskId: "LATE" });
    const cur = Lazy.get(t.id);
    assert.strictEqual(cur.transport, "sse", "订阅可用就不该降级成轮询");
    assert.strictEqual(cur.degraded, false);
    assert.deepStrictEqual(subs, ["agent:LATE"], "订阅动作应落到后来出现的 HTWApi 上");
    // 收尾，顺带把那条 8 秒首事件超时定时器撤掉，别把测试进程挂住
    streamCb({ streamId: "agent:LATE", type: "data", payload: '{"status":"completed"}' });
  } finally {
    delete require.cache[MOD];
    if (prevWindow === undefined) delete global.window;
    else global.window = prevWindow;
  }
});

/* ------------------------------------------------------------------
 * waiting_approval：等人批准，不是终态，也不该按在跑来对待。
 * ------------------------------------------------------------------ */

test("waiting_approval 不是终态：不能判完成，也不能判死", () => {
  // 创作域每一步都要人工确认，服务端就在这个状态上停住。若把它算进终态，
  // 这条记录会永久停在「等待」——用户批准后它也不会再动，面板再也看不到后续进展。
  assert.strictEqual(I.isTerminal("waiting_approval"), false, "它是暂停，绝不是做完了");
  assert.strictEqual(I.normalizeStatus("waiting_approval"), "running");
  assert.ok(I.isPausedStatus("waiting_approval"));
  assert.ok(!I.isPausedStatus("running"));
  assert.ok(!I.isPausedStatus(null));
  // 判完之后仍能从这条记录继续推进，证明没有被写死。
  const t = I.newTask({ domain: "creation", taskId: "V1", type: "video" });
  I.applyPayload(t, { status: "waiting_approval" });
  assert.strictEqual(t.status, "running");
  assert.strictEqual(t.paused, true);
  assert.strictEqual(t.endedAt, null, "暂停不是结束，不该盖结束时间");
  assert.strictEqual(t.step, "等待确认", "面板的徽章只会写进行中，暂停这件事要让人看得见");
  I.applyPayload(t, { status: "completed" });
  assert.strictEqual(t.status, "done");
  assert.strictEqual(t.paused, false, "状态一动，暂停标记必须自动清掉");
});

test("等人批准时不排 3 秒轮询，批准后立刻恢复", async () => {
  // 等人的这段时间服务端不会有任何变化，每 3 秒问一次纯属空转；
  // 但也不能彻底停掉 —— 停掉就再也没人知道用户批准了，记录会永远卡在等待里。
  const d = manualTimers(fakeDeps());
  const seq = [
    { ok: true, data: { status: "waiting_approval", sessionId: "V2" } },
    { ok: true, data: { status: "running", progress: 20 } },
    { ok: true, data: { status: "completed" } },
  ];
  let k = 0;
  d.api.call = async () => seq[Math.min(k++, seq.length - 1)];
  const store = I.createStore(d);
  const t = store.register({ domain: "creation", taskId: "V2", panel: "create", title: "视频创作", type: "video" });
  await settle();

  assert.strictEqual(store.get(t.id).status, "running", "等人批准期间记录仍是活的");
  assert.strictEqual(store.get(t.id).paused, true);
  assert.strictEqual(d.pendingOf(I.POLL_MS), 0, "等人批准时不该再挂 3 秒轮询");
  assert.strictEqual(d.pendingOf(I.RESUME_CHECK_MS), 1, "改挂一条慢速复查，批准后才靠得住它");

  await d.tick();
  assert.strictEqual(store.get(t.id).paused, false, "服务端给出下一个状态后就不该再算暂停");
  assert.strictEqual(store.get(t.id).progress, 20);
  assert.strictEqual(d.pendingOf(I.POLL_MS), 1, "恢复在跑就立刻回到 3 秒节奏");

  await d.tick();
  assert.strictEqual(store.get(t.id).status, "done", "批准后要能一路走到完成");
  assert.strictEqual(d.pendingOf(I.POLL_MS), 0, "终态不排下一轮");
});

test("「等待确认」不能活得比暂停久：批准之后立刻清掉", () => {
  // 「等待确认」是 applyPayload 自己合出来的一句话，服务端从来没有说过它。
  // 一旦状态往前走而不清它，任务中心里一条正在出片、甚至已经做完的创作任务
  // 会在详情行上永远挂着「等待确认」—— 与这次改动要消灭的那类谎报正好相反。
  const t = I.newTask({ domain: "creation", taskId: "V4", type: "video" });
  I.applyPayload(t, { status: "waiting_approval" });
  assert.strictEqual(t.step, "等待确认");
  // 用户批准了：服务端回到 running，但这一帧没有带步骤文案。
  // 此时不能把上一帧的合成标记当成真实步骤留下来。
  I.applyPayload(t, { status: "running", progress: 30 });
  assert.strictEqual(t.paused, false, "状态一动，暂停就该结束");
  assert.strictEqual(t.progress, 30);
  assert.strictEqual(t.step, null, "已经不在等了，详情行不能还写「等待确认」");
});

test("任务做完了也不能留着「等待确认」", () => {
  const t = I.newTask({ domain: "creation", taskId: "V5", type: "video" });
  I.applyPayload(t, { status: "waiting_approval" });
  I.applyPayload(t, { status: "completed" });
  assert.strictEqual(t.status, "done");
  assert.strictEqual(t.paused, false);
  assert.strictEqual(t.step, null, "已完成的记录挂着一句「等待确认」是纯误导");
});

test("暂停时服务端给了真实步骤，就不要用合成的标记盖掉它", () => {
  const t = I.newTask({ domain: "creation", taskId: "V6", type: "video" });
  I.applyPayload(t, { status: "waiting_approval", currentStepLabel: "等待你确认分镜" });
  assert.strictEqual(t.step, "等待你确认分镜", "有真实文案就用真实文案");
});

test("恢复出来的等人任务也按慢速复查接上", async () => {
  // 落盘文件里的 paused 标记要跟着走：重启后如果一律按 3 秒轮询接上，
  // 等着人批准的那批会话会在用户回来之前白烧掉几万次请求。
  const d = manualTimers(fakeDeps());
  d.loadJson = () => Promise.resolve([
    savedTask("t_paused", "creation", "V3", { panel: "create", title: "视频创作", type: "video", paused: true }),
  ]);
  d.api.call = async () => ({ ok: true, data: { status: "waiting_approval" } });
  const store = I.createStore(d);
  await store.restore();
  assert.strictEqual(store.get("t_paused").paused, true);
  assert.strictEqual(d.pendingOf(I.POLL_MS), 0);
  assert.strictEqual(d.pendingOf(I.RESUME_CHECK_MS), 1);
});

/* ------------------------------------------------------------------
 * 以下是整分支评审后才看得见的三处：未知域留下的僵尸记录、
 * 推送恢复后没人清的「状态未确认」、以及恢复时订阅者要等多久才看到记录。
 * ------------------------------------------------------------------ */

test("登记：未知域当场拒绝，不能留下一条永远「进行中」的僵尸", async () => {
  // watch 与 pollOnce 都在开头按 DOMAINS 查不到就返回：排不出轮询、订阅不了推送，
  // 派生不出状态。而 evict 留着 running、clearFinished 也只留 running —— 于是这条记录
  // 永远淘汰不掉，任务中心里永远挂着「进行中」，用户清空记录也清不掉。
  // 域名多半是新登记点打错字，所以要在建记录这一层就拒掉。
  const d = fakeDeps();
  let calls = 0, subs = 0;
  d.api.call = async () => { calls++; return { ok: true, data: { status: "completed" } }; };
  d.api.subscribeTask = () => { subs++; return "sid"; };
  const store = I.createStore(d);
  assert.strictEqual(store.register({ domain: "agnet", taskId: "TYPO" }), null, "域名拼错必须登记失败");
  assert.strictEqual(store.list().length, 0, "不该留下任何记录");
  await settle();
  assert.strictEqual(calls, 0, "没有记录就不该有轮询");
  assert.strictEqual(subs, 0, "没有记录就不该订阅推送");
});

test("恢复：落盘里域名字段不对的记录不得被复活成僵尸", async () => {
  // 恢复原来只按 t && t.id 过滤。域名写错（打错字的旧版本、手改过的文件）的记录会被
  // 原样灌进来，然后在 DOMAINS 里查不到 —— 与上面那条僵尸同一条死路。
  const d = fakeDeps();
  let calls = 0;
  d.api.call = async () => { calls++; return { ok: true, data: { status: "completed" } }; };
  d.loadJson = () => Promise.resolve([
    savedTask("t_bad", "publishh", "P9"),   // 域名多打一个字母
    savedTask("t_nodomain", null),          // 干脆没有域
    savedTask("t_ok", "agent", "A10"),
  ]);
  const store = I.createStore(d);
  await store.restore();
  assert.deepStrictEqual(store.list().map((t) => t.id), ["t_ok"], "只有域名字段认得的记录才该被载入");
  assert.strictEqual(calls, 1, "僵尸记录不该触发任何状态复查");
});

test("推送恢复后必须清掉「状态未确认」", async () => {
  // 面板的状态徽章正是照着 unknown 渲染的：查不到时显示「状态未确认」。
  // 恢复走完（此时还查不到）-> SSE 接上 -> 帧在流、进度在走，标记却没人清 ——
  // 用户看着一条健康流式推送的任务，被告知状态不明。推送帧解析成功就是「这条路是通的」
  // 这一条证据，够格清掉上一次轮询失败留下的标记。
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([savedTask("t_sse", "agent", "A11")]);
  d.api.call = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
  const store = I.createStore(d);
  await store.restore();
  const before = store.get("t_sse");
  assert.strictEqual(before.status, "running");
  assert.strictEqual(before.unknown, true, "查不到时先标成状态未确认");
  assert.strictEqual(before.transport, "sse", "仍在跑 -> 恢复流程会把它接上推送");

  d.emit("agent:A11", "data", '{"status":"running","progress":35}');
  await settle();
  const after = store.get("t_sse");
  assert.strictEqual(after.progress, 35, "前提：帧确实被收下并在推进");
  assert.strictEqual(after.unknown, false, "推送帧一到就必须清掉未确认，否则徽章永远写「状态未确认」");
});

test("恢复：记录一载入就广播，不必等逐条状态复查走完", async () => {
  // app.js 是先 mountSkills() 再 restore() 的，面板挂载在空列表上；
  // 而复查是刻意保持串行的，服务端不可达时每条都要等一次系统级连接超时
  // （Windows 上约 130 秒），一条接一条。此时唯一职责就是回答「什么在跑」的
  // 任务中心不能一直显示「还没有任务记录。」—— 载入结果必须先交出去。
  const d = fakeDeps();
  d.loadJson = () => Promise.resolve([
    savedTask("t_late", "batch", "B11"),
    savedTask("t_late2", "batch", "B12"),
  ]);
  const gates = [];
  d.api.call = () => new Promise((res) => { gates.push(() => res({ ok: true, data: { status: "running" } })); });
  const store = I.createStore(d);
  const seen = [];
  store.onChange(() => { seen.push(store.list().map((t) => t.id).join(",")); });
  const done = store.restore();
  await settle();
  assert.deepStrictEqual(seen, ["t_late,t_late2"],
    "复查一次都还没返回时，载入的记录就必须已经广播给订阅者了");
  // 放行复查，让 restore 自己收尾（串行复查本身刻意保持不变）
  gates.splice(0).forEach((f) => f());
  await settle();
  gates.splice(0).forEach((f) => f());
  await done;
  assert.strictEqual(store.list().length, 2, "复查放行后记录一条都不该少");
});
