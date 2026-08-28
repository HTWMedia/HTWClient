'use strict';

const api = window.HTWApi;
const UI = window.UI;
const Skills = (window.Skills = window.Skills || {});

function formatErr(r) {
  if (!r) return "未知错误";
  if (r.errCode) return "[" + r.errCode + "] " + (r.errMsg || "");
  return r.errMsg || r.message || "请求失败";
}

function tryParse(s) {
  try { return typeof s === "string" ? JSON.parse(s) : s; } catch (e) { return null; }
}

function pick(o, a, b) { return o == null ? undefined : (o[a] !== undefined ? o[a] : o[b]); }

// 从 status / artifact 中找出成片视频 URL（兼容多种字段名与大小写）
function findVideoUrl(d) {
  const keys = ["videoUrl", "VideoUrl", "url", "Url", "mediaFile", "MediaFile", "resultUrl", "ResultUrl", "downloadUrl", "DownloadUrl", "resultPath", "ResultPath", "video", "Video", "mp4", "Mp4"];
  const out = [];
  const artRaw = d && (d.Artifact !== undefined ? d.Artifact : d.artifact);
  const art = artRaw ? tryParse(artRaw) : null;
  if (art) keys.forEach(k => { if (art[k]) out.push(art[k]); });
  if (d) keys.forEach(k => { if (d[k]) out.push(d[k]); });
  return out[0] || null;
}

Skills.marketing = {
  mount: function (root) {
    UI.clear(root);
    let sessionId = null;
    let polling = false;

    function field(labelText, input) {
      return UI.el("div", { class: "field" }, [UI.el("label", { text: labelText }), input]);
    }
    function section(title, bodyNodes, actionNode, regionNode, icon) {
      const head = UI.el("h3", {}, [UI.el("i", { class: "fa-solid " + icon }), " " + title]);
      return UI.el("div", { class: "card" }, [head].concat(bodyNodes).concat([UI.el("div", { class: "row" }, [actionNode]), regionNode]));
    }
    function stepChk(id, label, on) {
      return UI.el("label", { class: "stepchk" }, [
        UI.el("input", { type: "checkbox", "data-step": id, checked: on }),
        UI.el("span", { text: label }),
      ]);
    }

    const productName = UI.el("input", { type: "text", id: "mv-product-name", placeholder: "商品名称（必填）" });
    const sellPoints = UI.el("textarea", { placeholder: "卖点，每行一条（可选）" });
    const files = UI.fileInput({ label: "商品素材（图片/视频，≤20MB）", accept: "image/*,video/*", multiple: true });
    files.input.id = "mv-files";
    const copyText = UI.el("textarea", { placeholder: "文案（可选，留空由 AI 生成脚本）" });
    const discount = UI.el("input", { type: "text", placeholder: "优惠活动，如 买二送一（可选）" });
    const audience = UI.el("input", { type: "text", placeholder: "适用人群，逗号分隔，如 学生,上班族（可选）" });
    const genSellBtn = UI.el("button", { class: "btn", id: "mv-gen-sell", text: "生成卖点" });
    const genCopyBtn = UI.el("button", { class: "btn", id: "mv-gen-copy", text: "生成营销文案" });
    const seedanceClips = UI.el("input", { type: "number", value: "2", min: "0", max: "6" });
    const overlay = UI.el("input", { type: "checkbox", checked: true });
    const videoType = UI.el("select", {}, [UI.el("option", { value: "", text: "默认(kol)" })]);
    const stepResearch = stepChk("research", "调研", false);
    const stepKeypoint = stepChk("keypoint", "关键点提取", false);
    const stepMaterial = stepChk("material", "素材搜索", false);
    const stepPublish = stepChk("publish", "自动发布", false);
    const startBtn = UI.el("button", { class: "btn primary", id: "mv-start", text: "生成成片" });
    const region = UI.el("div", { id: "mv-progress" });

    UI.mount(root, UI.el("div", {}, [
      UI.el("h2", { text: "营销成片 MarketVideo" }),
      section("素材与商品", [
        field("商品名称", productName),
        field("卖点", sellPoints),
        files,
        field("文案", copyText),
        field("优惠活动", discount),
        field("适用人群", audience),
        UI.el("div", { class: "row" }, [genSellBtn, genCopyBtn, UI.el("span", { class: "muted", text: "（调用服务端 market-video V2 接口）" })]),
        field("Seedance 钩子镜头数", seedanceClips),
        field("营销浮层", overlay),
        field("视频类型", videoType),
        UI.el("div", { class: "steprow" }, [stepResearch, stepKeypoint, stepMaterial, stepPublish]),
      ], startBtn, region, "fa-bag-shopping"),
    ]));

    // 加载视频类型下拉
    api.get("/api/v2/creation/types").then(r => {
      const types = (r && r.data) || [];
      types.forEach(t => videoType.appendChild(UI.el("option", { value: t.id, text: t.name || t.id })));
    }).catch(() => { /* 忽略，保留默认 */ });

    function buildSteps() {
      const set = [];
      [["research", stepResearch], ["keypoint", stepKeypoint], ["material", stepMaterial], ["publish", stepPublish]].forEach(([id, el]) => {
        const cb = el.querySelector("input");
        if (cb && cb.checked) set.push(id);
      });
      return set;
    }

    function render(d) {
      const status = pick(d, "Status", "status");
      const label = pick(d, "CurrentStepLabel", "currentStepLabel");
      const logs = pick(d, "ProgressLogs", "progressLogs");
      let html = "";
      if (label) html += `<div class="detail-step">${UI.esc(label)} <span class="badge ${UI.esc(status)}">${UI.esc(status)}</span></div>`;
      if (logs && logs.length) html += '<div class="progresslog">' + logs.map(l => `<div>${UI.esc(l)}</div>`).join("") + "</div>";
      region.innerHTML = html;
      UI.showResult(region, d);
      const vurl = findVideoUrl(d);
      if (vurl) {
        let src;
        if (/^https?:\/\//.test(vurl)) src = "/api/v2/creation/proxy-media?url=" + encodeURIComponent(vurl);
        else if (vurl.charAt(0) === "/") src = vurl;
        else src = "/api/v2/creation/media-file?sessionId=" + encodeURIComponent(sessionId) + "&fileName=" + encodeURIComponent(vurl);
        region.insertAdjacentHTML("beforeend", `<div class="field inline uprow"><video src="${UI.esc(src)}" controls style="max-width:100%"></video> <a class="btn" href="${UI.esc(src)}" download>下载成片</a></div>`);
      }
      const artRaw = d && (d.Artifact !== undefined ? d.Artifact : d.artifact);
      const art = artRaw ? tryParse(artRaw) : null;
      if (art && art.type === "video_script" && art.scriptText) {
        region.insertAdjacentHTML("beforeend", `<div class="scriptbox"><pre>${UI.esc(art.scriptText)}</pre></div>`);
      }
    }

    function renderActions() {
      const bar = UI.el("div", { class: "detail-actions" }, [
        UI.el("button", { class: "btn primary", text: "确认" }),
        UI.el("button", { class: "btn", text: "重新生成" }),
        UI.el("button", { class: "btn", text: "精修" }),
      ]);
      region.appendChild(bar);
      bar.children[0].addEventListener("click", () => act("approve"));
      bar.children[1].addEventListener("click", () => { const ins = prompt("重新生成指令（可留空）"); act("regenerate", ins); });
      bar.children[2].addEventListener("click", () => { const msg = prompt("精修意见"); if (msg) act("refine", msg); });
    }

    function act(kind, instruction) {
      const body = { sessionId: sessionId, type: "video" };
      if (kind === "regenerate") body.instruction = instruction || "";
      if (kind === "refine") body.message = instruction || "";
      const url = kind === "approve" ? "/api/v2/creation/approve" : (kind === "regenerate" ? "/api/v2/creation/regenerate" : "/api/v2/creation/refine");
      region.insertAdjacentHTML("beforeend", '<div class="progresslog"><div>处理中…</div></div>');
      api.post(url, body).then(() => { polling = true; poll(); }).catch(e => UI.showError(region, "操作失败：" + (e && e.message ? e.message : e)));
    }

    function poll() {
      if (!polling || !sessionId) return;
      api.get(`/api/v2/creation/status?sessionId=${encodeURIComponent(sessionId)}&type=video`).then(r => {
        const d = r && r.data;
        if (!d) return;
        render(d);
        const status = pick(d, "Status", "status");
        const stepId = pick(d, "CurrentStepId", "currentStepId");
        if (polling && status === "running") {
          setTimeout(poll, 2000);
        } else if (status === "waiting_approval") {
          // 脚本步骤交给用户确认/重新生成/精修；其余中间步骤（配音、画面、音乐、模板、合成）自动确认，直达成片
          if (stepId === "script") {
            polling = false; renderActions();
          } else {
            api.post("/api/v2/creation/approve", { sessionId: sessionId, type: "video" })
              .then(() => { polling = true; poll(); })
              .catch(e => { polling = false; UI.showError(region, "确认失败：" + (e && e.message ? e.message : e)); });
          }
        } else {
          polling = false;
        }
      }).catch(e => { polling = false; UI.showError(region, "状态错误：" + (e && e.message ? e.message : e)); });
    }

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

    startBtn.addEventListener("click", function () {
      const name = productName.value.trim();
      if (!name) { UI.showError(region, "请输入商品名称"); return; }
      const list = files.input.files || [];
      let imgCount = 0, vidCount = 0;
      for (let i = 0; i < list.length; i++) {
        const t = list[i].type || "";
        if (t.startsWith("video/")) vidCount++;
        else imgCount++;
      }
      if (imgCount < 5 && vidCount < 1) {
        UI.showError(region, "营销成片需要至少 5 张参考图，或 1 个参考视频（当前图片 " + imgCount + " 张 / 视频 " + vidCount + " 个）");
        return;
      }
      UI.withLoading(startBtn, async function () {
        try {
          const topic = [name, sellPoints.value.trim(), copyText.value.trim()].filter(Boolean).join("\n");
          const body = {
            type: "video",
            topic: topic,
            optionalSteps: buildSteps(),
            videoTypeId: videoType.value || "kol",
            enableSeedance: true,
            seedanceMaxClips: parseInt(seedanceClips.value, 10) || 2,
            enableMarketingOverlay: overlay.checked,
            marketingCtaText: discount.value.trim(),
            marketingHeroText: audience.value.trim(),
            productImageUrls: [],
            userMaterialIds: [],
          };
          const up = await api.post("/api/v2/creation/start", body);
          if (!up.ok) { UI.showError(region, formatErr(up)); return; }
          sessionId = up.data && up.data.sessionId;
          if (!sessionId) { UI.showError(region, "未返回 sessionId: " + JSON.stringify(up.data)); return; }
          const filesList = await readFiles(files);
          for (const f of filesList) {
            await api.upload("POST", "/api/v2/creation/upload-material?sessionId=" + encodeURIComponent(sessionId), [f], {}, null, "auto");
          }
          polling = true;
          poll();
        } catch (e) {
          UI.showError(region, "请求异常: " + (e && e.message ? e.message : e));
        }
      });
    });

    genSellBtn.addEventListener("click", function () {
      const name = productName.value.trim();
      if (!name) { UI.showError(region, "请先填写商品名称"); return; }
      UI.withLoading(genSellBtn, async function () {
        try {
          const r = await api.post("/api/v2/market-video/product-info", { text: name });
          if (!r.ok) { UI.showError(region, "生成卖点失败：" + formatErr(r)); return; }
          const d = r.data || {};
          if (d.productName) productName.value = d.productName;
          if (d.sellPoints && d.sellPoints.length) sellPoints.value = d.sellPoints.join("\n");
        } catch (e) {
          UI.showError(region, "生成卖点异常：" + (e && e.message ? e.message : e));
        }
      });
    });

    genCopyBtn.addEventListener("click", function () {
      const name = productName.value.trim();
      if (!name) { UI.showError(region, "请先填写商品名称"); return; }
      UI.withLoading(genCopyBtn, async function () {
        try {
          const r = await api.post("/api/v2/market-video/generate-script", {
            productName: name,
            sellPoints: sellPoints.value.trim(),
            ratio: "16:9",
            duration: "15-30",
            discountActivity: discount.value.trim(),
            audienceTypes: audience.value.trim(),
          });
          if (!r.ok) { UI.showError(region, "生成文案失败：" + formatErr(r)); return; }
          const d = r.data || {};
          if (d.script) copyText.value = d.script;
        } catch (e) {
          UI.showError(region, "生成文案异常：" + (e && e.message ? e.message : e));
        }
      });
    });
  },
};
