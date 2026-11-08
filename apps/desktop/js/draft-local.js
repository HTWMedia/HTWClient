"use strict";

/**
 * 剪映草稿的**纯本地**解析与解密。
 *
 * 为什么要有这个文件：
 *   桌面端此前所有"看草稿"的能力都要打后端（草稿导出、解密都计额度），
 *   而"这条草稿到底是什么样"其实完全可以在本机回答 —— 不联网、不要 AuthKey、
 *   不消耗额度。它是新用户注册之前唯一能立刻感受到的价值，所以刻意做成
 *   主进程里的纯函数模块：不 require electron，不碰网络，node --test 可直测。
 *
 * 解密算法与后端 `Models/Utils.cs: DecryptDraft` 逐行对齐（2026-11-08 用后端
 * 现存的一份真实加密草稿对拍通过）：新版剪映把 key(32 字符) + iv(16 字符) 拆成
 * 12 段 × 4 字符，按固定偏移插进密文里；取出来后是 AES-256-GCM，密文尾部 16 字节
 * 是 auth tag。
 *
 * ⚠️ 这份算法是"剪映某一版"的实现，不是稳定协议。剪映改版时症状是解密报
 * "密钥不匹配"，不是崩溃 —— 调用方要把这句话原样给用户看，别翻译成"文件坏了"。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// 新版写 draft_content.json；部分版本/工具写 draft_info.json，两个都认。
const DRAFT_FILE_NAMES = ["draft_content.json", "draft_info.json"];

// 草稿 JSON 正常在 1~20MB。设上限只为防"选错文件夹时把一个巨型文件整个读进内存"。
const MAX_DRAFT_JSON_BYTES = 64 * 1024 * 1024;

// 递归找草稿文件时有界：够覆盖"用户选了上一层目录"的场景，又不会把整块盘走一遍。
const MAX_DRAFT_SEARCH_DEPTH = 3;

// 统计草稿目录体积时的条目上限：素材多的草稿几千个文件很常见，两万足够。
const MAX_SCAN_ENTRIES = 20000;

// key/iv 在密文里的字符偏移（12 段 × 4 字符 = 48 字符 = 32 key + 16 iv）。
const KEY_IV_OFFSETS = [0, 7, 20, 33, 40, 47, 59, 66, 76, 89, 99, 127];

const TRACK_LABELS = {
  video: "视频",
  audio: "音频",
  text: "文字",
  sticker: "贴纸",
  effect: "特效",
  filter: "滤镜",
  adjust: "调节",
  image: "图片",
  draft: "草稿",
  placeholder: "占位",
};

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

/**
 * 判据与后端 `Utils.IsPlainDraftJson` 一致：明文草稿顶层就是 `{...}`，
 * 密文是"一整段 base64 + 散落插入的 key/iv 字符"，不可能被解析成 JSON 对象。
 * 不要退回"包含 version 子串"那种写法 —— 密文里出现这几个字母完全可能。
 */
function isPlainDraftJson(text) {
  if (typeof text !== "string") return false;
  const s = text.trimStart();
  if (!s.startsWith("{")) return false;
  try { return JSON.parse(s) != null; } catch (e) { return false; }
}

/**
 * 从密文里把 key/iv 拆出来。返回值：
 *   keyIv —— 48 个字符（前 32 key，后 16 iv）
 *   body  —— 剥掉那 48 个字符之后的纯 base64
 * 必须**从后往前**按偏移切、切出来的段**往前拼**：偏移是按原文算的，
 * 正着切会让后面的偏移全部错位。
 */
function extractKeyIv(input) {
  const s = String(input == null ? "" : input);
  if (s.length < 131) throw new Error("这段内容太短，不像剪映的加密草稿");
  const chars = s.split("");
  let keyIv = [];
  for (let i = KEY_IV_OFFSETS.length - 1; i >= 0; i--) {
    const offset = KEY_IV_OFFSETS[i];
    if (offset + 4 <= chars.length) {
      const piece = chars.splice(offset, 4);
      keyIv = piece.concat(keyIv);
    }
  }
  return { keyIv: keyIv.join(""), body: chars.join("") };
}

/**
 * 解密草稿密文，返回明文 JSON 字符串。
 * 失败一律抛中文 Error —— 这一层的报错会直接显示给用户，不能出现
 * "Unsupported state or unable to authenticate data" 这种 OpenSSL 原文。
 */
function decryptDraft(input) {
  const { keyIv, body } = extractKeyIv(input);
  if (keyIv.length < 48) throw new Error("密文里没有解析出完整的密钥与 IV");
  const key = Buffer.from(keyIv.slice(0, 32), "utf8");
  const iv = Buffer.from(keyIv.slice(32, 48), "utf8");
  if (key.length !== 32 || iv.length !== 16) throw new Error("密钥长度不对，这条草稿不是这套加密格式");

  const raw = Buffer.from(body, "base64");
  if (raw.length <= 16) throw new Error("密文太短，解不出内容");

  // 剪映把 auth tag 拼在密文**尾部**，而 Node 要单独 setAuthTag。
  const ciphertext = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (e) {
    throw new Error("解密失败：密钥不匹配或密文格式不对（这条草稿可能来自不兼容的剪映版本）");
  }
}

/** 读一个草稿文件，明文原样返回，密文就地解密。 */
function readDraftFile(file) {
  const st = fs.statSync(file);
  if (st.size > MAX_DRAFT_JSON_BYTES) {
    throw new Error("草稿文件超过 " + Math.round(MAX_DRAFT_JSON_BYTES / 1048576) + "MB，已停止读取");
  }
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) throw new Error("草稿文件是空的：" + path.basename(file));

  const encrypted = !isPlainDraftJson(text);
  const plain = encrypted ? decryptDraft(text) : text;

  let json;
  try { json = JSON.parse(plain); } catch (e) {
    throw new Error("草稿内容不是合法 JSON，无法解析");
  }
  return { file: file, text: plain, encrypted: encrypted, json: json };
}

/**
 * 在目录里找草稿文件。
 * 直接命中优先；否则向下找 MAX_DRAFT_SEARCH_DEPTH 层。找到多个时**报错**而不是
 * 随便挑一个 —— 用户很可能选的是剪映的草稿总目录，随便挑一条等于给错结论。
 */
function findDraftFile(folder) {
  for (let i = 0; i < DRAFT_FILE_NAMES.length; i++) {
    const p = path.join(folder, DRAFT_FILE_NAMES[i]);
    if (isFile(p)) return p;
  }
  const hits = [];
  (function walk(dir, depth) {
    if (hits.length > 1 || depth > MAX_DRAFT_SEARCH_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (let i = 0; i < entries.length; i++) {
      const ent = entries[i];
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
        if (hits.length > 1) return;
      } else if (DRAFT_FILE_NAMES.indexOf(ent.name.toLowerCase()) >= 0) {
        hits.push(full);
        if (hits.length > 1) return;
      }
    }
  })(folder, 1);

  if (hits.length > 1) {
    throw new Error("这个文件夹里有多个草稿，请选到具体那条草稿的文件夹（剪映里右键草稿 →「打开草稿文件夹」）");
  }
  if (!hits.length) {
    throw new Error("没有找到 draft_content.json：请确认选的是剪映草稿文件夹");
  }
  return hits[0];
}

/** 把微秒时长变成「3 分 12 秒」这种人话。 */
function formatDurationUs(us) {
  const total = Math.round((Number(us) || 0) / 1e6);
  if (total <= 0) return "0 秒";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return h + " 小时 " + m + " 分 " + s + " 秒";
  if (m > 0) return m + " 分 " + s + " 秒";
  return s + " 秒";
}

/** 字节数 → 「1.2 GB」。 */
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

/** 解析文字素材里的文案，算个总字数（纯统计，不关心样式）。 */
function countTextChars(texts) {
  let total = 0;
  let ok = false;
  (texts || []).forEach(function (t) {
    if (!t || typeof t.content !== "string" || !t.content) return;
    try {
      const c = JSON.parse(t.content);
      if (c && typeof c.text === "string") {
        total += c.text.replace(/\s+/g, "").length;
        ok = true;
      }
    } catch (e) { /* 有的版本 content 是纯文本，不是 JSON */ }
  });
  return ok ? total : null;
}

/**
 * 素材路径 → 候选绝对路径。
 *
 * 🔴 剪映把"跟随草稿目录"的素材写成占位前缀：
 *   `##_draftpath_placeholder_<草稿UUID>_##/video/xxx.mp4`
 * 它表示「草稿目录 / video / xxx.mp4」，**不是**字面路径。不认这个前缀的后果
 * 不是报错，而是把所有素材都判成"缺失"——2026-11-08 在本机 12 条真实草稿上
 * 复现过：23 个引用全被判缺，实际一个都不缺。这种误报比不报更伤：
 * 用户会以为体检在瞎说，从此不信任何结论。
 */
const DRAFT_PATH_PLACEHOLDER = /^##_draftpath_placeholder_[^#]+_##[\\/]?/;

function resolveMediaCandidates(raw, draftDir) {
  const s = String(raw || "");
  if (!s) return [];
  const ph = s.match(DRAFT_PATH_PLACEHOLDER);
  if (ph) return [path.join(draftDir, s.slice(ph[0].length))];
  if (path.isAbsolute(s)) return [s];
  // 相对路径：先按草稿目录解，再退化到"同名文件就在草稿目录里"。
  return [path.join(draftDir, s), path.join(draftDir, path.basename(s))];
}

/**
 * 素材核对：草稿里引用的素材还在不在本机。
 * 剪映存的可能是绝对路径、占位前缀或相对路径，三种都要解；
 * 这也正是云渲染出残片的最常见原因 —— 本地先看，比渲完才发现便宜得多。
 */
function checkMedia(json, draftDir) {
  const mats = (json && json.materials) || {};
  const groups = [
    { key: "videos", kind: "视频" },
    { key: "audios", kind: "音频" },
    { key: "images", kind: "图片" },
  ];
  const seen = Object.create(null);
  const missing = [];
  let referenced = 0;
  let existingBytes = 0;

  groups.forEach(function (g) {
    const list = mats[g.key] || [];
    list.forEach(function (m) {
      const raw = (m && (m.path || m.media_path)) || "";
      if (!raw || typeof raw !== "string") return;
      const key = (process.platform === "win32" ? raw.toLowerCase() : raw);
      if (seen[key]) return;
      seen[key] = true;
      referenced++;

      const candidates = resolveMediaCandidates(raw, draftDir);
      let hit = "";
      for (let i = 0; i < candidates.length; i++) {
        if (isFile(candidates[i])) { hit = candidates[i]; break; }
      }
      if (hit) {
        try { existingBytes += fs.statSync(hit).size; } catch (e) { /* 算不进体积不影响结论 */ }
      } else {
        missing.push({ name: path.basename(raw) || raw, kind: g.kind, path: raw });
      }
    });
  });

  return { referenced: referenced, missing: missing, existingBytes: existingBytes };
}

/** 草稿目录体积（含素材）。条目超上限就不再走，返回 partial=true。 */
function scanFolderSize(folder) {
  let files = 0;
  let bytes = 0;
  let partial = false;
  (function walk(dir) {
    if (partial) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (let i = 0; i < entries.length; i++) {
      if (files >= MAX_SCAN_ENTRIES) { partial = true; return; }
      const full = path.join(dir, entries[i].name);
      if (entries[i].isDirectory()) { walk(full); continue; }
      try {
        const st = fs.statSync(full);
        files++;
        bytes += st.size;
      } catch (e) { /* 单个文件读不到就跳过 */ }
    }
  })(folder);
  return { files: files, bytes: bytes, partial: partial };
}

/**
 * 多视频轨的层级检查。
 *
 * 已知的云渲染失败码 19070005（执行端只回 "Render failed (code=19070005)"）：
 * 剪映桌面端能播，云渲染不接受"上层视频轨的 render_index 不高于主轨"的草稿。
 * 正常草稿里主轨的 segment 干脆没有 render_index（track mode 打开时），上层从 1 起；
 * 而某些生成器产出的草稿会让所有轨都是 0 —— 那种必然踩。所以只在**确实看到**
 * 违规值时才提示，宁可不报，也不能对着正常草稿喊"会失败"。
 */
function renderIndexRisk(json) {
  const tracks = ((json && json.tracks) || []).filter(function (t) { return t && t.type === "video"; });
  if (tracks.length < 2) return null;

  function values(track) {
    const out = [];
    (track.segments || []).forEach(function (s) {
      const v = Number(s && s.render_index);
      if (s && s.render_index != null && isFinite(v)) out.push(v);
    });
    return out;
  }

  const base = values(tracks[0]);
  // 主轨一个数值都没有 = 缺省 0（track mode 的正常形态）
  const baseMax = base.length ? Math.max.apply(null, base) : 0;

  let judged = false;
  const offenders = [];
  for (let i = 1; i < tracks.length; i++) {
    const vals = values(tracks[i]);
    if (!vals.length) continue;
    judged = true;
    if (Math.max.apply(null, vals) <= baseMax) offenders.push({ index: i, max: Math.max.apply(null, vals) });
  }
  if (!judged || !offenders.length) return null;
  return { videoTracks: tracks.length, baseMax: baseMax, offenders: offenders };
}

/**
 * 把草稿 JSON 变成给人看的摘要。不做 IO 之外的事（素材存在性由 checkMedia 负责），
 * 所以测试可以直接喂一个 JSON 对象。
 */
function summarizeDraft(json, opts) {
  opts = opts || {};
  const draftDir = opts.draftDir || "";
  const j = json || {};
  const canvas = j.canvas_config || j.canvasConfig || {};
  const tracks = Array.isArray(j.tracks) ? j.tracks : [];
  const mats = j.materials || {};

  // 时长：顶层 duration 是微秒。个别工具产出的草稿写 0，退化到"最晚的片段结束点"。
  let durationUs = Number(j.duration) || 0;
  if (!durationUs) {
    tracks.forEach(function (t) {
      (t.segments || []).forEach(function (s) {
        const end = Number(s && s.target_timerange && s.target_timerange.end);
        if (isFinite(end) && end > durationUs) durationUs = end;
      });
    });
  }

  const trackRows = tracks.map(function (t) {
    const type = String((t && t.type) || "unknown");
    return {
      type: type,
      label: TRACK_LABELS[type] || type,
      segments: (t && t.segments ? t.segments.length : 0),
    };
  });
  const videoTrackCount = trackRows.filter(function (r) { return r.type === "video"; }).length;

  const media = opts.checkMedia === false
    ? { referenced: 0, missing: [], existingBytes: 0 }
    : checkMedia(j, draftDir);

  const folderStat = opts.folder || null;
  const textChars = countTextChars(mats.texts);
  const risk = renderIndexRisk(j);
  const name = String(j.name || j.draft_name || opts.fallbackName || path.basename(draftDir) || "未命名草稿");

  const checks = [];
  if (opts.encrypted === true) {
    checks.push({ level: "info", text: "草稿是加密的，已在本机解密（AES-256-GCM）——内容没有离开这台机器。" });
  } else if (opts.encrypted === false) {
    checks.push({ level: "info", text: "草稿是明文 JSON，不需要解密。" });
  }
  if (!videoTrackCount) {
    checks.push({ level: "error", text: "没有视频轨：这条草稿渲不出画面（只有音频/文字/贴纸）。" });
  }
  if (!durationUs) {
    checks.push({ level: "error", text: "草稿时长为 0：所有轨道都是空的，渲出来是空片。" });
  }
  if (media.missing.length) {
    const names = media.missing.slice(0, 3).map(function (m) { return m.name; }).join("、");
    checks.push({
      level: "warn",
      text: "缺 " + media.missing.length + " 个素材（" + names + (media.missing.length > 3 ? " 等" : "")
        + "）：成片里对应片段会黑屏或没声音。把素材放回原路径，或连同素材重新打包再导出。",
    });
  }
  if (risk) {
    checks.push({
      level: "warn",
      text: "检测到 " + risk.videoTracks + " 条视频轨，且有上层轨的 render_index（最大 "
        + risk.offenders[0].max + "）不高于主轨（" + risk.baseMax + "）：剪映桌面端能播，"
        + "但云渲染可能报 19070005。把上层视频轨的层级调高后再导出。",
    });
  }
  if (media.referenced && !media.missing.length) {
    checks.push({ level: "ok", text: "素材核对通过：草稿引用的 " + media.referenced + " 个素材都在本机。" });
  }

  let verdict;
  if (!videoTrackCount) verdict = { level: "error", text: "这条草稿没有视频轨，不能当视频导出。" };
  else if (!durationUs) verdict = { level: "error", text: "草稿是空的（时长 0 秒），没有可渲染的内容。" };
  else if (media.missing.length) verdict = { level: "warn", text: "能解密、能读，但会渲出残片：缺 " + media.missing.length + " 个素材。" };
  else if (risk) verdict = { level: "warn", text: "内容完整，但云渲染有已知风险（19070005），建议先按提示调轨道层级。" };
  else verdict = { level: "ok", text: "内容完整，可以直接导出成片。" };

  return {
    name: name,
    durationUs: durationUs,
    durationText: formatDurationUs(durationUs),
    canvas: {
      ratio: String(canvas.ratio || ""),
      width: Number(canvas.width) || 0,
      height: Number(canvas.height) || 0,
    },
    fps: Number(j.fps) || 0,
    updatedAt: Number(j.update_time) > 0 ? Math.round(Number(j.update_time) / 1000) : 0,
    trackCount: trackRows.length,
    tracks: trackRows,
    videoTrackCount: videoTrackCount,
    materialCounts: [
      { label: "视频", count: (mats.videos || []).length },
      { label: "图片", count: (mats.images || []).length },
      { label: "音频", count: (mats.audios || []).length },
      { label: "文字", count: (mats.texts || []).length },
      { label: "贴纸", count: (mats.stickers || []).length },
      { label: "特效", count: (mats.effects || []).length },
    ].filter(function (m) { return m.count > 0; }),
    textChars: textChars,
    media: {
      referenced: media.referenced,
      missingCount: media.missing.length,
      missing: media.missing.slice(0, 8),
      bytes: media.existingBytes,
    },
    folder: folderStat,
    checks: checks,
    verdict: verdict,
  };
}

/**
 * 用户输入 → 草稿目录。
 * 两类真实输入必须容错，否则用户会在"路径没错"的情况下被拒：
 *   ① Windows 的「复制为路径」带一对双引号（`"C:\...\草稿"`）；
 *   ② 有人直接把 `draft_content.json` 的完整路径粘进来。
 */
function normalizeDraftDir(input) {
  let s = String(input == null ? "" : input).trim();
  s = s.replace(/^["']+|["']+$/g, "").trim();
  if (!s) throw new Error("请先选择草稿文件夹");
  if (isFile(s)) {
    if (DRAFT_FILE_NAMES.indexOf(path.basename(s).toLowerCase()) >= 0) return path.dirname(s);
    throw new Error("这是一个文件，不是草稿文件夹：" + s);
  }
  if (!isDir(s)) throw new Error("这个路径不是一个文件夹：" + s);
  return s;
}

/**
 * 体检入口：给一个文件夹路径，返回摘要。**全程不出本机**。
 * 抛出的 Error.message 都是可以直接显示给用户的中文。
 */
function inspectDraftFolder(folder, opts) {
  opts = opts || {};
  const dir = normalizeDraftDir(folder);
  const file = findDraftFile(dir);
  const draft = readDraftFile(file);

  const summary = summarizeDraft(draft.json, {
    draftDir: path.dirname(file),
    encrypted: draft.encrypted,
    fallbackName: path.basename(dir),
    checkMedia: opts.checkMedia !== false,
    folder: opts.withFolderSize === false ? null : scanFolderSize(dir),
  });

  return {
    ok: true,
    file: file,
    fileName: path.basename(file),
    folder: dir,
    encrypted: draft.encrypted,
    jsonBytes: Buffer.byteLength(draft.text, "utf8"),
    summary: summary,
  };
}

/**
 * 把解密后的明文写到草稿目录里（`draft_content.decrypted.json`），
 * **绝不覆盖原文件**。本来就地改原文件的话，剪映下次打开会认不出来，
 * 而用户只是想"拿到一份能看/能改的 JSON"。
 */
function exportDecryptedDraft(folder) {
  const dir = normalizeDraftDir(folder);
  const file = findDraftFile(dir);
  const draft = readDraftFile(file);
  const base = path.basename(file, ".json");
  const out = path.join(path.dirname(file), base + ".decrypted.json");
  fs.writeFileSync(out, draft.text, "utf8");
  return { ok: true, path: out, bytes: Buffer.byteLength(draft.text, "utf8"), encrypted: draft.encrypted };
}

module.exports = {
  DRAFT_FILE_NAMES: DRAFT_FILE_NAMES,
  isPlainDraftJson: isPlainDraftJson,
  extractKeyIv: extractKeyIv,
  decryptDraft: decryptDraft,
  readDraftFile: readDraftFile,
  findDraftFile: findDraftFile,
  resolveMediaCandidates: resolveMediaCandidates,
  summarizeDraft: summarizeDraft,
  renderIndexRisk: renderIndexRisk,
  inspectDraftFolder: inspectDraftFolder,
  exportDecryptedDraft: exportDecryptedDraft,
  formatDurationUs: formatDurationUs,
  formatBytes: formatBytes,
};
