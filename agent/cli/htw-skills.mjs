#!/usr/bin/env node
// htw-skills — CLI for the HTW media platform API.
// Key comes from the HTW_API_KEY environment variable ONLY.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = process.env.API_BASE || "https://htwmedia.dpdns.org";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_SRC = join(__dirname, "..", "skills");

const FEATURES = {
  insight: { skill: "htw-media-insight", aliases: ["insight", "analyze", "media-insight"] },
  create: { skill: "htw-media-create", aliases: ["create", "media-create"] },
  publish: { skill: "htw-media-publish", aliases: ["publish", "media-publish"] },
  tools: { skill: "htw-media-tools", aliases: ["tools", "tool", "media-tools"] },
  edit: { skill: "htw-media-edit", aliases: ["edit", "media-edit"] },
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
    "  list                          List the four skills",
    "  guide [feature]               Print the guide for a feature (default: all)",
    "  install [feature]             Copy skills into ~/.agents/skills (+ ~/.claude/skills)",
    "  call <feature> [options]      Call the HTW API (add --dry-run to preview)",
    "",
    "Features: insight | create | publish | tools | edit",
    "",
    "Examples:",
    "  htw-skills list",
    "  htw-skills guide insight",
    "  htw-skills install",
    "  htw-skills call insight --video https://www.douyin.com/video/123",
    "  htw-skills call edit --decrypt draft.json --dry-run",
    "  htw-skills call edit --draft-export draft.zip --dry-run",
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
    return { success: false, error: json.error || json.errMsg || `HTTP ${res.status}`, status: json.errCode || res.status, httpStatus: res.status };
  }
  // V2 envelope uses { ok, errMsg }; V1 uses { success, error }
  if (json.ok === false || json.success === false) {
    return { success: false, error: json.errMsg || json.error || "request failed", status: json.errCode || res.status, httpStatus: res.status, raw: json };
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

  if (!key() && !dry) { console.log(noKeyGuide()); return; }

  const build = buildCall(feature, o, dry);
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

function buildCall(feature, o, dry) {
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
    if (o.status) return req("GET", `/api/v2/edit/status/${encodeURIComponent(o.status)}`);
  }

  return null;
}

const UPLOAD_HINT = Symbol("upload-hint");

// Multipart uploads (files) are not JSON — guide the user to the curl form.
// `formFields` is an optional string of extra `-F "k=v"` segments.
function uploadHint(filePath, path, formFields = "") {
  console.log(`Upload via curl (multipart):\n  curl -H "AuthKey: <key>" -F "file=@${filePath}" ${formFields} ${API_BASE}${path}`);
  return UPLOAD_HINT;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(usage()); return; }
  switch (cmd) {
    case "list": await cmdList(); break;
    case "guide": cmdGuide(rest); break;
    case "install": cmdInstall(rest); break;
    case "call": await cmdCall(rest); break;
    default:
      if (!resolveFeature(cmd)) { console.log(`Unknown command: ${cmd}\n`); console.log(usage()); }
      else await cmdCall([cmd, ...rest]);
  }
}

main();
