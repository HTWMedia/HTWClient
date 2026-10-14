(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") {
    window.Skills = window.Skills || {};
    window.Skills.tasks = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  // 三组之外还留了第四组「未知状态」。restore() 不校验 status，落盘文件被手改过、
  // 或旧版本写进过词表外的值时，这条记录既不属于任何一组；静默丢掉等于让用户
  // 以为任务从没存在过，所以宁可摊开成「未知状态」让人自己判断。
  const GROUPS = [
    { key: "running", label: "进行中", fold: false },
    { key: "failed", label: "失败", fold: true },
    { key: "done", label: "已完成", fold: true },
    { key: "other", label: "未知状态", fold: true },
  ];
  const FOLD_LIMIT = 20;

  // 任务容器一律在**调用时**解析，不在模块求值那一刻做快照。
  // 快照下来的 canCancel 一旦因为加载顺序拿不到就是 undefined：三个可取消域的
  // 「取消」按钮会一排都不画，界面上没有任何症状 —— 这正是 tasks.js 的
  // defaultDeps() 注释里点名要避免的那一类静默失效。
  function store() {
    return (typeof window !== "undefined" && window.HTWTasks) || null;
  }

  function canCancel(domain) {
    const s = store();
    const i = (s && s._internal) || {};
    return typeof i.canCancel === "function" ? !!i.canCancel(domain) : false;
  }

  function listTasks() {
    const s = store();
    return s && typeof s.list === "function" ? (s.list() || []) : [];
  }

  // 产物地址常是带 token 的相对路径（/api/v2/...），与 batch.js / workflow.js 同法
  // 拼上 API 基址。少了这一步，相对地址过不了 http 判定，「下载」会被悄悄改成切面板。
  function absolute(url) {
    const s = String(url || "");
    if (/^https?:\/\//i.test(s)) return s;
    const base = (window.HTWApi && window.HTWApi.base) || "";
    if (!base) return s;
    try { return new URL(s, base).href; } catch (e) { return s; }
  }

  function openExternal(url) {
    if (!url) return;
    if (window.htw && typeof window.htw.openExternal === "function") window.htw.openExternal(url);
    else if (typeof window.open === "function") window.open(url, "_blank");
  }

  function errorLine(e) {
    return UI.el("div", { class: "wf-error", text: String((e && e.message) || e) });
  }

  function fmtTime(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n) => (n < 10 ? "0" + n : String(n));
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // 内部词表只有 running / done / failed / canceled / interrupted 五个词。
  // 落盘文件里的 status 不受校验，词表外的一律归到 other，绝不悄悄从三组之间漏下去。
  function groupOf(t) {
    const s = t && t.status;
    if (s === "running") return "running";
    if (s === "failed" || s === "interrupted") return "failed";
    if (s === "done" || s === "canceled") return "done";
    return "other";
  }

  function statusText(t) {
    if (t.status === "running") return t.unknown ? "状态未确认" : "进行中";
    if (t.status === "failed") return "失败";
    if (t.status === "interrupted") return "已中断";
    if (t.status === "canceled") return "已取消";
    if (groupOf(t) === "other") return "未知状态";
    return "已完成";
  }

  function row(t) {
    const node = UI.el("div", { class: "card tk-row" });

    const head = UI.el("div", { class: "row" }, [
      // title 与 taskId 都可能为空，全空就是一行没有主语的白板，用户无从判断这是哪条任务。
      UI.el("strong", { text: t.title || t.taskId || "未命名任务 · " + (t.domain || "未知来源") }),
      UI.el("span", { class: "badge " + t.status, text: statusText(t) }),
      // 「已降级」是排查实际降级率的唯一线索，必须显眼。
      t.degraded ? UI.el("span", { class: "badge", text: "已降级" }) : null,
    ]);
    node.appendChild(head);

    // progress 允许为 null —— 创作/工作流/批量三域的进度语义不同，编一个百分比是在骗人。
    if (t.progress != null) {
      node.appendChild(UI.el("div", { class: "tk-bar" }, [
        UI.el("div", { class: "tk-bar-fill", style: "width:" + t.progress + "%" }),
      ]));
    }
    const detail = [t.progress != null ? t.progress + "%" : null, t.step].filter(Boolean).join(" · ");
    if (detail) node.appendChild(UI.el("div", { class: "hintline", text: detail }));
    if (t.error) node.appendChild(UI.el("div", { class: "wf-error", text: String(t.error) }));

    const acts = [];
    if (t.panel && window.App && window.App.showPanel) {
      acts.push(UI.el("button", {
        class: "btn btn-ghost", text: "回到面板",
        onclick: function () { window.App.showPanel(t.panel); },
      }));
    }
    // 取消只在还在跑的时候给：已结束的记录点下去只会被 store 拒绝
    // （「任务已结束，无需取消」），在一条已经做完的记录上闪一条红字纯属噪声。
    if (t.status === "running" && canCancel(t.domain)) {
      const btn = UI.el("button", { class: "btn btn-ghost", text: "取消" });
      btn.addEventListener("click", function () {
        const s = store();
        if (!s || typeof s.cancel !== "function") return;
        let pending;
        // 包 try 是因为 store 缺席时取消是同步抛出的，直接抛进事件回调就成了未捕获异常。
        try { pending = s.cancel(t.id); }
        catch (e) { node.appendChild(errorLine(e)); return; }
        btn.disabled = true;
        btn.textContent = "取消中…";
        Promise.resolve(pending).catch(function (e) {
          btn.disabled = false;
          btn.textContent = "取消";
          node.appendChild(errorLine(e));
        });
      });
      acts.push(btn);
    }
    // 「重试」不自动重发：自动重发会二次扣减额度，必须由人确认。
    // 行为是切回来源面板让人自己来。
    if (t.status === "failed" && t.panel && window.App && window.App.showPanel) {
      acts.push(UI.el("button", {
        class: "btn btn-ghost", text: "重试",
        onclick: function () { window.App.showPanel(t.panel); },
      }));
    }
    // 下载以 downloadUrl 为准：applyPayload 在只拿到地址、拿不到文件名时会把
    // fileName 置空而 downloadUrl 照常填上（agent 域的云端产物常是这个形态），
    // 拿 fileName 当门槛会让一条有产物的完成记录连按钮都没有。
    // 没有地址就没有下载按钮 —— 绝不摆一个叫「下载」却会去切面板的按钮。
    if (t.status === "done" && t.result && String(t.result.downloadUrl || "").trim()) {
      const url = absolute(t.result.downloadUrl);
      acts.push(UI.el("button", {
        class: "btn btn-ghost", text: "下载",
        onclick: function () { openExternal(url); },
      }));
    }
    if (acts.length) node.appendChild(UI.el("div", { class: "row" }, acts));
    if (t.endedAt) node.appendChild(UI.el("div", { class: "hint", text: fmtTime(t.endedAt) }));
    return node;
  }

  function mount(panel) {
    // 先退掉上一次挂载留下的订阅：mount() 每次都新建 body 与 render，
    // 沿用旧订阅的话它渲染的是已被 UI.clear(panel) 摘掉的旧 body ——
    // 面板会永远停在首次挂载时的状态且毫无症状，而这恰恰是全应用唯一靠实时状态吃饭的面板。
    if (panel._tkUnsub) { try { panel._tkUnsub(); } catch (e) { /* ignore */ } panel._tkUnsub = null; }
    if (panel._tkProbe) { try { clearTimeout(panel._tkProbe); } catch (e) { /* ignore */ } panel._tkProbe = null; }
    UI.clear(panel);
    panel.appendChild(UI.el("h2", { text: "任务中心" }));
    const body = UI.el("div", { class: "tk-body" });
    panel.appendChild(body);

    const clearBtn = UI.el("button", {
      class: "btn btn-ghost",
      // store.clearFinished() 只保留 status === "running"，也就是说失败和中断
      // 一样被删掉，而「重试」入口恰恰只长在失败记录上。旧文案只说「已完成」，
      // 用户不会知道这一下抹掉的是自己唯一的重试线索，所以文案必须把失败写出来。
      text: "清空已结束记录（含失败）",
    });
    clearBtn.addEventListener("click", function () {
      const s = store();
      if (s && typeof s.clearFinished === "function") s.clearFinished();
      render();
    });
    panel.appendChild(UI.el("div", { class: "row" }, [clearBtn]));

    // 订阅的建立放在 render 里，而不是只在挂载那一刻建一次：
    // 「容器缺席就提前返回」+「挂载时没有订阅」这两件事叠在一起，
    // 会让「任务中心尚未就绪。」变成死局 —— 没有订阅就没有任何变更通知，
    // 即便 HTWTasks 随后加载好了，面板也再没有第二次渲染的机会。
    function ensureSub() {
      if (panel._tkUnsub) return;
      const s = store();
      if (s && typeof s.onChange === "function") panel._tkUnsub = s.onChange(render) || null;
    }

    function render() {
      ensureSub();
      UI.clear(body);
      // 容器缺席时退化成一句提示即可：让它抛出去的话 mountSkills() 会把整个面板
      // 标成「技能加载失败」，比空列表更难查。这里只画提示就返回 —— render() 每次
      // 都重新检查容器，容器补上后的下一次渲染就会画出列表。
      if (!store()) {
        body.appendChild(UI.el("div", { class: "hint", text: "任务中心尚未就绪。" }));
        return;
      }
      const all = listTasks();
      GROUPS.forEach(function (g) {
        const hit = all.filter((t) => groupOf(t) === g.key);
        if (!hit.length) return;
        body.appendChild(UI.el("div", { class: "section-title", text: g.label + " " + hit.length }));
        const shown = g.fold ? hit.slice(-FOLD_LIMIT) : hit;
        for (let i = shown.length - 1; i >= 0; i--) body.appendChild(row(shown[i]));
        if (hit.length > shown.length) {
          body.appendChild(UI.el("div", { class: "hint", text: "仅显示最近 " + FOLD_LIMIT + " 条，共 " + hit.length + " 条" }));
        }
      });
      if (!all.length) body.appendChild(UI.el("div", { class: "hint", text: "还没有任务记录。" }));
    }

    render();

    // 容器缺席时挂一次推迟复查：这是面板唯一还能自己重绘的机会
    // （tasks.js 的 script 标签若晚于本面板，第一次 render 时它还不存在）。
    // 复查一次就够了 —— 容器补上之后 ensureSub 会把订阅接上，之后靠通知驱动。
    if (!store()) panel._tkProbe = setTimeout(function () { panel._tkProbe = null; render(); }, 0);
  }

  return { mount: mount };
});
