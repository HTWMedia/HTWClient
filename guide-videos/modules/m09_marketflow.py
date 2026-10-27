# -*- coding: utf-8 -*-
"""09 营销成片与工作流"""
from record_module import Scene

A = "assets/"

SCENES = [
    Scene(
        "营销成片：面向电商与本地商家的批量出片面板，按「批次类型 → 选模板 → 商品条目 → 素材文件」四步走，最后批量启动。",
        sub="营销成片：选模板 → 商品条目 → 素材 → 批量启动",
        run=lambda d: (d.nav("营销成片 MarketVideo"), d.sleep(1))),

    Scene(
        "工作流面板是全链路自动化：选择成片类型，比如视频成片，填入选题或让系统随机选题，上传素材后点击开始工作流，系统会自动走完选题、成片、包装、发布的完整流程，每个阶段单独展示进度。",
        sub="工作流：选题 → 成片 → 包装 → 发布 全自动",
        run=lambda d: (d.nav("工作流 Workflow"), d.sleep(1), d.js('''(() => {
          const p = document.getElementById("panel-workflow");
          const i = p.querySelector("input[type=text]");
          if (i) {
            const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            s.call(i, "秋季旅行好物推荐");
            i.dispatchEvent(new Event("input", {bubbles: true}));
          }
          p.scrollIntoView({block: "start"});
          return "ok";
        })()'''), d.sleep(0.5))),

    Scene(
        "点击开始工作流后，任务进入云端队列。工作流耗时长、阶段多，任务中心会持续同步每个阶段的状态；在这里我们展示发起与排队状态即可。",
        sub="开始工作流 → 云端排队执行，任务中心同步各阶段",
        run=lambda d: (d.btn("▶ 开始工作流"), d.sleep(8))),

    Scene(
        "工作流与营销成片都是重云端的长任务，建议提交后到任务中心盯进度。下一集演示发布与任务中心。",
        sub="提示：长任务请到任务中心盯进度；下一集：发布与任务中心",
        run=None),
]
