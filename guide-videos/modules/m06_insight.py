# -*- coding: utf-8 -*-
"""06 洞察与选题"""
from record_module import Scene

A = "assets/"

SCENES = [
    Scene(
        "洞察面板提供创作前的数据分析能力：文案分析、视频分析、账号分析、热榜和全网搜索。输入链接或文案，系统返回结构化的分析结果。",
        sub="洞察 Analysis：文案 / 视频 / 账号分析 + 热榜 + 搜索",
        run=lambda d: d.nav("洞察 Analysis")),

    Scene(
        "先看热榜。点击获取热榜，系统拉取当前各平台的热点榜单，可以直接看到正在上升的话题。",
        sub="获取热榜：实时热点一览",
        run=lambda d: (d.btn("获取热榜"), d.sleep(6))),

    Scene(
        "全网搜索：选择平台，比如小红书、B站、抖音或头条，输入关键词和数量，点击搜索，返回相关的热门内容列表，用于对标调研。",
        sub="全网搜索：按平台与关键词调研对标内容",
        run=lambda d: (d.btn("搜索"), d.sleep(6))),

    Scene(
        "文案分析：粘贴一段文案，点击分析文案，系统会给出结构、钩子、情绪点等维度的解读，帮助优化脚本。",
        sub="文案分析：结构 / 钩子 / 情绪点多维解读",
        run=lambda d: (d.js('''(() => {
          const p = document.getElementById("panel-insight");
          const i = p.querySelector("input[type=text]");
          const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          s.call(i, "家人们谁懂啊，这条视频我剪了整整三天，最后一个镜头直接封神，看到最后你绝对不亏。");
          i.dispatchEvent(new Event("input", {bubbles: true}));
          i.scrollIntoView({block: "center"});
          return "ok";
        })()'''), d.btn("分析文案"), d.sleep(8), d.js('''(() => {
          const btns = [...document.querySelectorAll("#panel-insight button")];
          const b = btns.find(x => x.textContent.trim() === "分析文案");
          if (b) b.scrollIntoView({block: "center"});
          return "ok";
        })()'''))),

    Scene(
        "选题面板：系统每天结合热榜趋势与你的垂类画像生成选题建议，每条都带数据证据，点击「去创作」可以直接带着选题进入创作流程。黄条提示会提醒你补充对标账号，画像会随着使用越来越准。",
        sub="选题 Topics：每日选题建议 + 数据证据，去创作一键流转",
        run=lambda d: (d.nav("选题 Topics"), d.sleep(1), d.btn("热榜趋势"), d.sleep(2), d.btn("今日选题"), d.sleep(1))),
]
