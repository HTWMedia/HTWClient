'use strict';

var api = window.HTWApi;
var UI = window.UI;
var Skills = (window.Skills = window.Skills || {});

let recommendationsCache = null;

function loadRecommendations() {
  if (recommendationsCache) return Promise.resolve(recommendationsCache);
  return api.get('/api/v2/creation/recommendations').then(r => {
    recommendationsCache = r.data || {};
    return recommendationsCache;
  }).catch(() => ({ video: [], image: [], article: [], news: null }));
}

function loadVideoTypes() {
  return api.get('/api/v2/creation/types').then(r => r.data || []).catch(() => []);
}

function recSection(tab) {
  return loadRecommendations().then(rec => {
    const ideas = rec[tab] || [];
    const news = rec.news || [];
    let html = '';
    if (news.length) {
      html += '<div class="recgroup"><div class="recgroup-title">实时热点</div><div class="idearow">';
      news.forEach(t => {
        html += `<div class="ideacard news" data-topic="${UI.esc(t)}"><div class="ideacard-title">${UI.esc(t)}</div></div>`;
      });
      html += '</div></div>';
    }
    if (ideas.length) {
      html += '<div class="recgroup"><div class="recgroup-title">创作建议</div><div class="idearow">';
      ideas.forEach(it => {
        const title = it.title || '';
        const desc = it.desc || it.description || '';
        html += `<div class="ideacard" data-topic="${UI.esc(title)}"><div class="ideacard-title">${UI.esc(title)}</div>${desc ? `<div class="ideacard-desc">${UI.esc(desc)}</div>` : ''}</div>`;
      });
      html += '</div></div>';
    }
    return html;
  });
}

function stepToggle(tab, id, label, on) {
  return `<label class="stepchk"><input type="checkbox" data-step="${id}" ${on ? 'checked' : ''}><span>${UI.esc(label)}</span></label>`;
}

function renderInputCard(tab, state, root) {
  const card = root.querySelector('#creation-input-card');
  let inner = '';
  inner += `<div class="field"><textarea id="ctopic" class="ta" rows="3" placeholder="输入创作主题 / 创意描述…">${UI.esc(state.topic)}</textarea></div>`;

  if (tab === 'video') {
    inner += `<div class="field"><div class="field-label">视频类型</div><div class="vtyperow" id="vtyperow"><span class="muted">加载中…</span></div></div>`;
    inner += `<div class="field"><div class="field-label">参考视频链接（每行一个）</div><textarea id="cref" class="ta" rows="2" placeholder="https://...">${UI.esc(state.refurls)}</textarea></div>`;
    inner += `<div class="field"><div class="field-label">可选步骤</div><div class="steprow">${stepToggle('video','research','调研',state.steps.research)}${stepToggle('video','keypoint','关键点提取',state.steps.keypoint)}${stepToggle('video','material','素材搜索',state.steps.material)}${stepToggle('video','publish','自动发布',state.steps.publish)}</div></div>`;
  } else {
    inner += `<div class="field"><div class="field-label">可选步骤</div><div class="steprow">${stepToggle(tab,'optimize','优化精修',state.steps.optimize)}</div></div>`;
  }

  inner += `<div class="field"><div class="recbox" id="crecbox"><span class="muted">加载创作建议…</span></div></div>`;
  inner += `<div class="field inline"><button class="btn primary" id="cstart">开始创作</button><span class="muted" id="cstatus"></span></div>`;

  card.innerHTML = inner;

  recSection(tab).then(html => {
    const box = card.querySelector('#crecbox');
    if (box) box.innerHTML = html || '<span class="muted">暂无建议</span>';
    box.querySelectorAll('.ideacard').forEach(el => {
      el.addEventListener('click', () => {
        const t = el.getAttribute('data-topic');
        const ta = card.querySelector('#ctopic');
        if (ta && t) ta.value = t;
      });
    });
  });

  if (tab === 'video') {
    loadVideoTypes().then(types => {
      const row = card.querySelector('#vtyperow');
      if (!row) return;
      if (!types.length) { row.innerHTML = '<span class="muted">无</span>'; return; }
      row.innerHTML = types.map(t =>
        `<div class="vtypecard ${state.vtype === t.id ? 'sel' : ''}" data-id="${UI.esc(t.id)}"><div class="vtypecard-name">${UI.esc(t.name)}</div>${t.description ? `<div class="vtypecard-desc">${UI.esc(t.description)}</div>` : ''}</div>`
      ).join('');
      row.querySelectorAll('.vtypecard').forEach(el => {
        el.addEventListener('click', () => {
          state.vtype = el.getAttribute('data-id');
          row.querySelectorAll('.vtypecard').forEach(x => x.classList.remove('sel'));
          el.classList.add('sel');
        });
      });
    });
  }

  card.querySelector('#cstart').addEventListener('click', () => startCreation(tab, state, root));
}

function buildSteps(tab, state) {
  const set = [];
  if (tab === 'video') {
    // 关键点提取要吃调研结果：只勾它、不勾调研的话，后端会因为拿不到调研内容直接失败。
    // 所以只要勾了 keypoint，就自动把 research 一起带上。
    if (state.steps.research || state.steps.keypoint) set.push('research');
    ['keypoint', 'material', 'publish'].forEach(k => { if (state.steps[k]) set.push(k); });
  } else {
    if (state.steps.optimize) set.push('optimize');
  }
  return set;
}

function startCreation(tab, state, root) {
  const card = root.querySelector('#creation-input-card');
  const topic = (card.querySelector('#ctopic').value || '').trim();
  if (!topic) { card.querySelector('#cstatus').textContent = '请输入主题'; return; }

  card.querySelectorAll('.stepchk input').forEach(c => { state.steps[c.getAttribute('data-step')] = c.checked; });
  state.topic = topic;
  state.refurls = (card.querySelector('#cref') ? card.querySelector('#cref').value : '').trim();
  card.querySelector('#cstatus').textContent = '启动中…';

  const body = { type: tab, topic: topic, optionalSteps: buildSteps(tab, state) };
  if (tab === 'video') {
    body.referenceVideoUrls = state.refurls ? state.refurls.split('\n').map(s => s.trim()).filter(Boolean) : [];
    if (state.vtype) body.videoTypeId = state.vtype;
  }

  api.post('/api/v2/creation/start', body).then(r => {
    const id = r.data && r.data.sessionId;
    if (!id) { card.querySelector('#cstatus').textContent = '未返回会话'; return; }
    state.sessionId = id;
    state.polling = true;
    state.lastSig = null;
    card.querySelector('#cstatus').textContent = '进行中';
    poll(tab, state, root);
  }).catch(e => {
    card.querySelector('#cstatus').textContent = '启动失败：' + (e.message || e);
  });
}

function poll(tab, state, root) {
  // acting 期间（approve / regenerate / refine 的请求还在路上）也要继续轮询：
  // 服务端这一步往往要几十秒，期间会持续写进度日志，不轮询的话界面就是死的。
  if ((!state.polling && !state.acting) || !state.sessionId) return;
  api.get(`/api/v2/creation/status?sessionId=${encodeURIComponent(state.sessionId)}&type=${tab}`).then(r => {
    if (!state.polling && !state.acting) return;
    const data = r.data || {};
    renderDetail(tab, state, root, data);
    const status = data.status || '';
    if (status === 'running' || status === 'pending') {
      setTimeout(() => poll(tab, state, root), 2000);
      return;
    }
    if (state.acting) { setTimeout(() => poll(tab, state, root), 2000); return; }
    // waiting_approval 停在等待确认，其余状态（completed / failed / …）都结束轮询。
    state.polling = false;
    const card = root.querySelector('#creation-input-card');
    if (card && card.querySelector('#cstatus')) {
      const map = { completed: '已完成', failed: '失败', waiting_approval: '等待确认' };
      card.querySelector('#cstatus').textContent = map[status] || status;
    }
  }).catch(e => {
    state.polling = false;
    const card = root.querySelector('#creation-input-card');
    if (card && card.querySelector('#cstatus')) card.querySelector('#cstatus').textContent = '状态错误：' + (e.message || e);
  });
}

// 产物是后端 POCO 直出的英文键（Theme / ScriptText / CharacterDescription…），
// 直接铺给用户不合适：长文整段展示，短字段译成业务语言。
const ART_TEXT_FIELDS = ['RawResearch', 'ScriptText', 'Outline', 'Content', 'Text', 'Narration'];
const ART_LABEL = {
  Theme: '主题', Title: '标题', ScriptText: '脚本正文', RawResearch: '调研报告',
  CharacterDescription: '人物设定', Outline: '大纲', Keywords: '关键词', Tags: '标签',
  Narration: '旁白', Description: '说明', Summary: '摘要', Duration: '时长',
};

function renderArtifact(region, art) {
  const list = document.createElement('div');
  list.className = 'kv-list';
  Object.keys(art).forEach(k => {
    const v = art[k];
    if (v == null || v === '') return;
    if (ART_TEXT_FIELDS.indexOf(k) >= 0 && typeof v === 'string') {
      const text = UI.cleanText ? UI.cleanText(v) : v;
      const cap = document.createElement('div');
      cap.className = 'kv-key';
      cap.textContent = ART_LABEL[k] || k;
      const box = document.createElement('div');
      box.className = 'scriptbox';
      // 正文第一行常常已经是同名标题（"调研报告：xxx"），再压一个标题就重复了。
      const firstLine = text.trim().split('\n')[0] || '';
      if (firstLine.indexOf(ART_LABEL[k] || k) < 0) box.appendChild(cap);
      const pre = document.createElement('pre');
      pre.textContent = text;
      box.appendChild(pre);
      region.appendChild(box);
      return;
    }
    const row = document.createElement('div');
    row.className = 'kv';
    const key = document.createElement('span');
    key.className = 'kv-key';
    key.textContent = (ART_LABEL[k] || k) + '：';
    const val = document.createElement('span');
    val.className = 'kv-val';
    const raw = typeof v === 'object' ? JSON.stringify(v) : String(v);
    val.textContent = UI.cleanText ? UI.cleanText(raw) : raw;
    row.appendChild(key);
    row.appendChild(val);
    list.appendChild(row);
  });
  if (list.children.length) region.appendChild(list);
}

function renderDetail(tab, state, root, data) {
  const det = root.querySelector('#creation-detail');
  if (!det || !data) return;

  // 同一份状态不重复渲染：否则每 2 秒重建一次 <video>，成片会反复重载。
  const sig = (data.status || '') + ':' + (data.progressLogSeq || 0);
  if (state.lastSig === sig) return;
  state.lastSig = sig;

  UI.clear(det);

  const label = data.currentStepLabel || data.currentStepId || '';
  det.appendChild((function () {
    const head = document.createElement('div');
    head.className = 'detail-head';
    const step = document.createElement('div');
    step.className = 'detail-step';
    step.textContent = label || '创作';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (data.status || '');
    badge.textContent = data.status || '';
    step.appendChild(badge);
    if (data.currentSubTask) {
      const sub = document.createElement('span');
      sub.className = 'detail-sub';
      sub.textContent = ' · ' + data.currentSubTask;
      step.appendChild(sub);
    }
    head.appendChild(step);
    if (data.progressPercent != null) {
      const pct = document.createElement('div');
      pct.className = 'detail-progress';
      pct.textContent = '进度 ' + data.progressPercent + '%';
      head.appendChild(pct);
    }
    return head;
  })());

  // 进度日志放在独立的容器里：UI.showResult 会清空自己的容器，
  // 之前把日志写进 det 再 showResult(det)，日志会被立刻清掉。
  if (data.progressLogs && data.progressLogs.length) {
    const box = document.createElement('div');
    box.className = 'progresslog';
    data.progressLogs.forEach(l => {
      const line = document.createElement('div');
      line.textContent = l;
      box.appendChild(line);
    });
    det.appendChild(box);
  }

  // act() 插入的提示会被 UI.clear 清掉，这里每次重渲染时补回来。
  if (state.acting) {
    const acting = document.createElement('div');
    acting.className = 'progresslog';
    acting.textContent = '正在生成下一步，通常需要几十秒，请稍候…';
    det.appendChild(acting);
  }

  const resultRegion = document.createElement('div');
  resultRegion.className = 'creation-result';
  det.appendChild(resultRegion);

  var parsedArtifact = data.artifact;
  try { if (typeof parsedArtifact === "string") parsedArtifact = JSON.parse(parsedArtifact); } catch (e) { parsedArtifact = null; }
  var cloudUrl = parsedArtifact && typeof parsedArtifact === "object" ? parsedArtifact.CloudUrl : null;

  if (data.status === 'failed') {
    // 后端现在会落 Error/FailedStepId（首步是后台执行的，原因只在会话上），
    // 拿不到时再退回最后一条进度日志，至少让用户知道卡在哪一步。
    const reason = data.error || data.errMsg || '';
    const lastLog = (data.progressLogs && data.progressLogs.length)
      ? data.progressLogs[data.progressLogs.length - 1] : '';
    UI.showError(resultRegion,
      '「' + label + '」这一步失败了。' + (reason ? reason : (lastLog ? '最后进度：' + lastLog : '服务端没有返回具体原因。')));
  } else if (parsedArtifact && typeof parsedArtifact === 'object') {
    // 只呈现产物本身：把整个状态对象丢给 showResult 会把 Id / mediaToken 之类的内部字段铺满一屏。
    var artShow = parsedArtifact;
    if (cloudUrl) {
      try {
        artShow = JSON.parse(JSON.stringify(parsedArtifact));
        delete artShow.DownloadUrl;
        delete artShow.CloudUrl;
      } catch (e) { artShow = parsedArtifact; }
    }
    // 调研结果 / 脚本正文是一大段内容，整段呈现比铺成键值表可读得多。
    renderArtifact(resultRegion, artShow);
  } else if (parsedArtifact) {
    UI.showResult(resultRegion, parsedArtifact);
  }

  if (cloudUrl) {
    var vbox = document.createElement("div");
    vbox.className = "media-box";
    var vid = document.createElement("video");
    vid.className = "result-video"; vid.src = cloudUrl; vid.controls = true; vid.preload = "metadata";
    var dl = document.createElement("a");
    dl.className = "title-link"; dl.href = cloudUrl; dl.textContent = "下载视频（剪映 CDN 直链）"; dl.setAttribute("download", "");
    dl.addEventListener("click", function (e) { e.preventDefault(); if (window.htw && window.htw.openExternal) window.htw.openExternal(cloudUrl); else window.open(cloudUrl, "_blank"); });
    vbox.appendChild(vid); vbox.appendChild(dl);
    det.insertBefore(vbox, resultRegion);
  }

  if (parsedArtifact && parsedArtifact.type === 'video_script' && parsedArtifact.scriptText) {
    const script = document.createElement('div');
    script.className = 'scriptbox';
    const pre = document.createElement('pre');
    pre.textContent = parsedArtifact.scriptText;
    script.appendChild(pre);
    det.appendChild(script);
  }

  if (data.status === 'waiting_approval') {
    const bar = document.createElement('div');
    bar.className = 'detail-actions';
    bar.innerHTML = `<button class="btn primary" id="capprove">确认</button><button class="btn" id="cregen">重新生成</button><button class="btn" id="crefine">精修</button>`;
    det.appendChild(bar);
    // 上一步操作还在服务端跑时先锁住，避免用户连点把同一步提交多次。
    if (state.acting) {
      bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
    }
    bar.querySelector('#capprove').addEventListener('click', () => act(tab, state, root, 'approve'));
    bar.querySelector('#cregen').addEventListener('click', () => {
      const ins = prompt('重新生成指令（可留空）：');
      act(tab, state, root, 'regenerate', ins);
    });
    bar.querySelector('#crefine').addEventListener('click', () => {
      const msg = prompt('精修意见：');
      if (msg) act(tab, state, root, 'refine', msg);
    });
  }

  // 创作过程中也能加减后续步骤（/api/v2/creation/toggle-step）。
  // 以前勾选只在 start 那一刻生效，跑起来发现要补一步只能整单重开。
  if (data.status === 'waiting_approval' && tab === 'video' && state.sessionId) {
    const OPTS = [['research', '深度调研'], ['keypoint', '关键点提取'], ['material', '素材匹配'], ['publish', '发布']];
    const tuner = document.createElement('div');
    tuner.className = 'detail-steps';
    tuner.innerHTML = '<span class="muted">后续步骤：</span>' + OPTS.map(
      o => stepToggle(tab, o[0], o[1], !!state.steps[o[0]])
    ).join('');
    det.appendChild(tuner);

    tuner.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', async () => {
        const stepId = cb.getAttribute('data-step');
        // 与 start 时同一条依赖：关键点要吃调研结果，勾它就得带上调研
        if (stepId === 'keypoint' && cb.checked && !state.steps.research) {
          const rcb = tuner.querySelector('input[data-step="research"]');
          if (rcb) { rcb.checked = true; await toggleStep(state, tab, 'research', true, rcb, tuner); }
        }
        await toggleStep(state, tab, stepId, cb.checked, cb, tuner);
      });
    });
  }

  // 素材上传只挂一次，避免每次轮询都追加一个新的 file input。
  if (tab === 'video' && !det.querySelector('#cmaterial')) {
    const row = document.createElement('div');
    row.className = 'field inline uprow';
    row.innerHTML = `<span class="muted">上传素材（图片/视频，≤20MB）：</span><input type="file" id="cmaterial" multiple accept="image/*,video/*">`;
    det.appendChild(row);
    const up = row.querySelector('#cmaterial');
    if (up) up.addEventListener('change', () => uploadMaterial(state, up, row));
  }
}

// 开关一个可选步骤。失败要把勾选回滚，否则界面显示的和服务端实际会跑的对不上。
async function toggleStep(state, tab, stepId, enabled, cb, box) {
  state.steps[stepId] = enabled;
  cb.disabled = true;
  try {
    const r = await api.call('POST', '/api/v2/creation/toggle-step', {
      sessionId: state.sessionId, stepId: stepId, enabled: enabled, type: tab,
    });
    if (!r || !r.ok) {
      cb.checked = !enabled;
      state.steps[stepId] = !enabled;
      UI.showError(box, '步骤调整失败：' + ((r && r.message) || '未知错误'));
    }
  } catch (e) {
    cb.checked = !enabled;
    state.steps[stepId] = !enabled;
    UI.showError(box, '步骤调整失败：' + (e && e.message ? e.message : String(e)));
  } finally {
    cb.disabled = false;
  }
}

async function uploadMaterial(state, input, row) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  if (!state.sessionId) { alert('请先开始创作'); return; }
  input.disabled = true;
  const note = document.createElement('div');
  note.className = 'progresslog';
  row.appendChild(note);
  const say = (t) => { note.textContent = t; };

  let ok = 0, failed = 0, lastErr = '';
  for (const f of files) {
    say(`上传中 ${ok + failed + 1}/${files.length}：${f.name}`);
    try {
      const buffer = await f.arrayBuffer();
      await api.upload(
        'POST',
        `/api/v2/creation/upload-material?sessionId=${encodeURIComponent(state.sessionId)}`,
        [{ name: f.name, buffer: buffer }],
        {},
        null,
        'file'
      );
      ok++;
    } catch (e) {
      failed++;
      lastErr = e && e.message ? e.message : String(e);
    }
  }
  input.disabled = false;
  input.value = '';
  say(failed
    ? `上传完成 ${ok} 个，失败 ${failed} 个${lastErr ? '：' + lastErr : ''}`
    : `已上传 ${ok} 个素材，下一步生成时会用上。`);
}

function act(tab, state, root, kind, instruction) {
  const det = root.querySelector('#creation-detail');
  const body = { sessionId: state.sessionId, type: tab };
  if (kind === 'regenerate') body.instruction = instruction || '';
  if (kind === 'refine') body.message = instruction || '';
  const url = kind === 'approve' ? '/api/v2/creation/approve' : (kind === 'regenerate' ? '/api/v2/creation/regenerate' : '/api/v2/creation/refine');

  state.acting = true;
  const label = kind === 'approve' ? '正在生成下一步' : (kind === 'regenerate' ? '正在重新生成' : '正在精修');
  // 立刻锁住按钮：接下去几十秒里状态签名不变，renderDetail 会提前返回，不会重建按钮。
  const bar = det && det.querySelector('.detail-actions');
  if (bar) bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const pending = document.createElement('div');
  pending.className = 'progresslog';
  pending.textContent = label + '，通常需要几十秒，请稍候…';
  if (det) det.appendChild(pending);
  // 兜底：请求迟迟不返回时也要解锁，否则按钮会一直禁用。
  const guard = setTimeout(() => { state.acting = false; }, 180000);

  api.post(url, body).then(() => {
    clearTimeout(guard);
    state.acting = false;
    state.polling = true;
    state.lastSig = null;
    const card = root.querySelector('#creation-input-card');
    if (card && card.querySelector('#cstatus')) card.querySelector('#cstatus').textContent = '进行中';
    poll(tab, state, root);
  }).catch(e => {
    clearTimeout(guard);
    state.acting = false;
    if (det) det.insertAdjacentHTML('beforeend', `<div class="progresslog"><div>操作失败：${UI.esc(e.message || e)}</div></div>`);
  });
}

Skills.create = { mount: function (root) {
  const states = {
    video: { sessionId: null, topic: '', refurls: '', vtype: null, steps: { research: true, keypoint: false, material: false, publish: false }, polling: false, acting: false },
    image: { sessionId: null, topic: '', steps: { optimize: true }, polling: false, acting: false },
    article: { sessionId: null, topic: '', steps: { optimize: true }, polling: false, acting: false }
  };
  let current = 'video';

  root.innerHTML = `
    <div class="creation">
      <div class="tabbar" id="creation-tabs">
        <div class="tab active" data-tab="video">视频创作</div>
        <div class="tab" data-tab="image">图片创作</div>
        <div class="tab" data-tab="article">文章创作</div>
      </div>
      <div class="creation-body">
        <div class="creation-input-card" id="creation-input-card"></div>
        <div class="creation-detail" id="creation-detail"></div>
      </div>
    </div>`;

  const tabs = root.querySelector('#creation-tabs');
  tabs.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      const tab = t.getAttribute('data-tab');
      if (tab === current) return;
      tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      states[current].polling = false;
      states[current].acting = false;
      current = tab;
      states[tab].lastSig = null;
      root.querySelector('#creation-detail').innerHTML = '';
      renderInputCard(tab, states[tab], root);
    });
  });

  renderInputCard(current, states[current], root);
} };
