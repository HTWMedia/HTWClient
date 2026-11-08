import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * 免 AuthKey 钩子的装配守卫。
 *
 * 这条链路的价值全在"**不经过网络**"上：它必须在没有 AuthKey 的情况下可用，
 * 而一旦有人后来给它补上 `resolveBase(...)` / `apiKey` 参数，功能表面上照跑，
 * 但"免费、离线、不注册"这个卖点就悄悄没了 —— 而且不会有任何报错。
 *
 * 静态守卫只看形状，验不了运行时；它的作用是钉住"这条通道不许带上服务端参数"
 * 这个约定，真正行为由 draft-local.test.cjs 与 draftcheck.mount.test.cjs 覆盖。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

const mainJs = readFileSync(join(APP, "main.js"), "utf-8");
const preloadJs = readFileSync(join(APP, "preload.js"), "utf-8");
const indexHtml = readFileSync(join(APP, "index.html"), "utf-8");
const appJs = readFileSync(join(APP, "js", "app.js"), "utf-8");
const panelJs = readFileSync(join(APP, "js", "skills", "draftcheck.js"), "utf-8");

test("主进程：三条本地通道都注册了，且走的是纯本地模块", () => {
  assert.ok(/require\("\.\/js\/draft-local\.js"\)/.test(mainJs), "main.js 应引入 js/draft-local.js");
  ["htw:draftPickFolder", "htw:draftInspect", "htw:draftExport"].forEach((ch) => {
    assert.match(mainJs, new RegExp('ipcMain\\.handle\\("' + ch + '"'), "缺通道：" + ch);
  });
  assert.match(mainJs, /draftLocal\.inspectDraftFolder\(/, "体检通道必须调本地解析");
  assert.match(mainJs, /draftLocal\.exportDecryptedDraft\(/, "导出通道必须调本地导出");
});

test("主进程：体检失败返回 ok:false + 中文原因，不抛到渲染层", () => {
  const start = mainJs.indexOf('ipcMain.handle("htw:draftInspect"');
  assert.ok(start >= 0);
  const body = mainJs.slice(start, mainJs.indexOf("ipcMain.handle(\"htw:draftExport\""));
  assert.match(body, /ok:\s*false/, "失败要回结构化结果（渲染层按 ok 判）");
  assert.match(body, /err\.message/, "原因要透传（多个草稿/找不到文件这类话必须给到用户）");
  assert.match(body, /try\s*\{/, "IPC 里必须自己接异常，抛出去渲染层只会看到一坨英文");
});

test("preload：三条通道不带服务端参数（不许出现 base / apiKey）", () => {
  ["draftPickFolder", "draftInspect", "draftExport"].forEach((name) => {
    assert.match(preloadJs, new RegExp("\\b" + name + "\\s*:"), "preload 未暴露 " + name);
  });
  // 从 draftPickFolder 到下一个键 openExternal 之间就是这三条通道本身；
  // 不能把范围放到 localStart —— 中间夹着 subscribeTask（它本来就该带 base/apiKey）。
  const start = preloadJs.indexOf("draftPickFolder:");
  const end = preloadJs.indexOf("openExternal:", start);
  assert.ok(start >= 0 && end > start, "找不到草稿通道所在的代码段");
  const block = preloadJs.slice(start, end);
  assert.ok(!/resolveBase|isAllowedBase|apiKey/.test(block),
    "草稿体检通道不该出现服务端地址/密钥 —— 它是离线能力，带上就说明被挂回网络链路了");
});

test("渲染层：整个面板不发任何请求", () => {
  assert.ok(!/HTWApi/.test(panelJs), "draftcheck.js 不应依赖 HTWApi（那意味着要 Key）");
  assert.ok(!/\/api\//.test(panelJs), "draftcheck.js 不应出现接口路径");
  assert.ok(!/\bfetch\s*\(/.test(panelJs), "draftcheck.js 不应自己发请求");
});

test("导航/面板/脚本三处注册齐全，且脚本在 app.js 之前", () => {
  assert.ok(indexHtml.includes('data-skill="draftcheck"'), "缺导航按钮");
  assert.ok(indexHtml.includes('id="panel-draftcheck"'), "缺 panel 容器");
  assert.ok(indexHtml.includes("js/skills/draftcheck.js"), "缺 script 标签");
  const panel = indexHtml.indexOf("js/skills/draftcheck.js");
  const app = indexHtml.indexOf("js/app.js");
  assert.ok(panel >= 0 && app >= 0 && panel < app, "draftcheck.js 必须在 app.js 之前加载");
  const m = appJs.match(/const SKILLS = \[([^\]]*)\]/);
  assert.ok(m && /draftcheck/.test(m[1]), "app.js 的 SKILLS 里缺 draftcheck —— 点导航会没反应");
});

test("没有 AuthKey 时不在草稿体检面板上弹阻断提示", () => {
  // refreshKeyUI 的条件必须显式豁免 draftcheck：否则用户点开唯一能用的面板，
  // 顶上却写着"以下功能将无法使用"。
  const m = appJs.match(/const isDraftCheck[^;]*;/);
  assert.ok(m, "refreshKeyUI 里应有 draftcheck 的豁免判断（isDraftCheck）");
  assert.match(appJs, /!has\s*&&\s*!isSettings\s*&&\s*!isAssistant\s*&&\s*!isDraftCheck/,
    "提示条件必须把 isDraftCheck 排除掉");
});

test("面板说明已补（切到该面板时标题下要有话说）", () => {
  const m = appJs.match(/const SKILL_DESCRIPTIONS = \{([\s\S]*?)\n  \};/);
  assert.ok(m && /\bdraftcheck\s*:/.test(m[1]), "SKILL_DESCRIPTIONS 里缺 draftcheck");
});
