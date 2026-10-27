# -*- coding: utf-8 -*-
"""02 剪辑 · 视频粗剪"""
from record_module import Scene

A = "assets/"


def _wait_done(d, sel, timeout=900):
    """等任务出结果（下载成片按钮），最长 timeout 秒"""
    return d.wait_text("下载成片", timeout=timeout, scope_sel=sel)


SCENES = [
    Scene(
        "剪辑面板是使用频率最高的模块，包含六个功能：视频粗剪、智能包装、剪同款、草稿导出、超分和解密。这一集演示视频粗剪：把一条长视频自动剪成带配音口播的成片。",
        sub="剪辑面板：粗剪 · 智能包装 · 剪同款 · 草稿导出 · 超分 · 解密",
        run=lambda d: (d.nav("剪辑 Edit"), d.js('''(() => {
          const c = [...document.querySelectorAll("#panel-edit .card")].find(k => k.textContent.includes("视频粗剪"));
          if (c) c.scrollIntoView({block: "center"});
          return "ok";
        })()'''))),

    Scene(
        "第一步，选择素材视频。点击选择区域，或直接把文件拖进来。这里选择一条示例视频。",
        sub="第一步：选择素材视频",
        run=lambda d: d.set_file("#edit-coarse-file", [A + "示例视频.mp4"])),

    Scene(
        "第二步，选择配音音色。下拉框里有清冷女声、纪录片男声、电影男声等多种音色，粗剪会按音色自动生成口播配音。再设置成片的目标时长范围，最短五秒、最长六十秒；勾选「虚拟背景模糊」可以让画面在口播段自动加模糊背景。",
        sub="第二步：选配音音色 + 目标时长范围",
        run=lambda d: (d.js('''(() => {
          const s = document.getElementById("edit-coarse-voice");
          s.value = "zh_female_qinglengnv";
          s.dispatchEvent(new Event("change", {bubbles: true}));
          const mn = document.getElementById("edit-coarse-min");
          const mx = document.getElementById("edit-coarse-max");
          [mn, mx].forEach(i => {
            const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            set.call(i, "5");
            i.dispatchEvent(new Event("input", {bubbles: true}));
          });
          return "ok";
        })()'''), d.sleep(0.5))),

    Scene(
        "第三步，点击开始粗剪。视频会自动上传到云端，由云端完成语音识别、精彩片段挑选、配音合成和字幕生成，期间进度条会实时显示当前步骤。这一段画面做了加速处理。",
        sub="第三步：开始粗剪 → 云端自动处理（画面加速）",
        run=lambda d: (d.btn("开始粗剪"), d.wait_text("下载成片", timeout=900, scope_sel="#edit-coarse-result") or (_ for _ in ()).throw(RuntimeError("粗剪超时"))),
        speed_cap=12, pad=1.0),

    Scene(
        "渲染完成，结果区直接出现成片播放器和下载按钮。整条视频不需要手动剪辑，口播、字幕、节奏都是自动生成的。你可以先预览，满意后点击下载成片。",
        sub="完成：预览成片 → 点击「下载成片」保存到本地",
        run=lambda d: d.js('''(() => {
          const r = document.getElementById("edit-coarse-result");
          if (r) r.scrollIntoView({block: "center"});
          return r ? r.textContent.slice(0, 60) : "no";
        })()'''), min_len=2),

    Scene(
        "如果素材有问题或额度不足，结果区会显示具体的错误原因，比如「素材缺失」「额度不足」等，按提示处理即可。下一集演示剪同款。",
        sub="提示：异常时结果区会显示具体原因；下一集：剪同款",
        run=None),
]
