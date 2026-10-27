# -*- coding: utf-8 -*-
"""11 短剧创作 · 助手 · 创作 · 总结"""
from record_module import Scene

SCENES = [
    Scene(
        "短剧创作：面向短剧赛道的批量生产面板，从剧本、分集到成片按流程走，同样基于云端渲染。打开面板后按提示逐步填写即可。",
        sub="短剧创作 ShortDrama：剧本 → 分集 → 成片",
        run=lambda d: (d.nav("短剧创作 ShortDrama"), d.sleep(2))),

    Scene(
        "AI 助手：在助手面板直接对话，可以问使用问题、让它生成文案或选题建议。输入一条消息发送，助手会流式返回回答。",
        sub="AI 助手：对话式答疑与内容生成",
        run=lambda d: (d.nav("助手 Assistant"), d.sleep(1), d.js('''(() => {
          const p = document.getElementById("panel-assistant");
          const i = p.querySelector("textarea, input[type=text]");
          if (!i) return "no input";
          const setter = i.tagName === "TEXTAREA"
            ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set
            : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(i, "帮我起三个秋天旅行视频的标题");
          i.dispatchEvent(new Event("input", {bubbles: true}));
          i.scrollIntoView({block: "center"});
          return "ok";
        })()'''), d.sleep(0.5), d.btn("发送"), d.sleep(10))),

    Scene(
        "创作面板是选题到成片的入口：承接选题面板的「去创作」，把选题、素材、成片方式组织成一次创作任务。",
        sub="创作 Create：选题 → 创作任务的流转入口",
        run=lambda d: (d.nav("创作 Create"), d.sleep(2))),

    Scene(
        "全系列总结：HTW 工作台用一条云端流水线覆盖内容创作全流程——洞察和选题找方向，剪辑和工具做内容，批量和营销成片做规模，工作流串全程，发布管分发，任务中心盯进度。感谢观看。",
        sub="总结：洞察 → 选题 → 剪辑/工具 → 批量/成片 → 工作流 → 发布 → 任务中心",
        run=None),
]
