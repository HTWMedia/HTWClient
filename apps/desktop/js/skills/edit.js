(function () {
  var Skills = (window.Skills = window.Skills || {});

  function formatErr(r) {
    if (!r) return "未知错误";
    if (r.code) return "[" + r.code + "] " + (r.message || "");
    return r.message || "请求失败";
  }

  Skills.edit = {
    mount: function (panel) {
      var UI = window.UI;
      const API = window.HTWApi;
      UI.clear(panel);

      async function readFiles(wrap) {
        const arr = [];
        const list = wrap.input.files;
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          const buf = await f.arrayBuffer();
          arr.push({ name: f.name, buffer: buf });
        }
        return arr;
      }

      async function pollEdit(taskId) {
        return API.pollTask(taskId, {
          interval: 3000,
          timeout: 600000,
          fetcher: async function (id) {
            const r = await API.call("GET", "/api/v2/edit/status/" + encodeURIComponent(id));
            if (!r.ok) return r;
            const d = r.data || {};
            if (d.status === "completed") return { ok: true, data: { status: "done", result: d } };
            if (d.status === "failed" || d.error) return { ok: true, data: { status: "failed", errCode: d.error || "EDIT_FAILED", errMsg: d.error || "处理失败" } };
            return { ok: true, data: { status: "processing", progress: d.progress } };
          },
        });
      }

      function field(labelText, input) {
        return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
      }
      function section(title, bodyNodes, actionNode, region, icon) {
        const head = icon ? UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]) : UI.el("h3", { text: title });
        const kids = [head].concat(bodyNodes);
        kids.push(UI.el("div", { class: "row" }, [actionNode]));
        kids.push(region);
        return UI.el("div", { class: "card" }, kids);
      }

      const coarseFile = UI.fileInput({ label: "选择视频", accept: "video/*" });
      const coarseVoice = UI.el("input", { type: "text", placeholder: "配音文案（可选）" });
      const coarseMin = UI.el("input", { type: "number", value: "30", placeholder: "最短秒数" });
      const coarseMax = UI.el("input", { type: "number", value: "60", placeholder: "最长秒数" });
      const coarseBlur = UI.el("input", { type: "checkbox" });
      const coarseRegion = UI.el("div");
      const coarseBtn = UI.el("button", { class: "btn", text: "粗剪" });
      const coarseCard = section("粗剪 Coarse-cut", [coarseFile, field("配音", coarseVoice), field("最短秒", coarseMin), field("最长秒", coarseMax), field("模糊处理", coarseBlur)], coarseBtn, coarseRegion, "fa-scissors");

      const draftFile = UI.fileInput({ label: "选择 CapCut 草稿 ZIP", accept: ".zip" });
      const draftRegion = UI.el("div");
      const draftBtn = UI.el("button", { class: "btn", text: "导出草稿" });
      const draftCard = section("草稿导出 Draft-export", [draftFile], draftBtn, draftRegion, "fa-file-zipper");

      const srFile = UI.fileInput({ label: "选择视频", accept: "video/*" });
      const srW = UI.el("input", { type: "number", value: "1920", placeholder: "宽" });
      const srH = UI.el("input", { type: "number", value: "1080", placeholder: "高" });
      const srRegion = UI.el("div");
      const srBtn = UI.el("button", { class: "btn", text: "超分" });
      const srCard = section("超分 Super-res", [srFile, field("宽", srW), field("高", srH)], srBtn, srRegion, "fa-expand");

      const decFile = UI.fileInput({ label: "选择 .json 草稿", accept: ".json" });
      const decRegion = UI.el("div");
      const decBtn = UI.el("button", { class: "btn", text: "解密" });
      const decCard = section("解密 Decrypt", [decFile], decBtn, decRegion, "fa-lock-open");

      UI.mount(panel, UI.el("div", {}, [
        UI.el("h2", { text: "剪辑 Edit" }),
        coarseCard, draftCard, srCard, decCard,
      ]));

      coarseBtn.addEventListener("click", function () {
        UI.withLoading(coarseBtn, async function () {
          try {
            const files = await readFiles(coarseFile);
            if (!files.length) { UI.showError(coarseRegion, "请选择视频文件"); return; }
            const up = await API.upload("POST", "/api/v2/edit/coarse-cut", files, {
              voice: coarseVoice.value,
              durationMin: coarseMin.value,
              durationMax: coarseMax.value,
              blur: coarseBlur.checked ? "1" : "0",
            }, null, "video");
            if (!up.ok) { UI.showError(coarseRegion, formatErr(up)); return; }
            const taskId = up.taskId || (up.data && up.data.taskId);
            if (!taskId) { UI.showError(coarseRegion, "未返回 taskId: " + JSON.stringify(up.data)); return; }
            UI.showResult(coarseRegion, { message: "已提交，taskId=" + taskId + "，处理中…" });
            const res = await pollEdit(taskId);
            if (!res.ok) { UI.showError(coarseRegion, formatErr(res)); return; }
            UI.showResult(coarseRegion, res.data);
          } catch (e) {
            UI.showError(coarseRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      draftBtn.addEventListener("click", function () {
        UI.withLoading(draftBtn, async function () {
          try {
            const files = await readFiles(draftFile);
            if (!files.length) { UI.showError(draftRegion, "请选择 ZIP 文件"); return; }
            const up = await API.upload("POST", "/api/v2/edit/draft-export", files, {});
            if (!up.ok) { UI.showError(draftRegion, formatErr(up)); return; }
            const taskId = up.taskId || (up.data && up.data.taskId);
            if (!taskId) { UI.showError(draftRegion, "未返回 taskId: " + JSON.stringify(up.data)); return; }
            UI.showResult(draftRegion, { message: "已提交，taskId=" + taskId + "，处理中…", warnings: up.data.warnings });
            const res = await pollEdit(taskId);
            if (!res.ok) { UI.showError(draftRegion, formatErr(res)); return; }
            UI.showResult(draftRegion, res.data);
          } catch (e) {
            UI.showError(draftRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      srBtn.addEventListener("click", function () {
        UI.withLoading(srBtn, async function () {
          try {
            const files = await readFiles(srFile);
            if (!files.length) { UI.showError(srRegion, "请选择视频文件"); return; }
            const up = await API.upload("POST", "/api/v2/edit/super-res", files, { width: srW.value, height: srH.value }, null, "video");
            if (!up.ok) { UI.showError(srRegion, formatErr(up)); return; }
            const taskId = up.taskId || (up.data && up.data.taskId);
            if (!taskId) { UI.showError(srRegion, "未返回 taskId: " + JSON.stringify(up.data)); return; }
            UI.showResult(srRegion, { message: "已提交，taskId=" + taskId + "，处理中…" });
            const res = await pollEdit(taskId);
            if (!res.ok) { UI.showError(srRegion, formatErr(res)); return; }
            UI.showResult(srRegion, res.data);
          } catch (e) {
            UI.showError(srRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });

      decBtn.addEventListener("click", function () {
        UI.withLoading(decBtn, async function () {
          try {
            const files = await readFiles(decFile);
            if (!files.length) { UI.showError(decRegion, "请选择 .json 文件"); return; }
            const up = await API.upload("POST", "/api/v2/edit/decrypt", files, {});
            if (!up.ok) { UI.showError(decRegion, formatErr(up)); return; }
            UI.showResult(decRegion, up.data);
          } catch (e) {
            UI.showError(decRegion, "请求异常: " + (e && e.message ? e.message : String(e)));
          }
        });
      });
    },
  };
})();
