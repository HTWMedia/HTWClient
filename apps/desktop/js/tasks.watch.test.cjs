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