# -*- coding: utf-8 -*-
"""10 发布与任务中心"""
from record_module import Scene

SCENES = [
    Scene(
        "发布面板管理内容分发：发布编辑、任务队列、历史记录和 Cookie 配置四个页签。在发布编辑里填入标题与正文，可以点击 AI 生成文案让系统帮你写，再跑一次合规检测，确认没有违规词。",
        sub="发布 Publish：AI 文案 · 合规检测 · 多平台分发",
        run=lambda d: (d.nav("发布 Publish"), d.sleep(1), d.js('''(() => {
          const p = document.getElementById("panel-publish");
          const i = p.querySelector("input[type=text]");
          if (i) {
            const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            s.call(i, "秋日旅行 Vlog：三天两晚的治愈之旅");
            i.dispatchEvent(new Event("input", {bubbles: true}));
          }
          return "ok";
        })()'''), d.btn("AI 生成文案"), d.sleep(8))),

    Scene(
        "上传媒体和封面后，配置对应平台的 Cookie，即可提交发布。发布前系统会做合规检测并提示检测结果；Cookie 失效时这里也会给出明确的重新配置提示。",
        sub="媒体 + Cookie 就绪 → 合规检测 → 提交发布",
        run=lambda d: (d.btn("任务队列"), d.sleep(1.5), d.btn("历史记录"), d.sleep(1.5), d.btn("Cookie 配置"), d.sleep(1.5))),

    Scene(
        "任务中心实时汇总所有云端任务：粗剪、包装、剪同款、工作流、发布等每条任务的状态都在这里，SSE 实时推送，不用手动刷新。已结束的记录可以一键清空。",
        sub="任务中心：全模块任务实时状态汇总",
        run=lambda d: (d.nav("任务中心 Tasks"), d.sleep(2), d.js('''(() => {
          const b = [...document.querySelectorAll("#panel-tasks button")].find(b => b.textContent.includes("清空"));
          if (b) { b.scrollIntoView({block: "center"}); return "找到清空按钮(未点击)"; }
          return "no";
        })()'''))),

    Scene(
        "到这里，除短剧创作、助手和创作外的所有模块都演示完了。下一集补齐它们并做总结。",
        sub="下一集：短剧创作 · 助手 · 创作 · 总结",
        run=None),
]
