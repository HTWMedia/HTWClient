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
    stopped: "stopped",   // 已配置但当前没跑
    starting: "starting", // 已拉起（或是退避等待中），尚未发现地址
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
    // 第三个参数是用途标记（addressTimeout / backoff），setTimeout 会把它透传给回调，
    // 回调不接参数，无副作用。
    const delayFn = typeof o.delayFn === "function" ? o.delayFn : setTimeout;
    const now = typeof o.now === "function" ? o.now : Date.now;
    const env = o.env || process.env;
    const addressTimeoutMs = typeof o.addressTimeoutMs === "number" ? o.addressTimeoutMs : DEFAULT_ADDRESS_TIMEOUT_MS;
    const backoffMs = Array.isArray(o.backoffMs) && o.backoffMs.length ? o.backoffMs : RESTART_BACKOFF_MS;
    const maxRestarts = typeof o.maxRestarts === "number" ? o.maxRestarts : MAX_RESTARTS;
    const onState = typeof o.onState === "function" ? o.onState : null;

    let current = { state: STATE.idle, base: "", reason: "", attempt: 0, pid: null };
    let binaryPath = "";
    let child = null;
    let lineBuffer = "";
    let attempt = 0;            // 已发起的崩溃自动重启次数
    let intentionalStop = false; // 用户主动停止 / 已释放 → 不再自动重启
    let disposed = false;
    let addressTimer = null;
    let backoffTimer = null;
    // 计时器"世代"：作废某个计时器时把世代号 +1，
    // 回调里比对世代号即可知道这个计时器已被作废
    // （这样不依赖注入的 delayFn 返回值能否被全局 clearTimeout 收拾）。
    let addressEpoch = 0;
    let backoffEpoch = 0;

    function snapshot() {
      return {
        state: current.state,
        base: current.base,
        reason: current.reason,
        attempt: current.attempt,
        pid: current.pid,
      };
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
          // 回调是界面侧的事，抛错不许把监督器带崩。
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

    function killChild(proc) {
      try {
        if (proc && typeof proc.kill === "function") proc.kill();
      } catch (err) {
        // 进程可能已经自己没了 —— 杀不掉不影响状态推进。
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
        handleChildGone(null);
        return null;
      }

      child = proc;
      let settled = false;
      const onGone = function () {
        if (settled) return;
        settled = true;
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

    function handleChildGone(proc) {
      if (proc && child === proc) child = null;
      clearAddressTimer();
      clearBackoffTimer();

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

      if (attempt >= maxRestarts) {
        // 崩溃自动重启最多 maxRestarts 次；用尽后停在 failed，等用户手动再启。
        setState(STATE.failed, { reason: REASON.crashed, attempt: attempt });
        return;
      }

      const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
      attempt += 1;
      // 退避等待期间仍算"正在拉起"（starting），避免界面误判成"已停止"。
      setState(STATE.starting, { attempt: attempt });
      const epoch = ++backoffEpoch;
      backoffTimer = delayFn(function () {
        if (epoch !== backoffEpoch) return; // 已被作废（用户已停止）
        backoffTimer = null;
        launch();
      }, delay, "backoff");
    }

    // ---- 对外接口 ----

    function start(pathArg) {
      if (disposed) return snapshot();
      if (typeof pathArg === "string" && pathArg.trim() !== "") binaryPath = pathArg;
      if (!binaryPath) {
        // 没有可执行文件路径：起不了，也不该起。
        setState(STATE.failed, { reason: REASON.noBinary, attempt: 0 });
        return snapshot();
      }
      if (
        current.state === STATE.running ||
        current.state === STATE.starting ||
        current.state === STATE.stopping
      ) {
        // 已经在跑（或正在起、或正在停）：直接返回当前状态，不重复拉起。
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
        killChild(proc);
        child = null;
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
