(function (root, factory) {
  const tasks = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = tasks;
  if (typeof window !== "undefined") window.HTWTasks = tasks;
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_RECORDS = 200;
  const POLL_MS = 3000;
  const FIRST_EVENT_TIMEOUT_MS = 8000;
  const RECONNECT_MS = 2000;
  const SAVE_DEBOUNCE_MS = 2000;

  // 终态集合。partial_failed 必须在内：PublishManager.FinalizeTask 的判定是
  // 「任一子任务非 success 即算」，抖音人工发布/存草稿/未取到证据全都归并成它 ——
  // 也就是说最常见的发布结局都在这里。
  // expired 在内：batch 域把「任务记录已被服务端清掉」的条目写成 expired
  // （BatchController.cs，成片 1 小时 / 批次 6 小时后清理），漏了它这条记录会被
  // 当成在跑、永远停在 running。目前 /api/v2/batch/status 顶层还没有 status 字段，
  // 走不到这里；但 Task 4 要从 summary/items 推导状态，那时就可达了，所以先补上。
  const TERMINAL_STATUSES = {
    success: 1, completed: 1, done: 1, failed: 1, canceled: 1, cancelled: 1,
    error: 1, notfound: 1, partial_failed: 1, expired: 1,
    draft_saved: 1, awaiting_manual: 1, unconfirmed: 1,
  };

  // 内部状态词表（记录里 status 字段的取值）里的终态。
  // 与服务端词表分开是因为两边的判定标准不同：服务端只要知道「结束了」，
  // 客户端还要知道该显示成绿/红/灰/中断哪一类。
  const INTERNAL_TERMINAL_STATUSES = {
    done: 1, failed: 1, canceled: 1, interrupted: 1,
  };

  function isTerminal(status) {
    if (!status) return false;
    return !!TERMINAL_STATUSES[String(status).toLowerCase()];
  }

  function isTerminalState(status) {
    return !!INTERNAL_TERMINAL_STATUSES[status];
  }

  // 把服务端状态映射到内部词表：running / done / failed / canceled / interrupted。
  // payload 里没有 status 时返回 null —— 「不知道」和「还在跑」是两回事，
  // 不能默认按在跑处理。
  function normalizeStatus(status) {
    if (status === null || status === undefined) return null;
    const s = String(status).trim().toLowerCase();
    if (!s) return null;
    if (!isTerminal(s)) return "running";
    // notfound 与 expired 是同一类：服务端那边已经没有这条任务记录了。
    if (s === "notfound") return "interrupted";
    // expired 必须单独点名、落到「已中断」，绝不能顺着结尾的兜底分支掉进 done。
    // 它的含义是「记录已被服务端的定期清理删掉」（BatchController 对成片 1 小时、
    // 批次 6 小时后清理，条目状态回落成 expired），不是「做完了」—— 结局未知、
    // 产物也已不可达，显示成绿色成功等于替服务端撒谎，用户点进去只会发现什么都没有。
    if (s === "expired") return "interrupted";
    if (s === "canceled" || s === "cancelled") return "canceled";
    // partial_failed 必须落到失败而不是成功：publish 域只有这一个失败信号
    // （FinalizeTask 一旦有子任务非 success 就写它），映射成 done 会让
    // 「所有平台都失败」「B站成功、抖音要人工点」这两种结局都显示成绿色成功。
    if (s === "failed" || s === "error" || s === "partial_failed") return "failed";
    return "done";
  }

  function num(v) {
    if (v === null || v === undefined) return null;
    // Number("") 是 0、Number("  ") 也是 0。空串当进度会凭空造出一个 0%，
    // 而「没有进度」和「进度是 0」对用户是两回事 —— 本项目的规矩是拿不到就留 null。
    if (typeof v === "string" && v.trim() === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function newTask(opts) {
    const now = Date.now();
    return {
      id: "t_" + Math.random().toString(16).slice(2, 10),
      domain: opts.domain,
      taskId: opts.taskId,
      type: opts.type || null,
      panel: opts.panel || "",
      title: opts.title || "",
      status: "running",
      unknown: false,
      progress: null,
      step: null,
      transport: "none",
      degraded: false,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
  }

  // 进度字段各域叫法不一；取不到就留 null —— 编一个 0% 比不给更糟。
  function applyPayload(task, payload) {
    if (!task || !payload || typeof payload !== "object") return task;
    const p = payload;
    const url = p.downloadUrl || p.cloudUrl || p.videoUrl || p.url || "";
    if (p.error) task.error = String(p.error);
    if (p.currentStep || p.step) task.step = String(p.currentStep || p.step);
    else if (p.stage) task.step = String(p.stage);
    const pr = num(p.progress != null ? p.progress : p.percent);
    if (pr != null) task.progress = Math.max(0, Math.min(100, pr));
    // 有地址就算产物：agent 域的云端产物常常只给 cloudUrl，不带文件名。
    const name = p.fileName || p.outputFile;
    if (name || url) task.result = { fileName: name ? String(name) : null, downloadUrl: url };

    // updatedAt 必须无条件盖：workflow 与 batch 的状态响应里压根没有 status 字段
    // （/api/v2/workflow/status、/api/v2/batch/status），若在缺 status 时提前返回，
    // 这两个域的 updatedAt 永远不动，Task 4 基于它的落盘节流就永远不会触发。
    task.updatedAt = Date.now();

    const next = normalizeStatus(p.status);
    if (!next) return task;

    // 终态粘滞：已经落到终态的记录，不许被后到的一帧拉回 running。
    // SSE 与轮询都可能乱序或重发，一旦发生就会得到「status=running 但 endedAt 还留着」
    // 的僵尸记录 —— evict 按 status 分组，它既不显示完成、又因为算「在跑」而永远
    // 淘汰不掉。服务端 AgentTaskManager 为了同一件事给终态写加了锁
    // （终态写必须与进度回调互斥），客户端是最后一跳，同一条规则必须在这里再实现一次。
    // 注意这不是「终态不可变」：迟到的另一条终态（done → failed）仍然照常覆盖。
    if (next === "running" && isTerminalState(task.status)) return task;

    task.status = next;
    task.endedAt = next === "running" ? null : Date.now();
    return task;
  }

  // 超过上限时丢最旧的终态；运行中的永不丢。
  // max 缺省为 MAX_RECORDS；两条返回路径都返回新数组 —— 调用方（Task 4）会把
  // 传入的 store 数组整个换掉，原地改与新建混用会让「有没有换成功」没法判断。
  function evict(list, max) {
    const limit = typeof max === "number" && isFinite(max) && max >= 0 ? max : MAX_RECORDS;
    if (list.length <= limit) return list.slice();
    const running = list.filter((t) => t.status === "running");
    const finished = list.filter((t) => t.status !== "running");
    finished.sort((a, b) => (a.endedAt || a.createdAt) - (b.endedAt || b.createdAt));
    // 在跑的比预算还多时 max - running.length 为负，drop 就会等于 finished 全量：
    // 既然一条终态都挤不进去，就全丢，宁可列表暂时超预算也不谎报完成的任务还在。
    const drop = finished.length - Math.max(0, limit - running.length);
    const kept = finished.slice(Math.max(0, drop));
    const out = kept.concat(running);
    out.sort((a, b) => a.createdAt - b.createdAt);
    return out;
  }

  function canCancel(domain) {
    const d = DOMAINS[domain];
    return !!(d && d.cancel);
  }

  // PascalCase：服务端 MVC 走 Newtonsoft，只认这套大小写。
  function cancelBody(domain, taskId) {
    if (domain === "marketvideo") return { TaskId: taskId };
    if (domain === "batch") return { BatchId: taskId };
    if (domain === "workflow") return { WorkflowId: taskId };
    return null;
  }

  const DOMAINS = {
    agent: { sse: true, cancel: false,
      status: (t) => "/api/v2/agent/status?taskId=" + encodeURIComponent(t.taskId) },
    marketvideo: { sse: true, cancel: true,
      cancelPath: "/api/v2/market-video/cancel",
      status: (t) => "/api/v2/market-video/status?taskId=" + encodeURIComponent(t.taskId) },
    voice: { sse: true, cancel: false,
      status: (t) => "/api/v2/voice/status/" + encodeURIComponent(t.taskId) },
    subtitle: { sse: true, cancel: false,
      status: (t) => "/api/v2/subtitle/status/" + encodeURIComponent(t.taskId) },
    publish: { sse: true, cancel: false,
      status: (t) => "/api/v2/publish/task-status?taskId=" + encodeURIComponent(t.taskId) },
    creation: { sse: false, cancel: false,
      status: (t) => "/api/v2/creation/status?sessionId=" + encodeURIComponent(t.taskId)
        + "&type=" + encodeURIComponent(t.type || "video") },
    workflow: { sse: false, cancel: true,
      cancelPath: "/api/v2/workflow/cancel",
      status: (t) => "/api/v2/workflow/status?workflowId=" + encodeURIComponent(t.taskId) },
    batch: { sse: false, cancel: true,
      cancelPath: "/api/v2/batch/cancel",
      status: (t) => "/api/v2/batch/status?batchId=" + encodeURIComponent(t.taskId) },
    edit: { sse: false, cancel: false,
      status: (t) => "/api/v2/edit/status/" + encodeURIComponent(t.taskId) },
    image: { sse: false, cancel: false,
      status: (t) => "/api/v2/image/status?taskId=" + encodeURIComponent(t.taskId) },
  };

  return {
    _internal: {
      MAX_RECORDS, POLL_MS, FIRST_EVENT_TIMEOUT_MS, RECONNECT_MS, SAVE_DEBOUNCE_MS,
      TERMINAL_STATUSES, DOMAINS,
      isTerminal, normalizeStatus, applyPayload, evict, canCancel, cancelBody, newTask,
    },
  };
});
