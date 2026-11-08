const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const D = require("./draft-local.js");

/*
 * 本地草稿体检的核心约束：
 *   1) 解密必须与后端 Models/Utils.cs:DecryptDraft 同一套算法 —— 否则用户在
 *      「剪辑 → 解密」里能解开的草稿，到了免费的本地体检里反而解不开；
 *   2) 结论必须能指向真实后果（缺素材 / 空草稿 / 19070005 风险），不能只回
 *      "解析成功" 这种没有决策价值的字；
 *   3) 导出**绝不覆盖**原草稿 —— 覆盖了剪映下次就打不开。
 *
 * 加密样本由 encryptLikeJianYing() 现场构造：它是 extractKeyIv 的严格逆运算。
 * 该构造已用后端现存的一份真实加密草稿（2.3MB）逐字节对拍通过 —— 重加密后
 * 按同样的偏移插入，产出的字符串与磁盘上那份**完全一致**，所以这里不是在自说自话。
 */

const KEY = "0123456789abcdef0123456789abcdef"; // 32 字符
const IV = "abcdef0123456789";                 // 16 字符
const OFFSETS = [0, 7, 20, 33, 40, 47, 59, 66, 76, 89, 99, 127];

// 把明文按剪映的方式加密并「藏」进 base64：AES-256-GCM，tag 拼在尾部，
// 再把 key+iv 切成 12 段按偏移升序插进去。
function encryptLikeJianYing(plain) {
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(KEY, "utf8"), Buffer.from(IV, "utf8"));
  const ct = Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]);
  const body = Buffer.concat([ct, cipher.getAuthTag()]).toString("base64");
  const chars = body.split("");
  const keyIv = KEY + IV;
  OFFSETS.forEach(function (off, i) {
    chars.splice(off, 0, ...keyIv.slice(i * 4, i * 4 + 4).split(""));
  });
  return chars.join("");
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "htw-draft-"));
}

function baseDraft(over) {
  const j = {
    id: "draft-1",
    name: "测试草稿",
    version: 360000,
    fps: 30,
    duration: 5000000, // 5 秒（微秒）
    canvas_config: { ratio: "16:9", width: 1920, height: 1080 },
    materials: {
      videos: [], audios: [], images: [], texts: [], stickers: [], effects: [],
    },
    tracks: [
      { type: "video", segments: [{ id: "s1", target_timerange: { start: 0, end: 5000000 } }] },
      { type: "audio", segments: [] },
    ],
  };
  Object.keys(over || {}).forEach(function (k) { j[k] = over[k]; });
  return j;
}

test("isPlainDraftJson：只有能解析成 JSON 对象的才算明文", function () {
  assert.strictEqual(D.isPlainDraftJson('{"a":1}'), true);
  assert.strictEqual(D.isPlainDraftJson('  \n{"a":1}'), true);
  assert.strictEqual(D.isPlainDraftJson("2bD7Hum5hffryQbdiKxMh16C3rS4sp15"), false);
  assert.strictEqual(D.isPlainDraftJson('{"a":'), false);
  assert.strictEqual(D.isPlainDraftJson(""), false);
  assert.strictEqual(D.isPlainDraftJson(null), false);
});

test("decryptDraft：与剪映同构的密文能解回原文，key/iv 位置正确", function () {
  const plain = JSON.stringify(baseDraft());
  const enc = encryptLikeJianYing(plain);
  const parts = D.extractKeyIv(enc);
  assert.strictEqual(parts.keyIv, KEY + IV, "取出的 48 个字符必须正好是 key+iv");
  assert.strictEqual(D.decryptDraft(enc), plain);
});

test("decryptDraft：解不开时给中文原因，不透 OpenSSL 原文", function () {
  const plain = JSON.stringify(baseDraft());
  const enc = encryptLikeJianYing(plain);
  // 改掉中间的 base64 字符：能解码，但 GCM 校验必失败
  const bad = enc.slice(0, 200) + (enc[200] === "A" ? "B" : "A") + enc.slice(201);
  assert.throws(function () { D.decryptDraft(bad); }, function (e) {
    assert.ok(/解密失败/.test(e.message), "应说明是解密失败，实际：" + e.message);
    assert.ok(!/unable to authenticate|Unsupported state|bad decrypt/i.test(e.message), "不应出现底层英文报错");
    return true;
  });
  assert.throws(function () { D.decryptDraft("short"); }, /太短/);
});

test("formatDurationUs / formatBytes：给人看的单位", function () {
  assert.strictEqual(D.formatDurationUs(5000000), "5 秒");
  assert.strictEqual(D.formatDurationUs(192000000), "3 分 12 秒");
  assert.strictEqual(D.formatDurationUs(3661000000), "1 小时 1 分 1 秒");
  assert.strictEqual(D.formatDurationUs(0), "0 秒");
  assert.strictEqual(D.formatBytes(512), "512 B");
  assert.strictEqual(D.formatBytes(1536), "1.5 KB");
  assert.strictEqual(D.formatBytes(5 * 1048576), "5.0 MB");
});

test("inspectDraftFolder：剪映的草稿目录占位前缀不能被判成缺素材", function () {
  // 真实草稿里素材写成 `##_draftpath_placeholder_<UUID>_##/video/x.mp4`，
  // 表示"草稿目录/video/x.mp4"。2026-11-08 在本机真实草稿上踩过：不认这个前缀
  // 会把 23 个引用全判缺失 —— 那种误报会让整个体检失去可信度。
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "video"));
  fs.writeFileSync(path.join(dir, "video", "clip.mp4"), Buffer.alloc(16));
  const uuid = "0E685133-18CE-45ED-8CB8-2904A212EC80";
  const j = baseDraft({
    materials: {
      videos: [{ path: "##_draftpath_placeholder_" + uuid + "_##/video/clip.mp4" }],
      audios: [{ path: "##_draftpath_placeholder_" + uuid + "_##\\audio\\bgm.mp3" }],
      images: [], texts: [], stickers: [], effects: [],
    },
  });
  fs.writeFileSync(path.join(dir, "draft_content.json"), JSON.stringify(j), "utf8");
  const r = D.inspectDraftFolder(dir);
  assert.strictEqual(r.summary.media.referenced, 2);
  assert.strictEqual(r.summary.media.missingCount, 1, "只该缺没落盘的 bgm.mp3");
  assert.strictEqual(r.summary.media.missing[0].name, "bgm.mp3");

  // 解析本身也要正确：占位前缀 → 草稿目录下的相对路径
  const cands = D.resolveMediaCandidates("##_draftpath_placeholder_" + uuid + "_##/video/clip.mp4", dir);
  assert.deepStrictEqual(cands, [path.join(dir, "video", "clip.mp4")]);
});

test("inspectDraftFolder：明文草稿 → 轨道/时长/文案字数/缺素材一处不漏", function () {
  const dir = tmpDir();
  const clip = path.join(dir, "clip.mp4");
  fs.writeFileSync(clip, Buffer.alloc(2048));
  const missing = path.join(dir, "素材不在", "missing.mp3");

  const j = baseDraft({
    materials: {
      videos: [{ path: clip, duration: 5000000 }],
      audios: [{ path: missing }],
      images: [], stickers: [], effects: [],
      texts: [{ content: JSON.stringify({ text: "你好 世界" }) }],
    },
  });
  fs.writeFileSync(path.join(dir, "draft_content.json"), JSON.stringify(j), "utf8");

  const r = D.inspectDraftFolder(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.encrypted, false);
  assert.strictEqual(r.summary.name, "测试草稿");
  assert.strictEqual(r.summary.durationText, "5 秒");
  assert.deepStrictEqual(r.summary.canvas, { ratio: "16:9", width: 1920, height: 1080 });
  assert.strictEqual(r.summary.videoTrackCount, 1);
  assert.strictEqual(r.summary.textChars, 4, "文案字数应忽略空白");
  assert.strictEqual(r.summary.media.referenced, 2);
  assert.strictEqual(r.summary.media.missingCount, 1);
  assert.strictEqual(r.summary.media.missing[0].name, "missing.mp3");
  assert.strictEqual(r.summary.verdict.level, "warn");
  assert.ok(/缺 1 个素材/.test(r.summary.verdict.text), "结论要说清后果，实际：" + r.summary.verdict.text);
  assert.ok(r.summary.checks.some(function (c) { return c.level === "warn" && /missing\.mp3/.test(c.text); }),
    "缺的素材名要出现在提示里");
  assert.ok(r.summary.folder && r.summary.folder.files >= 2, "应统计草稿目录体积");
});

test("inspectDraftFolder：加密草稿就地解密，结论与明文一致", function () {
  const dir = tmpDir();
  const j = baseDraft();
  const plain = JSON.stringify(j);
  fs.writeFileSync(path.join(dir, "draft_content.json"), encryptLikeJianYing(plain), "utf8");

  const r = D.inspectDraftFolder(dir);
  assert.strictEqual(r.encrypted, true);
  assert.strictEqual(r.summary.name, "测试草稿");
  assert.strictEqual(r.summary.durationText, "5 秒");
  assert.ok(r.summary.checks.some(function (c) { return c.level === "info" && /已在本机解密/.test(c.text); }));
  assert.strictEqual(r.summary.verdict.level, "ok", "内容完整就该给 ok，实际：" + JSON.stringify(r.summary.verdict));
});

test("inspectDraftFolder：空草稿 / 无视频轨 要明确判死，不报“解析成功”", function () {
  const dir = tmpDir();
  const j = baseDraft({
    duration: 0,
    tracks: [{ type: "audio", segments: [] }],
  });
  fs.writeFileSync(path.join(dir, "draft_content.json"), JSON.stringify(j), "utf8");
  const r = D.inspectDraftFolder(dir);
  assert.strictEqual(r.summary.videoTrackCount, 0);
  assert.strictEqual(r.summary.verdict.level, "error");
  assert.ok(r.summary.checks.some(function (c) { return c.level === "error" && /没有视频轨/.test(c.text); }));
  assert.ok(r.summary.checks.some(function (c) { return c.level === "error" && /时长为 0/.test(c.text); }));
});

test("inspectDraftFolder：粘贴带引号的路径 / 直接粘 draft_content.json 也能用", function () {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "draft_content.json"), JSON.stringify(baseDraft()), "utf8");

  // Windows「复制为路径」会带一对双引号 —— 不该让用户为此重敲一遍
  const quoted = D.inspectDraftFolder('"' + dir + '"');
  assert.strictEqual(quoted.ok, true);
  assert.strictEqual(quoted.summary.name, "测试草稿");

  // 有人会直接把 json 的完整路径粘进来
  const byFile = D.inspectDraftFolder(path.join(dir, "draft_content.json"));
  assert.strictEqual(byFile.ok, true);
  assert.strictEqual(byFile.folder, dir);

  // 但随便一个文件不能当草稿目录用
  const other = path.join(dir, "notes.txt");
  fs.writeFileSync(other, "x", "utf8");
  assert.throws(function () { D.inspectDraftFolder(other); }, /这是一个文件/);
});

test("inspectDraftFolder：选错目录给可执行的下一步，而不是“失败”", function () {
  const empty = tmpDir();
  assert.throws(function () { D.inspectDraftFolder(empty); }, /没有找到 draft_content\.json/);
  assert.throws(function () { D.inspectDraftFolder(path.join(empty, "不存在")); }, /不是一个文件夹/);
  assert.throws(function () { D.inspectDraftFolder(""); }, /请先选择草稿文件夹/);

  // 草稿总目录：里面有两条草稿 → 不能随便挑一条给结论
  const root = tmpDir();
  ["A", "B"].forEach(function (n) {
    const d = path.join(root, n);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "draft_content.json"), JSON.stringify(baseDraft()), "utf8");
  });
  assert.throws(function () { D.inspectDraftFolder(root); }, /多个草稿/);
});

test("renderIndexRisk：只在真的看到违规层级时才报警", function () {
  const normal = {
    render_index_track_mode_on: true,
    tracks: [
      { type: "video", segments: [{ target_timerange: { start: 0, end: 100 } }] },
      { type: "video", segments: [{ render_index: 1 }, { render_index: 2 }] },
    ],
  };
  assert.strictEqual(D.renderIndexRisk(normal), null, "主轨无 render_index、上层从 1 起属正常");

  const broken = {
    tracks: [
      { type: "video", segments: [{ render_index: 0 }] },
      { type: "video", segments: [{ render_index: 0 }, { render_index: 0 }] },
    ],
  };
  const risk = D.renderIndexRisk(broken);
  assert.ok(risk, "上层轨不超过主轨应判为有风险");
  assert.strictEqual(risk.videoTracks, 2);
  assert.strictEqual(risk.baseMax, 0);

  const single = { tracks: [{ type: "video", segments: [{ render_index: 0 }] }] };
  assert.strictEqual(D.renderIndexRisk(single), null, "单视频轨不判风险");

  // 无法判定（上层完全没有数值）时不能瞎报
  const unknown = {
    tracks: [
      { type: "video", segments: [{}] },
      { type: "video", segments: [{}] },
    ],
  };
  assert.strictEqual(D.renderIndexRisk(unknown), null);
});

test("exportDecryptedDraft：解密另存，原文件一个字节都不动", function () {
  const dir = tmpDir();
  const plain = JSON.stringify(baseDraft());
  const enc = encryptLikeJianYing(plain);
  const src = path.join(dir, "draft_content.json");
  fs.writeFileSync(src, enc, "utf8");

  const r = D.exportDecryptedDraft(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.encrypted, true);
  assert.strictEqual(path.basename(r.path), "draft_content.decrypted.json");
  assert.strictEqual(fs.readFileSync(r.path, "utf8"), plain);
  assert.strictEqual(fs.readFileSync(src, "utf8"), enc, "原草稿必须原样保留");
});
