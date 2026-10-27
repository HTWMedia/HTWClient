# -*- coding: utf-8 -*-
"""07 工具"""
from record_module import Scene

A = "assets/"

SCENES = [
    Scene(
        "工具面板是创作工具箱：语音转写、翻译、总结、歌词提取、人声伴奏分离、语音合成、图像生成、图像识别、字幕提取、模板搜索等。全部云端执行，按需取用。",
        sub="工具 Tools：转写 · 翻译 · 总结 · 歌词 · 分离 · TTS · 图像 · 智能体",
        run=lambda d: d.nav("工具 Tools")),

    Scene(
        "演示语音转写：选择一段音频，格式选普通文本，点击转写。云端识别后返回带时间信息的文字稿。语音样本是我们提前合成的一句话。",
        sub="语音转写：音频 → 文字稿",
        run=lambda d: (d.file_input_by_card("语音转写") and None,
                       d.set_file(d.file_input_by_card("语音转写"), [A + "语音样本.mp3"]),
                       d.btn("转写"),
                       d.wait_text("下载", timeout=300, scope_sel="#panel-tools")
                       or d.sleep(8)),
        speed_cap=10, pad=1.0),

    Scene(
        "图像识别：选择一张图片，点击识别图片，云端返回图片内容的详细描述。生成图片则相反，输入描述文字直接生成图片。这两个能力在做封面和素材时非常实用。",
        sub="图像识别 / 图像生成：封面与素材的好帮手",
        run=lambda d: (d.file_input_by_card("图像识别") and None,
                       d.set_file(d.file_input_by_card("图像识别"), [A + "演示图片.jpg"]),
                       d.btn("识别图片"), d.sleep(8))),

    Scene(
        "模板搜索：按关键词搜索剪映云模板，配合剪同款使用。其余工具——翻译、总结、歌词提取、人声伴奏分离、语音合成、智能体——操作方式相同：选文件、点按钮、等结果。",
        sub="其余工具同套路：选文件 → 点按钮 → 等结果",
        run=lambda d: d.sleep(1)),
]
