const test = require("node:test");
const assert = require("node:assert");
const T = require("./tasks.js");
const I = T._internal;

/* 字段名取自各面板现役的读法：
 *   agent       —— shortdrama.js:184/354/358 （status/progress/currentStep/cloudUrl||downloadUrl）
 *   marketvideo —— marketing.js:233-248        （status/progress/currentStep/error）
 *   voice/subtitle/image —— tools.js:34         （status/result）
 *   publish     —— PublishManager.GetTaskStatus（status/subTasks）
 * 其余四域的进度语义与上面不同，一律允许 progress 为 null，不许编。
 */

test("终态判定覆盖服务端全部终态值", () => {
  const terminal = ["success", "completed", "failed", "canceled", "cancelled",
    "error", "notfound", "partial_failed", "draft_saved", "awaiting_manual", "unconfirmed"];
  for (const s of terminal) assert.ok(I.isTerminal(s), s + " 应判为终态");
  // 大小写不敏感：服务端 PublishManager 写的是小写，但别的域可能给 done
  assert.ok(I.isTerminal("DONE"));
});

test("进行中的状态绝不能判为终态", () => {
  for (const s of ["pending", "running", "uploading", "processing", "", null, undefined]) {
    assert.strictEqual(I.isTerminal(s), false, JSON.stringify(s) + " 不该是终态");
  }
});

test("partial_failed 是终态 —— 它是最常见的发布结局", () => {
  // 抖音人工发布/存草稿/未取到证据都会被 FinalizeTask 归并成 partial_failed。
  // 漏了它，发布完成后连接会一直挂到 60 分钟上限。
  assert.ok(I.isTerminal("partial_failed"));
});

test("applyPayload: agent 域取出进度与步骤", () => {
  const t = I.newTask({ domain: "agent", taskId: "A1", panel: "shortdrama", title: "短剧" });
  I.applyPayload(t, { status: "running", progress: 62, currentStep: "合成中" });
  assert.strictEqual(t.progress, 62);
  assert.strictEqual(t.step, "合成中");
  assert.strictEqual(t.status, "running");
});

test("applyPayload: cloudUrl 与 downloadUrl 都能作为产物地址", () => {
  const a = I.newTask({ domain: "agent", taskId: "A2" });
  I.applyPayload(a, { status: "completed", cloudUrl: "https://cdn/x.mp4" });
  assert.strictEqual(a.result && a.result.downloadUrl, "https://cdn/x.mp4");
});

test("applyPayload: 拿不到进度就留 null，绝不伪造 0", () => {
  const t = I.newTask({ domain: "workflow", taskId: "W1" });
  I.applyPayload(t, { stage: "compose" });
  assert.strictEqual(t.progress, null, "没有进度字段时必须是 null，不是 0");
  assert.strictEqual(t.step, "compose");
});

test("applyPayload: notfound 直接落终态", () => {
  const t = I.newTask({ domain: "agent", taskId: "A3" });
  I.applyPayload(t, { status: "notfound" });
  assert.strictEqual(t.status, "interrupted");
});

test("applyPayload: 完成时记下产物文件名", () => {
  const t = I.newTask({ domain: "agent", taskId: "A4" });
  I.applyPayload(t, { status: "completed", fileName: "movie.mp4", downloadUrl: "/d/1" });
  assert.strictEqual(t.status, "done");
  assert.strictEqual(t.result.fileName, "movie.mp4");
});

test("淘汰：只丢最旧的终态，运行中的永不淘汰", () => {
  let tasks = [];
  for (let i = 0; i < 205; i++) {
    const t = I.newTask({ domain: "agent", taskId: "T" + i });
    t.status = i % 2 === 0 ? "done" : "running";   // 约一半终态、一半在跑
    t.createdAt = i;
    tasks.push(t);
  }
  tasks = I.evict(tasks, 200);
  assert.strictEqual(tasks.length, 200);
  const running = tasks.filter((t) => t.status === "running");
  assert.ok(running.length > 0, "运行中的任务不该被淘汰");
  // 最新的那个在跑的任务必须还在（i=204 是偶数、状态为 done，在跑的是 T203）
  assert.ok(tasks.some((t) => t.taskId === "T203" && t.status === "running"));
});

test("淘汰：终态不足时全部保留", () => {
  const tasks = [];
  for (let i = 0; i < 3; i++) {
    const t = I.newTask({ domain: "agent", taskId: "X" + i });
    t.status = "running";
    tasks.push(t);
  }
  assert.strictEqual(I.evict(tasks, 200).length, 3);
});

test("取消请求体必须是 PascalCase", () => {
  // 服务端 MVC 走 Newtonsoft，只认 PascalCase；api.js 的 camelize 只管响应。
  const body = I.cancelBody("marketvideo", "T1");
  assert.deepStrictEqual(body, { TaskId: "T1" });
  assert.deepStrictEqual(I.cancelBody("batch", "B1"), { BatchId: "B1" });
  assert.deepStrictEqual(I.cancelBody("workflow", "W1"), { WorkflowId: "W1" });
});

test("取消白名单只有三个域", () => {
  assert.ok(I.canCancel("marketvideo"));
  assert.ok(I.canCancel("batch"));
  assert.ok(I.canCancel("workflow"));
  for (const d of ["agent", "voice", "subtitle", "image", "creation", "edit", "publish"]) {
    assert.strictEqual(I.canCancel(d), false, d + " 不该有取消按钮");
  }
});

test("域注册表覆盖 8 个面板用到的全部域", () => {
  for (const d of ["agent", "marketvideo", "voice", "subtitle", "image",
    "publish", "creation", "workflow", "batch", "edit"]) {
    assert.ok(I.DOMAINS[d], "缺域：" + d);
  }
});

test("只有服务端已支持的六个域走 SSE", () => {
  assert.strictEqual(I.DOMAINS.agent.sse, true);
  assert.strictEqual(I.DOMAINS.marketvideo.sse, true);
  assert.strictEqual(I.DOMAINS.voice.sse, true);
  assert.strictEqual(I.DOMAINS.subtitle.sse, true);
  assert.strictEqual(I.DOMAINS.publish.sse, true);
  // 这五个后端还没有 SSE 域，注册表留了口子，但本次不接
  assert.strictEqual(I.DOMAINS.creation.sse, false);
  assert.strictEqual(I.DOMAINS.workflow.sse, false);
  assert.strictEqual(I.DOMAINS.batch.sse, false);
  assert.strictEqual(I.DOMAINS.edit.sse, false);
  assert.strictEqual(I.DOMAINS.image.sse, false);
});
