(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") {
    window.Skills = window.Skills || {};
    window.Skills.tasks = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const I = (typeof window !== "undefined" && window.HTWTasks && window.HTWTasks._internal) || {};
  const GROUPS = [
    { key: "running", label: "进行中", match: (t) => t.status === "running" },
    { key: "failed", label: "失败", match: (t) => t.status === "failed" || t.status === "interrupted", fold: true },
    { key: "done", label: "已完成", match: (t) => t.status === "done" || t.status === "canceled", fold: true },
  ];
  const FOLD_LIMIT = 20;

  function fmtTime(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n) => (n < 10 ? "0" + n : String(n));
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function statusText(t) {
    if (t.status === "running") return t.unknown ? "状态未确认" : "进行中";
    if (t.status === "failed") return "失败";
    if (t.status === "interrupted") return "已中断";
    if (t.status === "canceled") return "已取消";
    return "已完成";
  }

  function row(t) {
    const node = UI.el("div", { class: "card tk-row" });

    const head = UI.el("div", { class: "row" }, [
      UI.el("strong", { text: t.title || t.taskId }),
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
    if (I.canCancel && I.canCancel(t.domain)) {
      const btn = UI.el("button", { class: "btn btn-ghost", text: "取消" });
      btn.addEventListener("click", function () {
        btn.disabled = true;
        btn.textContent = "取消中…";
        Promise.resolve(window.HTWTasks.cancel(t.id)).catch(function (e) {
          btn.disabled = false;
          btn.textContent = "取消";
          node.appendChild(UI.el("div", { class: "wf-error", text: String((e && e.message) || e) }));
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
    if (t.result && t.result.fileName && t.status === "done") {
      acts.push(UI.el("button", {
        class: "btn btn-ghost", text: "下载",
        onclick: function () {
          const url = t.result.downloadUrl;
          if (url && /^https?:/i.test(url) && window.htw && window.htw.openExternal) window.htw.openExternal(url);
          else if (t.panel && window.App && window.App.showPanel) window.App.showPanel(t.panel);
        },
      }));
    }
    if (acts.length) node.appendChild(UI.el("div", { class: "row" }, acts));
    if (t.endedAt) node.appendChild(UI.el("div", { class: "hint", text: fmtTime(t.endedAt) }));
    return node;
  }

  function mount(panel) {
    UI.clear(panel);
    panel.appendChild(UI.el("h2", { text: "任务中心" }));
    const body = UI.el("div", { class: "tk-body" });
    panel.appendChild(body);

    const clearBtn = UI.el("button", { class: "btn btn-ghost", text: "清空已完成" });
    clearBtn.addEventListener("click", function () {
      window.HTWTasks.clearFinished();
      render();
    });
    panel.appendChild(UI.el("div", { class: "row" }, [clearBtn]));

    function render() {
      UI.clear(body);
      const all = (window.HTWTasks.list && window.HTWTasks.list()) || [];
      const counts = {};
      GROUPS.forEach(function (g) {
        const hit = all.filter(g.match);
        counts[g.key] = hit.length;
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
    // 容器每次变更都会回调；面板重挂时用标记避免重复订阅。
    if (!panel._tkBound && window.HTWTasks.onChange) {
      panel._tkBound = true;
      window.HTWTasks.onChange(render);
    }
  }

  return { mount: mount };
});
