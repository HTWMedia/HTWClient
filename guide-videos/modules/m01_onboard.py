# -*- coding: utf-8 -*-
"""01 快速上手与设置（hybrid 版：逐场景录制 + 项目 TTS）。
2026-10-27 重录：由 record_module 单条 take 模式改造为 phys 逐场景；
旁白措辞与 out/使用说明.md 对齐（不出现内部实现表述，本地模式按文档口径讲）。"""
import sys
import time

HERE = r"D:\HTWClient\guide-videos"
sys.path.insert(0, HERE)
from hcdp import H
from phys import record_physical

TOUR = ["tools", "insight", "topics", "create", "workflow", "edit", "publish",
        "market", "batch", "shortdrama", "assistant", "tasks"]


def s_welcome():
    pass


def s_tour():
    d = H()
    for name in TOUR:
        d.nav(name)
        time.sleep(0.35)


def s_settings():
    d = H()
    d.nav("settings")


def s_authkey():
    d = H()
    d.c.ev('''(() => {
      const i = document.getElementById("api-key");
      if (i) i.scrollIntoView({block: "center"});
      return i ? "ok" : "no";
    })()''')
    time.sleep(0.8)


def s_local():
    d = H()
    d.c.ev('''(() => {
      const c = document.getElementById("local-card");
      if (c) c.scrollIntoView({block: "center"});
      return "ok";
    })()''')
    time.sleep(0.8)


def s_next():
    d = H()
    d.nav("edit")
    time.sleep(0.8)


scenes = [
    dict(narr="欢迎使用 HTW 工作台。这是一款面向内容创作者的一站式工具，覆盖从选题、剪辑、包装到发布的完整创作链路，剪辑、配音、渲染等重活都自动完成，普通电脑也能流畅出片。",
         sub="HTW 工作台：选题 · 剪辑 · 包装 · 发布 一站式创作工具", run=s_welcome, min_len=1),
    dict(narr="左侧是模块导航。工具面板提供语音转写、翻译、总结、歌词提取、人声分离、语音合成、图像生成与识别等创作工具；洞察面板提供文案与账号数据分析；选题面板每天推送选题建议；创作和工作流串联全链路；剪辑面板负责粗剪、包装与渲染导出；发布面板一键分发多平台；还有营销成片、批量、短剧创作和 AI 助手。我们逐个演示。",
         sub="左侧导航：工具 · 洞察 · 选题 · 创作 · 工作流 · 剪辑 · 发布 · 营销成片 · 批量 · 短剧 · 助手 · 任务中心",
         run=s_tour, pad=1.0),
    dict(narr="首次使用需要先配置密钥。点击左下角的设置，在密钥输入框填入你的密钥。密钥从官网获取，点击「前往 web 端获取」会自动打开获取页面。输入框采用密码样式，密钥不会明文展示。",
         sub="设置 → 密钥：从官网获取，填入后自动保存",
         run=s_settings),
    dict(narr="填写后状态栏显示「已设置」，就可以使用全部功能了。如果没有填写，这里会显示红色的未设置，并且所有功能都会提示需要密钥。修改后状态会即时更新。",
         sub="已设置 ✓：全部功能可用；未设置时显示红色并拦截操作",
         run=s_authkey),
    dict(narr="设置面板下方是本地模式：开启后，本地实例支持的业务会直接在你自己的电脑上执行，素材不离开本机；其余请求仍走在线处理。支持一键配对、启动本地实例和检查更新，普通用户保持默认即可，后面我们会单独介绍。",
         sub="本地模式：可选的本机处理实例，素材不离开本机",
         run=s_local),
    dict(narr="配置完成。接下来我们按模块逐一演示：先从最常用的剪辑面板开始。",
         sub="下一集：剪辑面板 · 视频粗剪",
         run=s_next),
]

if __name__ == "__main__":
    record_physical("m01", scenes, out_name="01_安装与初始配置")
