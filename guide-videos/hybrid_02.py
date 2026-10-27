# -*- coding: utf-8 -*-
"""重录 02_剪辑-视频粗剪：功能讲解 + 完整真实过程。
混合驱动：CDP 导航/选文件/设参数，提交点击走物理鼠标并脱离 CDP，
渲染等待期间零长连 CDP（周期性短暂重连读状态），全桌面录屏 + 窗口裁剪。"""
import sys, os, time
HERE = r"D:\HTWClient\guide-videos"
sys.path.insert(0, HERE)
import pyautogui
import pdrive as p
import phys
from hcdp import H
from phys import record_physical

A = HERE + r"\assets"

# 窗口矩形（物理像素，偶数化供 yuv420p）
W = p.window_rect()
assert W, "窗口定位失败"
CROP = (W[0], W[1], W[2] - (W[2] % 2), W[3] - (W[3] % 2))
print("窗口矩形:", W, "裁剪:", CROP, flush=True)


def s1():
    d = H()
    d.nav("edit")
    d.scroll_card("panel-edit", "视频粗剪 Coarse-cut")


def s2():
    d = H()
    d.set_file_card("panel-edit", "视频粗剪 Coarse-cut", [A + r"\demo_speech.mp4"])
    time.sleep(1.0)


def s3():
    d = H()
    # 清掉上一轮残留结果（clear 结束时会主动断连，之后必须先重连）
    phys.clear_card_results(d, "panel-edit", ["视频粗剪"])
    d.attach()
    d.scroll_card("panel-edit", "视频粗剪 Coarse-cut")
    # 音色/时长：清冷女声（演示原片口播自带）+ 5~60 秒；数字参数走真实键盘输入
    d.c.ev('''(() => {
      const s = document.getElementById("edit-coarse-voice");
      if (s) { s.value = "zh_female_qinglengnv"; s.dispatchEvent(new Event("change", {bubbles: true})); }
      return "ok";
    })()''')
    phys.type_field(d, "panel-edit", "edit-coarse-min", "5")
    phys.type_field(d, "panel-edit", "edit-coarse-max", "60")
    time.sleep(0.8)
    d.click_btn_text("panel-edit", "开始粗剪")
    time.sleep(8)
    ok = d.wait_result("panel-edit", "下载成片", timeout=1500, poll=25)
    print("    粗剪渲染:", ok, flush=True)


def s4():
    d = H()
    d.scroll_card("panel-edit", "视频粗剪 Coarse-cut")
    time.sleep(1.0)


scenes = [
    dict(narr="剪辑面板是使用频率最高的模块，包含视频粗剪、智能包装、剪同款、草稿导出、超分和解密六个功能。这一集完整演示视频粗剪：把一条带口播的视频，自动剪成成片。",
         sub="剪辑面板六功能 · 本集：视频粗剪（完整过程）", run=s1),
    dict(narr="第一步，选择素材。粗剪的解说词和配音基于原片真实语音生成，所以要选一条带人声口播的视频。点击选择区域，选中这条四十二秒的旅行口播素材，下方立即显示已选文件名。",
         sub="第一步：选择带口播的素材（解说词的事实来源）", run=s2),
    dict(narr="第二步，选择配音音色，比如清冷女声，再设置目标时长范围，五到六十秒。点击开始粗剪：视频自动上传云端，先识别原片台词，再挑选精彩片段、生成解说词、合成配音与字幕。这一段画面加速播放，进度条会实时显示当前步骤。",
         sub="第二步：音色与时长 → 开始粗剪（云端处理，画面加速）", run=s3, speed_cap=4, pad=1.0),
    dict(narr="渲染完成，结果区直接出现成片播放器和下载成片按钮，可以先预览，满意后一键下载。整条视频无需手动剪辑，口播、字幕、节奏全部自动生成。",
         sub="完成：预览成片 → 下载成片", run=s4, min_len=5),
    dict(narr="两个提示：一，素材必须含真实人声，纯画面素材会在台词识别阶段就被明确告知无法粗剪，并建议改用智能包装或草稿导出；二，额度不足或服务异常时，结果区会给出具体原因。下一集演示剪同款。",
         sub="提示：素材需含人声；异常时有明确原因；下一集：剪同款", run=None, min_len=3),
]
for sc in scenes:
    sc["crop"] = CROP

record_physical("h02", scenes, out_name="02_剪辑-视频粗剪")
