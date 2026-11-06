#!/usr/bin/env node
// htw-skills — CLI for the HTW media platform API.
// Key comes from the HTW_API_KEY environment variable ONLY.
import { closeSync, cpSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

const API_BASE = process.env.API_BASE || "https://htwmedia.dpdns.org";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_SRC = join(__dirname, "..", "skills");

const FEATURES = {
  insight: { skill: "htw-media-insight", aliases: ["insight", "analyze", "media-insight"] },
  create: { skill: "htw-media-create", aliases: ["create", "media-create"] },
  topics: { skill: "htw-media-topics", aliases: ["topics", "topic", "media-topics"] },
  publish: { skill: "htw-media-publish", aliases: ["publish", "media-publish"] },
  tools: { skill: "htw-media-tools", aliases: ["tools", "tool", "media-tools"] },
  edit: { skill: "htw-media-edit", aliases: ["edit", "media-edit"] },
  workflow: { skill: "htw-media-workflow", aliases: ["workflow", "flow", "media-workflow"] },
};

function resolveFeature(arg) {
  if (!arg) return null;
  for (const [id, meta] of Object.entries(FEATURES)) {
    if (id === arg || meta.aliases.includes(arg)) return id;
  }
  return null;
}

function key() {
  return process.env.HTW_API_KEY || "";
}

function noKeyGuide() {
  return [
    "HTW_API_KEY is not set. No request was sent.",
    "1) Get a key:  POST https://htwmedia.dpdns.org/auth/applykey?email=<you>  with header  X-App-Source: HDraft",
    "2) Export it:",
    "   PowerShell:   $env:HTW_API_KEY = \"your-key\"",
    "   macOS/Linux:  export HTW_API_KEY=\"your-key\"",
    "3) Re-run this command.",
  ].join("\n");
}

function usage() {
  return [
    "htw-skills <command> [args]",
    "",
    "Commands:",
    "  draft <草稿.zip|目录>         剪映草稿 → 云端渲染 → 下载成片（一条命令）",
    "  list                          List the four skills",
    "  guide [feature]               Print the guide for a feature (default: all)",
    "  install [feature]             Copy skills into ~/.agents/skills (+ ~/.claude/skills)",
    "  call <feature> [options]      Call the HTW API (add --dry-run to preview)",
    "",
    "Features: insight | create | topics | publish | tools | edit | workflow",
    "",
    "Examples:",
    "  htw-skills draft \"C:\\Users\\me\\AppData\\Local\\JianyingPro\\...\\我的草稿\"",
    "  htw-skills draft my-draft.zip --out ./out",
    "  htw-skills list",
    "  htw-skills guide insight",
    "  htw-skills install",
    "  htw-skills call insight --video https://www.douyin.com/video/123",
    "  htw-skills call topics --daily",
    "  htw-skills call edit --decrypt draft.json --dry-run",
    "  htw-skills call edit --draft-export draft.zip --dry-run",
    "  htw-skills call workflow --topics",
    "  htw-skills call workflow --start --auto --platforms douyin",
  ].join("\n");
}

function guideFor(id) {
  const meta = FEATURES[id];
  const file = join(SKILLS_SRC, meta.skill, "SKILL.md");
  return existsSync(file) ? `# ${id}\n\n${readFileSync(file)}` : `No skill found for '${id}'.`;
}

async function callApi(path, { method = "GET", body, form, query = "" } = {}) {
  const k = key();
  const url = `${API_BASE}${path}${query ? "?" + query : ""}`;
  const headers = { AuthKey: k, "X-App-Source": "HDraft" };
  let payload = null;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { success: false, error: text.slice(0, 500) }; }
  if (!res.ok) {
    return { success: false, error: json.ErrMsg || json.error || json.errMsg || `HTTP ${res.status}`, status: json.ErrCode || json.errCode || res.status, httpStatus: res.status };
  }
  // 服务端是 Newtonsoft 默认契约 → 信封键是 PascalCase 的 { Ok, Data, ErrCode, TaskId }。
  // 这里两种写法都认：FailApi 两参（HTTP 200 + ErrCode）只能靠 Ok 字段判别，漏了就会把
  // 失败当成功返回（CLI 只是 printResult，肉眼很难发现）。
  const ok = json.Ok !== undefined ? json.Ok : json.ok;
  if (ok === false || json.success === false) {
    return {
      success: false,
      error: json.ErrMsg || json.errMsg || json.error || "request failed",
      status: json.ErrCode || json.errCode || res.status,
      httpStatus: res.status,
      raw: json,
    };
  }
  return json;
}

function printResult(r) {
  console.log(JSON.stringify(r, null, 2));
}

function parseKeyValues(argv) {
  // "--key value" pairs; flags that take no value end with ":" (not used here)
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { out[a.slice(2)] = next; i++; }
    else { out[a.slice(2)] = true; }
  }
  return out;
}

// ---------- command implementations ----------

async function cmdList() {
  console.log("Installed HTW media skills:");
  for (const [id, meta] of Object.entries(FEATURES)) {
    console.log(`  ${id.padEnd(9)} -> ${meta.skill}`);
  }
}

function cmdGuide(args) {
  const target = args[0];
  if (target) {
    const id = resolveFeature(target);
    if (!id) { console.log(`No skill found for '${target}'.`); return; }
    console.log(guideFor(id));
    return;
  }
  for (const id of Object.keys(FEATURES)) console.log(guideFor(id));
}

function copySkills(force, featureId) {
  const homes = [join(homedir(), ".agents", "skills")];
  if (existsSync(join(homedir(), ".claude"))) homes.push(join(homedir(), ".claude", "skills"));
  for (const dest of homes) {
    mkdirSync(dest, { recursive: true });
    const items = featureId ? [FEATURES[featureId].skill] : readdirSync(SKILLS_SRC);
    for (const name of items) {
      cpSync(join(SKILLS_SRC, name), join(dest, name), { recursive: true, force: true });
      console.log(`  installed ${name} -> ${join(dest, name)}`);
    }
  }
  return homes;
}

function cmdInstall(args) {
  const opts = parseKeyValues(args);
  const featureId = args.find((a) => !a.startsWith("--"));
  const id = featureId ? resolveFeature(featureId) : null;
  if (featureId && !id) { console.log(`Unknown feature: ${featureId}`); return; }
  const homes = copySkills(true, id);
  console.log("\n已安装到以下位置：");
  for (const h of homes) console.log(`  ${h}`);
  console.log("\n下一步：设置 HTW_API_KEY（PowerShell: $env:HTW_API_KEY=\"...\"; macOS/Linux: export HTW_API_KEY=\"...\"）");
  console.log("然后运行：htw-skills list");
}

async function cmdCall(args) {
  const dry = args.includes("--dry-run");
  const featureArg = args.find((a) => !a.startsWith("--"));
  const feature = resolveFeature(featureArg);
  if (!feature) { console.log(usage()); return; }
  const o = parseKeyValues(args);

  // 原始位置参数（批量工作流要收集多个主题）。parseKeyValues 只认"--key value"，
  // 裸词会被忽略，所以这里单独取一份：feature 名之后、不属于任何 --flag 值的那些。
  const bare = [];
  for (let i = args.indexOf(featureArg) + 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      // 跳过 "--key value" 里的 value，它已被 parseKeyValues 消费
      if (args[i + 1] !== undefined && !args[i + 1].startsWith("--")) i++;
      continue;
    }
    bare.push(a);
  }

  if (!key() && !dry) { console.log(noKeyGuide()); return; }

  const build = buildCall(feature, o, dry, bare);
  if (!build) { console.log(`Invalid arguments for '${feature}'. See: htw-skills guide ${feature}`); return; }
  if (build === UPLOAD_HINT) return;

  if (dry) {
    console.log(`[dry-run] ${build.method} ${API_BASE}${build.path}`);
    if (build.query) console.log(`  query: ${build.query}`);
    if (build.body !== undefined) console.log(`  body: ${JSON.stringify(build.body)}`);
    console.log("  header: AuthKey=<redacted>");
    return;
  }
  printResult(await callApi(build.path, build));
}

function buildCall(feature, o, dry, bare) {
  const req = (method, path, body, query) => ({ method, path, body, query });

  if (feature === "insight") {
    if (o.video) return req("POST", "/api/v2/insight/analyze-video", { url: o.video });
    if (o.account) return req("POST", "/api/v2/insight/analyze-account", { url: o.account });
    if (o.copy) return req("POST", "/api/v2/insight/analyze-copy", { text: o.copy });
    if (o.hot) return req("GET", "/api/v2/insight/hot-rankings");
    if (o.search) return req("POST", "/api/v2/insight/search", { platform: o.platform || "xhs", keyword: o.search, count: Number(o.count || 20) });
  }

  if (feature === "create") {
    if (o.topic && !o["session-id"]) return req("POST", "/api/v2/creation/start", { type: o.type || "video", topic: o.topic, videoTypeId: o["video-type-id"] || "kol" });
    if (o["session-id"] && o.approve) return req("POST", "/api/v2/creation/approve", { sessionId: o["session-id"], type: o.type || "video" });
    if (o["session-id"] && o.regenerate) return req("POST", "/api/v2/creation/regenerate", { sessionId: o["session-id"], instruction: o.regenerate, type: o.type || "video" });
    if (o["session-id"] && o.refine) return req("POST", "/api/v2/creation/refine", { sessionId: o["session-id"], message: o.refine, type: o.type || "video" });
    if (o["session-id"] && o["toggle-step"]) return req("POST", "/api/v2/creation/toggle-step", { sessionId: o["session-id"], stepId: o["toggle-step"], enabled: String(o.enabled) !== "false", type: o.type || "video" });
    if (o["session-id"] && o.status) return req("GET", "/api/v2/creation/status", undefined, `sessionId=${encodeURIComponent(o["session-id"])}&type=${encodeURIComponent(o.type || "video")}`);
  }

  // 选题雷达：看选题、管对标账号、维护垂类画像、走采纳→发布→回测闭环。
  // 请求体用驼峰：ASP.NET 的模型绑定大小写不敏感，与后端 POCO 字段能对上。
  if (feature === "topics") {
    if (o.daily) return req("GET", "/api/v2/topics/daily", undefined, `count=${encodeURIComponent(o.count || 6)}`);
    if (o.trends) return req("GET", "/api/v2/topics/trends", undefined, `category=${encodeURIComponent(o.category || "")}&count=${encodeURIComponent(o.count || 60)}`);
    if (o.health) return req("GET", "/api/v2/topics/health");
    if (o.radar) return req("GET", "/api/v2/topics/radar/accounts");
    if (o["radar-add"]) return req("POST", "/api/v2/topics/radar/accounts", { platform: o.platform || "douyin", url: o["radar-add"] === true ? (o.url || "") : o["radar-add"] });
    if (o["radar-remove"]) return req("DELETE", `/api/v2/topics/radar/accounts/${encodeURIComponent(o["radar-remove"])}`);
    if (o["radar-sample"]) return req("POST", "/api/v2/topics/radar/sample", {});
    if (o.alerts) return req("GET", "/api/v2/topics/radar/alerts");
    if (o["alert-dismiss"]) return req("POST", `/api/v2/topics/radar/alerts/${encodeURIComponent(o["alert-dismiss"])}/dismiss`, {});
    // --profile-save 要排在 --profile 前面：两者是不同的键，但先判写操作更符合直觉
    if (o["profile-save"]) return req("PUT", "/api/v2/topics/profile", {
      platforms: String(o.platforms || "").split(",").map((s) => s.trim()).filter(Boolean),
      includeKeywords: String(o.include || "").split(",").map((s) => s.trim()).filter(Boolean),
      excludeKeywords: String(o.exclude || "").split(",").map((s) => s.trim()).filter(Boolean),
      audience: o.audience || "",
    });
    if (o.profile) return req("GET", "/api/v2/topics/profile");
    if (o.feedback) return req("POST", "/api/v2/topics/feedback", { topicTitle: o.feedback === true ? (o.title || "") : o.feedback, reason: o.reason || "不感兴趣" });
    if (o.adopt) return req("POST", "/api/v2/topics/outcome/adopt", { topicId: o.adopt, title: o.title || "", score: Number(o.score || 0) });
    if (o.published) return req("POST", "/api/v2/topics/outcome/publish", { topicId: o.published, platform: o.platform || "", url: o.url || "" });
    if (o.metrics) return req("POST", "/api/v2/topics/outcome/metrics", { topicId: o.metrics, views: Number(o.views || 0), likes: Number(o.likes || 0), comments: Number(o.comments || 0) });
    if (o["outcome-stats"]) return req("GET", "/api/v2/topics/outcome/stats");
  }

  if (feature === "publish") {
    if (o.submit) {
      const platforms = String(o.platforms || "douyin").split(",").map((p) => ({ platformId: p.trim(), creativeStatement: "none", savePermission: "deny" }));
      return req("POST", "/api/v2/publish/submit", {
        title: o.title || "", content: o.content || "",
        tags: (o.tags || "").split(",").map((s) => s.trim()).filter(Boolean),
        mediaUrls: (o["media-urls"] || "").split(",").map((s) => s.trim()).filter(Boolean),
        isDraft: o["is-draft"] === "true", platforms,
      });
    }
    if (o.status) return req("GET", "/api/v2/publish/task-status", undefined, `taskId=${encodeURIComponent(o.status)}`);
    if (o.queue) return req("GET", "/api/v2/publish/queue-status");
    if (o.history) return req("GET", "/api/v2/publish/history");
    if (o.retry) return req("POST", "/api/v2/publish/retry", { subTaskId: o.retry });
    if (o.compliance) return req("POST", "/api/v2/publish/check-compliance", { content: o.content || "", platform: o.platform || "" });
    if (o["tags-gen"]) return req("POST", "/api/v2/publish/generate-tags", { title: o.title || "", content: o.content || "", platform: o.platform || "" });
    if (o["content-gen"]) return req("POST", "/api/v2/publish/generate-content", { title: o.title || "", mediaHint: o["media-hint"] || "", platform: o.platform || "" });
    if (o["platform-status"]) return req("GET", "/api/v2/publish/platform-status");
  }

  // 全链路工作流：一次发起，服务端把出片→包装→文案合规→发布跑完，你只管轮询与确认。
  // ⚠️ auto-publish 刻意不暴露开关：发布用客户自己的平台凭证自动化发帖会违反平台 ToS，
  //    最后一步必须人点（服务端也强制 autoPublish=false）。
  if (feature === "workflow") {
    const publishCfg = (platforms) => ({
      platforms: String(platforms || "douyin").split(",").map((p) => p.trim()).filter(Boolean),
      autoPublish: false,
    });
    if (o.topics) return req("GET", "/api/v2/workflow/topics", undefined, `count=${encodeURIComponent(o.count || 6)}`);
    if (o["start-batch"]) {
      const list = o["start-batch"] === true ? bare : [o["start-batch"], ...bare];
      const topics = list.map((s) => String(s).trim()).filter(Boolean);
      if (!topics.length) return null;
      return req("POST", "/api/v2/workflow/create-batch", {
        topics,
        style: o.style || "", ratio: o.ratio || "", mode: o.mode || "",
        length: o.length || "", voice: o.voice || "", referenceText: o.reference || "",
        publish: publishCfg(o.platforms),
      });
    }
    if (o.start) {
      // 两种写法都认：`--start "主题"` 与 `--start --topic "主题"`。
      // 前者更短，后者与其他 feature（--topic 是独立flag）的心智模型一致。
      const topic = o.start === true ? (o.topic || "") : String(o.start);
      if (!topic && !o.auto) return null;
      return req("POST", "/api/v2/workflow/create", {
        topic,
        topicSource: !topic && o.auto ? "auto" : "",
        style: o.style || "", ratio: o.ratio || "", mode: o.mode || "",
        length: o.length || "", voice: o.voice || "", referenceText: o.reference || "",
        publish: publishCfg(o.platforms),
      });
    }
    if (o.status) return req("GET", "/api/v2/workflow/status", undefined, `workflowId=${encodeURIComponent(o.status)}`);
    if (o.approve) return req("POST", "/api/v2/workflow/approve", { workflowId: o.approve, stage: "publish" });
    if (o.cancel) return req("POST", "/api/v2/workflow/cancel", { workflowId: o.cancel });
    if (o.history) return req("GET", "/api/v2/workflow/history", undefined, `limit=${encodeURIComponent(o.limit || 30)}`);
  }

  if (feature === "tools") {
    if (o["audio-upload"] && o.convert) return req("POST", "/api/v2/voice/transcribe", { fileId: o["audio-upload"], format: o.format || "txt" });
    if (o["audio-upload"] && o.translate) return req("POST", "/api/v2/voice/translate", { fileId: o["audio-upload"], language: o.language || "zh-CHS" });
    if (o["audio-upload"] && o.summarize) return req("POST", "/api/v2/voice/summarize", { fileId: o["audio-upload"] });
    if (o["audio-upload"] && o.separate) return req("POST", "/api/v2/voice/separate", { fileId: o["audio-upload"], type: "human" });
    if (o["audio-upload"] && o.lyrics) return req("POST", "/api/v2/voice/lyrics", { fileId: o["audio-upload"] });
    if (o.tts) return req("POST", "/api/v2/voice/tts", { text: o.text || "", speaker: o.speaker || "zh_female_qinglengnv" });
    if (o["audio-status"]) return req("GET", `/api/v2/voice/status/${encodeURIComponent(o["audio-status"])}`);
    // subtitle extraction (v2)
    if (o.subtitle) {
      const f = `-F "format=${o.format || "txt"}" -F "engine=${o.engine || "ocr"}"`;
      return uploadHint(o.subtitle, "/api/v2/subtitle/extract", f);
    }
    if (o["subtitle-status"]) return req("GET", `/api/v2/subtitle/status/${encodeURIComponent(o["subtitle-status"])}`);
    if (o["image-gen"]) return req("POST", "/api/v2/image/generate", { prompt: o["image-gen"] === true ? (o.prompt || "") : o["image-gen"], model: o.model || "v4.5", ratio: o.ratio || "1:1", resolution: o.resolution || "2k", sampleStrength: Number(o["sample-strength"] || 0.5), negativePrompt: o["negative-prompt"] || "" });
    if (o.recognize) return uploadHint(o.recognize, "/api/v2/image/recognize");
    // template search (v2)
    if (o["template-search"]) return req("GET", "/api/v2/template/search", undefined, `keyword=${encodeURIComponent(o["template-search"])}&page=${encodeURIComponent(o.page || 1)}&pageSize=${encodeURIComponent(o["page-size"] || 20)}`);
    if (o.agent) {
      if (o["one-click"] || !o.theme) {
        return req("POST", "/api/v2/agent/one-click", {
          topic: o.agent === true ? (o.topic || "") : o.agent,
          platform: o.platform || "default",
          length: o.length || "medium",
          style: o.style || "default",
          ratio: o.ratio || "16:9",
          mode: o.mode || "quick",
          referenceText: o["reference-text"] || "",
          voice: o.voice || "",
        });
      }
      return req("POST", "/api/v2/agent/start", { theme: o.agent === true ? (o.theme || "") : o.agent, platform: o.platform || "Default", scriptLength: o["script-length"] || "Medium", mode: o.mode || "Quick" });
    }
  }

  if (feature === "edit") {
    if (o["coarse-cut"]) {
      const f = `-F "voice=${o.voice || "zh-CN-XiaoxiaoNeural"}" -F "durationMin=${o["duration-min"] || 60}" -F "durationMax=${o["duration-max"] || 180}"` + (o.blur ? ` -F "blur=true"` : "");
      return uploadHint(o["coarse-cut"], "/api/v2/edit/coarse-cut", f);
    }
    if (o["draft-export"]) return uploadHint(o["draft-export"], "/api/v2/edit/draft-export");
    if (o.decrypt) return uploadHint(o.decrypt, "/api/v2/edit/decrypt");
    if (o["super-res"]) {
      const f = `-F "width=${o.width || 1708}" -F "height=${o.height || 960}"`;
      return uploadHint(o["super-res"], "/api/v2/edit/super-res", f);
    }
    // 剪同款（--cut-same / --cut-same-search）已于 2026-11-06 下线，服务端返回 410：
    // 它要下载剪映的模板包并替换模板作者的素材，模板/素材版权属于剪映及模板作者，
    // 站外提供同类服务已有生效判决认定构成不正当竞争。这里保留一句提示而不是直接删选项，
    // 免得老脚本失败时只看到 410 不知道发生了什么。
    if (o["cut-same-search"] || o["cut-same"]) {
      return { success: false, error: "剪同款已下线：模板与素材版权属于剪映及模板作者，本站不再提供。用自己的工程出片请用 --draft-export。" };
    }
    if (o.status) return req("GET", `/api/v2/edit/status/${encodeURIComponent(o.status)}`);
  }

  return null;
}

const UPLOAD_HINT = Symbol("upload-hint");

// Multipart uploads (files) are not JSON — guide the user to the curl form.
// `formFields` is an optional string of extra `-F "k=v"` segments;
// `fileField` defaults to `file` (端点收取多个文件时用 `videos` 之类，且可重复)。
function uploadHint(filePath, path, formFields = "", fileField = "file") {
  console.log(`Upload via curl (multipart):\n  curl -H "AuthKey: <key>" -F "${fileField}=@${filePath}" ${formFields} ${API_BASE}${path}`);
  return UPLOAD_HINT;
}

// ---------- 草稿 → 成片：一条命令跑完整条链路 ----------
//
// 这条路走 /api/v2/edit/draft-export（服务端 DraftExportService：剪映草稿包 → 云端成片）。
// 之前 edit --draft-export 只会打印一条 curl 提示，等于把"唯一别人做不了的事"关在门外。

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crcUpdate(crc, buf) {
  let c = crc ^ -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosStamp(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function crcOfFile(p) {
  return new Promise((res, rej) => {
    let crc = 0;
    const rs = createReadStream(p);
    rs.on("data", (c) => { crc = crcUpdate(crc, c); });
    rs.on("end", () => res(crc >>> 0));
    rs.on("error", rej);
  });
}

function appendFileBytes(outFd, p) {
  const inFd = openSync(p, "r");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const n = readSync(inFd, buf, 0, buf.length, null);
      if (n <= 0) break;
      writeSync(outFd, buf, 0, n);
    }
  } finally {
    closeSync(inFd);
  }
}

/**
 * 把草稿文件夹打成 ZIP（store-only，不压缩）。
 *
 * 素材本来就是已压缩的音视频，deflate 收益极低；而 store-only 可以边读边写、
 * 不需要把几百 MB 素材读进内存。CRC 先扫一遍再写头，是因为 ZIP 的本地头必须
 * 带 CRC —— 用数据描述符能省这一趟，但 .NET 的 ZipArchive 对它的兼容性不值这趟风险。
 */
async function zipFolder(srcDir, zipPath) {
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) files.push({ abs, rel: relative(srcDir, abs).split(sep).join("/") });
    }
  })(srcDir);

  const { time, date } = dosStamp();
  const outFd = openSync(zipPath, "w");
  const central = [];
  let offset = 0;
  try {
    for (const f of files) {
      const st = statSync(f.abs);
      const nameBuf = Buffer.from(f.rel, "utf8");
      const crc = await crcOfFile(f.abs);
      const size = st.size;

      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(0x0800, 6);
      lh.writeUInt16LE(0, 8);
      lh.writeUInt16LE(time, 10);
      lh.writeUInt16LE(date, 12);
      lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(size, 18);
      lh.writeUInt32LE(size, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(0, 28);

      writeSync(outFd, lh);
      writeSync(outFd, nameBuf);
      appendFileBytes(outFd, f.abs);

      central.push({ nameBuf, crc, size, offset });
      offset += 30 + nameBuf.length + size;
    }

    const cdStart = offset;
    for (const c of central) {
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(20, 4);
      ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0x0800, 8);
      ch.writeUInt16LE(0, 10);
      ch.writeUInt16LE(time, 12);
      ch.writeUInt16LE(date, 14);
      ch.writeUInt32LE(c.crc, 16);
      ch.writeUInt32LE(c.size, 20);
      ch.writeUInt32LE(c.size, 24);
      ch.writeUInt16LE(c.nameBuf.length, 28);
      ch.writeUInt16LE(0, 30);
      ch.writeUInt16LE(0, 32);
      ch.writeUInt16LE(0, 34);
      ch.writeUInt16LE(0, 36);
      ch.writeUInt32LE(0, 38);
      ch.writeUInt32LE(c.offset, 42);
      writeSync(outFd, ch);
      writeSync(outFd, c.nameBuf);
      offset += 46 + c.nameBuf.length;
    }

    const cdSize = offset - cdStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    writeSync(outFd, eocd);
  } finally {
    closeSync(outFd);
  }
  return files.length;
}

function hasDraftContent(dir) {
  let hit = false;
  (function walk(d) {
    if (hit) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (hit) return;
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name === "draft_content.json") hit = true;
    }
  })(dir);
  return hit;
}

function asciiFileName(p) {
  // Content-Disposition 里放原文名，非 ASCII 在部分反代上会被截断/乱码。
  // 服务端只用扩展名做校验，稳定的 ASCII 名称更安全。
  const ext = extname(p) || ".zip";
  return "draft" + ext.replace(/[^\x20-\x7e]/g, "");
}

function uploadMultipart(filePath, path, { field = "file", fields = {} } = {}) {
  return new Promise((resolvePromise, reject) => {
    const boundary = "----htw" + Math.random().toString(16).slice(2);
    const size = statSync(filePath).size;
    let head = "";
    for (const [k, v] of Object.entries(fields)) {
      head += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    }
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${asciiFileName(filePath)}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;

    const url = new URL(API_BASE + path);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          AuthKey: key(),
          "X-App-Source": "HTWClient",
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": Buffer.byteLength(head) + size + Buffer.byteLength(tail),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { buf += c; });
        res.on("end", () => {
          let json;
          try { json = JSON.parse(buf); } catch { json = { Ok: false, ErrMsg: buf.slice(0, 500) || `HTTP ${res.statusCode}` }; }
          resolvePromise({ httpStatus: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    req.write(head);
    const rs = createReadStream(filePath);
    rs.on("error", reject);
    rs.pipe(req, { end: false });
    rs.on("end", () => req.end(tail));
  });
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

async function waitForTask(taskId, { quiet = false, intervalMs = 5000, timeoutMs = 45 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  let lastShown = "";
  for (;;) {
    const r = await callApi(`/api/v2/edit/status/${encodeURIComponent(taskId)}`);
    if (r.success === false) return { ok: false, error: r.error };
    const d = r.Data || {};
    const st = d.status || "";
    const shown = `${st}${d.progress !== undefined && d.progress !== null ? " " + d.progress + "%" : ""}`;
    if (!quiet && shown !== lastShown) {
      console.log(`  任务状态: ${shown}${d.currentStep ? " · " + d.currentStep : ""}`);
      lastShown = shown;
    }
    if (st === "completed") return { ok: true, data: d };
    if (TERMINAL.has(st)) return { ok: false, error: d.error || `任务${st}`, data: d };
    if (Date.now() - t0 > timeoutMs) return { ok: false, error: "等待超时，任务可能仍在服务端渲染", data: d };
    await new Promise((r2) => setTimeout(r2, intervalMs));
  }
}

async function downloadTo(url, destPath) {
  const abs = /^https?:\/\//i.test(url) ? url : API_BASE + (url.startsWith("/") ? url : "/" + url);
  const res = await fetch(abs);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  return buf.length;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function cmdDraft(args) {
  const input = args[0] && !args[0].startsWith("--") ? args[0] : "";
  const o = parseKeyValues(args.slice(1));
  const quiet = o.json === true;
  const log = (...a) => { if (!quiet) console.log(...a); };

  if (!input) {
    console.log("用法: htw-skills draft <草稿.zip | 草稿文件夹> [--out <目录>] [--no-wait] [--json]");
    process.exitCode = 2;
    return;
  }
  if (!key()) { console.log(noKeyGuide()); process.exitCode = 3; return; }

  const src = resolve(input);
  if (!existsSync(src)) { console.log(`找不到路径: ${src}`); process.exitCode = 2; return; }

  let zipPath = src;
  let tempZip = "";
  const isDir = statSync(src).isDirectory();
  if (isDir) {
    if (!hasDraftContent(src)) {
      console.log(`这个文件夹里没有 draft_content.json，不是剪映草稿目录: ${src}`);
      console.log("提示：剪映里右键草稿 →「打开草稿文件夹」，填那个目录。");
      process.exitCode = 2;
      return;
    }
    tempZip = join(tmpdir(), `htw-draft-${Date.now()}.zip`);
    log(`打包草稿目录 → ${basename(tempZip)} …`);
    const n = await zipFolder(src, tempZip);
    log(`  已打包 ${n} 个文件 (${(statSync(tempZip).size / 1048576).toFixed(1)} MB)`);
    zipPath = tempZip;
  } else if (extname(src).toLowerCase() !== ".zip") {
    console.log(`请传 .zip 或草稿文件夹，收到: ${basename(src)}`);
    process.exitCode = 2;
    return;
  }

  try {
    log(`上传中: ${basename(zipPath)} (${(statSync(zipPath).size / 1048576).toFixed(1)} MB) …`);
    const up = await uploadMultipart(zipPath, "/api/v2/edit/draft-export");
    const body = up.json || {};
    if (body.Ok === false || up.httpStatus >= 400) {
      const code = body.ErrCode || up.httpStatus;
      console.log(`提交失败（${code}）: ${body.ErrMsg || "未知错误"}`);
      if (code === 402) console.log("额度用完，充值页: " + API_BASE + "/Home/Recharge");
      process.exitCode = code === 402 ? 4 : 1;
      return;
    }
    const taskId = body.TaskId || (body.Data && body.Data.taskId);
    if (!taskId) { console.log("服务端没返回 taskId: " + JSON.stringify(body).slice(0, 300)); process.exitCode = 1; return; }
    log(`已提交，taskId=${taskId}`);
    const warnings = body.Data && body.Data.warnings;
    if (Array.isArray(warnings) && warnings.length) log(`  警告 ${warnings.length} 条（素材缺失等），仍会继续渲染`);

    if (o["no-wait"] === true) {
      if (quiet) console.log(JSON.stringify({ taskId }));
      else console.log(`\n不等待。之后可查: htw-skills call edit --status ${taskId}`);
      return;
    }

    const r = await waitForTask(taskId, { quiet });
    if (!r.ok) {
      console.log(`\n渲染失败: ${r.error}`);
      if (r.data && r.data.downloadUrl) console.log("部分产物: " + r.data.downloadUrl);
      process.exitCode = 1;
      return;
    }

    const url = r.data.downloadUrl;
    if (!url) { console.log("任务完成但没拿到成片地址: " + JSON.stringify(r.data).slice(0, 300)); process.exitCode = 1; return; }

    const outDir = o.out ? resolve(o.out) : dirname(zipPath === tempZip ? src : zipPath);
    mkdirSync(outDir, { recursive: true });
    const baseName = isDir ? basename(src) : basename(src, extname(src));
    const dest = join(outDir, `${baseName}-成片-${stamp()}.mp4`);
    log("下载成片 …");
    const bytes = await downloadTo(url, dest);
    if (quiet) console.log(JSON.stringify({ taskId, file: dest, bytes }));
    else console.log(`\n完成: ${dest} (${(bytes / 1048576).toFixed(1)} MB)`);
  } finally {
    if (tempZip && existsSync(tempZip)) {
      try { unlinkSync(tempZip); } catch { /* 临时文件删不掉不影响结果 */ }
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(usage()); return; }
  switch (cmd) {
    case "list": await cmdList(); break;
    case "guide": cmdGuide(rest); break;
    case "install": cmdInstall(rest); break;
    case "call": await cmdCall(rest); break;
    case "draft": await cmdDraft(rest); break;
    default:
      if (!resolveFeature(cmd)) { console.log(`Unknown command: ${cmd}\n`); console.log(usage()); }
      else await cmdCall([cmd, ...rest]);
  }
}

main();
