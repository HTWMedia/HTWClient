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

test("expired 是终态 —— batch 域的任务记录被服务端清掉后写的状态", () => {
  // BatchController.cs：任务状态先于批次记录被清理时（成片 1 小时、批次 6 小时），
  // 条目状态回落成 expired。它是终态，漏判就会把这条记录永远留在 running。
  assert.ok(I.isTerminal("expired"));
  assert.strictEqual(I.normalizeStatus("expired"), "interrupted");
});

test("expired 必须映射为已中断，绝不能显示成绿色成功", () => {
  // expired 的含义是「记录被服务端清掉了」，不是「做完了」：结局未知、产物也已不可达。
  // 顺着兜底分支落到 done 会把一条根本没结果的记录渲染成成功，用户点进去空空如也。
  // 与 notfound 同档 —— 两者都是「服务端那边已经没有这条任务了」。
  assert.strictEqual(I.normalizeStatus("expired"), "interrupted");
  assert.strictEqual(I.normalizeStatus("EXPIRED"), "interrupted");
  assert.strictEqual(I.normalizeStatus(" expired "), "interrupted");
  const t = I.newTask({ domain: "batch", taskId: "B1" });
  I.applyPayload(t, { status: "expired" });
  assert.strictEqual(t.status, "interrupted");
  assert.ok(t.endedAt, "落终态就必须记结束时间");
  // 它是终态，所以能被淘汰掉，不会变成永远淘汰不掉的僵尸
  assert.strictEqual(I.evict([t], 0).length, 0);
});

test("normalizeStatus：服务端词表映射到内部词表", () => {
  for (const [from, to] of [
    ["running", "running"], ["uploading", "running"], ["pending", "running"],
    ["success", "done"], ["completed", "done"], ["done", "done"],
    ["DONE", "done"], ["  Completed  ", "done"],
    ["expired", "interrupted"], ["draft_saved", "done"], ["awaiting_manual", "done"],
    ["failed", "failed"], ["error", "failed"], ["partial_failed", "failed"],
    ["canceled", "canceled"], ["cancelled", "canceled"],
    ["notfound", "interrupted"],
  ]) {
    assert.strictEqual(I.normalizeStatus(from), to, from + " 应映射为 " + to);
  }
  // 没有 status 就返回 null：「不知道」不等于「还在跑」，调用方要能分辨
  for (const s of ["", "   ", null, undefined]) {
    assert.strictEqual(I.normalizeStatus(s), null, JSON.stringify(s) + " 应映射为 null");
  }
});

test("partial_failed 映射为失败，不能显示成绿色成功", () => {
  // publish 域只有 partial_failed 这一个失败信号：FinalizeTask 只要有子任务非 success
  // 就写它，覆盖「所有平台 cookie 全失效」和「B站成功、抖音要人工点」两种结局。
  // 映射成 done 会让全平台失败也显示成功。
  const t = I.newTask({ domain: "publish", taskId: "P1" });
  I.applyPayload(t, { status: "partial_failed" });
  assert.strictEqual(t.status, "failed");
  assert.ok(t.endedAt, "落终态就必须记结束时间");
});

test("终态是粘滞的：迟到的 running 帧不能把已完成的任务拉回在跑", () => {
  // SSE 会乱序/重发。若允许回退，就会出现 status=running 而 endedAt 还留着的记录 ——
  // evict 按 status 分组，它既不显示完成、又因为算「在跑」而永远淘汰不掉。
  const t = I.newTask({ domain: "agent", taskId: "Z1" });
  I.applyPayload(t, { status: "completed" });
  assert.strictEqual(t.status, "done");
  const endedAt = t.endedAt;
  assert.ok(endedAt);

  I.applyPayload(t, { status: "running", progress: 30 });
  assert.strictEqual(t.status, "done", "已完成的任务不能被迟到的 running 帧复活");
  assert.strictEqual(t.endedAt, endedAt, "endedAt 不能被清掉");
  // 进度之类仍然照常更新，只是状态不动
  assert.strictEqual(t.progress, 30);

  // 而且它必须能被淘汰掉，否则就是个永久僵尸
  const list = I.evict([t], 0);
  assert.strictEqual(list.length, 0, "终态记录应该被淘汰");
});

test("终态粘滞只挡回退，不挡终态之间的修正", () => {
  const t = I.newTask({ domain: "agent", taskId: "Z2" });
  I.applyPayload(t, { status: "completed" });
  I.applyPayload(t, { status: "failed", error: "上传中断" });
  assert.strictEqual(t.status, "failed");
  assert.ok(t.endedAt);
});

test("在跑的记录仍可被非终态状态改写", () => {
  const t = I.newTask({ domain: "agent", taskId: "Z3" });
  I.applyPayload(t, { status: "uploading" });
  assert.strictEqual(t.status, "running");
  assert.strictEqual(t.endedAt, null);
  I.applyPayload(t, { status: "running" });
  assert.strictEqual(t.status, "running");
});

test("没有 status 的 payload 也必须盖 updatedAt", () => {
  // /api/v2/workflow/status 与 /api/v2/batch/status 压根不返回 status 字段。
  // 若在缺 status 时提前返回，这两个域的 updatedAt 永远不动，落盘节流就永远不触发。
  const t = I.newTask({ domain: "workflow", taskId: "W2" });
  t.updatedAt = 0;
  I.applyPayload(t, { stage: "compose" });
  assert.ok(t.updatedAt > 0, "没有 status 也要更新 updatedAt");
  assert.strictEqual(t.status, "running", "缺 status 不等于改状态");
});

test("applyPayload: agent 域取出进度与步骤", () => {
  const t = I.newTask({ domain: "agent", taskId: "A1", panel: "shortdrama", title: "短剧" });
  I.applyPayload(t, { status: "running", progress: 62, currentStep: "合成中" });
  assert.strictEqual(t.progress, 62);
  assert.strictEqual(t.step, "合成中");
  assert.strictEqual(t.status, "running");
});

test("applyPayload: 创作域的 currentStepLabel / currentStepId 要能显示出来", () => {
  // 创作状态端点给的是这两个字段，创作面板自己也是这么读的（create.js 的 renderDetail）。
  // store 不认它们的话，一条创作任务的详情行除了暂停时那句合成的「等待确认」之外
  // 永远是空的 —— 缺口不只影响暂停中的那批，是**所有**创作记录。
  const t = I.newTask({ domain: "creation", taskId: "C1", type: "video" });
  I.applyPayload(t, { status: "running", currentStepLabel: "生成画面" });
  assert.strictEqual(t.step, "生成画面");

  // 没有文案时退回 id，总比空着强
  const u = I.newTask({ domain: "creation", taskId: "C2", type: "video" });
  I.applyPayload(u, { status: "running", currentStepId: "script_gen" });
  assert.strictEqual(u.step, "script_gen");

  // 两个都有时以文案为准（与创作面板同口径）
  const v = I.newTask({ domain: "creation", taskId: "C3", type: "video" });
  I.applyPayload(v, { status: "running", currentStepLabel: "生成画面", currentStepId: "video_gen" });
  assert.strictEqual(v.step, "生成画面");

  // 别的域的既有读法不能被挤掉
  const w = I.newTask({ domain: "agent", taskId: "A9" });
  I.applyPayload(w, { status: "running", currentStep: "合成中" });
  assert.strictEqual(w.step, "合成中");
  const x = I.newTask({ domain: "workflow", taskId: "W9" });
  I.applyPayload(x, { stage: "compose" });
  assert.strictEqual(x.step, "compose");
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

test("applyPayload: 进度是空串也算拿不到，绝不伪造 0", () => {
  // Number("") 是 0、空格串也是 0，而 p.progress != null 挡不住空串。
  // 「没有进度」和「进度真的是 0」必须分得开，否则界面会跳出一个凭空的 0%。
  for (const v of ["", "   "]) {
    const t = I.newTask({ domain: "agent", taskId: "E" + v.length });
    I.applyPayload(t, { status: "running", progress: v });
    assert.strictEqual(t.progress, null, JSON.stringify(v) + " 应留 null");
  }
  const p = I.newTask({ domain: "agent", taskId: "EP" });
  I.applyPayload(p, { status: "running", percent: "" });
  assert.strictEqual(p.progress, null, "percent 为空串同样留 null");
  // 真的 0% 还是要照实记
  const z = I.newTask({ domain: "agent", taskId: "EZ" });
  I.applyPayload(z, { status: "running", progress: 0 });
  assert.strictEqual(z.progress, 0);
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

test("淘汰：在跑的超过预算时终态全丢，列表仍超预算", () => {
  // 上限是给终态留位置的；在跑的永远不丢，所以它们自己就能把列表撑爆。
  // 这时不能为了凑满上限去动在跑的，只能把终态全丢光并接受超预算。
  const tasks = [];
  for (let i = 0; i < 210; i++) {
    const t = I.newTask({ domain: "agent", taskId: "R" + i });
    t.status = "running";
    t.createdAt = i;
    tasks.push(t);
  }
  for (let i = 0; i < 5; i++) {
    const t = I.newTask({ domain: "agent", taskId: "F" + i });
    t.status = "done";
    t.endedAt = i;
    tasks.push(t);
  }
  const out = I.evict(tasks, 200);
  assert.strictEqual(out.length, 210, "210 条在跑的都不该被丢，终态却一条都挤不进去");
  assert.strictEqual(out.filter((t) => t.status === "done").length, 0);
  assert.ok(out.every((t) => t.status === "running"));
});

test("淘汰：max 缺省用 MAX_RECORDS", () => {
  const tasks = [];
  for (let i = 0; i < I.MAX_RECORDS + 10; i++) {
    const t = I.newTask({ domain: "agent", taskId: "D" + i });
    t.status = "done";
    t.endedAt = i;
    tasks.push(t);
  }
  assert.strictEqual(I.evict(tasks).length, I.MAX_RECORDS);
  // 不传 max 且没超上限时原样返回
  assert.strictEqual(I.evict(tasks.slice(0, 3)).length, 3);
});

test("淘汰：两条返回路径都返回新数组，不改也不返回入参本身", () => {
  // 调用方（Task 4）会把 store 里的数组整个换掉；混用「原地改」和「返回新数组」
  // 会让「有没有换成功」这件事没法判断。
  const under = [I.newTask({ domain: "agent", taskId: "U1" })];
  assert.notStrictEqual(I.evict(under, I.MAX_RECORDS), under);

  const over = [];
  for (let i = 0; i < 5; i++) {
    const t = I.newTask({ domain: "agent", taskId: "O" + i });
    t.status = "done";
    t.endedAt = i;
    over.push(t);
  }
  const out = I.evict(over, 2);
  assert.notStrictEqual(out, over);
  assert.strictEqual(over.length, 5, "入参不该被就地改短");
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

test("八个面板的 track 调用点都必须先判空容器", () => {
  // 容器缺席（script 标签被删、或加载顺序滑到面板之后）时，面板里直接调
  // window.HTWTasks.track 会抛 TypeError，被面板自己的 catch 接成「启动失败」
  // 「请求异常」：一次其实已经提交成功的任务被报成失败，面板随后也不再开始轮询。
  // 容器自己的面板（tasks-panel.js）另用 store() 容错读取，面板侧要对齐同一套约定。
  // 这里用源码扫描把这条约定钉住：将来新增的登记点忘了判空，套件会红。
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "skills");
  const panels = ["shortdrama", "marketing", "tools", "publish", "create", "workflow", "batch", "edit"];
  const GUARD = "if (window.HTWTasks) ";
  let sites = 0;
  for (const name of panels) {
    const lines = fs.readFileSync(path.join(dir, name + ".js"), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.indexOf("HTWTasks.track") < 0) return;
      sites++;
      assert.strictEqual(line.trim().indexOf(GUARD), 0,
        name + ".js:" + (i + 1) + " 的 track 调用没有判空容器：" + line.trim());
    });
  }
  // 数量下限：八面板当前共 20 处（tools 9 / edit 3 / workflow 2 / shortdrama 2，
  // 其余各 1）。低于这个数说明有面板被整体删掉了登记点。
  assert.ok(sites >= 20, "登记点不该少于 20 处，实际 " + sites);
});
