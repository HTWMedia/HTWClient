# -*- coding: utf-8 -*-
"""08 批量"""
from record_module import Scene

A = "assets/"

SCENES = [
    Scene(
        "批量面板解决「一个模板跑 N 条视频」的问题：支持批量剪同款、批量智能包装和批量营销成片。先选择批次类型，这里选剪同款。",
        sub="批量 Batch：一个模板 × N 条素材 = N 条成片",
        run=lambda d: (d.nav("批量 Batch"), d.btn("剪同款"), d.sleep(1))),

    Scene(
        "第一步搜索并选择模板，与剪同款面板一致；第二步批量选择素材文件，可以一次选很多条。",
        sub="① 搜模板选模板 ② 批量上传素材",
        run=lambda d: (d.btn("搜模板"), d.sleep(4), d.js('''(() => {
          const p = document.getElementById("panel-batch");
          const grid = p.querySelector("[id*=grid], .tpl-grid, .grid");
          if (grid && grid.children.length) { grid.children[0].click(); grid.scrollIntoView({block: "center"}); return "已选"; }
          return "未找到模板网格";
        })()'''))),

    Scene(
        "第三步提交批次。点击提交批次后，系统会创建一个批次任务，N 条素材由云端队列并行处理，互不阻塞。",
        sub="③ 提交批次 → 云端队列并行处理",
        run=lambda d: (d.set_file("#panel-batch input.file-input-native", [A + "示例视频.mp4", A + "示例视频2.mp4"]), d.sleep(0.5))),

    Scene(
        "提交后点击批次状态，可以看到每一批的进度、成功数量和失败原因。批次粒度的状态与单条任务分开管理，互不影响。",
        sub="批次状态：每批进度 / 成功数 / 失败原因一目了然",
        run=lambda d: (d.btn("▶ 提交批次"), d.sleep(6), d.btn("批次状态"), d.sleep(3))),

    Scene(
        "提示：批量能力对账号档位有要求，免费档提交会被拒绝并返回明确提示；素材数量、模板可用性的校验规则与单个剪同款一致。",
        sub="提示：批量需要相应账号档位，失败会返回明确原因",
        run=None),
]
