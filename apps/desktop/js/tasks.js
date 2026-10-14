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

  /* ------------------------------------------------------------------
   * 按域推导状态。
   *
   * workflow 与 batch 的状态响应里压根没有 status 字段，只把载荷喂给
   * applyPayload 的话这两域的记录会永远停在 running（applyPayload 对缺 status
   * 的载荷只盖 updatedAt、不动 status）。所以在进 applyPayload 之前按域折算一次，
   * 折算出的是**服务端词表**里的词，仍由 normalizeStatus 统一落到内部词表 ——
   * 这样粘滞终态、expired→interrupted 这些规则一条都不绕开。
   *
   * 这段刻意不塞进 applyPayload：那是与域无关的通用映射，塞进来会让上面两条
   * 规则对所有域生效。
   * ------------------------------------------------------------------ */

  // workflow：状态响应是 { workflowId, stage, topic, active, ... }。
  // 优先看 stage（completed / failed / cancelled 三个终态判得最准）；
  // stage 缺失时退回按 active —— active 为假即视为已结束。
  // 不能只看 active：它只在服务端自己会推的那四个 stage（produce/package/compose/
  // publishing）上为真，awaiting-publish（成片好了、等人点确认发布）它也是假的，
  // 而那段并没有结束。只看 active 会把一条正等用户操作的流水线直接标成已完成。
  function deriveWorkflowStatus(payload) {
    const p = payload || {};
    const stage = p.stage ? String(p.stage).trim().toLowerCase() : "";
    if (stage === "completed" || stage === "failed" || stage === "cancelled") return stage;
    if (stage) return null;
    if (p.active === false) return "completed";
    return null;
  }

  // batch：状态响应是 { batchId, kind, summary: {...}, items: [...] }，
  // 整批结局只能从 summary 数出来（js/skills/batch.js 的 isFinished 也是这么数的）。
  // 判定顺序即优先级：
  //   pending/running 还有 -> 还在跑
  //   failed    > 0 -> failed     确凿的失败，先说它
  //   cancelled > 0 -> canceled   用户主动取消，结局确定
  //   expired   > 0 -> interrupted 见下
  //   completed > 0 -> completed  正常收尾
  //   其余                  -> interrupted 一条都没成功，不能报成功
  // summary 里一个可判定的字段都没有时返回 null：宁可继续轮询，也不把「不知道」写成「已结束」。
  //
  // expired 这条是本文件最需要解释的判断：它是 BatchController 在成片 1 小时、
  // 批次 6 小时后清理条目记录后留下的状态，既不是成功也不是失败，而是
  // 「服务端已经不知道这条成片到底出没出来」，产物也一并取不回来。所以只要
  // 出现 expired，整批就不能标成成功 —— 宁可显示「已中断」让用户知道结局不明，
  // 也不能顶着一盏绿灯点进去发现什么都没有。它排在 failed/cancelled 之后，
  // 是因为那两种结局是确凿的已知信息，比「不可知」更该先告诉用户。
  function deriveBatchStatus(payload) {
    const s = payload && payload.summary;
    if (!s || typeof s !== "object") return null;
    const keys = ["pending", "running", "completed", "failed", "cancelled", "expired"];
    const has = (k) => Object.prototype.hasOwnProperty.call(s, k);
    if (!keys.some(has)) return null;
    const n = (k) => {
      const v = Number(s[k]);
      return isFinite(v) && v > 0 ? v : 0;
    };
    if (n("pending") + n("running") > 0) return null;   // 还在跑，交给下一次轮询
    if (n("failed") > 0) return "failed";
    if (n("cancelled") > 0) return "cancelled";
    if (n("expired") > 0) return "expired";
    return n("completed") > 0 ? "completed" : "expired";
  }

  // 返回服务端词表里的状态词；返回 null 表示这份载荷推不出结局，不该改 status。
  function deriveStatus(domain, payload) {
    if (domain === "workflow") return deriveWorkflowStatus(payload);
    if (domain === "batch") return deriveBatchStatus(payload);
    return null;
  }

  // 全局对象在**调用时**才解析，不在模块求值那一刻做快照。
  // 单例是在本模块求值完就建好的，而 window.HTWApi 要等 api.js 求值完才挂上：
  // 页面里的脚本顺序一旦变成先 tasks.js 后 api.js，快照下来的 subscribeTask 就是
  // undefined —— watch 会抛错、被 catch 吞掉、每条任务静默降级成轮询，
  // 界面上一点症状都看不出来，只有服务器连接数对得上才想得到。
  function defaultDeps() {
    const liveApi = () => ((typeof window !== "undefined" && window.HTWApi) || {});
    const liveHtw = () => ((typeof window !== "undefined" && window.htw) || {});
    return {
      api: {
        subscribeTask: function () { return liveApi().subscribeTask.apply(null, arguments); },
        unsubscribeTask: function () {
          const u = liveApi().unsubscribeTask;
          if (typeof u === "function") return u.apply(null, arguments);
        },
        call: function () { return liveApi().call.apply(null, arguments); },
        post: function () { return liveApi().post.apply(null, arguments); },
      },
      saveJson: function () { return liveHtw().saveJson.apply(null, arguments); },
      loadJson: function () { return liveHtw().loadJson.apply(null, arguments); },
      subscribe: function (cb) { return liveHtw().onStreamEvent(cb); },
      now: function () { return Date.now(); },
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimeout: function (id) { return clearTimeout(id); },
    };
  }

  function createStore(deps) {
    const d = deps || defaultDeps();
    let tasks = [];
    let saveTimer = null;
    // 取消订阅函数按**记录 id** 存，不是按 streamId：streamId 是 "域:任务标识"，
    // 同一个任务在进程里可能同时存在两条记录（比如用户点了两次提交），
    // 按 streamId 存的话第二条 watch 会把第一条的退订函数覆盖掉 ——
    // 第一条就此变成永远收不到事件的孤儿，而任意一条 stopWatch 又会拆掉另一条的回调。
    // streamId 只在退订时要发给主进程，单独记在 timers 里。
    const unsubs = {};        // task.id -> 取消订阅函数
    const timers = {};        // task.id -> {first, poll, reconnect, sid}
    const listeners = [];

    function emitChange() {
      for (let i = 0; i < listeners.length; i++) {
        try { listeners[i](); } catch (e) { /* 单个订阅者出错不能影响其他 */ }
      }
    }

    function writeNow() {
      // 写盘失败只吞掉：磁盘满不该让用户正在跑的任务崩掉。
      try {
        const r = d.saveJson("tasks", tasks);
        if (r && typeof r.catch === "function") r.catch(function () {});
      } catch (e) { /* ignore */ }
    }

    // 尾随节流：一串进度帧只落一次盘。
    // 首次登记（now）例外 —— 那是一次性事件，而且它是崩溃后唯一能恢复出来的线索，
    // 没有理由陪着节流一起押后。
    function persist(now) {
      if (now) {
        if (saveTimer != null) { try { d.clearTimeout(saveTimer); } catch (e) { /* ignore */ } saveTimer = null; }
        writeNow();
        return;
      }
      if (saveTimer) return;
      saveTimer = d.setTimeout(function () {
        saveTimer = null;
        writeNow();
      }, SAVE_DEBOUNCE_MS);
    }

    // 载荷落地：先按域折算出 status（没有的话），再走 applyPayload 的通用映射。
    function applyFor(task, payload) {
      if (!payload || typeof payload !== "object") return task;
      if (payload.status === null || payload.status === undefined) {
        const s = deriveStatus(task.domain, payload);
        if (s) return applyPayload(task, Object.assign({}, payload, { status: s }));
      }
      return applyPayload(task, payload);
    }

    function stopWatch(task) {
      const t = timers[task.id];
      const sid = (t && t.sid) || task.domain + ":" + task.taskId;
      if (unsubs[task.id]) { try { unsubs[task.id](); } catch (e) { /* ignore */ } delete unsubs[task.id]; }
      if (d.api && d.api.unsubscribeTask) { try { d.api.unsubscribeTask(sid); } catch (e) { /* ignore */ } }
      if (t) {
        [t.first, t.poll, t.reconnect].forEach(function (id) {
          if (id != null) { try { d.clearTimeout(id); } catch (e) { /* ignore */ } }
        });
        delete timers[task.id];
      }
    }

    function finish(task) {
      if (task.status === "running") return false;
      stopWatch(task);
      return true;
    }

    // 轮询定时器是「每个任务至多一个」。恢复流程会先查一轮、再调 watch，
    // 若 watch 不看这里再查一轮，两条链各自续命、每 tick 请求量翻倍且永不收敛。
    function clearPoll(task) {
      const t = timers[task.id];
      if (t && t.poll != null) { try { d.clearTimeout(t.poll); } catch (e) { /* ignore */ } t.poll = null; }
    }

    function hasPendingPoll(task) {
      const t = timers[task.id];
      return !!(t && t.poll != null);
    }

    function schedulePoll(task) {
      const t = timers[task.id] || (timers[task.id] = {});
      // 先销掉上一个再挂新的：句柄被覆盖的旧定时器没人能再取消，
      // 它照样会到点触发，于是凭空多出一条轮询链。
      clearPoll(task);
      t.poll = d.setTimeout(function () { pollOnce(task); }, POLL_MS);
    }

    async function pollOnce(task) {
      const cfg = DOMAINS[task.domain];
      if (!cfg || task.status !== "running") return;
      try {
        const r = await d.api.call("GET", cfg.status(task));
        if (task.status !== "running") return;
        if (r && r.ok) {
          task.unknown = false;
          applyFor(task, r.data || {});
        } else if (r && (r.code === 404 || r.status === 404)) {
          // 「服务端已经没有这条任务」和「这次没查着」必须分清：
          // 前者说明任务真的没了（服务端重启过 / 记录被清理），落成 interrupted；
          // 后者只是网络抖动或鉴权没过，判死就等于把一条还在跑的任务永远钉死在界面上，
          // 用户会白等，而服务端那边它其实好好地在跑。
          // 状态码要看 code 而不是 status：api.js 的 normalize() 返回 {ok, code, message, raw}，
          // HTTP 状态落在 code 上（WorkflowController 的 FailApi(404, ..., 404) 会同时给出
          // HTTP 404 与 ErrCode=404，两条路都覆盖到），status 只有直接调用的调用方才会有。
          task.status = "interrupted";
          task.error = "服务端已无此任务（Web 服务可能已重启）";
          task.endedAt = d.now();
        } else {
          // 其它失败（网络抖动 / 401）**不判死**：只是这次没查到。
          task.unknown = true;
        }
      } catch (e) {
        task.unknown = true;
      }
      task.updatedAt = d.now();
      finish(task);
      emitChange();
      persist();
      if (task.status === "running") schedulePoll(task);
    }

    function onStream(task, msg) {
      if (!msg || msg.streamId !== task.domain + ":" + task.taskId) return;
      const t = timers[task.id] || (timers[task.id] = {});
      // 收到第一个事件就说明连接活着，清掉首事件超时。
      if (t.first) { try { d.clearTimeout(t.first); } catch (e) { /* ignore */ } t.first = null; }
      if (msg.type === "error") { degrade(task); return; }
      // 服务端发 end 但载荷始终没进终态（代理截断、终态事件丢失）：不能就此收工，
      // 否则记录会永远停在"进行中"。降级到轮询，让它有机会自己收敛。
      if (msg.type === "end") { if (!finish(task)) degrade(task); emitChange(); persist(); return; }
      let payload = msg.payload;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (e) { return; } }
      applyFor(task, payload || {});
      finish(task);
      emitChange();
      persist();
    }

    // 降级是静默的：面板本来就在用自己的轮询，容器降级只是它自己从推送切回轮询。
    function degrade(task) {
      if (task.degraded) return;
      task.degraded = true;
      stopWatch(task);
      task.transport = "poll";
      task.updatedAt = d.now();
      emitChange();
      persist();
      if (task.status === "running") schedulePoll(task);
    }

    function watch(task) {
      const cfg = DOMAINS[task.domain];
      if (!cfg) return;
      if (!cfg.sse) {
        task.transport = "poll";
        // 恢复流程刚查过一轮并且已经排好了下一次，watch 不必再立刻查一遍 ——
        // 立刻查就是第二条轮询链的起点，之后每 tick 的请求量会一直翻倍。
        if (hasPendingPoll(task)) return;
        pollOnce(task);
        return;
      }
      // 推送域由推送驱动，不该同时挂着一个轮询定时器：恢复时的确认查询已经查完了，
      // 剩下的交给 SSE，让它降级（订阅失败 / 超时 / end）时再自己切回轮询。
      clearPoll(task);
      task.transport = "sse";
      const sid = task.domain + ":" + task.taskId;
      if (d.subscribe) {
        try { unsubs[task.id] = d.subscribe(function (msg) { onStream(task, msg); }) || null; } catch (e) { /* ignore */ }
      }
      try {
        d.api.subscribeTask(task.domain, task.taskId);
      } catch (e) { degrade(task); return; }
      const t = timers[task.id] || (timers[task.id] = {});
      t.sid = sid;
      // 8 秒还没收到任何事件，就当这条路不通，静默切轮询。
      t.first = d.setTimeout(function () {
        const tt = timers[task.id];
        if (tt) tt.first = null;
        if (task.transport === "sse" && task.status === "running") degrade(task);
      }, FIRST_EVENT_TIMEOUT_MS);
    }

    const store = {
      register: function (opts) {
        const task = newTask(opts);
        tasks = evict(tasks.concat([task]), MAX_RECORDS);
        emitChange();
        persist(true);
        watch(task);
        return task;
      },
      list: function () { return tasks.slice(); },
      get: function (id) { return tasks.filter((t) => t.id === id)[0] || null; },
      onChange: function (fn) {
        listeners.push(fn);
        return function () { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
      },
      clearFinished: function () {
        tasks = tasks.filter((t) => t.status === "running");
        emitChange();
        persist(true);
      },
      cancel: function (id) {
        // 整个流程裹进 Promise 里：d.api.post 缺失（HTWApi 还没挂上）时它会同步抛，
        // 而调用方一律按「返回 Promise」处理，同步抛就变成了未捕获异常。
        return Promise.resolve().then(function () {
          const task = store.get(id);
          if (!task) throw new Error("任务不存在");
          // 已经出结果的任务不许再被取消：重复点击 / 迟到的取消会把一条真实的
          // done 或 failed 改写成 canceled，用户白跑的那一趟就此从记录里消失了。
          if (isTerminalState(task.status)) throw new Error("任务已结束，无需取消");
          if (!canCancel(task.domain)) throw new Error("该任务不支持中途取消");
          const cfg = DOMAINS[task.domain];
          return Promise.resolve(d.api.post(cfg.cancelPath, cancelBody(task.domain, task.taskId)))
            .then(function (r) {
              if (r && r.ok === false) throw new Error(r.message || "取消失败");
              task.status = "canceled";
              task.endedAt = d.now();
              stopWatch(task);
              emitChange();
              persist(true);
              return true;
            });
        });
      },
      restore: function () {
        return Promise.resolve(d.loadJson("tasks"))
          .then(function (saved) {
            // 落盘文件同样要过上限：文件被手改过、或上一版写坏过，就可能比
            // register 的预算大得多。只在 register 上设上限的话，恢复是绕过它的口子。
            tasks = evict(Array.isArray(saved) ? saved.filter((t) => t && t.id) : [], MAX_RECORDS);
            const pending = tasks.filter((t) => t.status === "running");
            // 逐个各查一次，不并发、不轮询：启动时服务端可能还没就绪。
            return pending.reduce(function (chain, task) {
              return chain.then(function () {
                return pollOnce(task).then(function () {
                  // 查完可能已经是终态了（notfound / 失败），这时再 watch 会白订阅一条流。
                  if (task.status === "running") watch(task);
                });
              });
            }, Promise.resolve());
          })
          .then(function () { emitChange(); persist(true); })
          .catch(function () { emitChange(); });
      },
    };
    return store;
  }

  const _singleton = createStore(null);

  return {
    register: (o) => _singleton.register(o),
    list: () => _singleton.list(),
    get: (id) => _singleton.get(id),
    onChange: (fn) => _singleton.onChange(fn),
    clearFinished: () => _singleton.clearFinished(),
    cancel: (id) => _singleton.cancel(id),
    restore: () => _singleton.restore(),
    _internal: {
      MAX_RECORDS, POLL_MS, FIRST_EVENT_TIMEOUT_MS, RECONNECT_MS, SAVE_DEBOUNCE_MS,
      TERMINAL_STATUSES, DOMAINS,
      isTerminal, normalizeStatus, applyPayload, evict, canCancel, cancelBody, newTask, createStore,
      deriveStatus, deriveWorkflowStatus, deriveBatchStatus,
    },
  };
});
