import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * 面板注册一致性守卫。
 *
 * 加一个面板要改三处，漏任何一处的表现都很难查：
 *   ① index.html 有 `<section id="panel-X">` 与 `<button data-skill="X">`
 *   ② js/app.js 的 SKILLS 白名单里有 "X"
 *   ③ js/skills/X.js 存在并导出 mount
 *
 * 漏 ② 的症状最阴：**点导航按钮完全没反应，也不报任何错**——
 * showPanel只给白名单里的面板切 active。2026-10-03 加工作流面板时就踩了这个，
 * 靠 Electron 渲染探针才抓到（panelActive:false）。
 */

// 注意：这是 .mjs（ESM），没有 __dirname，必须用 import.meta.url 推导。
// 放成 .mjs 也让它能用 node --test 直接跑（.cjs 那套 require 写法在这里不适用）。
const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

const indexHtml = readFileSync(join(APP, "index.html"), "utf-8");
const appJs = readFileSync(join(APP, "js", "app.js"), "utf-8");
const panelJs = readFileSync(join(APP, "js", "skills", "workflow.js"), "utf-8");

function skillList() {
  const m = appJs.match(/const SKILLS = \[([^\]]*)\]/);
  assert.ok(m, "app.js 里应能读到 SKILLS 白名单");
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

test("index.html 里的每个 data-skill 都在 app.js 的 SKILLS 白名单里", () => {
  // 反向查：漏了白名单的面板会"点了没反应"，这是最容易漏的一处。
  // settings 例外——它由独立的 showSettings() 处理（不挂 Skills.*.mount），
  // 放进 SKILLS 反而会让它当普通面板处理。
  const SPECIAL = ["settings"];
  const navSkills = [...indexHtml.matchAll(/data-skill="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(navSkills.length >= 10, "导航项数量异常：" + navSkills.length);
  const list = skillList();
  for (const s of navSkills) {
    if (SPECIAL.includes(s)) continue;
    assert.ok(list.includes(s), `导航项 ${s} 不在 app.js 的 SKILLS 白名单里 —— 点它不会有反应`);
  }
});

test("settings 走独立分支，不该混进 SKILLS", () => {
  assert.ok(!skillList().includes("settings"), "settings 应由 showSettings() 单独处理");
  assert.match(appJs, /function showSettings\(/, "app.js 应有 showSettings 独立分支");
});

test("SKILLS 白名单里的每个面板都有对应的 section", () => {
  for (const s of skillList()) {
    assert.ok(indexHtml.includes(`id="panel-${s}"`), `SKILLS 里有 ${s} 但index.html 没有 panel-${s}`);
  }
});

test("workflow 面板三处注册齐全", () => {
  assert.ok(indexHtml.includes('data-skill="workflow"'), "缺导航按钮");
  assert.ok(indexHtml.includes('id="panel-workflow"'), "缺 panel 容器");
  assert.ok(indexHtml.includes('js/skills/workflow.js'), "缺 script 标签");
  assert.ok(skillList().includes("workflow"), "缺 app.js 白名单条目");
  assert.match(panelJs, /mount:\s*mount/, "workflow.js 未导出 mount");
});

test("batch 面板三处注册齐全", () => {
  assert.ok(indexHtml.includes('data-skill="batch"'), "缺导航按钮");
  assert.ok(indexHtml.includes('id="panel-batch"'), "缺 panel 容器");
  assert.ok(indexHtml.includes('js/skills/batch.js'), "缺 script 标签");
  assert.ok(skillList().includes("batch"), "缺 app.js 白名单条目");
  const batchJs = readFileSync(join(APP, "js", "skills", "batch.js"), "utf-8");
  assert.match(batchJs, /mount:\s*mount/, "batch.js 未导出 mount");
});

test("script 标签顺序：workflow 在 app.js 之前（app.js 要挨个 mount）", () => {
  const wf = indexHtml.indexOf("js/skills/workflow.js");
  const app = indexHtml.indexOf("js/app.js");
  assert.ok(wf >= 0 && app >= 0);
  assert.ok(wf < app, "workflow.js 必须在 app.js 之前加载，否则挂载时Skills.workflow 还不存在");
});
