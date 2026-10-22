(function () {
  // 面板白名单：showPanel 只给名单里的面板切active。
  // 🔴 新增面板**必须**同时改这里——只加 index.html 的 section 与 nav 按钮的话，
  //    点导航会"点了没反应"（面板永远不激活），而且不报任何错。
  const SKILLS = ["insight", "topics", "edit", "tools", "publish", "assistant", "create", "marketing", "batch", "shortdrama", "workflow", "tasks"];

  function getBaseInput() { return document.getElementById("api-base"); }
  function getKeyInput() { return document.getElementById("api-key"); }
  function getLocalBaseInput() { return document.getElementById("local-base"); }
  function getLocalStatusEl() { return document.getElementById("local-status"); }
  function getLocalPairBtn() { return document.getElementById("local-pair"); }
  function getLocalPairResultEl() { return document.getElementById("local-pair-result"); }
  function getLocalBinaryInput() { return document.getElementById("local-binary"); }
  function getLocalToggleBtn() { return document.getElementById("local-toggle"); }
  function getLocalStateEl() { return document.getElementById("local-state"); }
  function getLocalEnabledInput() { return document.getElementById("local-enabled"); }

  // 本地模式未配置（输入框为空）时的状态文案。
  const LOCAL_NOT_CONFIGURED = "本地模式未配置";
  // 本地实例尚未就绪（没探活过 / 探活失败）时的提示。
  const LOCAL_NOT_READY_TEXT = "本地实例尚未就绪，请先保存并探活。";
  // AuthKey 没填时的提示：直接失败，不发请求。
  const LOCAL_KEY_REQUIRED_TEXT = "请先填写 AuthKey";
  // 本地实例已经就绪时的提示：就绪了就不需要再配对。
  const LOCAL_ALREADY_READY_TEXT = "本地实例已就绪，无需配对。";
  // 地址被改动（还没保存、还没探活）时的提示：之前那次探活的结果不再作数。
  const LOCAL_BASE_CHANGED_TEXT = "地址已修改，请重新探活";
  // 本地模式模块没就绪时的统一提示（闸门、状态行、探活、配对共用同一句）。
  const LOCAL_MODULE_MISSING_TEXT = "本地模式组件未就绪，请重启应用后再试。";
  // 协议版本对不上时的提示（客户端与实例之间没有公共版本刻度，只能让用户更新其中一边）。
  const LOCAL_PROTOCOL_MISMATCH_TEXT = "本地实例与客户端不兼容，请更新客户端或本地实例";

  // ---- 本地实例（用户自备可执行文件）的状态文案 ----
  //
  // 🔴 口径来自监督器契约（要改就改契约那边，别在渲染层另造一套）：
  //  - 失败载荷是 { ok:false, errMsg }，**不含** state/base/pid/reason。
  //    必须先判出来按「操作失败」处理 —— 当状态读会显示成"未启动"这类假状态，
  //    把主进程故障说成用户的配置问题。
  //  - 状态载荷是 { state, base, reason, attempt, pid }。
  //  - 崩溃退避期**没有单独的状态**：stopped + attempt>0 + pid===null（那时根本没有进程）。
  //  - failed ≠ 实例已停（进程正跑时收到 start("") 也会翻成 failed）：
  //    所以失败文案只说"启动失败"，不说"已停止"。
  //
  // ⚠️ 本轮**不切业务流量**：状态行必须显式区分「实例在跑」与「业务走本地」。
  // 运行中的文案写明"业务请求仍走云端"，免得用户以为业务已经切到本机。
  const LOCAL_INSTANCE_TEXTS = {
    idle: "本地实例：请先填写可执行文件路径。",
    starting: "本地实例：正在启动…",
    stopping: "本地实例：正在停止…",
    stopped: "本地实例：已停止。",
    running: "本地实例运行中（地址 {base}）。业务请求仍走云端。",
    backoff: "本地实例崩溃退避中，稍后会自动重试。",
  };
  // 失败原因 → 中文（键是监督器的机器契约取值）。
  const LOCAL_INSTANCE_REASON_TEXTS = {
    noBinary: "未填写可执行文件路径",
    noAddress: "未发现它的地址",
    crashed: "连续启动后仍异常退出",
  };
  // 操作失败（IPC 失败载荷）的前缀。失败**不是**状态，别混进上面的状态文案里。
  const LOCAL_INSTANCE_OP_FAILED_PREFIX = "本地实例操作失败：";

  // 用户保存过的本地地址（点过「保存并探活」就落盘，探活失败也不清空 ——
  // 地址本身是用户填的，探活失败只是实例没起来，不该把地址从配置里抹掉）。
  // 只有「保存并探活」按钮能改它 —— 输入框里还没保存过的值不算数，
  // 否则每敲一个 AuthKey 字符都会把半截地址写进配置。
  let userLocalBase = "";
  // 用户保存过的本地实例可执行文件路径（点过「保存并探活」或「启动本地实例」就落盘）。
  // 路径不是秘密（只是本机上的一个文件路径），但每次启动重输一遍不可接受 —— 所以要落盘。
  // 🔴 只认**用户显式输入**的路径（输入框里的值）：不接受任何远端下发的路径。
  let userLocalBinary = "";
  // 最近一次探活得到的三态（未探活 / 探活失败时为 null）。
  let confirmedLocalState = null;
  // 最近一次探活是不是撞上了协议版本不匹配（是的话，配对一律被拒）。
  let localProtocolMismatch = false;
  // 监督器（主进程）最近一次上报的状态，以及它**发现**的地址。
  // supervisorBase 是实例真正的地址（端口由系统分配，桌面端只能从子进程上报里拿），
  // 所以探活与配对都优先用它；没有它时才用用户保存过的地址。
  let supervisorSnapshot = null;
  let supervisorBase = "";

  function localBaseValue() {
    const input = getLocalBaseInput();
    return input ? String(input.value || "").trim() : "";
  }
  // 本地地址的归一化与准入：口径只有一份，在 js/local.js 的 normalizeLocalBase
  // （去尾斜杠 + 拒绝带路径 + 强制回环）。这里只做接线，不重复实现那三条规则。
  //
  // 🔴 模块（window.HTWLocal）没就位时**拒绝**，不做「仅去尾斜杠」的兜底：
  // 兜底会跳过「必须是本机回环」「必须是根地址」这两条准入，于是非回环地址会被
  // 登记进 preload 白名单并落盘 —— 而配对请求会把 **AuthKey + 账号级材料**发往那个地址。
  // 这是防账号级材料外寄的闸门，所以必须 fail-closed：缺模块时宁可不配置，也不放行。
  // （空地址是「关闭本地模式」，不放行任何地址 —— 它不是闸门放行，所以照常通过。）
  function normalizeLocalBase(v) {
    const Local = window.HTWLocal;
    if (Local && typeof Local.normalizeLocalBase === "function") return Local.normalizeLocalBase(v);
    const raw = String(v == null ? "" : v).trim();
    if (!raw) return { ok: true, base: "", empty: true };
    return { ok: false, reason: "format", message: LOCAL_MODULE_MISSING_TEXT };
  }
  // 拒绝原因 → 文案。文案只有一份定义（js/local.js 的 LOCAL_BASE_TEXTS）。
  function localBaseText(reason) {
    const Local = window.HTWLocal;
    const t = (Local && Local.LOCAL_BASE_TEXTS) || null;
    if (!t) return LOCAL_MODULE_MISSING_TEXT;
    return t[reason] || t.format;
  }
  function setLocalStatus(text) { const el = getLocalStatusEl(); if (el) el.textContent = text; }
  function setLocalPairResult(text) { const el = getLocalPairResultEl(); if (el) el.textContent = text; }
  function setLocalPairEnabled(on) { const b = getLocalPairBtn(); if (b) b.disabled = !on; }

  // 配置的五个键必须一起写：主进程的 saveConfig 只认
  // apiBase/apiKey/localBase/localBinary/localEnabled，少写一个键等于把另一个键清空
  // （例如保存 AuthKey 时把本地地址抹掉）。
  // localBinary 走缓存（userLocalBinary），不直接读输入框：
  // 输入框里还没确认过的值不该跟着每次按键落盘。
  // localEnabled 走总开关状态（localModeEnabled），不直接读勾选框 ——
  // 勾选框是**显示**，状态才是事实（启动时要先读配置再回填勾选框）。
  function saveConfigAll(localBase) {
    if (!window.htw || !window.htw.saveConfig) return;
    const base = getBaseInput() ? getBaseInput().value.trim() : "";
    const key = getKeyInput() ? getKeyInput().value : "";
    window.htw.saveConfig({
      apiBase: base,
      apiKey: key,
      localBase: localBase == null ? "" : localBase,
      localBinary: userLocalBinary,
      localEnabled: localModeEnabled,
    });
  }

  // 落盘用户显式填写的可执行文件路径。
  // 值只从输入框来（用户显式输入），**不接受任何远端下发的路径**。
  // 值没变就不写（省一次磁盘写入，也避免把空值写回去）。
  function confirmLocalBinary(value) {
    const p = String(value == null ? "" : value).trim();
    if (p === userLocalBinary) return p;
    userLocalBinary = p;
    saveConfigAll(userLocalBase);
    return p;
  }

  // AuthKey 只存主进程的 userData 文件（明文，README 已声明）。
  // 早期版本还往 localStorage 写了一份做"互为备份"，那只是把泄露面扩大了一倍
  // （渲染层任何脚本都能读到），现在改为：仅在迁移时读一次，读到后立刻清掉。
  function readLocal() {
    try {
      return {
        apiBase: localStorage.getItem("htw_apiBase") || "",
        apiKey: localStorage.getItem("htw_apiKey") || "",
      };
    } catch (e) { return { apiBase: "", apiKey: "" }; }
  }
  function clearLocal() {
    try {
      localStorage.removeItem("htw_apiBase");
      localStorage.removeItem("htw_apiKey");
    } catch (e) { /* ignore */ }
  }

  function applyAuth() {
    const base = getBaseInput().value.trim();
    const key = getKeyInput().value;
    // 本地地址只落盘"用户保存过"的那一份：输入框里还没保存的值一律不写
    // （这个函数绑在 AuthKey 的每次按键上，跟着输入框走等于每敲一下存一次半截地址）。
    saveConfigAll(userLocalBase);
    clearLocal();
    if (base) window.HTWApi.setBase(base);
    window.HTWApi.setKey(key);
    refreshKeyUI();
  }

  function persistAuth() {
    saveConfigAll(userLocalBase);
    clearLocal();
  }

  function openGetKey() {
    const base = (getBaseInput().value.trim() || (window.htw && window.htw.apiBase) || "https://htwmedia.dpdns.org").replace(/\/+$/, "");
    const url = base + "/Home/GetApiKey";
    if (window.htw && window.htw.openExternal) window.htw.openExternal(url);
  }

  function refreshKeyUI() {
    const status = document.getElementById("key-status");
    if (status) {
      const has = window.HTWApi && window.HTWApi.hasKey && window.HTWApi.hasKey();
      status.textContent = has ? "已设置 ✓" : "未设置";
      status.style.color = has ? "#10b981" : "#ef4444";
    }
    const warn = document.getElementById("key-warning");
    if (warn) {
      const active = document.querySelector(".panel.active");
      const isSettings = document.getElementById("panel-settings") && document.getElementById("panel-settings").classList.contains("active");
    const isAssistant = document.getElementById("panel-assistant") && document.getElementById("panel-assistant").classList.contains("active");
      const has = window.HTWApi && window.HTWApi.hasKey && window.HTWApi.hasKey();
      if (!has && !isSettings && !isAssistant) {
        warn.hidden = false;
        warn.textContent = "尚未设置 AuthKey，以下功能将无法使用。请到「设置」填写，或点击「前往 web 端获取 AuthKey」。";
      } else {
        warn.hidden = true;
      }
    }
  }

  function showPanel(name) {
    for (const s of SKILLS) {
      const p = document.getElementById("panel-" + s);
      if (p) p.classList.toggle("active", s === name);
    }
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.skill === name);
    });
    const settingsPanel = document.getElementById("panel-settings");
    if (settingsPanel) settingsPanel.classList.remove("active");
    refreshKeyUI();
  }

  function showSettings() {
    for (const s of SKILLS) {
      const p = document.getElementById("panel-" + s);
      if (p) p.classList.remove("active");
    }
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    const sp = document.getElementById("panel-settings");
    if (sp) sp.classList.add("active");
    refreshKeyUI();
  }

  // 402 是账号级状态：任何一个面板撞上都要能看见，且要给出充值入口。
  // 注册在 api.js 的 normalize 里 —— 所有请求都经过它，不用改 40 处错误提示。
  function showQuotaBanner(info) {
    const banner = document.getElementById("quota-banner");
    if (!banner) return;
    banner.textContent = "免费次数已用完，充值后可继续使用。";
    const btn = document.createElement("button");
    btn.className = "quota-btn";
    btn.textContent = "去充值";
    btn.addEventListener("click", function () {
      const base = (getBaseInput().value.trim() || (window.htw && window.htw.apiBase) || "https://htwmedia.dpdns.org").replace(/\/+$/, "");
      const url = /^https?:/i.test(info.redirectUrl || "") ? info.redirectUrl : base + (info.redirectUrl || "/Home/Recharge");
      if (window.htw && window.htw.openExternal) window.htw.openExternal(url);
    });
    banner.appendChild(btn);
    banner.hidden = false;
  }

  // ---- 本地模式设置块 ----
  // 三态文案与状态判定都在 js/local.js（机器契约只在那里翻译），
  // 这里只做接线：读地址 → 登记基地址 → 探活 → 显示状态 → 允许配对。

  // ---- 本地选路：把实例状态与能力清单喂给 api.js ----
  //
  // 判据本身全在 api.js 那边（setLocalRouting），这里只负责**提供事实**：
  //  - enabled     用户总开关（默认关；设置页勾选与落盘见下面 onLocalEnabledChanged）。
  //  - ready       实例可达（探活通过）。
  //  - paired      已配对**且已解锁**（探活三态为 ready）——
  //                未配对 / 未解锁时鉴权层会 500，那时切过去只会拿到坏结果。
  //  - compatible  协议版本握手通过。
  //  - store       端点能力清单（js/local-capabilities.js 的 store）。
  let localModeEnabled = false;
  let localInstanceReady = false;
  let localInstancePaired = false;
  let localInstanceCompatible = false;
  let capabilitiesStore = null;
  let capabilitiesStoreBase = "";

  // 把当前事实喂给 api.js。任何一次状态变化后都要调一次 ——
  // 不调的话 api.js 会拿着上一次的状态选路（地址都换了还往老地址发）。
  function syncLocalRouting() {
    const api = window.HTWApi;
    if (!api || typeof api.setLocalRouting !== "function") return;
    api.setLocalRouting({
      enabled: localModeEnabled,
      ready: localInstanceReady,
      paired: localInstancePaired,
      compatible: localInstanceCompatible,
      store: capabilitiesStore,
    });
  }

  // 选路判据整体作废（实例没起来 / 地址变了 / 没配置）：一律走云端。
  function resetLocalRouting() {
    localInstanceReady = false;
    localInstancePaired = false;
    localInstanceCompatible = false;
    capabilitiesStore = null;
    capabilitiesStoreBase = "";
    syncLocalRouting();
  }

  // 总开关变化：立刻落盘 + 立刻把新状态喂给选路。
  //
  // 落盘走 saveConfigAll（五个键一起写）：既有四键一字不动，只多一个 localEnabled。
  // 勾选框是**显示**，状态（localModeEnabled）才是事实 —— 两者同源，
  // 免得出现「勾选框勾着、判据却说是关的」这种自相矛盾的状态。
  function onLocalEnabledChanged() {
    const el = getLocalEnabledInput();
    localModeEnabled = !!(el && el.checked);
    saveConfigAll(userLocalBase);
    syncLocalRouting();
  }

  // 实例就绪后拉一次端点能力清单。
  // 清单**与实例生命周期绑定**：地址变了就重新拉（缓存按地址记）。
  // 拉不到 / 为空 → store 查不到任何端点 → 选路全走云端（不报错、不阻断）。
  async function loadCapabilitiesStore(base) {
    const Caps = window.HTWLocalCapabilities;
    const b = String(base || "").trim();
    if (!Caps || typeof Caps.createStore !== "function" || !b) {
      capabilitiesStore = null;
      capabilitiesStoreBase = "";
      syncLocalRouting();
      return null;
    }
    if (capabilitiesStore && capabilitiesStoreBase === b) return capabilitiesStore;
    const store = Caps.createStore({ base: b, transport: localTransport(b) });
    capabilitiesStore = store;
    capabilitiesStoreBase = b;
    // 拉取失败不是错误：清单为空 = 本地无能力 = 全部走云端。
    try { await store.load(); } catch (e) { /* 拉不到就是"本地无能力" */ }
    syncLocalRouting();
    return store;
  }

  // ---- 本地实例：启停与状态 ----
  // 状态文案与判定口径见 LOCAL_INSTANCE_TEXTS 上面的注释。

  // 用户自备的可执行文件路径。
  // **要落盘**：主进程的配置有第 4 个键（localBinary），
  // 每次启动都要用户重输一遍是不可接受的 —— 落盘后在启动时回填输入框。
  // 落盘的值只来自用户显式输入（见 confirmLocalBinary）。
  function localBinaryValue() {
    const input = getLocalBinaryInput();
    return input ? String(input.value || "").trim() : "";
  }
  function setLocalStateText(text) { const el = getLocalStateEl(); if (el) el.textContent = text; }
  function setLocalToggleText(text) { const b = getLocalToggleBtn(); if (b) b.textContent = text; }

  // 探活与配对用的本地地址：监督器发现的地址优先（它才是实例真正的地址），
  // 没有监督器地址时用用户保存过的那一份。
  function currentLocalBase() {
    if (supervisorBase) return supervisorBase;
    return userLocalBase || "";
  }

  // 配对结果行要带上**实际使用的地址**：输入框里显示的可能不是配对实际打向的那个
  // （监督器发现的地址优先于用户保存的地址），用户得知道材料发到了哪儿。
  // 失败文案本身逐字透传，这里只在后面补一句地址说明。
  function pairResultWithBase(text, base) {
    const t = String(text == null ? "" : text);
    const b = String(base == null ? "" : base).trim();
    if (!b) return t;
    return t + "（实际地址：" + b + "）";
  }

  // 采纳监督器发现的地址：登记进 preload 白名单，否则请求会被 BASE_NOT_ALLOWED 拒掉。
  // 归一化/准入不过（不是本机回环根地址）就**不采纳** —— 地址不合格时宁可不发请求。
  function adoptSupervisorBase(base) {
    const b = String(base || "").trim();
    if (!b) { supervisorBase = ""; return false; }
    const api = window.HTWApi;
    if (!api || typeof api.setLocalBase !== "function") { supervisorBase = ""; return false; }
    const res = api.setLocalBase(b);
    if (!res || res.ok === false) { supervisorBase = ""; return false; }
    supervisorBase = String(res.base || b);
    return true;
  }

  // 实例是不是还活着（进程在跑或正在起）。
  function localInstanceAlive() {
    const st = supervisorSnapshot ? String(supervisorSnapshot.state || "") : "";
    return st === "running" || st === "starting";
  }

  // 状态载荷 → 界面文案。载荷是 { state, base, reason, attempt, pid }。
  function renderLocalState(payload) {
    const p = payload || {};
    const st = String(p.state || "");
    if (st === "running") {
      setLocalStateText(LOCAL_INSTANCE_TEXTS.running.replace("{base}", String(p.base || "")));
    } else if (st === "failed") {
      const why = LOCAL_INSTANCE_REASON_TEXTS[p.reason] || String(p.reason || "原因未知");
      setLocalStateText("本地实例启动失败：" + why + "。");
    } else if (st === "stopped" && Number(p.attempt) > 0 && (p.pid === null || p.pid === undefined)) {
      // 崩溃退避期：没有单独的"退避中"状态，是 stopped + attempt>0 + pid===null。
      setLocalStateText(LOCAL_INSTANCE_TEXTS.backoff);
    } else {
      setLocalStateText(LOCAL_INSTANCE_TEXTS[st] || LOCAL_INSTANCE_TEXTS.idle);
    }
    updateLocalToggleLabel(st);
  }

  // 按钮文案跟着状态走：实例在跑 → "停止"，否则 → "启动"。
  function updateLocalToggleLabel(state) {
    const st = String(state || "");
    const alive = st === "running" || st === "starting";
    setLocalToggleText(alive ? "停止本地实例" : "启动本地实例");
  }

  // 监督器事件 → 界面。
  function onSupervisorEvent(payload) {
    // 🔴 先判失败载荷：{ ok:false, errMsg } **不是**状态载荷。
    // 当状态读会显示成"未启动"这类假状态（把主进程故障说成用户的配置问题）。
    if (payload && payload.ok === false) {
      setLocalStateText(LOCAL_INSTANCE_OP_FAILED_PREFIX + String(payload.errMsg || "原因未知"));
      return;
    }
    if (!payload || typeof payload.state !== "string") return;
    supervisorSnapshot = payload;
    adoptSupervisorBase(payload.base);
    renderLocalState(payload);
    if (payload.state !== "running") return;
    // 实例跑起来了 → 地址回填 + 自动探活。
    // 为什么地址要回填：端口是系统随机分配的，桌面端只能从子进程上报里拿。
    // 用户把它手工抄进输入框，抄错一个字符就全白搭 —— 监督器报什么就是什么。
    // （"只认用户显式输入"那条约束针对的是 **localBinary 可执行文件路径**，
    //   地址是实例自己报的真地址，不是远端下发的值。）
    backfillSupervisorBase(payload.base);
    autoProbeRunning(payload.base);
  }

  // 监督器发现的地址回填进地址输入框。
  function backfillSupervisorBase(base) {
    const b = String(base || "").trim();
    if (!b) return;
    const li = getLocalBaseInput();
    if (!li) return;
    if (String(li.value || "").trim() === b) return;
    li.value = b;
  }

  // 上一次自动探活成功用过的地址（地址没成功探过就不重复探）。
  let lastAutoProbedBase = "";

  // 实例跑起来就自动探一次活。
  // 为什么必须自动探：「点启动 → 实例起来」这条主路径上从没探过活，
  // 于是不兼容的实例照样显示"本地实例运行中" —— 用户以为能用，等到配对才炸。
  // 探活失败**不抛到界面之外**：失败就显示在状态行上，不该把事件处理搞崩。
  function autoProbeRunning(base) {
    const b = String(base || "").trim();
    if (!b) return;
    if (b === lastAutoProbedBase) return; // 这个地址已经探过了
    let p;
    try {
      p = probeLocal();
    } catch (e) {
      return; // 探活抛错也不外抛（事件处理抛出去会打断整条事件链）
    }
    if (!p || typeof p.then !== "function") return;
    p.then(function (r) {
      // 只有探成功了才记下这个地址：探失败说明这个地址还没被确认过，
      // 后面再来一次事件还能重试。
      if (r && r.ok === true) lastAutoProbedBase = b;
    }).catch(function () { /* 探活失败只体现在状态行上 */ });
  }

  // 调监督器的 IPC（启动 / 停止）。
  // 失败载荷是 { ok:false, errMsg }：按「操作失败」显示 errMsg，**不当状态读**。
  async function callSupervisor(method, arg) {
    const htw = window.htw;
    if (!htw || typeof htw[method] !== "function") {
      setLocalStateText(LOCAL_INSTANCE_OP_FAILED_PREFIX + LOCAL_MODULE_MISSING_TEXT);
      return { ok: false, errMsg: LOCAL_MODULE_MISSING_TEXT };
    }
    let r;
    try {
      r = method === "localStart" ? await htw.localStart(arg) : await htw.localStop();
    } catch (e) {
      r = { ok: false, errMsg: String((e && e.message) || e) };
    }
    if (r && r.ok === false) {
      setLocalStateText(LOCAL_INSTANCE_OP_FAILED_PREFIX + String(r.errMsg || "原因未知"));
      return r;
    }
    // 成功：真正的状态由监督器推过来；这里只在返回值本身就是状态载荷时刷新，
    // 不自己编状态（编出来的状态没人能信）。
    if (r && typeof r.state === "string") {
      supervisorSnapshot = r;
      adoptSupervisorBase(r.base);
      renderLocalState(r);
    }
    return r;
  }

  // 启停按钮：实例没在跑 → 启动（**必须带上可执行文件路径**）；在跑 → 停止。
  async function toggleLocal() {
    if (localInstanceAlive()) return await callSupervisor("localStop");
    const p = localBinaryValue();
    // 点「启动」就是确认这个路径（用户显式输入的）：落盘，下次启动不用重输。
    confirmLocalBinary(p);
    return await callSupervisor("localStart", p);
  }

  // 把完整 URL 拆成 path（preload 的 call 是 base + path 拼出来的，
  // 直接把完整 URL 当 path 传过去会拼出坏地址）。
  function pathOf(url) {
    try {
      const u = new URL(String(url));
      return u.pathname + (u.search || "");
    } catch (e) { return String(url); }
  }

  // 探活用的传输层：HTTP 状态自己判 —— 非 2xx 一律当失败。
  // 不判的话 500 会被当成"探活成功"，状态行显示就绪，用户白高兴一场。
  // 状态码挂在异常上（httpStatus），探活据此区分"实例回了错误"与"连不上"。
  function localTransport(localBase) {
    return {
      call: async function (method, path) {
        // 不带 AuthKey：健康检查不需要登录，也不该把云端密钥递给本机进程。
        // 🔴 显式传 **null**（省略通道哨兵）：preload 头物化对 null/undefined 一律
        //    不建 AuthKey 键 —— 连"空值的头"都不出现（空值头在实例侧也会被当作
        //    "带了凭据"处理）。探活与端点清单共用这一条 transport，两个出口同时覆盖。
        const res = await window.htw.call(method, pathOf(path), undefined, null, localBase);
        const status = res ? res.status : 0;
        if (typeof status !== "number" || status < 200 || status >= 300) {
          const e = new Error("HTTP " + status);
          e.httpStatus = status;
          throw e;
        }
        return res;
      },
    };
  }

  // 探活并刷新状态行（探活结果只在这里翻译成界面文案）。
  // 地址用 currentLocalBase()：监督器发现的地址优先，没有时用用户保存过的。
  async function probeLocal() {
    const Local = window.HTWLocal;
    const localBase = currentLocalBase();
    if (!Local || typeof Local.probeHealth !== "function") {
      confirmedLocalState = null;
      // 选路判据作废：模块都不在，本地实例不可用 → 走云端。
      resetLocalRouting();
      setLocalStatus(LOCAL_MODULE_MISSING_TEXT);
      setLocalPairEnabled(false);
      return { ok: false, state: "invalid", message: LOCAL_MODULE_MISSING_TEXT };
    }
    let r;
    try {
      r = await Local.probeHealth(localBase, localTransport(localBase));
    } catch (e) {
      r = { ok: false, state: "unreachable", message: (e && e.message) ? e.message : String(e) };
    }
    if (!r || r.ok !== true) {
      // 探活失败 = 未就绪：配对必须被状态自检拦下，选路也一并作废。
      confirmedLocalState = null;
      localProtocolMismatch = false;
      resetLocalRouting();
      setLocalStatus((r && r.message) ? r.message : "无法连接本地实例，请先启动或检查地址。");
      setLocalPairEnabled(false);
      return r;
    }
    // ---- 协议版本握手 ----
    //
    // 实例报的协议版本与客户端支持的对不上 → **拒绝配对**并说清：
    // 配对会把 AuthKey + 账号级 KEK 材料发给实例，版本对不上时不该发。
    //
    // 🔴 版本读不到（null）时**不阻断**：老实例没有这个字段，做不了握手 ——
    //    按兼容处理（老实例不做版本握手，见任务报告）。绝不能把 null 当成 0
    //    去比，那样会把所有老实例都说成"不兼容"。
    const supported = (Local && typeof Local.SUPPORTED_PROTOCOL_VERSION === "number")
      ? Local.SUPPORTED_PROTOCOL_VERSION
      : null;
    const version = r.protocolVersion;
    if (supported !== null && typeof version === "number" && version !== supported) {
      confirmedLocalState = null;
      localProtocolMismatch = true;
      // 实例可达但握手不兼容 → 选路走云端（ready 为真、compatible 为假）。
      localInstanceReady = true;
      localInstancePaired = false;
      localInstanceCompatible = false;
      capabilitiesStore = null;
      capabilitiesStoreBase = "";
      syncLocalRouting();
      setLocalStatus(LOCAL_PROTOCOL_MISMATCH_TEXT);
      setLocalPairEnabled(false);
      setLocalPairResult(LOCAL_PROTOCOL_MISMATCH_TEXT);
      return { ok: false, state: "protocolMismatch", message: LOCAL_PROTOCOL_MISMATCH_TEXT, protocolVersion: version };
    }
    localProtocolMismatch = false;
    // 状态文案取机器契约的映射表（不在这里另造一套说法）。
    const text = (Local.STATE_TEXT && Local.STATE_TEXT[r.state]) || r.message || "";
    confirmedLocalState = r.state;
    // ---- 选路判据 ----
    // 实例可达（ready）与握手兼容（compatible）：探活过了 + 版本对上了。
    // 已配对**且已解锁**才算 paired：探活三态里只有 ready 满足
    // （notPaired / pairedNotUnlocked 时鉴权层会 500，不能切本地）。
    localInstanceReady = true;
    localInstanceCompatible = true;
    localInstancePaired = (r.state === "ready");
    if (localInstancePaired) {
      // 就绪了才拉清单：没配对时拉到的清单也用不上。
      await loadCapabilitiesStore(localBase);
    } else {
      capabilitiesStore = null;
      capabilitiesStoreBase = "";
    }
    syncLocalRouting();
    setLocalStatus(text);
    // 配对按钮的可用性跟着三态走：
    // - notPaired（还没配过对）→ 可以配对，这正是「一键配对」的主用例；
    // - pairedNotUnlocked（配过对但实例重启后待解锁）→ 重新配对，出示当前 AuthKey；
    // - ready（已经就绪）→ 不需要配对，按钮禁用。
    setLocalPairEnabled(r.state === "notPaired" || r.state === "pairedNotUnlocked");
    return r;
  }

  // 地址被改动（还没保存、还没探活）→ 上一次探活的结果立刻作废：
  // 状态行提示要重新探活，配对按钮同时禁用 —— 免得拿旧地址的状态去配对新地址。
  function onLocalBaseChanged() {
    const v = localBaseValue();
    if (v === userLocalBase) return; // 地址没变（改回原值），之前的结果仍然作数
    // 归一化之后相同也不算改动：尾斜杠这类写法差异不该让上一次探活作废
    // （保存时存的是归一化后的地址，用户输入框里可能还带着尾斜杠）。
    const norm = normalizeLocalBase(v);
    if (norm.ok && norm.base === userLocalBase) return;
    confirmedLocalState = null;
    localProtocolMismatch = false;
    // 地址一改，上一次探活的结果作废 → 选路判据也一并作废
    // （不然会拿着旧地址的就绪状态往新地址发请求）。
    resetLocalRouting();
    setLocalStatus(LOCAL_BASE_CHANGED_TEXT);
    setLocalPairEnabled(false);
    setLocalPairResult("");
  }

  // 「保存并探活」：空地址 = 关闭本地模式；非空 = 校验 → 登记 → 落盘 → 探活。
  // 这里是唯一能把本地地址写进配置的地方：用户保存过的地址进缓存，缓存才落盘。
  async function applyLocal() {
    const api = window.HTWApi;
    // 可执行文件路径：用户显式填的就落盘（与地址校验无关 —— 路径与地址是两件事）。
    confirmLocalBinary(localBinaryValue());
    // 地址来源：输入框优先；输入框为空但**监督器已经发现了地址**时用监督器那个。
    // 为什么不能只看输入框：端口是系统随机分配的，用户拿不到、不该手工抄 ——
    // 监督器报上来的就是实例真正的地址，照着它探活才对。
    //
    // ⚠️ 兜底只认**监督器**的地址，不认用户保存过的那一份：
    //   "清空输入框"是用户关闭本地模式的动作（那条既有语义不能被破坏）。
    const v = localBaseValue() || supervisorBase;
    if (!v) {
      userLocalBase = "";
      confirmedLocalState = null;
      localProtocolMismatch = false;
      // 关闭本地模式 → 选路判据整体作废（清单也清掉：地址没了，清单无意义）。
      resetLocalRouting();
      if (api && api.setLocalBase) api.setLocalBase("");
      saveConfigAll("");
      setLocalStatus(LOCAL_NOT_CONFIGURED);
      setLocalPairEnabled(false);
      setLocalPairResult("");
      return { ok: false, state: "notConfigured", message: LOCAL_NOT_CONFIGURED };
    }
    // 🔴 **先校验、后登记、再落盘**——顺序不能换。
    // 校验不过的地址（带路径 / 非本机回环 / 格式非法）绝不能登记到 preload 白名单，
    // 也不能写进配置：配对请求会把 **AuthKey + 账号级 KEK 材料**发往那个地址，
    // 而那个地址可能根本不是本机。
    const norm = normalizeLocalBase(v);
    if (!norm.ok) {
      confirmedLocalState = null;
      setLocalStatus(norm.message);
      setLocalPairEnabled(false);
      setLocalPairResult("");
      return { ok: false, state: "invalidBase", message: norm.message };
    }
    const base = norm.base;
    // 换了地址，之前的探活结果作废（不能拿旧地址的就绪状态去配对）。
    confirmedLocalState = null;
    // 换了地址，之前那次探活的版本判定也作废（新地址还没探过）。
    localProtocolMismatch = false;
    // 换了地址，之前的清单与就绪判据也作废（清单与实例生命周期绑定）。
    resetLocalRouting();
    // 登记 = 进 preload 白名单。登记失败（地址格式非法）不落盘、不生效。
    const res = api && api.setLocalBase ? api.setLocalBase(base) : null;
    if (res && res.ok === false) {
      setLocalStatus(localBaseText(res.reason));
      setLocalPairEnabled(false);
      setLocalPairResult("");
      return { ok: false, state: "invalidBase", message: localBaseText(res.reason) };
    }
    // 归一化后的地址回填输入框：输入框与配置里存的是同一份字面量，
    // 否则「地址已修改，请重新探活」的判定会把写法差异当成改动。
    // 🔴 回填必须**在登记成功之后**：登记失败时状态行说的是「这个地址不合格」，
    // 而输入框却已经换成了另一串字面量 —— 两边对不上，用户会以为地址已经被接受。
    const li = getLocalBaseInput();
    if (li) li.value = base;
    // 地址先落盘再探活：探活失败（实例没起来）不该把用户填的地址从配置里抹掉。
    userLocalBase = base;
    saveConfigAll(base);
    setLocalPairResult("");
    // 监督器在跑的话，探活与配对一律走它发现的地址（那才是实例真正的地址）。
    // 重新采纳一次：登记用户地址时会把本地基地址换成用户填的那个，这里换回来。
    if (supervisorBase) adoptSupervisorBase(supervisorBase);
    return await probeLocal();
  }

  // 「一键配对」：登记材料（enroll，走服务端）→ 出示材料（pair，走本地实例）→ 比对 keyId。
  // 账号由 enroll 响应回带，调用方不传也不猜。
  async function pairLocal() {
    const Local = window.HTWLocal;
    const api = window.HTWApi;
    // 配对地址：监督器发现的地址优先，没有时用用户保存过的那一份。
    const localBase = currentLocalBase();
    const serverBase = getBaseInput() ? getBaseInput().value.trim() : "";
    const key = getKeyInput() ? String(getKeyInput().value || "").trim() : "";
    if (!Local || typeof Local.pairFlow !== "function") {
      setLocalPairResult(LOCAL_MODULE_MISSING_TEXT);
      return { ok: false, message: LOCAL_MODULE_MISSING_TEXT };
    }
    // 没有本地地址就**不配对**：空地址会被 api.call 当成"没指定地址"，
    // 于是配对材料会发给服务端地址 —— 那不是本地实例。
    if (!localBase) {
      setLocalPairResult(LOCAL_NOT_READY_TEXT);
      return { ok: false, message: LOCAL_NOT_READY_TEXT };
    }
    // 地址自检：输入框里的地址必须还是保存过的那一份 ——
    // 改了地址没保存就配对，配对的其实是上一个地址。
    // 比的是**归一化之后**的地址：尾斜杠这类写法差异不是改动（与 onLocalBaseChanged 同口径）。
    //
    // 例外：监督器发现了地址并已回填输入框 —— 那时输入框里显示的就是实例真正的地址，
    // 配对也正是打向它（currentLocalBase 优先用它），所以不该按"改了地址"拦下。
    const curNorm = normalizeLocalBase(localBaseValue());
    const curBase = curNorm.ok ? curNorm.base : localBaseValue();
    const supervisorOwns = !!supervisorBase && localBase === supervisorBase;
    if (!supervisorOwns && userLocalBase && curBase !== userLocalBase) {
      confirmedLocalState = null;
      setLocalStatus(LOCAL_BASE_CHANGED_TEXT);
      setLocalPairEnabled(false);
      setLocalPairResult(LOCAL_BASE_CHANGED_TEXT);
      return { ok: false, message: LOCAL_BASE_CHANGED_TEXT };
    }
    // 协议版本不匹配 → 一律不配对（按钮禁用只是界面层的兜底，流程本身也要拦一道）。
    if (localProtocolMismatch) {
      setLocalStatus(LOCAL_PROTOCOL_MISMATCH_TEXT);
      setLocalPairResult(LOCAL_PROTOCOL_MISMATCH_TEXT);
      return { ok: false, message: LOCAL_PROTOCOL_MISMATCH_TEXT };
    }
    // 状态自检：按钮禁用只是界面层的兜底，流程本身也要拦一道 ——
    // 没探活过（或探活失败）就配对，配对的其实是上一个地址。
    // 放行的是"还需要配对"的两种状态：还没配过对（首配对）、配过对但实例重启后待解锁；
    // 已经就绪的实例不需要再配对，给一句明确的说明而不是笼统的"未就绪"。
    if (confirmedLocalState === "ready") {
      setLocalPairResult(LOCAL_ALREADY_READY_TEXT);
      return { ok: false, message: LOCAL_ALREADY_READY_TEXT };
    }
    if (confirmedLocalState !== "notPaired" && confirmedLocalState !== "pairedNotUnlocked") {
      setLocalPairResult(LOCAL_NOT_READY_TEXT);
      return { ok: false, message: LOCAL_NOT_READY_TEXT };
    }
    // key 口径：输入框为空就直接失败，不发请求 ——
    // 否则配对体会带着空 AuthKey 出去，而登记用的却是另一个 key。
    if (!key) {
      setLocalPairResult(LOCAL_KEY_REQUIRED_TEXT);
      return { ok: false, message: LOCAL_KEY_REQUIRED_TEXT };
    }
    // 配对体里的 AuthKey 与登记用的 key 必须同一个：输入框这份为准。
    if (api && api.setKey) api.setKey(key);
    let r;
    try {
      r = await Local.pairFlow({
        apiBase: serverBase,
        localBase: localBase,
        key: key,
        enroll: async function () { return api.call("POST", "/api/v2/local/enroll"); },
        pair: async function (body) { return api.call("POST", "/api/local/pair", body, localBase); },
      });
    } catch (e) {
      r = { ok: false, message: (e && e.message) ? e.message : String(e) };
    }
    if (!r || r.ok !== true) {
      // 失败文案逐字透传（keyId 不一致等都是流程给出的原文），
      // 后面补上实际使用的地址（可能不是输入框里显示的那个）。
      setLocalPairResult(pairResultWithBase((r && r.message) ? r.message : "配对失败。", localBase));
      return r;
    }
    setLocalPairResult(pairResultWithBase("配对成功。", localBase));
    // 只刷新状态行，不清结果行（刚写进去的成功提示不能被自己抹掉）。
    await probeLocal();
    return r;
  }

  // 🔴 接线**只做一次**：boot() 的成功路径与失败路径都会调 wireLocal，
  // 不加防重的话同一个按钮会绑上两个处理器 —— 点一次「保存并探活」探活两次，
  // 而且两次是交错的异步探活，状态行显示的是**后到**的那次，用户看到的结果
  // 与他点的按钮对不上。
  let localWired = false;
  function wireLocal() {
    if (localWired) return;
    localWired = true;
    const apply = document.getElementById("local-apply");
    if (apply) apply.addEventListener("click", function () { return applyLocal(); });
    const pair = getLocalPairBtn();
    if (pair) pair.addEventListener("click", function () { return pairLocal(); });
    // 本地实例的启停按钮。
    const toggle = getLocalToggleBtn();
    if (toggle) toggle.addEventListener("click", function () { return toggleLocal(); });
    // 订阅监督器状态：主进程每次状态变化推一次。
    if (window.htw && typeof window.htw.onLocalEvent === "function") {
      try { window.htw.onLocalEvent(onSupervisorEvent); } catch (e) { /* 订阅失败不影响设置页 */ }
    }
    // 地址一改，上一次探活的结果就不再作数（配对按钮与状态行跟着作废）。
    const baseInput = getLocalBaseInput();
    if (baseInput) baseInput.addEventListener("change", onLocalBaseChanged);
    // 总开关：勾选 / 取消都要立刻落盘并生效。
    const enabledInput = getLocalEnabledInput();
    if (enabledInput) enabledInput.addEventListener("change", onLocalEnabledChanged);
  }

  function wireNav() {
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.addEventListener("click", () => {
        const name = b.dataset.skill;
        if (name === "settings") { showSettings(); return; }
        applyAuth();
        showPanel(name);
      });
    });
    const gk = document.getElementById("get-key-btn");
    if (gk) gk.addEventListener("click", openGetKey);
    const kw = document.getElementById("key-warning");
    if (kw) kw.addEventListener("click", showSettings);
  }

  function mountSkills() {
    for (const s of SKILLS) {
      const mod = window.Skills && window.Skills[s];
      const panel = document.getElementById("panel-" + s);
      if (mod && typeof mod.mount === "function" && panel) {
        try { mod.mount(panel); } catch (e) {
          panel.appendChild(window.UI.el("div", { class: "error-box", text: "技能加载失败: " + (e && e.message ? e.message : e) }));
        }
      }
    }
  }

  // preload 的配置读写现在走 IPC（异步），这里必须先等结果再决定用哪份配置。
  async function boot() {
    let saved = {};
    if (window.htw && window.htw.loadConfig) {
      try { saved = (await window.htw.loadConfig()) || {}; } catch (e) { saved = {}; }
    }
    if (!saved.apiKey) {
      // 迁移老版本留在 localStorage 里的凭据：读出来后马上清掉。
      const l = readLocal();
      if (l.apiKey) { saved.apiKey = l.apiKey; saved.apiBase = l.apiBase || saved.apiBase; }
    }
    clearLocal();
    if (saved.apiBase) getBaseInput().value = saved.apiBase;
    if (saved.apiKey) getKeyInput().value = saved.apiKey;
    // 可执行文件路径：启动时回填输入框（上次用户显式填的那一份）。
    // 🔴 只接受**字符串**且只接受用户自己填过的值 —— 配置里的路径不是远端下发的，
    // 但类型不对（对象/数组）说明配置被改坏了，宁可留空也不填。
    if (typeof saved.localBinary === "string" && saved.localBinary.trim()) {
      userLocalBinary = saved.localBinary.trim();
      const bi = getLocalBinaryInput();
      if (bi) bi.value = userLocalBinary;
    }
    // 总开关（config 第 5 键 localEnabled）：**默认关**。
    // 配置里没有这个键 = 用户从没勾选过 → 当关。
    // 布尔口径只认 true："true" / 1 都不是用户勾选出来的值，
    // 当成"开"会把流量切到本地去 —— 那是最不该出的错。
    localModeEnabled = saved.localEnabled === true;
    const enabledInput = getLocalEnabledInput();
    if (enabledInput) enabledInput.checked = localModeEnabled;
    // 本地地址要在 applyAuth 之前填好：applyAuth 会把配置整份写回，
    // 顺序反了会把刚读出来的本地地址又清空。
    if (saved.localBase) {
      const lb = String(saved.localBase);
      // 🔴 配置里的地址也要过一遍准入：老版本可能存过带路径 / 非回环的地址，
      // 而配对请求会把 **AuthKey + 账号级 KEK 材料**发往那个地址。
      // 不合格就**不登记、不落盘**，并把原因摆在状态行上。
      const norm = normalizeLocalBase(lb);
      if (!norm.ok) {
        setLocalStatus(norm.message);
        setLocalPairEnabled(false);
      } else {
        const li = getLocalBaseInput();
        if (li) li.value = norm.base;
        const res = window.HTWApi && window.HTWApi.setLocalBase ? window.HTWApi.setLocalBase(norm.base) : null;
        if (res && res.ok === false) {
          setLocalStatus(localBaseText(res.reason));
          setLocalPairEnabled(false);
        } else {
          // 上次保存过的地址：进缓存，applyAuth 整份写回时不能把它弄丢。
          userLocalBase = norm.base;
          setLocalStatus("已配置，未探活");
        }
      }
    }
    getBaseInput().addEventListener("change", applyAuth);
    getKeyInput().addEventListener("input", applyAuth);
    applyAuth();
    // 把总开关的事实喂给选路（enabled 是选路的第一条判据）。
    // 不调的话 api.js 拿不到 enabled —— 启动时勾选过也不生效。
    syncLocalRouting();
    if (window.HTWApi && window.HTWApi.onQuotaExceeded) window.HTWApi.onQuotaExceeded(showQuotaBanner);
    wireNav();
    wireLocal();
    // 初始状态：主进程不主动推当前状态（新开的窗口要自己问一次）。
    // 只在**还没收到过事件**时用它 —— 否则会把后来的事件结果覆盖掉。
    if (window.htw && typeof window.htw.localStatus === "function" && !supervisorSnapshot) {
      try {
        const st = await window.htw.localStatus();
        if (st && st.ok !== false && typeof st.state === "string" && !supervisorSnapshot) {
          // 走与监督器事件**同一套**处理：状态渲染 + 地址回填 + 自动探活。
          // （主流程也得握手：实例早就在跑的时候，客户端不能装作没看见。）
          onSupervisorEvent(st);
        }
      } catch (e) { /* 拿不到初始状态不影响设置页 */ }
    }
    mountSkills();
    // 任务恢复要等配置与 AuthKey 就绪，所以排在 mountSkills 之后。
    // 注意面板在 mountSkills 里已经渲染过一次（那时列表还是空的）：真正把记录显示
    // 出来的是 restore() 末尾那次 emitChange()，它通知已订阅的面板重渲染。
    if (window.HTWTasks && window.HTWTasks.restore) {
      try { window.HTWTasks.restore(); } catch (e) { /* 恢复失败不该挡住启动 */ }
    }
    // README 主推的工作流从「选题」开始；默认落在「工具」会让新用户第一眼看到一堆
    // 与创作无关的卡片（此前选题面板还是坏的，更糟）。
    showPanel("topics");
    window.addEventListener("beforeunload", persistAuth);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") persistAuth(); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    boot().catch(function (e) {
      // 启动失败时也要把界面装配起来，否则整个应用是白屏。
      console.error("boot failed", e);
      applyAuth();
      wireNav();
      wireLocal();
      mountSkills();
      showPanel("topics");
    });
  });

  window.App = {
    showPanel: showPanel,
    getKey: function () { return getKeyInput().value; },
    getBase: function () { return getBaseInput().value; },
    applyAuth: applyAuth,
    // 本地模式接线（设置块）：暴露出来便于冒烟测试直接驱动。
    local: {
      apply: applyLocal,
      pair: pairLocal,
      wire: wireLocal,
      transport: localTransport,
      // 本地实例的启停与状态（供测试驱动）。
      toggle: toggleLocal,
      stateOf: function () { return supervisorSnapshot; },
      base: currentLocalBase,
      // 本地选路状态（给 api.js 的判据用；后续任务接总开关时也走这里）。
      routing: function () {
        return {
          enabled: localModeEnabled,
          ready: localInstanceReady,
          paired: localInstancePaired,
          compatible: localInstanceCompatible,
          hasStore: !!capabilitiesStore,
        };
      },
      // 总开关（默认关）。设置页勾选与落盘接上以后由它驱动。
      setEnabled: function (on) {
        localModeEnabled = !!on;
        syncLocalRouting();
        return localModeEnabled;
      },
    },
  };
})();
