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
  const TERMINAL_STATUSES = {
    success: 1, completed: 1, done: 1, failed: 1, canceled: 1, cancelled: 1,
    error: 1, notfound: 1, partial_failed: 1,
    draft_saved: 1, awaiting_manual: 1, unconfirmed: 1,
  };

  function isTerminal(status) {
    if (!status) return false;
    return !!TERMINAL_STATUSES[String(status).toLowerCase()];
  }

  function num(v) {
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

    const s = String(p.status || "").toLowerCase();
    if (!s) return task;
    if (s === "notfound") { task.status = "interrupted"; task.endedAt = Date.now(); }
    else if (isTerminal(s)) {
      task.status = (s === "canceled" || s === "cancelled") ? "canceled"
        : (s === "failed" || s === "error") ? "failed" : "done";
      task.endedAt = Date.now();
    } else {
      task.status = "running";
    }
    task.updatedAt = Date.now();
    return task;
  }

  // 超过上限时丢最旧的终态；运行中的永不丢。
  function evict(list, max) {
    if (list.length <= max) return list;
    const running = list.filter((t) => t.status === "running");
    const finished = list.filter((t) => t.status !== "running");
    finished.sort((a, b) => (a.endedAt || a.createdAt) - (b.endedAt || b.createdAt));
    const drop = finished.length - Math.max(0, max - running.length);
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
      isTerminal, applyPayload, evict, canCancel, cancelBody, newTask,
    },
  };
});
