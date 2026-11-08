# -*- coding: utf-8 -*-
"""06 洞察与选题"""
from record_module import Scene

A = "assets/"

SCENES = [
    Scene(
        "洞察面板把五个工具分成页签：文案分析、视频分析、账号分析、热榜和全网搜索，点页签切换，不用在长页面里来回滚动。",
        sub="洞察 Analysis：五个工具页签化",
        run=lambda d: d.nav("洞察 Analysis")),

    Scene(
        "先看热榜。点开热榜页签并获取，系统拉取当前各平台的热点榜单，可以直接看到正在上升的话题。",
        sub="热榜：实时热点一览",
        run=lambda d: (d.btn("热榜"), d.sleep(1), d.btn("获取热榜"), d.sleep(6))),

    Scene(
        "全网搜索：选择平台，比如小红书、B站、抖音或头条，输入关键词和数量，点击搜索，返回相关的热门内容列表，用于对标调研。",
        sub="全网搜索：按平台与关键词调研对标内容",
        run=lambda d: (d.btn("全网搜索"), d.sleep(1), d.js('''(() => {
          const p = document.getElementById("panel-insight");
          const sel = p.querySelector("select");
          const kw = p.querySelector('input[placeholder="关键词"]');
          const cnt = p.querySelector("input[type=number]");
          const setSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
          const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setSel.call(sel, "bilibili");
          sel.dispatchEvent(new Event("change", {bubbles: true}));
          setInput.call(kw, "露营装备");
          kw.dispatchEvent(new Event("input", {bubbles: true}));
          setInput.call(cnt, "5");
          cnt.dispatchEvent(new Event("input", {bubbles: true}));
          cnt.scrollIntoView({block: "center"});
          return "ok";
        })()'''), d.btn("搜索", within="#panel-insight .insight-body"), d.sleep(8))),

    Scene(
        "文案分析：粘贴一段文案，点击分析文案，系统会给出结构、钩子、情绪点等维度的解读，帮助优化脚本。",
        sub="文案分析：结构 / 钩子 / 情绪点多维解读",
        run=lambda d: (d.btn("文案分析"), d.sleep(1), d.js('''(() => {
          const p = document.getElementById("panel-insight");
          const t = p.querySelector("textarea");
          const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          s.call(t, "家人们谁懂啊，这条视频我剪了整整三天，最后一个镜头直接封神，看到最后你绝对不亏。");
          t.dispatchEvent(new Event("input", {bubbles: true}));
          t.scrollIntoView({block: "center"});
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
