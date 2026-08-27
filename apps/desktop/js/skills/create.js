'use strict';

const api = window.HTWApi;
const UI = window.UI;
const Skills = (window.Skills = window.Skills || {});

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
    ['research','keypoint','material','publish'].forEach(k => { if (state.steps[k]) set.push(k); });
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
    card.querySelector('#cstatus').textContent = '进行中';
    poll(tab, state, root);
  }).catch(e => {
    card.querySelector('#cstatus').textContent = '启动失败：' + (e.message || e);
  });
}

function poll(tab, state, root) {
  if (!state.polling || !state.sessionId) return;
  api.get(`/api/v2/creation/status?sessionId=${encodeURIComponent(state.sessionId)}&type=${tab}`).then(r => {
    renderDetail(tab, state, root, r.data);
    if (state.polling && r.data && r.data.status === 'running') {
      setTimeout(() => poll(tab, state, root), 2000);
    } else if (r.data && r.data.status === 'waiting_approval') {
      state.polling = false;
    } else {
      state.polling = false;
      const card = root.querySelector('#creation-input-card');
      if (card && card.querySelector('#cstatus')) card.querySelector('#cstatus').textContent = (r.data && r.data.status === 'completed') ? '已完成' : (r.data ? r.data.status : '');
    }
  }).catch(e => {
    state.polling = false;
    const card = root.querySelector('#creation-input-card');
    if (card && card.querySelector('#cstatus')) card.querySelector('#cstatus').textContent = '状态错误：' + (e.message || e);
  });
}

function renderDetail(tab, state, root, data) {
  const det = root.querySelector('#creation-detail');
  if (!det || !data) return;
  let html = '';
  const label = data.currentStepLabel || data.currentStepId || '';
  html += `<div class="detail-head"><div class="detail-step">${UI.esc(label || '创作')} <span class="badge ${UI.esc(data.status)}">${UI.esc(data.status)}</span></div></div>`;

  if (data.progressLogs && data.progressLogs.length) {
    html += '<div class="progresslog">' + data.progressLogs.map(l => `<div>${UI.esc(l)}</div>`).join('') + '</div>';
  }

  det.innerHTML = html;

  UI.showResult(det, data);

  if (data.artifact) {
    try {
      const art = typeof data.artifact === 'string' ? JSON.parse(data.artifact) : data.artifact;
      if (art && art.type === 'video_script' && art.scriptText) {
        det.insertAdjacentHTML('beforeend', `<div class="scriptbox"><pre>${UI.esc(art.scriptText)}</pre></div>`);
      }
    } catch (e) {}
  }

  if (tab === 'video') {
    det.insertAdjacentHTML('beforeend', `<div class="field inline uprow"><span class="muted">上传素材（图片/视频，≤20MB）：</span><input type="file" id="cmaterial" multiple accept="image/*,video/*"></div>`);
    const up = det.querySelector('#cmaterial');
    if (up) up.addEventListener('change', () => uploadMaterial(state, up, root));
  }

  if (data.status === 'waiting_approval') {
    const bar = document.createElement('div');
    bar.className = 'detail-actions';
    bar.innerHTML = `<button class="btn primary" id="capprove">确认</button><button class="btn" id="cregen">重新生成</button><button class="btn" id="crefine">精修</button>`;
    det.appendChild(bar);
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
}

function uploadMaterial(state, input, root) {
  const files = input.files;
  if (!files || !files.length) return;
  if (!state.sessionId) { alert('请先开始创作'); return; }
  input.disabled = true;
  let pending = files.length;
  Array.from(files).forEach(f => {
    api.upload(`/api/v2/creation/upload-material?sessionId=${encodeURIComponent(state.sessionId)}`, f).then(() => {
      pending--;
      if (pending === 0) { input.disabled = false; input.value = ''; }
    }).catch(e => {
      pending--;
      alert('上传失败：' + (e.message || e));
      if (pending === 0) { input.disabled = false; input.value = ''; }
    });
  });
}

function act(tab, state, root, kind, instruction) {
  const det = root.querySelector('#creation-detail');
  const body = { sessionId: state.sessionId, type: tab };
  if (kind === 'regenerate') body.instruction = instruction || '';
  if (kind === 'refine') body.message = instruction || '';
  const url = kind === 'approve' ? '/api/v2/creation/approve' : (kind === 'regenerate' ? '/api/v2/creation/regenerate' : '/api/v2/creation/refine');
  if (det) det.insertAdjacentHTML('beforeend', '<div class="progresslog"><div>处理中…</div></div>');
  api.post(url, body).then(() => {
    state.polling = true;
    const card = root.querySelector('#creation-input-card');
    if (card && card.querySelector('#cstatus')) card.querySelector('#cstatus').textContent = '进行中';
    poll(tab, state, root);
  }).catch(e => {
    if (det) det.insertAdjacentHTML('beforeend', `<div class="progresslog"><div>操作失败：${UI.esc(e.message || e)}</div></div>`);
  });
}

Skills.create = { mount: function (root) {
  const states = {
    video: { sessionId: null, topic: '', refurls: '', vtype: null, steps: { research: false, keypoint: true, material: false, publish: false }, polling: false },
    image: { sessionId: null, topic: '', steps: { optimize: true }, polling: false },
    article: { sessionId: null, topic: '', steps: { optimize: true }, polling: false }
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
      current = tab;
      root.querySelector('#creation-detail').innerHTML = '';
      renderInputCard(tab, states[tab], root);
    });
  });

  renderInputCard(current, states[current], root);
} };
