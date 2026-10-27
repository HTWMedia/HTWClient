# -*- coding: utf-8 -*-
"""03 剪辑 · 剪同款"""
from record_module import Scene

A = "assets/"


SCENES = [
    Scene(
        "剪同款：选一个热门模板，把自己的素材套进去，云端自动生成同款视频。先在关键词框输入想要的模板类型，比如旅行、美食、卡点，然后点击搜索模板。",
        sub="剪辑 → 剪同款：关键词搜索模板",
        run=lambda d: (d.nav("剪辑 Edit"), d.js('''(() => {
          const c = [...document.querySelectorAll("#panel-edit .card")].find(k => k.textContent.includes("剪同款"));
          if (c) c.scrollIntoView({block: "center"});
          return "ok";
        })()'''), d.btn("搜索模板"), d.sleep(4))),

    Scene(
        "搜索结果以卡片展示，包含模板封面、时长、片段数和可用状态。点击选择一个模板，下方会显示已选模板信息。付费或未解锁的模板会标记不可用，无法套用。",
        sub="选择模板：注意「可用」状态，付费模板无法套用",
        run=lambda d: d.js('''(() => {
          const grid = document.getElementById("edit-cutsame-grid");
          if (!grid || !grid.children.length) return "空";
          grid.children[0].click();
          grid.scrollIntoView({block: "center"});
          return "已选: " + grid.children[0].textContent.slice(0, 40);
        })()'''), pad=1.0),

    Scene(
        "第三步，上传素材。可以选择多个视频，素材数量少于模板片段数时会自动循环复用。点击选择文件，支持批量选择。",
        sub="上传素材：可多选，不足自动循环复用",
        run=lambda d: d.set_file("#edit-cutsame-file", [A + "示例视频.mp4", A + "示例视频2.mp4"])),

    Scene(
        "点击开始套模板，云端会按模板的节奏、转场和音乐重新合成你的素材。这个过程完全在云端完成，画面做了加速处理。",
        sub="开始套模板 → 云端合成（画面加速）",
        run=lambda d: (d.btn("开始套模板"),
                       d.wait_text("下载成片", timeout=900, scope_sel="#edit-cutsame-result")
                       or (_ for _ in ()).throw(RuntimeError("剪同款超时"))),
        speed_cap=12, pad=1.0),

    Scene(
        "完成。结果区直接出现套用模板后的成片，可以预览和下载。如果选择的模板不可用，提交时会明确提示无法获取模板草稿；素材缺失时也会有对应警告。",
        sub="完成：预览与下载；异常时会有明确提示",
        run=lambda d: d.js('''(() => {
          const r = document.getElementById("edit-cutsame-result");
          if (r) r.scrollIntoView({block: "center"});
          return "ok";
        })()'''), min_len=2),

    Scene(
        "下一集演示智能包装和草稿导出。",
        sub="下一集：智能包装 · 草稿导出",
        run=None),
]
