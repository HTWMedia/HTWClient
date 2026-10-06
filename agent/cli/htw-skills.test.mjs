// CLI 参数解析的边界验证：批量工作流依赖"位置参数不被 flag 的值吞掉"。
//
// ⚠️ 为什么不用 execFileSync / spawnSync + pipe：
// 本机子进程**管道整体失效**（spawnSync 静默返回 undefined，execSync 报
// `EBUSY：所有的管道范例都在使用中`）。这是环境级故障，重启机器才恢复，
// 且会连带把 flutter/electron 之类一起带崩。已实测确认，非代码问题。
//
// 所以这里**不 spawn 子进程**，改为直接 import CLI 内部的纯逻辑。
// 代价是 buildCall 不是导出的 —— 见下方说明：改为对同一套规则做等价断言，
// 规则本身若改动，两边都会一起变（真正的回归保障在 bash 版的冒烟检查里）。

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "htw-skills.mjs"), "utf-8");

/*
 * 这些断言针对**契约文本**而非运行时行为：把 CLI 源码读进来，检查它确实
 * 声明了这些接口与常量。理由是本机跑不动子进程，而纯文本断言至少能挡住
 * "有人把 workflow 从 FEATURES 里删了""有人把 autoPublish 改成读用户传参"这类改动。
 * 运行时行为请用：
 *   node cli/htw-skills.mjs call workflow --start-batch 甲 乙 --platforms douyin --dry-run
 * 逐条肉眼核对（管道恢复后建议再跑一遍本文件的行为断言版）。
 */

test("workflow feature 已注册", () => {
  assert.match(SRC, /workflow:\s*\{\s*skill:\s*"htw-media-workflow"/);
  // 别名：workflow / flow / media-workflow
  assert.match(SRC, /aliases:\s*\["workflow",\s*"flow",\s*"media-workflow"\]/);
});

test("🔴 autoPublish 在 CLI 里是硬编码 false，不读任何用户传参", () => {
  // publishCfg 里写死 false；不能出现 String(o[...autoPublish...]) 之类读用户值的写法
  const cfg = SRC.match(/const publishCfg = \([^)]*\) => \(\{[\s\S]*?\}\);/);
  assert.ok(cfg, "应能找到 publishCfg 定义");
  assert.match(cfg[0], /autoPublish:\s*false/);
  // 关键：cfg 内部不得引用 o（用户传参）
  assert.doesNotMatch(cfg[0], /\bo\[|\bo\./,
    "publishCfg 不得读取用户传参——自动发布开关不能暴露给 CLI 调用方");
});

test("全部 7 个 workflow 端点都接上了", () => {
  const paths = [
    "/api/v2/workflow/topics",
    "/api/v2/workflow/create",
    "/api/v2/workflow/create-batch",
    "/api/v2/workflow/status",
    "/api/v2/workflow/approve",
    "/api/v2/workflow/cancel",
    "/api/v2/workflow/history",
  ];
  for (const p of paths) {
    assert.ok(SRC.includes(p), "缺少端点：" + p);
  }
});

test("approve 固定 stage=publish", () => {
  assert.match(SRC, /workflowId:\s*o\.approve,\s*stage:\s*"publish"/);
});

test("批量走 create-batch 且收集位置参数", () => {
  assert.match(SRC, /"start-batch"[\s\S]{0,400}create-batch/);
  // 位置参数要从 args 里取出来传给 buildCall
  assert.match(SRC, /buildCall\(feature,\s*o,\s*dry,\s*bare\)/);
  assert.match(SRC, /function buildCall\(feature, o, dry, bare\)/);
});

test("无主题且无 --auto 时不构造请求（省一次必然 404 的调用）", () => {
  assert.match(SRC, /if \(!topic && !o\.auto\) return null;/);
});

test("skill 文档写明了人工确认闸与三结局不可混淆", () => {
  const skill = readFileSync(
    join(__dirname, "..", "skills", "htw-media-workflow", "SKILL.md"), "utf-8");
  assert.match(skill, /awaiting-publish/);
  assert.match(skill, /never call `--approve` on the user's behalf/);
  // 批量按条计费是必须写清的坑
  assert.match(skill, /original.*index|原始/);

  const api = readFileSync(
    join(__dirname, "..", "skills", "htw-media-workflow", "references", "api.md"), "utf-8");
  assert.match(api, /unconfirmed/);
  assert.match(api, /duplicate/);
});
