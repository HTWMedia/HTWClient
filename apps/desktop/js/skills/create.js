'use strict';

var api = window.HTWApi;
var UI = window.UI;
var Skills = (window.Skills = window.Skills || {});

// 推荐数据一天里会变，缓存不能永久有效；30 分钟内重复切页签不重复打接口。
const REC_TTL = 30 * 60 * 1000;
const MATERIAL_MAX = 20 * 1024 * 1024;

const STATUS_LABEL = {
  pending: '排队中', running: '进行中', waiting_approval: '等待确认',
  completed: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消',
};

// 三个页签的固定步骤表，与后端 Steps 保持一致（顺序即执行顺序）。
// 状态接口会带 currentStepLabel，但步骤条需要完整顺序，也要给旧会话兜底中文名。
const STEP_DEFS = {
  video: [
    { id: 'research', label: '调研', optional: true },
    { id: 'keypoint', label: '关键点提取', optional: true },
    { id: 'script', label: '脚本' },
    { id: 'voice', label: '配音' },
    { id: 'material', label: '素材搜索', optional: true },
    { id: 'visual', label: '画面生成' },
    { id: 'music', label: '音乐' },
    { id: 'template', label: '模板选择' },
    { id: 'compositor', label: '合成' },
    { id: 'publish', label: '发布', optional: true },
  ],
  image: [
    { id: 'concept', label: '创意构思' },
    { id: 'prompt', label: '画面描述' },
    { id: 'generate', label: '图片生成' },
    { id: 'optimize', label: '优化', optional: true },
  ],
  article: [
    { id: 'topic', label: '主题分析' },
    { id: 'outline', label: '大纲' },
    { id: 'content', label: '内容生成' },
    { id: 'optimize', label: '优化', optional: true },
  ],
};

let recommendationsCache = null;
let recommendationsAt = 0;
let videoTypesCache = null;

// 选题面板「去创作」通过 setTopic 把标题塞进主题框。
// mount 之后 setTopic 直接改当前 textarea；mount 之前先记下来，挂载时带进初始值。
let mountedRoot = null;
let pendingTopic = "";

// 三个页签共用右侧详情区：轮询回调必须知道"自己是不是当前页签"，
// 否则切走之后旧页签的响应会覆盖新页签的界面。
let activeTab = "video";
let renderSeq = 0;
let mountToken = 0;

function isStateLive(state) {
  return !!state && state.mountToken === mountToken;
}

function loadRecommendations() {
  if (recommendationsCache && Date.now() - recommendationsAt < REC_TTL) {
    return Promise.resolve(recommendationsCache);
  }
  return api.get('/api/v2/creation/recommendations').then(r => {
    // ok:false 时绝不能把空对象写进缓存 —— 否则一次网络抖动会让面板整个
    // 进程生命周期都显示「暂无建议」，重进页签也不会再请求。
    if (!r || !r.ok) throw new Error((r && r.message) || '加载失败');
    const data = r.data && typeof r.data === 'object' ? r.data : {};
    recommendationsCache = data;
    recommendationsAt = Date.now();
    return data;
  }).catch(() => recommendationsCache || { video: [], image: [], article: [], news: [] });
}

function loadVideoTypes() {
  if (videoTypesCache) return Promise.resolve(videoTypesCache);
  return api.get('/api/v2/creation/types').then(r => {
    if (!r || !r.ok) return [];
    const list = Array.isArray(r.data) ? r.data : [];
    // 空列表多半是服务端一时不可用，不缓存，下次切回来还能重试。
    if (list.length) videoTypesCache = list;
    return list;
  }).catch(() => []);
}

function recSection(tab, selected) {
  return loadRecommendations().then(rec => {
    const ideas = Array.isArray(rec[tab]) ? rec[tab] : [];
    let news = rec.news;
    if (typeof news === 'string') news = [news];
    if (!Array.isArray(news)) news = [];
    const sel = selected || '';
    let html = '';
    if (news.length) {
      html += '<div class="recgroup"><div class="recgroup-title">实时热点</div><div class="idearow">';
      news.forEach(t => {
        const title = typeof t === 'string' ? t : (t && (t.title || t.name)) || '';
        if (!title) return;
        html += `<div class="ideacard news${title === sel ? ' sel' : ''}" data-topic="${UI.esc(title)}"><div class="ideacard-title">${UI.esc(title)}</div></div>`;
      });
      html += '</div></div>';
    }
    if (ideas.length) {
      html += '<div class="recgroup"><div class="recgroup-title">创作建议</div><div class="idearow">';
      ideas.forEach(it => {
        const item = typeof it === 'string' ? { title: it } : (it || {});
        const title = item.title || '';
        const desc = item.desc || item.description || '';
        if (!title) return;
        html += `<div class="ideacard${title === sel ? ' sel' : ''}" data-topic="${UI.esc(title)}"><div class="ideacard-title">${UI.esc(title)}</div>${desc ? `<div class="ideacard-desc">${UI.esc(desc)}</div>` : ''}</div>`;
      });
      html += '</div></div>';
    }
    return html;
  });
}

function stepToggle(tab, id, label, on) {
  return `<label class="stepchk"><input type="checkbox" data-step="${id}" ${on ? 'checked' : ''}><span>${UI.esc(label)}</span></label>`;
}

function updateStartButton(card, state) {
  const btn = card && card.querySelector('#cstart');
  if (!btn) return;
  btn.disabled = !!(state.starting || state.polling || state.acting);
  btn.textContent = state.starting ? '启动中…' : (state.sessionId ? '开始新创作' : '开始创作');
}

function setStatus(tab, state, text, bad, root) {
  state.statusText = text || '';
  state.statusBad = !!bad;
  if (!isStateLive(state) || tab !== activeTab) return;
  const card = root && root.querySelector('#creation-input-card');
  if (!card) return;
  const el = card.querySelector('#cstatus');
  if (el) {
    el.textContent = state.statusText;
    if (bad) el.classList.add('bad'); else el.classList.remove('bad');
  }
  updateStartButton(card, state);
}

function renderInputCard(tab, state, root) {
  const card = root.querySelector('#creation-input-card');
  if (!card) return;
  // 异步回填（创作建议 / 视频类型）可能晚于一次页签切换才返回，
  // 用序号把它挡在"已经不是自己这一版卡片"的门外。
  const seq = ++renderSeq;
  let inner = '';
  inner += `<div class="field"><textarea id="ctopic" class="ta" rows="3" placeholder="输入创作主题 / 创意描述…">${UI.esc(state.topic)}</textarea></div>`;

  if (tab === 'video') {
    inner += `<div class="field"><div class="field-label">视频类型</div><div class="vtyperow" id="vtyperow"><span class="muted">加载中…</span></div></div>`;
    inner += `<div class="field"><div class="field-label">参考视频链接（每行一个）</div><textarea id="cref" class="ta" rows="2" placeholder="https://...">${UI.esc(state.refurls)}</textarea></div>`;
    inner += `<div class="field"><div class="field-label">可选步骤</div><div class="steprow">${stepToggle('video','research','调研',state.steps.research)}${stepToggle('video','keypoint','关键点提取',state.steps.keypoint)}${stepToggle('video','material','素材搜索',state.steps.material)}${stepToggle('video','publish','自动发布',state.steps.publish)}</div><div class="muted step-hint">关键点提取依赖调研结果，勾选时会自动带上「调研」。</div></div>`;
  } else {
    inner += `<div class="field"><div class="field-label">可选步骤</div><div class="steprow">${stepToggle(tab,'optimize','优化精修',state.steps.optimize)}</div></div>`;
  }

  inner += `<div class="field"><div class="recbox" id="crecbox"><span class="muted">加载创作建议…</span></div></div>`;
  inner += `<div class="field inline"><button class="btn primary" id="cstart">${state.sessionId ? '开始新创作' : '开始创作'}</button><span class="muted${state.statusBad ? ' bad' : ''}" id="cstatus">${UI.esc(state.statusText || '')}</span></div>`;

  card.innerHTML = inner;

  // 输入即写回 state：切换视频/图片/文章页签时 renderInputCard 用的是 state.topic，
  // 不写回的话刚填的主题会在切页签时凭空消失。
  const topicTa = card.querySelector('#ctopic');
  if (topicTa) {
    topicTa.addEventListener('input', () => {
      state.topic = topicTa.value;
      card.querySelectorAll('.ideacard.sel').forEach(el => {
        if (el.getAttribute('data-topic') !== topicTa.value) el.classList.remove('sel');
      });
    });
  }
  const refTa = card.querySelector('#cref');
  if (refTa) refTa.addEventListener('input', () => { state.refurls = refTa.value; });

  card.querySelectorAll('.stepchk input').forEach(cb => {
    cb.addEventListener('change', () => {
      if (tab === 'video') {
        const research = card.querySelector('input[data-step="research"]');
        const keypoint = card.querySelector('input[data-step="keypoint"]');
        // 前端就把依赖关系摆正，别等后端因为缺调研内容直接失败。
        if (cb.getAttribute('data-step') === 'keypoint' && cb.checked && research) research.checked = true;
        if (cb.getAttribute('data-step') === 'research' && !cb.checked && keypoint && keypoint.checked) keypoint.checked = false;
      }
      card.querySelectorAll('.stepchk input').forEach(x => { state.steps[x.getAttribute('data-step')] = x.checked; });
      // 可选步骤决定「确认」之后还有没有下一步，等待确认时要立刻刷新步骤条与按钮文案。
      if (tab !== 'video') refreshDetail(tab, state, root);
    });
  });

  recSection(tab, state.topic).then(html => {
    if (seq !== renderSeq || !isStateLive(state)) return;
    const box = card.querySelector('#crecbox');
    if (!box) return;
    box.innerHTML = html || '<span class="muted">暂无建议</span>';
    box.querySelectorAll('.ideacard').forEach(el => {
      el.addEventListener('click', () => {
        const t = el.getAttribute('data-topic');
        if (!t) return;
        const ta = card.querySelector('#ctopic');
        if (ta) ta.value = t;
        state.topic = t;
        box.querySelectorAll('.ideacard').forEach(x => x.classList.remove('sel'));
        el.classList.add('sel');
      });
    });
  });

  if (tab === 'video') {
    loadVideoTypes().then(types => {
      if (seq !== renderSeq || !isStateLive(state)) return;
      const row = card.querySelector('#vtyperow');
      if (!row) return;
      if (!types.length) { row.innerHTML = '<span class="muted">无</span>'; return; }
      row.innerHTML = types.map(t => {
        const id = String(t.id == null ? '' : t.id);
        return `<div class="vtypecard ${state.vtype != null && String(state.vtype) === id ? 'sel' : ''}" data-id="${UI.esc(id)}"><div class="vtypecard-name">${UI.esc(t.name)}</div>${t.description ? `<div class="vtypecard-desc">${UI.esc(t.description)}</div>` : ''}</div>`;
      }).join('');
      row.querySelectorAll('.vtypecard').forEach(el => {
        el.addEventListener('click', () => {
          state.vtype = el.getAttribute('data-id');
          row.querySelectorAll('.vtypecard').forEach(x => x.classList.remove('sel'));
          el.classList.add('sel');
        });
      });
    });
  }

  const startBtn = card.querySelector('#cstart');
  if (startBtn) startBtn.addEventListener('click', () => startCreation(tab, state, root));
  updateStartButton(card, state);
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
  if (!isStateLive(state) || tab !== activeTab || state.starting) return;
  const card = root.querySelector('#creation-input-card');
  if (!card) return;
  const topic = ((card.querySelector('#ctopic') || {}).value || '').trim();
  if (!topic) { setStatus(tab, state, '请输入主题', true, root); return; }

  card.querySelectorAll('.stepchk input').forEach(c => { state.steps[c.getAttribute('data-step')] = c.checked; });
  state.topic = topic;
  state.refurls = ((card.querySelector('#cref') || {}).value || '').trim();

  let refs = [];
  if (tab === 'video') {
    refs = state.refurls.split('\n').map(s => s.trim()).filter(Boolean);
    const bad = refs.find(u => !/^https?:\/\//i.test(u));
    if (bad) {
      setStatus(tab, state, '参考视频链接需以 http(s):// 开头：' + bad, true, root);
      return;
    }
  }

  // 已有会话时点一下就开始新会话，会把当前进度从界面里换掉；先用行内提示确认一次，
  // 不用同步 confirm（Electron 里体验差，也挡不住误点）。
  if (state.sessionId && !state.startConfirm) {
    state.startConfirm = true;
    setStatus(tab, state, '当前会话仍在。再次点击「开始新创作」将新建会话，当前进度会从界面移除。', true, root);
    setTimeout(() => {
      if (!isStateLive(state) || !state.startConfirm) return;
      state.startConfirm = false;
      // 提示里的"再次点击"只在倒计时内有效，超时后要把这句警示撤掉，
      // 否则用户下次点击看到的还是同一句，永远开始不了。
      if (tab === activeTab && state.statusBad) setStatus(tab, state, '', false, root);
    }, 6000);
    return;
  }
  state.startConfirm = false;
  state.starting = true;
  setStatus(tab, state, '启动中…', false, root);

  const body = { type: tab, topic: topic, optionalSteps: buildSteps(tab, state) };
  if (tab === 'video') {
    body.referenceVideoUrls = refs;
    if (state.vtype) body.videoTypeId = state.vtype;
  }

  api.post('/api/v2/creation/start', body).then(r => {
    if (!isStateLive(state)) return;
    state.starting = false;
    if (!r || !r.ok) {
      setStatus(tab, state, '启动失败：' + ((r && r.message) || '未知错误'), true, root);
      return;
    }
    const id = r.data && (r.data.sessionId || r.data.SessionId);
    if (!id) {
      setStatus(tab, state, '启动失败：服务端未返回会话', true, root);
      return;
    }
    state.sessionId = id;
    state.polling = true;
    state.pendingResume = false;
    state.pollFails = 0;
    state.lastSig = null;
    state.lastData = null;
    state.history = {};
    state.actError = '';
    state.composer = null;
    state.uploadNote = '';
    setStatus(tab, state, '进行中', false, root);
    // 判空再调：容器缺席时静默跳过，否则这一行抛出的 TypeError 会被下面的 catch
    // 接成「启动失败」，一次其实已经建好的创作会话被报成没起来。
    // 标题按 tab 分开：三条创作记录都叫「创作」的话，任务中心里根本分不出
    // 哪一条在跑；这里就是把面板自己已经知道的形态照抄成标题。
    // 任务中心的上报是尽力而为：这里抛错不能让一次已经建好的会话被报成「启动失败」。
    try {
      if (window.HTWTasks) window.HTWTasks.track({ domain: "creation", taskId: id, panel: "create", title: tab === 'image' ? "图片创作" : tab === 'article' ? "文章创作" : "视频创作", type: tab });
    } catch (e) { /* ignore */ }
    try { syncUpload(tab, state, root); renderPendingDetail(root); } catch (e) { /* 界面构建失败不影响会话 */ }
    if (tab === activeTab) poll(tab, state, root);
    else state.pendingResume = true;
  }).catch(e => {
    if (!isStateLive(state)) return;
    state.starting = false;
    setStatus(tab, state, '启动失败：' + (e && e.message ? e.message : String(e)), true, root);
  });
}

function renderPendingDetail(root) {
  const det = root.querySelector('#creation-detail');
  if (!det) return;
  UI.clear(det);
  const box = document.createElement('div');
  box.className = 'progresslog';
  box.textContent = '正在启动创作会话…';
  det.appendChild(box);
}

function poll(tab, state, root) {
  if (!isStateLive(state)) return;
  if (tab !== activeTab) { state.polling = false; state.pendingResume = true; return; }
  // acting 期间（approve / regenerate / refine 的请求还在路上）也要继续轮询：
  // 服务端这一步往往要几十秒，期间会持续写进度日志，不轮询的话界面就是死的。
  if ((!state.polling && !state.acting) || !state.sessionId) return;
  const sid = state.sessionId;
  api.get(`/api/v2/creation/status?sessionId=${encodeURIComponent(sid)}&type=${tab}`).then(r => {
    if (!isStateLive(state) || sid !== state.sessionId) return;
    if (!state.polling && !state.acting) return;
    if (tab !== activeTab) { state.polling = false; state.pendingResume = true; return; }
    if (!r || !r.ok) { pollFailed(tab, state, root, r && r.message); return; }
    const data = r.data || {};
    // 有会话的查询却回不出 status（会话丢失 / 网关截断）不能当成「已完成」，
    // 否则界面会显示一个空的完成态，把真实失败藏起来。
    if (!data.status) { pollFailed(tab, state, root, '状态响应缺少 status'); return; }
    state.pollFails = 0;
    state.lastData = data;
    renderDetail(tab, state, root, data);
    const status = data.status;
    if (status === 'running' || status === 'pending' || state.acting) {
      schedulePoll(tab, state, root, 2000);
      return;
    }
    // waiting_approval 停在等待确认，其余状态（completed / failed / …）都结束轮询。
    state.polling = false;
    state.pendingResume = false;
    setStatus(tab, state, STATUS_LABEL[status] || status || '已完成', status === 'failed', root);
    syncUpload(tab, state, root);
  }).catch(e => {
    if (!isStateLive(state) || sid !== state.sessionId) return;
    pollFailed(tab, state, root, e && e.message ? e.message : String(e));
  });
}

function pollFailed(tab, state, root, message) {
  if (!isStateLive(state)) return;
  state.pollFails = (state.pollFails || 0) + 1;
  if (state.pollFails >= 5) {
    state.polling = false;
    state.pendingResume = true;
    setStatus(tab, state, '状态查询失败：' + (message || '未知错误') + '（已停止自动刷新）', true, root);
    return;
  }
  setStatus(tab, state, '状态查询失败，重试中…（' + state.pollFails + '/5）', true, root);
  schedulePoll(tab, state, root, 3000);
}

function schedulePoll(tab, state, root, delay) {
  if (!isStateLive(state)) return;
  if (tab !== activeTab) { state.polling = false; state.pendingResume = true; return; }
  setTimeout(() => poll(tab, state, root), delay);
}

function renderEmptyDetail(det) {
  if (!det) return;
  UI.clear(det);
  const hint = document.createElement('div');
  hint.className = 'tp-empty';
  hint.textContent = '填写左侧主题后点击「开始创作」，进度与产物会显示在这里。';
  det.appendChild(hint);
}

// 产物是后端 POCO 直出的英文键（Theme / ScriptText / CharacterDescription…），
// 直接铺给用户不合适：长文整段展示，短字段译成业务语言，
// 分镜 / 合成数据这类大块 JSON 折叠起来，内部字段不上屏。
const ART_TEXT_FIELDS = ['rawResearch', 'scriptText', 'outline', 'content', 'text', 'narration', 'platformGuide'];
const ART_TEXT_ORDER = ['rawResearch', 'scriptText', 'outline', 'content', 'text', 'narration', 'platformGuide'];
const ART_HIDDEN = ['cloudUrl', 'downloadUrl', 'mediaToken', 'sessionId', 'id', 'type', 'artifactId', 'mode', 'outputPath', 'status', 'taskId'];
const ART_COLLAPSE = ['shots', 'unionShotList', 'characters', 'videoAnalysisResults', 'styleRecommendations', 'chartImagePaths'];
const ART_LABEL = {
  theme: '主题', title: '标题', scriptText: '脚本正文', rawResearch: '调研报告',
  characterDescription: '人物设定', characterRefImageUrl: '角色参考图', shots: '分镜脚本',
  unionShotList: '合成分镜', platform: '平台', length: '时长', platformGuide: '平台适配建议',
  keywords: '关键词', tags: '标签', narration: '旁白', description: '说明', summary: '摘要',
  duration: '时长', mode: '模式', characters: '角色', videoAnalysisResults: '视频分析结果',
  styleRecommendations: '风格建议', unionBgmUrl: '背景音乐', unionBgmDuration: '配乐时长',
  chartImagePaths: '图表', draftId: '剪映草稿 ID', prompt: '生成提示词',
};

function camelKey(k) {
  if (typeof k !== 'string' || !k) return k;
  return k[0] >= 'A' && k[0] <= 'Z' ? k[0].toLowerCase() + k.slice(1) : k;
}

function pickArt(art, key) {
  if (!art || typeof art !== 'object') return null;
  if (art[key] != null) return art[key];
  const pascal = key[0].toUpperCase() + key.slice(1);
  return art[pascal] != null ? art[pascal] : null;
}

function artBaseName(p) {
  const s = String(p == null ? '' : p);
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

function absolutize(u) {
  const s = String(u == null ? '' : u);
  if (!s) return '';
  return s.charAt(0) === '/' ? api.base.replace(/\/+$/, '') + s : s;
}

function stepDefs(tab) {
  return STEP_DEFS[tab] || null;
}

// 当前步骤之后第一个会真正执行的步骤（跳过没勾选的 optional），
// 用来把「确认」按钮写成「确认，继续『图片生成』」，也让冷却时限知道下一步是不是在生图。
function nextStep(tab, steps, currentStepId) {
  const defs = stepDefs(tab);
  if (!defs) return null;
  const idx = defs.findIndex(d => d.id === currentStepId);
  if (idx < 0) return null;
  for (let i = idx + 1; i < defs.length; i++) {
    if (defs[i].optional && steps && !steps[defs[i].id]) continue;
    return defs[i];
  }
  return null;
}

function openExternalSafe(url) {
  if (!url) return;
  try {
    if (window.htw && window.htw.openExternal) { window.htw.openExternal(url); return; }
  } catch (e) { /* 没有桥接时退回 window.open */ }
  try { window.open(url, '_blank'); } catch (e) { /* 环境不支持打开外链 */ }
}

function fmtElapsed(sec) {
  const n = Number(sec);
  if (!isFinite(n) || n <= 0) return '';
  const s = Math.round(n);
  return s >= 60 ? Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒' : s + ' 秒';
}

// 图片产物必须看到图。以前 imageUrls 被当成普通字段拼成一行文本，
// 用户以为图没生成；这里铺成缩略图网格，点图或「原图」用系统浏览器打开。
function renderImageGrid(region, urls, elapsed) {
  const srcs = (Array.isArray(urls) ? urls : []).map(absolutize).filter(Boolean);
  if (!srcs.length) return;
  const box = document.createElement('div');
  box.className = 'cimg-box';
  const grid = document.createElement('div');
  grid.className = 'img-grid';
  srcs.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-wrap';
    const img = document.createElement('img');
    img.className = 'result-img cimg';
    img.src = src;
    img.alt = '生成图片 ' + (i + 1);
    img.title = '点击打开原图';
    img.addEventListener('click', () => openExternalSafe(src));
    const open = document.createElement('a');
    open.className = 'img-open';
    open.href = src;
    open.textContent = '原图 ' + (i + 1);
    open.addEventListener('click', e => { e.preventDefault(); openExternalSafe(src); });
    wrap.appendChild(img);
    wrap.appendChild(open);
    grid.appendChild(wrap);
  });
  box.appendChild(grid);
  const took = fmtElapsed(elapsed);
  const cap = document.createElement('div');
  cap.className = 'muted cimg-cap';
  cap.textContent = '共 ' + srcs.length + ' 张' + (took ? ' · 生成耗时约 ' + took : '') + ' · 点击图片可打开原图';
  box.appendChild(cap);
  region.appendChild(box);
}

// 状态接口只回当前步骤的产物；确认走到下一步后，上一步的结果就没了。
// 每见到一次产物就按步骤 id 留一份，切页签、走到后面步骤都还能回看。
function rememberArtifact(state, data, art) {
  if (!state || !data) return;
  const id = data.currentStepId;
  if (!id || id === 'done' || isEmptyArt(art)) return;
  if (!state.history) state.history = {};
  state.history[id] = art;
}

function renderHistory(region, tab, state, data) {
  const defs = stepDefs(tab);
  if (!defs || !state.history) return;
  const blocks = [];
  defs.forEach(d => {
    if (d.id === data.currentStepId) return;
    const art = state.history[d.id];
    if (isEmptyArt(art)) return;
    blocks.push([d, art]);
  });
  if (!blocks.length) return;
  const box = document.createElement('div');
  box.className = 'hist-box';
  const title = document.createElement('div');
  title.className = 'hist-title';
  title.textContent = '前面的步骤';
  box.appendChild(title);
  blocks.forEach(item => {
    const d = item[0];
    const art = item[1];
    const details = document.createElement('details');
    details.className = 'hist-item';
    const summary = document.createElement('summary');
    summary.textContent = d.label;
    details.appendChild(summary);
    const inner = document.createElement('div');
    if (art && typeof art === 'object') {
      renderArtifact(inner, art);
      // 图片步骤默认展开：确认后图从当前产物里消失，回看时得还能看到图。
      const urls = pickArt(art, 'imageUrls');
      if (Array.isArray(urls) && urls.length) details.open = true;
    } else {
      inner.textContent = UI.cleanText ? UI.cleanText(String(art)) : String(art);
    }
    details.appendChild(inner);
    box.appendChild(details);
  });
  region.appendChild(box);
}

function renderStepStrip(det, tab, state, data) {
  const defs = stepDefs(tab);
  if (!defs) return;
  const curIdx = defs.findIndex(d => d.id === data.currentStepId);
  const finished = data.status === 'completed';
  const strip = document.createElement('div');
  strip.className = 'csteps';
  defs.forEach((d, i) => {
    const skipped = !!d.optional && state.steps && !state.steps[d.id];
    const chip = document.createElement('div');
    let cls = 'cstep';
    if (skipped) cls += ' skipped';
    else if (finished || (curIdx >= 0 && i < curIdx)) cls += ' done';
    else if (i === curIdx) cls += data.status === 'failed' ? ' failed' : ' current';
    else cls += ' pending';
    chip.className = cls;
    chip.textContent = (i + 1) + '. ' + d.label + (skipped && !finished ? '（跳过）' : '');
    strip.appendChild(chip);
  });
  det.appendChild(strip);
}

// 合成产物落在会话临时目录，产物里的 /Download/<name> 是后端误写的路径
// （文件并不在 MediaFiles，直接下必然 400）。能取到字节的是 media-file 端点：
// token 由每次 status 下发，30 分钟内有效；桌面端还可以用 AuthKey 走 download。
function mediaFileUrl(sessionId, fileName, token) {
  let u = api.base.replace(/\/+$/, '') + '/api/v2/creation/media-file?sessionId=' +
    encodeURIComponent(sessionId) + '&fileName=' + encodeURIComponent(fileName);
  if (token) u += '&token=' + encodeURIComponent(token);
  return u;
}

function isEmptyArt(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function addKv(list, label, value) {
  const row = document.createElement('div');
  row.className = 'kv';
  const key = document.createElement('span');
  key.className = 'kv-key';
  key.textContent = label + '：';
  const val = document.createElement('span');
  val.className = 'kv-val';
  val.textContent = String(value);
  row.appendChild(key);
  row.appendChild(val);
  list.appendChild(row);
}

function addArtLink(list, label, url) {
  const href = /^\/\//.test(url) ? 'https:' + url : url;
  const row = document.createElement('div');
  row.className = 'kv';
  const key = document.createElement('span');
  key.className = 'kv-key';
  key.textContent = label + '：';
  const val = document.createElement('span');
  val.className = 'kv-val';
  const a = document.createElement('a');
  a.className = 'art-link';
  a.href = href;
  a.textContent = href;
  a.addEventListener('click', e => {
    e.preventDefault();
    if (window.htw && window.htw.openExternal) window.htw.openExternal(href);
    else window.open(href, '_blank');
  });
  val.appendChild(a);
  row.appendChild(key);
  row.appendChild(val);
  list.appendChild(row);
}

function appendArtText(region, ck, text) {
  const clean = UI.cleanText ? UI.cleanText(text) : text;
  if (!clean) return;
  const label = ART_LABEL[ck] || ck;
  const box = document.createElement('div');
  box.className = 'scriptbox';
  // 正文第一行常常已经是同名标题（"调研报告：xxx"），再压一个标题就重复了。
  const firstLine = clean.trim().split('\n')[0] || '';
  if (firstLine.indexOf(label) < 0) {
    const cap = document.createElement('div');
    cap.className = 'kv-key';
    cap.textContent = label;
    box.appendChild(cap);
  }
  const pre = document.createElement('pre');
  pre.textContent = clean;
  box.appendChild(pre);
  region.appendChild(box);
}

function artJson(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every(x => typeof x !== 'object')) return v.join('\n');
  try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
}

function appendArtCollapse(region, ck, v) {
  const details = document.createElement('details');
  details.className = 'artifact-details';
  const summary = document.createElement('summary');
  const base = ART_LABEL[ck] || ck;
  const count = Array.isArray(v) ? '（' + v.length + ' 项）' : '';
  summary.textContent = base + count + '，点击展开';
  const pre = document.createElement('pre');
  pre.className = 'artifact-pre';
  // 合成分镜等字段可能有几万字符，展开前不生成文本，避免每次轮询都重建大块 DOM。
  let filled = false;
  details.addEventListener('toggle', () => {
    if (!details.open || filled) return;
    filled = true;
    pre.textContent = artJson(v);
  });
  details.appendChild(summary);
  details.appendChild(pre);
  region.appendChild(details);
}

function renderArtifact(region, art) {
  if (!art || typeof art !== 'object') return;
  const meta = document.createElement('div');
  meta.className = 'kv-list';
  const extra = document.createElement('div');
  extra.className = 'kv-list';
  const texts = [];
  const collapses = [];
  const images = [];
  let elapsed = null;

  Object.keys(art).forEach(k => {
    const ck = camelKey(k);
    const v = art[k];
    if (ART_HIDDEN.indexOf(ck) >= 0 || isEmptyArt(v)) return;

    // 图片生成步骤的产物：图铺成网格，耗时并进图片说明，提示词折叠起来。
    if (ck === 'imageUrls' && Array.isArray(v)) {
      v.forEach(u => { if (typeof u === 'string' && u) images.push(u); });
      return;
    }
    if (ck === 'prompt' && typeof v === 'string') { collapses.push([ck, v]); return; }
    if (ck === 'elapsed') { elapsed = v; return; }

    if (ART_TEXT_FIELDS.indexOf(ck) >= 0 && typeof v === 'string') { texts.push([ck, v]); return; }
    if (ck === 'keywords' || ck === 'tags') {
      addKv(meta, ART_LABEL[ck] || ck, Array.isArray(v) ? v.join('、') : String(v));
      return;
    }
    if (ck === 'platform') {
      addKv(meta, '平台', UI.platformName ? UI.platformName(v) : String(v));
      return;
    }
    if (ck === 'length') { addKv(meta, '时长', String(v)); return; }
    if (ck === 'theme' || ck === 'title') { addKv(meta, ART_LABEL[ck], String(v)); return; }
    if (ck === 'characterRefImageUrl' || ck === 'unionBgmUrl') {
      if (typeof v === 'string' && /^(https?:)?\/\//i.test(v)) addArtLink(meta, ART_LABEL[ck] || ck, v);
      else if (typeof v === 'string') addKv(extra, ART_LABEL[ck] || ck, v);
      return;
    }
    if (ART_COLLAPSE.indexOf(ck) >= 0) { collapses.push([ck, v]); return; }
    if (typeof v === 'object') {
      let json = '';
      try { json = JSON.stringify(v); } catch (e) { json = ''; }
      if (json && json.length > 240) { collapses.push([ck, v]); return; }
      addKv(extra, ART_LABEL[ck] || ck, Array.isArray(v) ? v.join('、') : json);
      return;
    }
    if (typeof v === 'boolean') return;
    addKv(extra, ART_LABEL[ck] || ck, String(v));
  });

  if (images.length) renderImageGrid(region, images, elapsed);
  if (meta.children.length) region.appendChild(meta);
  texts
    .sort((a, b) => ART_TEXT_ORDER.indexOf(a[0]) - ART_TEXT_ORDER.indexOf(b[0]))
    .forEach(item => appendArtText(region, item[0], item[1]));
  if (extra.children.length) region.appendChild(extra);
  collapses.forEach(item => appendArtCollapse(region, item[0], item[1]));
}

function renderDetail(tab, state, root, data) {
  if (!isStateLive(state) || tab !== activeTab || !data) return;
  const det = root.querySelector('#creation-detail');
  if (!det) return;
  // 已经离开等待确认阶段，输入区没有意义了；留着会在下一次等待确认时意外弹出。
  if (data.status !== 'waiting_approval' && state.composer) state.composer = null;

  // 同一份状态不重复渲染：否则每 2 秒重建一次 <video>，成片会反复重载。
  // 除状态与日志序号外，还要看当前步骤 / 百分比 / 产物体积，否则这些变化不会刷新。
  const artifactSig = data.artifact
    ? (typeof data.artifact === 'string' ? data.artifact.length : Object.keys(data.artifact || {}).length)
    : 0;
  const sig = [
    data.status || '', data.currentStepId || '', data.currentSubTask || '',
    data.progressPercent, data.progressLogSeq || 0, artifactSig,
    state.acting ? 1 : 0, state.actError || '', state.composer ? state.composer.kind : '',
  ].join('|');
  if (state.lastSig === sig) return;
  state.lastSig = sig;

  if (state.videoBlobUrl) {
    try { URL.revokeObjectURL(state.videoBlobUrl); } catch (e) { /* 已被回收 */ }
    state.videoBlobUrl = null;
  }
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
    badge.textContent = STATUS_LABEL[data.status] || data.status || '';
    step.appendChild(badge);
    if (data.currentSubTask && data.currentSubTask !== (STATUS_LABEL[data.status] || '')) {
      const sub = document.createElement('span');
      sub.className = 'detail-sub';
      sub.textContent = ' · ' + data.currentSubTask;
      step.appendChild(sub);
    }
    head.appendChild(step);
    const pct = Number(data.progressPercent);
    // 后端未上报进度时会给 -1，直接铺出去就是一句「进度 -1%」，不如不显示。
    if (data.progressPercent != null && isFinite(pct) && pct >= 0 && pct <= 100) {
      const pctEl = document.createElement('div');
      pctEl.className = 'detail-progress';
      pctEl.textContent = '进度 ' + pct + '%';
      head.appendChild(pctEl);
    }
    return head;
  })());

  renderStepStrip(det, tab, state, data);

  if (data.status === 'completed') {
    const done = document.createElement('div');
    done.className = 'progresslog cdone';
    done.textContent = '创作已完成。点左侧「开始新创作」可发起下一轮；本页产物会保留到新会话开始。';
    det.appendChild(done);
  }

  if (state.actError) {
    const err = document.createElement('div');
    err.className = 'progresslog act-error';
    err.textContent = state.actError;
    det.appendChild(err);
  }

  // 进度日志放在独立的容器里：UI.showResult 会清空自己的容器，
  // 之前把日志写进 det 再 showResult(det)，日志会被立刻清掉。
  if (Array.isArray(data.progressLogs) && data.progressLogs.length) {
    const box = document.createElement('div');
    box.className = 'progresslog';
    data.progressLogs.forEach(l => {
      const line = document.createElement('div');
      line.textContent = l;
      box.appendChild(line);
    });
    det.appendChild(box);
    try { box.scrollTop = box.scrollHeight; } catch (e) { /* jsdom 等环境没有滚动高度 */ }
  }

  // act() 插入的提示会被 UI.clear 清掉，这里每次重渲染时补回来。
  if (state.acting) {
    const acting = document.createElement('div');
    acting.className = 'progresslog';
    // 生图一步要跑 1–3 分钟，文案按实际等待时间写，别让用户以为卡住了。
    const genRunning = tab === 'image' &&
      (data.currentStepId === 'generate' || ((nextStep(tab, state.steps, data.currentStepId) || {}).id === 'generate'));
    acting.textContent = genRunning ? '正在生成图片，通常需要 1–3 分钟，请稍候…' : '正在生成下一步，通常需要几十秒，请稍候…';
    det.appendChild(acting);
  }

  const resultRegion = document.createElement('div');
  resultRegion.className = 'creation-result';
  det.appendChild(resultRegion);

  let parsedArtifact = data.artifact;
  if (typeof parsedArtifact === "string") {
    const raw = parsedArtifact;
    try { parsedArtifact = JSON.parse(raw); } catch (e) {
      // 不是 JSON 就按纯文本展示，不能因为解析失败把产物整块吞掉。
      parsedArtifact = raw;
    }
  }
  rememberArtifact(state, data, parsedArtifact);
  const cloudUrl = parsedArtifact && typeof parsedArtifact === "object" ? pickArt(parsedArtifact, 'cloudUrl') : null;
  const downloadUrl = parsedArtifact && typeof parsedArtifact === "object" ? pickArt(parsedArtifact, 'downloadUrl') : null;
  const outputPath = parsedArtifact && typeof parsedArtifact === "object" ? pickArt(parsedArtifact, 'outputPath') : null;

  // 只给视频页签取播放源。优先级：会话临时文件 -> 相对下载链接 -> 剪映 CDN 直链。
  // CloudUrl 是第三方签名直链，会过期，而且它对 <video> 发出的 Range: bytes=0-
  // 会回一个 Content-Range 越界的 206，Chromium 直接报 Format error，只能兜底。
  let videoSrc = '';
  let videoName = '';
  if (tab === 'video' && state.sessionId) {
    const fileName = artBaseName(outputPath);
    if (fileName) {
      videoSrc = mediaFileUrl(state.sessionId, fileName, data.mediaToken || '');
      videoName = fileName;
    } else if (downloadUrl) {
      videoSrc = absolutize(downloadUrl);
      videoName = artBaseName(String(downloadUrl).split('?')[0]);
    } else if (cloudUrl) {
      videoSrc = absolutize(cloudUrl);
      videoName = artBaseName(String(cloudUrl).split('?')[0]) || 'video.mp4';
    }
  }

  if (data.status === 'failed') {
    // 后端现在会落 Error/FailedStepId（首步是后台执行的，原因只在会话上），
    // 拿不到时再退回最后一条进度日志，至少让用户知道卡在哪一步。
    const reason = data.error || data.errMsg || '';
    const logs = Array.isArray(data.progressLogs) ? data.progressLogs : [];
    const lastLog = logs.length ? logs[logs.length - 1] : '';
    UI.showError(resultRegion,
      '「' + label + '」这一步失败了。' + (reason ? reason : (lastLog ? '最后进度：' + lastLog : '服务端没有返回具体原因。')));
  } else if (parsedArtifact && typeof parsedArtifact === 'object') {
    // 只呈现产物本身：把整个状态对象丢给 showResult 会把 Id / mediaToken 之类的内部字段铺满一屏。
    let artShow = parsedArtifact;
    if (videoSrc) {
      try {
        artShow = JSON.parse(JSON.stringify(parsedArtifact));
        delete artShow.DownloadUrl;
        delete artShow.downloadUrl;
        delete artShow.CloudUrl;
        delete artShow.cloudUrl;
      } catch (e) { artShow = parsedArtifact; }
    }
    renderArtifact(resultRegion, artShow);
  } else if (parsedArtifact) {
    UI.showResult(resultRegion, parsedArtifact);
  }

  renderHistory(resultRegion, tab, state, data);

  if (videoSrc) {
    // 播放走源站直连：Cloudflare 对 media-file 的 206 要等十几秒才出头，
    // Chromium 媒体栈会先放弃（ERR_ABORTED）；直连实测 300ms 内出首帧。
    // 剪映直链是第三方 CDN，preferDirectUrl 不会改写它。
    const playSrc = api.preferDirectUrl(videoSrc);
    const vbox = document.createElement("div");
    vbox.className = "media-box";
    const vid = document.createElement("video");
    vid.className = "result-video"; vid.src = playSrc; vid.controls = true; vid.preload = "metadata";
    const dl = document.createElement("a");
    dl.className = "title-link"; dl.href = playSrc; dl.textContent = "下载视频";
    dl.setAttribute("download", videoName || "video.mp4");
    const hint = document.createElement("div");
    hint.className = "muted video-hint";
    hint.hidden = true;
    vbox.appendChild(vid); vbox.appendChild(dl); vbox.appendChild(hint);
    det.insertBefore(vbox, resultRegion);

    let blobTried = false;
    vid.addEventListener('error', function () {
      // 直连没配、或 token 过期时，退回带 AuthKey 的整包下载再转 Blob
      // （与 preload.download 注释里的约定一致）。只尝试一次，避免循环。
      if (blobTried || !vid.isConnected) return;
      blobTried = true;
      hint.hidden = false;
      hint.textContent = '在线预览加载失败，正在改用下载通道重试…';
      const path = api.base && videoSrc.indexOf(api.base) === 0 ? videoSrc.slice(api.base.length) : null;
      const task = path ? api.download('GET', path) : Promise.reject(new Error('无可下载路径'));
      task.then(function (r) {
        if (state.videoBlobUrl) { try { URL.revokeObjectURL(state.videoBlobUrl); } catch (e) { /* ignore */ } state.videoBlobUrl = null; }
        if (!r || !r.ok || !r.data) throw new Error((r && (r.error || r.message)) || '下载失败');
        const blob = new Blob([r.data], { type: 'video/mp4' });
        state.videoBlobUrl = URL.createObjectURL(blob);
        if (!vid.isConnected) return;
        vid.src = state.videoBlobUrl;
        dl.href = state.videoBlobUrl;
        hint.hidden = true;
      }).catch(function (e) {
        if (!vid.isConnected) return;
        hint.textContent = '在线预览失败（' + (e && e.message ? e.message : e) + '），请点击「下载视频」保存后播放。';
      });
    });
  }

  if (data.status === 'waiting_approval') {
    // 图片生成这一步后端不读精修意见（凭空再生成一批），别给一个看起来能提意见、
    // 实际被忽略的入口；重新生成也不再弹输入框，直接重跑。
    const genStep = tab === 'image' && data.currentStepId === 'generate';
    // 确认按钮写明下一步要发生什么，避免「确认」按下去不知道会去哪。
    const next = stepDefs(tab) ? nextStep(tab, state.steps, data.currentStepId) : null;
    const approveText = stepDefs(tab)
      ? (next ? '确认，继续「' + next.label + '」' : '确认，完成创作')
      : '确认';
    const bar = document.createElement('div');
    bar.className = 'detail-actions';
    bar.innerHTML = `<button class="btn primary" id="capprove">${approveText}</button><button class="btn" id="cregen">重新生成</button>${genStep ? '' : '<button class="btn" id="crefine">精修</button>'}`;
    det.appendChild(bar);
    if (genStep) {
      const ghint = document.createElement('div');
      ghint.className = 'muted cstep-hint';
      ghint.textContent = '图片生成不支持文字精修：可直接「重新生成」换一批；想调风格请在后续「优化」步骤提意见。';
      det.appendChild(ghint);
    }

    // 重新生成 / 精修用行内输入区，不再用 window.prompt：
    // 同步弹窗在 Electron 里体验差，也没法保留用户已经写了一半的意见。
    const composer = document.createElement('div');
    composer.className = 'composer';
    composer.id = 'ccomposer';
    composer.innerHTML = `<div class="field-label" id="ccomposer-label"></div><textarea id="ccomposer-text" class="ta" rows="2"></textarea><div class="composer-actions"><button class="btn primary" id="ccomposer-send">提交</button><button class="btn" id="ccomposer-cancel">取消</button><span class="muted" id="ccomposer-hint"></span></div>`;
    det.appendChild(composer);

    const ta = composer.querySelector('#ccomposer-text');
    const labelEl = composer.querySelector('#ccomposer-label');
    const hint = composer.querySelector('#ccomposer-hint');
    const applyComposer = (kind) => {
      labelEl.textContent = kind === 'refine' ? '精修意见' : '重新生成指令（可留空）';
      ta.placeholder = kind === 'refine' ? '说明希望怎么改，例如：开头再抓人一点…' : '可选：说明重新生成的方向';
    };
    const openComposer = (kind) => {
      state.composer = { kind: kind, text: '' };
      applyComposer(kind);
      ta.value = '';
      hint.textContent = '';
      composer.hidden = false;
      try { ta.focus(); } catch (e) { /* 焦点失败不影响功能 */ }
    };
    if (state.composer) {
      applyComposer(state.composer.kind);
      ta.value = state.composer.text || '';
      composer.hidden = false;
    } else {
      composer.hidden = true;
    }

    bar.querySelector('#capprove').addEventListener('click', () => act(tab, state, root, 'approve'));
    if (genStep) {
      bar.querySelector('#cregen').addEventListener('click', () => act(tab, state, root, 'regenerate'));
    } else {
      bar.querySelector('#cregen').addEventListener('click', () => openComposer('regenerate'));
    }
    const refineBtn = bar.querySelector('#crefine');
    if (refineBtn) refineBtn.addEventListener('click', () => openComposer('refine'));
    ta.addEventListener('input', () => { if (state.composer) state.composer.text = ta.value; });
    composer.querySelector('#ccomposer-cancel').addEventListener('click', () => {
      state.composer = null;
      composer.hidden = true;
      ta.value = '';
      hint.textContent = '';
    });
    composer.querySelector('#ccomposer-send').addEventListener('click', () => {
      const kind = state.composer && state.composer.kind;
      if (!kind) return;
      const text = (ta.value || '').trim();
      if (kind === 'refine' && !text) { hint.textContent = '请填写精修意见'; return; }
      state.composer.text = text;
      composer.hidden = true;
      act(tab, state, root, kind, text);
    });

    // 上一步操作还在服务端跑时先锁住，避免用户连点把同一步提交多次。
    if (state.acting) {
      bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
      composer.querySelectorAll('button').forEach(b => { b.disabled = true; });
      ta.disabled = true;
    }
  }

  // 创作过程中也能加减后续步骤（/api/v2/creation/toggle-step）。
  // 以前勾选只在 start 那一刻生效，跑起来发现要补一步只能整单重开。
  if (data.status === 'waiting_approval' && tab === 'video' && state.sessionId) {
    const OPTS = [['research', '调研'], ['keypoint', '关键点提取'], ['material', '素材搜索'], ['publish', '自动发布']];
    const tuner = document.createElement('div');
    tuner.className = 'detail-steps';
    tuner.innerHTML = '<span class="muted">后续步骤：</span>' + OPTS.map(
      o => stepToggle(tab, o[0], o[1], !!state.steps[o[0]])
    ).join('');
    det.appendChild(tuner);

    tuner.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', async () => {
        const stepId = cb.getAttribute('data-step');
        const research = tuner.querySelector('input[data-step="research"]');
        const keypoint = tuner.querySelector('input[data-step="keypoint"]');
        // 与 start 时同一条依赖：关键点要吃调研结果，勾它就得带上调研
        if (stepId === 'keypoint' && cb.checked && research && !research.checked) {
          research.checked = true;
          await toggleStep(state, tab, 'research', true, research, tuner);
          if (!research.checked) { cb.checked = false; return; }
        }
        // 反向依赖：取消调研时关键点也不能留着，否则后端同样拿不到调研内容。
        if (stepId === 'research' && !cb.checked && keypoint && keypoint.checked) {
          keypoint.checked = false;
          await toggleStep(state, tab, 'keypoint', false, keypoint, tuner);
          // 关关键点失败会回滚成勾选状态；这时调研必须留在勾选，否则依赖就断了。
          if (keypoint.checked) {
            cb.checked = true;
            state.steps.research = true;
            return;
          }
        }
        await toggleStep(state, tab, stepId, cb.checked, cb, tuner);
      });
    });
  }
}

// 开关一个可选步骤。失败要把勾选回滚，否则界面显示的和服务端实际会跑的对不上。
async function toggleStep(state, tab, stepId, enabled, cb, box) {
  if (!isStateLive(state) || tab !== activeTab) return;
  const prev = !!state.steps[stepId];
  const oldErr = box.querySelector('.step-error');
  if (oldErr && oldErr.parentNode) oldErr.parentNode.removeChild(oldErr);
  state.steps[stepId] = enabled;
  cb.disabled = true;
  try {
    const r = await api.call('POST', '/api/v2/creation/toggle-step', {
      sessionId: state.sessionId, stepId: stepId, enabled: enabled, type: tab,
    });
    if (!r || !r.ok) {
      state.steps[stepId] = prev;
      cb.checked = prev;
      showStepError(box, '步骤调整失败：' + ((r && r.message) || '未知错误'));
    }
  } catch (e) {
    state.steps[stepId] = prev;
    cb.checked = prev;
    showStepError(box, '步骤调整失败：' + (e && e.message ? e.message : String(e)));
  } finally {
    cb.disabled = false;
  }
}

// 行内提示，不能像 UI.showError 那样清空整个 tuner——那样会把其它勾选框一起抹掉。
function showStepError(box, message) {
  if (!box) return;
  let line = box.querySelector('.step-error');
  if (!line) {
    line = document.createElement('span');
    line.className = 'step-error';
    box.appendChild(line);
  }
  line.textContent = message;
  setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 6000);
}

function isMediaFile(f) {
  if (f.type && /^(image|video)\//.test(f.type)) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif|mp4|mov|webm|mkv|avi|m4v)$/i.test(f.name || '');
}

// 素材上传区挂在详情卡外面：轮询每次都会清空详情，上传进度放里面会被反复抹掉。
function syncUpload(tab, state, root) {
  if (!isStateLive(state)) return;
  const box = root.querySelector('#creation-upload');
  if (!box) return;
  const st = state.lastData && state.lastData.status;
  const show = tab === 'video' && !!state.sessionId &&
    st !== 'completed' && st !== 'failed' && st !== 'cancelled' && st !== 'canceled';
  box.hidden = !show;
  if (!show) return;

  if (!box.querySelector('#cmaterial')) {
    UI.clear(box);
    const title = document.createElement('div');
    title.className = 'field-label';
    title.textContent = '上传素材（图片 / 视频，≤20MB，可多选）';
    const pick = UI.fileInput({ label: '选择素材文件', multiple: true, accept: 'image/*,video/*' });
    pick.input.id = 'cmaterial';
    const note = document.createElement('div');
    note.className = 'progresslog upload-note';
    note.hidden = true;
    box.appendChild(title);
    box.appendChild(pick);
    box.appendChild(note);
    pick.input.addEventListener('change', () => uploadMaterial(state, pick.input, box));
    state.uploadNoteEl = note;
  }
  const note = state.uploadNoteEl || box.querySelector('.upload-note');
  if (note) {
    note.textContent = state.uploadNote || '';
    note.hidden = !state.uploadNote;
  }
}

async function uploadMaterial(state, input, box) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  // 固定本次上传的目标会话：上传途中用户另起一个会话时，
  // 剩下的文件不能悄悄落到新会话里。
  const sid = state.sessionId;
  if (!sid || !isStateLive(state)) { input.value = ''; return; }
  const note = box.querySelector('.upload-note');
  input.disabled = true;
  const say = (t) => {
    state.uploadNote = t;
    if (note) { note.textContent = t; note.hidden = !t; }
  };

  let ok = 0, failed = 0, lastErr = '';
  for (const f of files) {
    const idx = ok + failed + 1;
    if (!isMediaFile(f)) { failed++; lastErr = f.name + ' 不是图片或视频'; continue; }
    if (Number(f.size || 0) > MATERIAL_MAX) { failed++; lastErr = f.name + ' 超过 20MB'; continue; }
    say(`上传中 ${idx}/${files.length}：${f.name}`);
    try {
      const buffer = await f.arrayBuffer();
      const r = await api.upload(
        'POST',
        `/api/v2/creation/upload-material?sessionId=${encodeURIComponent(sid)}`,
        [{ name: f.name, buffer: buffer }],
        {},
        null,
        'file'
      );
      if (!r || !r.ok) { failed++; lastErr = (r && r.message) || '上传失败'; }
      else ok++;
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

function refreshDetail(tab, state, root) {
  if (!isStateLive(state) || tab !== activeTab || !state.lastData) return;
  state.lastSig = null;
  renderDetail(tab, state, root, state.lastData);
}

// 操作失败 / 超时后把输入卡的状态文字还原到详情里仍然有效的那个状态，
// 不能一直停在中途写上的「进行中」。
function restoreStatus(tab, state, root) {
  const st = state.lastData && state.lastData.status;
  setStatus(tab, state, st ? (STATUS_LABEL[st] || st) : '', st === 'failed', root);
}

function act(tab, state, root, kind, instruction) {
  if (!isStateLive(state) || tab !== activeTab || !state.sessionId || state.acting) return;
  const op = ++state.opSeq;
  state.acting = true;
  state.actError = '';
  if (kind === 'approve') state.composer = null;
  setStatus(tab, state, '进行中', false, root);

  const det = root.querySelector('#creation-detail');
  const body = { sessionId: state.sessionId, type: tab };
  if (kind === 'regenerate') body.instruction = instruction || '';
  if (kind === 'refine') body.message = instruction || '';
  const url = kind === 'approve' ? '/api/v2/creation/approve' : (kind === 'regenerate' ? '/api/v2/creation/regenerate' : '/api/v2/creation/refine');
  const label = kind === 'approve' ? '正在生成下一步' : (kind === 'regenerate' ? '正在重新生成' : '正在精修');
  // 生图一步后端要轮询第三方最长 3 分钟，180 秒的兜底会把它误判成超时。
  const curId = state.lastData && state.lastData.currentStepId;
  const nextDef = kind === 'approve' ? nextStep(tab, state.steps, curId) : null;
  const genCall = tab === 'image' && (
    (kind === 'regenerate' && curId === 'generate') ||
    (kind === 'approve' && !!nextDef && nextDef.id === 'generate')
  );

  // 立刻锁住按钮：接下去几十秒里状态签名不变，renderDetail 会提前返回，不会重建按钮。
  const bar = det && det.querySelector('.detail-actions');
  if (bar) bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const composer = det && det.querySelector('#ccomposer');
  if (composer) {
    composer.hidden = true;
    composer.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const ta = composer.querySelector('#ccomposer-text');
    if (ta) ta.disabled = true;
  }
  const pending = document.createElement('div');
  pending.className = 'progresslog';
  pending.textContent = genCall
    ? '正在生成图片，通常需要 1–3 分钟，请稍候…'
    : label + '，通常需要几十秒，请稍候…';
  if (det) det.appendChild(pending);

  // 兜底：请求迟迟不返回时也要解锁，否则按钮会一直禁用。
  const guard = setTimeout(() => {
    if (state.opSeq !== op || !isStateLive(state)) return;
    state.acting = false;
    state.actError = '操作超时，请稍后重试';
    restoreStatus(tab, state, root);
    refreshDetail(tab, state, root);
  }, genCall ? 300000 : 180000);

  api.post(url, body).then(r => {
    if (state.opSeq !== op || !isStateLive(state)) return;
    clearTimeout(guard);
    state.acting = false;
    if (!r || !r.ok) {
      state.actError = '操作失败：' + ((r && r.message) || '未知错误');
      restoreStatus(tab, state, root);
      refreshDetail(tab, state, root);
      return;
    }
    state.actError = '';
    state.composer = null;
    state.lastSig = null;
    setStatus(tab, state, '进行中', false, root);
    if (tab === activeTab) {
      state.polling = true;
      poll(tab, state, root);
    } else {
      state.pendingResume = true;
    }
  }).catch(e => {
    if (state.opSeq !== op || !isStateLive(state)) return;
    clearTimeout(guard);
    state.acting = false;
    state.actError = '操作失败：' + (e && e.message ? e.message : String(e));
    restoreStatus(tab, state, root);
    refreshDetail(tab, state, root);
  });
}

function resumeTab(tab, state, root) {
  if (!isStateLive(state)) return;
  const det = root.querySelector('#creation-detail');
  if (!det) return;
  UI.clear(det);
  if (state.lastData) {
    state.lastSig = null;
    renderDetail(tab, state, root, state.lastData);
  } else {
    renderEmptyDetail(det);
  }
  syncUpload(tab, state, root);
  if (!state.sessionId) return;
  const st = state.lastData ? state.lastData.status : '';
  if (state.acting || state.pendingResume || !st || st === 'running' || st === 'pending') {
    state.pendingResume = false;
    state.polling = true;
    poll(tab, state, root);
  }
}

Skills.create = { mount: function (root) {
  mountedRoot = root;
  const token = ++mountToken;
  activeTab = 'video';
  const initialTopic = pendingTopic;
  pendingTopic = "";
  const base = {
    sessionId: null, topic: initialTopic, refurls: '', vtype: null,
    polling: false, acting: false, starting: false, startConfirm: false,
    pendingResume: false, pollFails: 0, opSeq: 0, mountToken: token,
    statusText: '', statusBad: false, lastData: null, lastSig: null,
    actError: '', composer: null, uploadNote: '', uploadNoteEl: null, videoBlobUrl: null,
  };
  const states = {
    // history 必须每个页签各建一份：Object.assign 的 history:{} 写进 base 会被三个页签共享。
    video: Object.assign({}, base, { steps: { research: true, keypoint: false, material: false, publish: false }, history: {} }),
    image: Object.assign({}, base, { steps: { optimize: true }, history: {} }),
    article: Object.assign({}, base, { steps: { optimize: true }, history: {} }),
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
        <div class="creation-right">
          <div class="creation-detail" id="creation-detail"></div>
          <div class="creation-upload" id="creation-upload" hidden></div>
        </div>
      </div>
    </div>`;

  const tabs = root.querySelector('#creation-tabs');
  tabs.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      const tab = t.getAttribute('data-tab');
      if (tab === current) return;
      tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      // 停掉旧页签的轮询；它的状态和会话都保留，切回来时接着显示。
      states[current].polling = false;
      current = tab;
      activeTab = tab;
      renderInputCard(tab, states[tab], root);
      resumeTab(tab, states[tab], root);
    });
  });

  renderInputCard(current, states[current], root);
  renderEmptyDetail(root.querySelector('#creation-detail'));
  syncUpload(current, states[current], root);
},

// 供「选题」面板调用：把标题写进当前创作页签的主题框。
setTopic: function (text) {
  const t = String(text == null ? "" : text);
  pendingTopic = t;
  if (!mountedRoot) return;
  const ta = mountedRoot.querySelector('#ctopic');
  if (!ta) return;
  ta.value = t;
  try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { }
  try { ta.focus(); } catch (e) { }
} };
