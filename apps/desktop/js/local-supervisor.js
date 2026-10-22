/*
 * 本地实例监督器：只管"进程与地址"（拉起 / 发现地址 / 存活 / 重启 / 停止）。
 *
 * 为什么单独成文件：main.js 依赖 electron，node --test 里 require 不了；
 * 而"崩溃退避重启""地址只认 stdout 那一行"恰恰是最容易写错的地方，
 * 必须能脱离 Electron 直接单测。本模块**不 require electron**，
 * 只用 node 内置的 child_process。
 *
 * 职责边界：健康三态与配对**不在这里**（归渲染层既有的 probeHealth / pairFlow），
 * 这里只回答两个问题：**进程活着吗**、**它报的地址是哪个**。
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HTWLocalSupervisor = api;
})(typeof self !== "undefined" ? self : this, function () {
  const childProcess = require("child_process");

  // 状态机取值是机器契约（主进程 → IPC → 渲染层按字面量取用），不要改写。
  const STATE = Object.freeze({
    idle: "idle",         // 未配置可执行文件路径
    stopped: "stopped",   // 已配置但当前没跑（含崩溃退避等待期：attempt>0 且 pid===null）
    starting: "starting", // 已 spawn，尚未发现地址
    running: "running",   // 已发现地址且进程活着
    failed: "failed",     // 起不来 / 没找到地址 / 崩溃超限
    stopping: "stopping", // 正在停止
  });

  // 失败原因取值。其它场景（正常启动、停止）reason 留空。
  const REASON = Object.freeze({
    noBinary: "noBinary",   // 没给可执行文件路径
    noAddress: "noAddress", // 超时也没从 stdout 里读到地址
    crashed: "crashed",     // 崩溃且自动重启次数已用尽
  });

  // 地址只认 stdout 里这一行（行首标记 + 真实基地址）。
  // 为什么只认这一行：真实端口由系统分配（子进程自己绑回环、端口 0），
  // 桌面端**不知道也不该猜**端口；猜端口/扫端口会把请求打到别人的服务上，
  // 也会把配对材料寄到非本机进程。所以只解析这一行，解析不到就判失败。
  const LISTENING_RE = /^\[local-instance\] listening (.+)$/;

  const DEFAULT_ADDRESS_TIMEOUT_MS = 15000;
  const RESTART_BACKOFF_MS = Object.freeze([1000, 2000, 4000]);
  const MAX_RESTARTS = 3;

  // 应用退出时"先礼后兵"：kill 之后给这么长的时间自己退出，超时再强杀。
  // 为什么要有强杀：子进程可能卡死 / 不响应终止信号，应用退出后它还占着端口，
  // 下次启动就会撞端口（spec §3.4「应用退出」要求不留孤儿进程占端口）。
  const DEFAULT_KILL_GRACE_MS = 2000;

  // 子进程必须带的环境变量：角色由它决定。
  // 为什么必须带 HTW_LOCAL=1：子进程若缺这个变量，会以**服务器角色**启动
  // （连数据库、绑非回环端口），那就不是本地实例了。所以这里硬写，
  // 不接受调用方把它去掉。
  const LOCAL_ENV_FLAG = "HTW_LOCAL";

  function createSupervisor(opts) {
    const o = opts || {};
    const spawnFn = typeof o.spawnFn === "function" ? o.spawnFn : childProcess.spawn;
    // delayFn 的调用约定与 setTimeout 一致：(回调, 毫秒, 用途标记)，
    // 这样"默认就是 setTimeout"、直接注入原生 setTimeout 也能用。
    // 第三个参数是用途标记（addressTimeout / backoff / killEscalation），
    // setTimeout 会把它透传给回调，回调不接参数，无副作用。
    const delayFn = typeof o.delayFn === "function" ? o.delayFn : setTimeout;
    const now = typeof o.now === "function" ? o.now : Date.now;
    const env = o.env || process.env;
    const addressTimeoutMs = typeof o.addressTimeoutMs === "number" ? o.addressTimeoutMs : DEFAULT_ADDRESS_TIMEOUT_MS;
    const backoffMs = Array.isArray(o.backoffMs) && o.backoffMs.length ? o.backoffMs : RESTART_BACKOFF_MS;
    const maxRestarts = typeof o.maxRestarts === "number" ? o.maxRestarts : MAX_RESTARTS;
    const onState = typeof o.onState === "function" ? o.onState : null;
    const killGraceMs = typeof o.killGraceMs === "number" ? o.killGraceMs : DEFAULT_KILL_GRACE_MS;
    // 错误出口：onState 之类的界面回调抛错**不该**把监督器带崩，
    // 但也不该完全静默（静默吞掉会让人查不到问题）。
    // 默认行为是吞掉（没有注入 onError 时什么都不做），主进程可以注入 onError
    // 把这些异常记进日志 —— 这是"可注入的错误出口"，不是"忽略错误"。
    const onError = typeof o.onError === "function" ? o.onError : null;

    let current = { state: STATE.idle, base: "", reason: "", attempt: 0, pid: null };
    let binaryPath = "";
    let child = null;
    let lineBuffer = "";
    let attempt = 0;            // 已发起的崩溃自动重启次数
    let intentionalStop = false; // 用户主动停止 / 已释放 → 不再自动重启
    let disposed = false;
    let addressTimer = null;
    let backoffTimer = null;
    let killTimer = null;
    // 计时器"世代"：作废某个计时器时把世代号 +1，
    // 回调里比对世代号即可知道这个计时器已被作废
    // （这样不依赖注入的 delayFn 返回值能否被全局 clearTimeout 收拾）。
    let addressEpoch = 0;
    let backoffEpoch = 0;
    let killEpoch = 0;
    // 已经退出的子进程集合（弱引用）：用来判断"要不要再强杀一次"。
    const exitedProcs = new WeakSet();

    function snapshot() {
      return {
        state: current.state,
        base: current.base,
        reason: current.reason,
        attempt: current.attempt,
        pid: current.pid,
      };
    }

    function reportError(err, where) {
      if (!onError) return;
      try {
        onError(err, { where: where });
      } catch (ignore) {
        // 错误出口自己抛错也不能影响监督器（否则会变成"报错把监督器带崩"）。
      }
    }

    function setState(state, extra) {
      const e = extra || {};
      current = {
        state: state,
        base: e.base || "",
        reason: e.reason || "",
        attempt: typeof e.attempt === "number" ? e.attempt : attempt,
        pid: e.pid == null ? null : e.pid,
      };
      if (onState) {
        try {
          // 第二个参数是这次状态变更的时刻（可注入时钟），
          // 第一个参数是状态载荷本身 —— 载荷形状是契约，不带时间戳。
          onState(snapshot(), { at: now() });
        } catch (err) {
          // 回调是界面侧的事，抛错不许把监督器带崩；
          // 但要走错误出口（默认吞掉，注入了 onError 就记下来），别无声无息。
          reportError(err, "onState");
        }
      }
      return snapshot();
    }

    function clearAddressTimer() {
      addressEpoch += 1;
      if (addressTimer !== null) {
        try {
          clearTimeout(addressTimer);
        } catch (err) {
          // 注入的 delayFn 返回值未必是真实计时器，忽略即可（世代号已经作废它）。
        }
        addressTimer = null;
      }
    }

    function clearBackoffTimer() {
      backoffEpoch += 1;
      if (backoffTimer !== null) {
        try {
          clearTimeout(backoffTimer);
        } catch (err) {
          // 同上。
        }
        backoffTimer = null;
      }
    }

    function clearKillTimer() {
      killEpoch += 1;
      if (killTimer !== null) {
        try {
          clearTimeout(killTimer);
        } catch (err) {
          // 同上。
        }
        killTimer = null;
      }
    }

    function killChild(proc, signal) {
      try {
        if (proc && typeof proc.kill === "function") proc.kill(signal);
      } catch (err) {
        // 进程可能已经自己没了 —— 杀不掉不影响状态推进。
        reportError(err, "kill");
      }
    }

    // "先礼后兵"的强杀升级（spec §3.4 应用退出：kill + 超时强杀）。
    // 为什么强杀用 child.kill("SIGKILL") 而不是 taskkill /F /T：
    //   1) taskkill 只在 Windows 上有，这个模块是跨平台的；
    //   2) taskkill 要另起一个进程（应用正在退出，多一个进程反而添乱）；
    //   3) Node 的 kill("SIGKILL") 在所有平台都可用，在 Windows 上等价于
    //      TerminateProcess（无条件结束、不给清理机会）—— 正是"强杀"想要的语义。
    function killWithEscalation(proc) {
      if (!proc) return;
      clearKillTimer(); // 别让上一轮的强杀计时器还挂着
      killChild(proc);
      if (killGraceMs < 0) return;
      const epoch = ++killEpoch;
      killTimer = delayFn(function () {
        if (epoch !== killEpoch) return; // 已被作废
        killTimer = null;
        if (exitedProcs.has(proc)) return; // 已经自己退了，不用强杀
        killChild(proc, "SIGKILL");
      }, killGraceMs, "killEscalation");
      // 这个计时器不该吊住进程退出（应用退出时事件循环要能自然结束）。
      if (killTimer && typeof killTimer.unref === "function") {
        try {
          killTimer.unref();
        } catch (err) {
          // 假计时器没有 unref 也无所谓。
        }
      }
    }

    // ---- 地址解析 ----

    function handleListeningLine(proc, line) {
      const m = LISTENING_RE.exec(line);
      if (!m) return false;
      const base = String(m[1] || "").trim();
      if (!base) return false;
      clearAddressTimer();
      lineBuffer = "";
      setState(STATE.running, { base: base, attempt: attempt, pid: proc.pid });
      return true;
    }

    function onStdout(proc, chunk) {
      if (child !== proc) return;                 // 旧进程的迟到输出
      if (current.state !== STATE.starting) return; // 已经有地址了，不再解析
      lineBuffer += String(chunk);
      let idx = lineBuffer.indexOf("\n");
      while (idx >= 0) {
        const line = lineBuffer.slice(0, idx).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(idx + 1);
        if (handleListeningLine(proc, line)) return;
        idx = lineBuffer.indexOf("\n");
      }
    }

    // ---- 拉起 ----

    function scheduleAddressTimeout(proc) {
      const epoch = ++addressEpoch;
      addressTimer = delayFn(function () {
        if (epoch !== addressEpoch) return; // 已被作废
        addressTimer = null;
        handleAddressTimeout(proc);
      }, addressTimeoutMs, "addressTimeout");
    }

    function handleAddressTimeout(proc) {
      // 拿不到地址 = 这个进程没按约定起来（可执行文件不对、不是本地实例、卡住了）。
      // 杀掉它，并且**不要**当成崩溃去重启（那只会反复拉起一个坏进程）。
      intentionalStop = true;
      killChild(proc);
      setState(STATE.failed, { reason: REASON.noAddress, attempt: attempt, pid: proc.pid });
    }

    function launch() {
      clearAddressTimer();
      clearBackoffTimer();
      lineBuffer = "";

      if (!binaryPath) {
        // 兜底：没有可执行文件路径就不 spawn（绝不用空路径拉起一个啥也干不了的进程）。
        setState(STATE.failed, { reason: REASON.noBinary, attempt: 0 });
        return null;
      }

      const childEnv = Object.assign({}, env);
      childEnv[LOCAL_ENV_FLAG] = "1";
      const options = {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      };

      let proc;
      try {
        proc = spawnFn(binaryPath, [], options);
      } catch (err) {
        // spawn 自己抛错（可执行文件不存在等）= 这次拉起没成功，当成"进程没了"处理，
        // 让它走退避/失败路径；同时确保没有活着的子进程。
        child = null;
        reportError(err, "spawn");
        handleChildGone(null);
        return null;
      }

      child = proc;
      let settled = false;
      const onGone = function () {
        if (settled) return;
        settled = true;
        // 无论是不是当前 child，都要记进"已退出"集合：
        // 强杀升级要靠它判断"这个进程是不是已经自己退了"。
        exitedProcs.add(proc);
        handleChildGone(proc);
      };

      if (proc.stdout && typeof proc.stdout.on === "function") {
        proc.stdout.on("data", function (chunk) {
          onStdout(proc, chunk);
        });
        // 末行没有换行符时，stdout 流结束这一刻那一行才算完整。
        proc.stdout.on("end", function () {
          if (child !== proc) return;
          if (current.state !== STATE.starting) return;
          const rest = lineBuffer.replace(/\r$/, "");
          lineBuffer = "";
          handleListeningLine(proc, rest);
        });
        if (typeof proc.stdout.on === "function") {
          proc.stdout.on("error", function () { /* 子进程的输出流报错不影响监督器 */ });
        }
      }
      if (proc.stderr && typeof proc.stderr.on === "function") {
        proc.stderr.on("error", function () { /* 同上 */ });
      }
      if (typeof proc.on === "function") {
        proc.on("exit", onGone);
        proc.on("error", onGone);
      }

      setState(STATE.starting, { attempt: attempt, pid: proc.pid });
      scheduleAddressTimeout(proc);
      return proc;
    }

    // ---- 崩溃与重启 ----

    // 陈旧子进程守卫：只有"当前 child"的事件才算数。
    // 为什么必须防陈旧：stop() → start() 之后，**旧**子进程的 exit 可能迟到。
    // 若不防它，它会：
    //   1) 作废**新**子进程的地址超时计时器 → 新实例不吐地址就永远卡在 starting，
    //      永远等不到 failed(noAddress)（界面看着像"一直在启动"）；
    //   2) 排一次退避 → 退避到点**再 spawn 一个进程** → 双实例，
    //      而旧那个已经没人监管了（孤儿进程，还占着端口）。
    // 所以：proc 不是当前 child → 整个事件忽略，连计时器都不许碰。
    function isCurrentProc(proc) {
      if (proc === null || proc === undefined) return child === null;
      return child === proc;
    }

    function handleChildGone(proc) {
      if (!isCurrentProc(proc)) return; // 陈旧子进程：直接忽略
      const wasCurrent = proc === child;
      if (proc && child === proc) child = null;
      // 只有"当前 child 没了"才清它的计时器（新实例的计时器不能被旧实例的事件作废）。
      if (wasCurrent) {
        clearAddressTimer();
        clearBackoffTimer();
      }

      // 为什么用户主动停止后不重启：用户点"停止"的语义是"**别再拉起它了**"。
      // 如果这里还按崩溃处理，就会出现"我明明点了停止，它又自己跑起来了"。
      // 所以用户主动停止（以及应用退出）一律不重启，必须用户自己再点启动。
      if (disposed || intentionalStop) {
        // 注意：地址超时那类"失败"状态不要在这里被覆盖成 stopped
        //（失败原因必须留住），只有本来在跑/在起的才收成 stopped。
        if (proc && (current.state === STATE.running || current.state === STATE.starting)) {
          setState(STATE.stopped, { attempt: 0 });
        }
        return;
      }

      if (!binaryPath) {
        // 没有可执行文件路径就没法自动重启（也不该拿空路径去 spawn）。
        setState(STATE.failed, { reason: REASON.noBinary, attempt: 0 });
        return;
      }

      if (attempt >= maxRestarts) {
        // 崩溃自动重启最多 maxRestarts 次；用尽后停在 failed，等用户手动再启。
        setState(STATE.failed, { reason: REASON.crashed, attempt: attempt });
        return;
      }

      const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
      attempt += 1;
      // 退避等待期**根本没有进程**，所以状态是 stopped 而不是 starting：
      // spec §3.2 里 starting 的定义是"已 spawn，尚未发现地址"。
      // "正在崩溃退避"这个信息由 attempt>0 + pid===null 表达，渲染层据此显示。
      // 顺带好处：退避期内用户点"启动"不会被 starting 的早退分支静默吞掉。
      setState(STATE.stopped, { attempt: attempt });
      const epoch = ++backoffEpoch;
      backoffTimer = delayFn(function () {
        if (epoch !== backoffEpoch) return; // 已被作废（用户已停止/已手动启动）
        backoffTimer = null;
        launch();
      }, delay, "backoff");
    }

    // ---- 对外接口 ----

    function start(pathArg) {
      if (disposed) return snapshot();
      const raw = typeof pathArg === "string" ? pathArg.trim() : "";
      if (raw === "") {
        // 空路径 = 本次没有可执行文件 → failed(noBinary) 且**绝不 spawn**。
        // 也不能沿用上次配置过的路径：否则"清空路径再点启动"会把老进程偷偷再拉一个。
        binaryPath = "";
        clearBackoffTimer();
        setState(STATE.failed, { reason: REASON.noBinary, attempt: 0 });
        return snapshot();
      }
      binaryPath = raw;
      if (
        current.state === STATE.running ||
        current.state === STATE.starting ||
        current.state === STATE.stopping
      ) {
        // 已经在跑（或正在起、或正在停）：直接返回当前状态，不重复拉起。
        // 注意：崩溃退避期是 stopped（不是 starting），所以这里不会拦住它 ——
        // 退避期内用户手动启动是要**真的**重新拉起的（attempt 归零、退避计时器取消）。
        return snapshot();
      }
      intentionalStop = false;
      attempt = 0; // 用户主动启动 → 重启计数归零
      launch();
      return snapshot();
    }

    function stop() {
      if (disposed) return snapshot();
      const proc = child;
      if (!proc && current.state === STATE.idle) return snapshot();
      intentionalStop = true;
      attempt = 0;
      clearAddressTimer();
      clearBackoffTimer();
      if (proc) {
        setState(STATE.stopping, { attempt: attempt, pid: proc.pid });
        killChild(proc);
      }
      child = null;
      setState(STATE.stopped, { attempt: 0 });
      return snapshot();
    }

    function dispose() {
      disposed = true;
      intentionalStop = true;
      clearAddressTimer();
      clearBackoffTimer();
      const proc = child;
      if (proc) {
        setState(STATE.stopping, { attempt: attempt, pid: proc.pid });
        // 先 kill，超时还没退就强杀（不留孤儿进程占端口）。
        killWithEscalation(proc);
        child = null;
        setState(STATE.stopped, { attempt: 0 });
      } else if (current.state === STATE.stopped) {
        // 没有活着的子进程（例如正处在崩溃退避期）→ 归一成"停干净了"，
        // 但**不要**动 failed 的状态（失败原因必须留住）。
        setState(STATE.stopped, { attempt: 0 });
      }
      return snapshot();
    }

    function status() {
      return snapshot();
    }

    function isRunning() {
      return current.state === STATE.running;
    }

    return {
      start: start,
      stop: stop,
      dispose: dispose,
      status: status,
      isRunning: isRunning,
    };
  }

  return {
    createSupervisor: createSupervisor,
    STATE: STATE,
    LISTENING_RE: LISTENING_RE,
    DEFAULT_ADDRESS_TIMEOUT_MS: DEFAULT_ADDRESS_TIMEOUT_MS,
    RESTART_BACKOFF_MS: RESTART_BACKOFF_MS,
    MAX_RESTARTS: MAX_RESTARTS,
  };
});
