# -*- coding: utf-8 -*-
"""05 剪辑 · 草稿导出 + 超分 + 解密"""
from record_module import Scene

A = "assets/"

SCENES = [
    Scene(
        "草稿导出是用户需求最多的功能：把剪映或 CapCut 生成的草稿包上传，云端直接渲染成片，本机不需要安装剪映。先准备一个包含 draft_content 的草稿 ZIP 包。",
        sub="草稿导出：剪映/CapCut 草稿包 → 云端渲染成片",
        run=lambda d: (d.nav("剪辑 Edit"), d.js('''(() => {
          const c = [...document.querySelectorAll("#panel-edit .card")].find(k => k.textContent.includes("草稿导出"));
          if (c) c.scrollIntoView({block: "center"});
          return "ok";
        })()'''))),

    Scene(
        "选择草稿 ZIP 并点击导出草稿。提交后系统会先做素材核对：这条演示草稿故意缺少部分素材，可以看到结果区明确列出了缺失的类型、数量和文件名，并说明缺失部分会黑屏——按提示把素材补进包里重新上传即可。",
        sub="提交后先做素材核对：明确列出缺失素材清单",
        run=lambda d: (d.set_file(d.file_input_by_card("草稿导出 Draft-export"), [A + "缺素材草稿.zip"]),
                       d.btn("导出草稿"),
                       d.wait_text("缺失", timeout=120, scope_sel="#panel-edit") or d.sleep(5),
                       d.sleep(3))),

    Scene(
        "核对通过的部分继续云端渲染，进度实时可见。渲染完成后结果区出现成片和下载按钮。注意：草稿里如果有多条视频轨，上层轨道的层级要高于主轨，否则云端会拒绝渲染，错误信息会给出说明。",
        sub="渲染进行中（画面加速）→ 完成后可直接下载",
        run=lambda d: (d.wait_text("下载视频", timeout=600, scope_sel="#panel-edit")
                       or (_ for _ in ()).throw(RuntimeError("草稿导出超时"))),
        speed_cap=12, pad=1.0),

    Scene(
        "超分功能：把低分辨率视频放大到指定宽高。选择一条 960 乘 540 的小视频，目标设置为 1920 乘 1080，点击超分，云端完成画质重建。",
        sub="超分：低清视频 → 指定分辨率（演示 540P → 1080P）",
        run=lambda d: (d.set_file(d.file_input_by_card("超分 Super-res"), [A + "待超分小视频.mp4"]),
                       d.js('''(() => {
                         const set = (id, v) => {
                           const i = document.getElementById(id);
                           if (!i) return;
                           const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                           s.call(i, v);
                           i.dispatchEvent(new Event("input", {bubbles: true}));
                         };
                         set("edit-sr-width", "1920");
                         set("edit-sr-height", "1080");
                         return "ok";
                       })()'''), d.btn("超分"),
                       d.wait_text("下载成片", timeout=600, scope_sel="#panel-edit")
                       or (_ for _ in ()).throw(RuntimeError("超分超时"))),
        speed_cap=12, pad=1.0),

    Scene(
        "解密功能：新版剪映的草稿 JSON 是加密的，选择加密的 draft_content 文件点击解密，瞬间返回明文内容，可以直接查看或交给其他工具使用。",
        sub="解密：新版剪映加密草稿 → 明文 JSON（即时完成）",
        run=lambda d: (d.set_file(d.file_input_by_card("解密 Decrypt"), [A + "加密草稿.json"]),
                       d.btn("解密"), d.sleep(4))),

    Scene(
        "到这里剪辑面板的六个功能就演示完了。总结一下：粗剪、包装、剪同款负责生成内容，草稿导出负责渲染已有草稿，超分负责画质增强，解密负责草稿文件处理。",
        sub="剪辑面板小结：生成 × 3 + 渲染 + 增强 + 解密",
        run=None),
]
