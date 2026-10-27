# -*- coding: utf-8 -*-
"""04 剪辑 · 智能包装"""
from record_module import Scene

A = "assets/"

SCENES = [
    Scene(
        "智能包装：为视频自动加上片头、片尾、字幕、贴纸和背景音乐，一条素视频一键变成成品感的视频。同样在剪辑面板，选择视频后点击开始包装。",
        sub="智能包装：一键加片头片尾字幕贴纸 BGM",
        run=lambda d: (d.nav("剪辑 Edit"), d.set_file("#edit-pack-file", [A + "示例视频.mp4"]))),

    Scene(
        "点击开始包装后，云端会分析视频内容并自动生成包装方案，过程约三到八分钟，视视频长度而定。画面做了加速处理。",
        sub="开始包装 → 云端自动包装（画面加速）",
        run=lambda d: (d.btn("开始包装"),
                       d.wait_text("下载成片", timeout=900, scope_sel="#edit-pack-result")
                       or (_ for _ in ()).throw(RuntimeError("包装超时"))),
        speed_cap=12, pad=1.0),

    Scene(
        "包装完成，结果区出现成片和下载按钮。注意：智能包装与剪同款一样，仅支持 mp4、mov、m4v 格式的视频，其他格式会提示不支持。",
        sub="完成：预览与下载；仅支持 mp4 / mov / m4v",
        run=lambda d: d.js('''(() => {
          const r = document.getElementById("edit-pack-result");
          if (r) r.scrollIntoView({block: "center"});
          return "ok";
        })()'''), min_len=2),

    Scene(
        "下一集演示草稿导出、超分和解密三个功能。",
        sub="下一集：草稿导出 · 超分 · 解密",
        run=None),
]
