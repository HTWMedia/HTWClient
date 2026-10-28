# -*- coding: utf-8 -*-
"""离线重建教程视频：用已录制的分场景片段（全桌面捕获）重新合成，
裁剪位置通过在每段首帧上模板匹配应用标题栏自动确定（应用窗口位置随会话变过）。
用法: python rebuild.py            # 重建 03-11
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pipeline import assemble, run, audio_len

import cv2

TITLEBAR = os.path.join(HERE, "tmpl", "titlebar.png")


def clip_crop(clip, fallback):
    """从片段首帧模板匹配标题栏 → 窗口裁剪矩形；失败返回 fallback。"""
    probe = clip + ".probe.jpg"
    try:
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-ss", "0.5", "-i", clip, "-frames:v", "1", probe])
        img = cv2.imread(probe)
        if img is None:
            return fallback, False
        tpl = cv2.imread(TITLEBAR)
        r = cv2.matchTemplate(img, tpl, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(r)
        if max_val < 0.55:
            return fallback, False
        x = max_loc[0] - 18
        y = max_loc[1] - 15
        w, h = 1482, 953
        x = max(0, x)
        y = max(0, y)
        w -= x - max(0, max_loc[0] - 18) if False else 0
        return (x, y, w - w % 2, h - h % 2), True
    except Exception:
        return fallback, False
    finally:
        try:
            os.remove(probe)
        except Exception:
            pass


def rebuild(meta_path, out_name, name, cut=None, append_meta=None):
    meta = json.load(open(meta_path, encoding="utf-8"))
    if cut is not None:
        meta = meta[:cut]
    if append_meta:
        meta = meta + json.load(open(append_meta, encoding="utf-8"))
    # 逐场景定裁剪（模块级兜底用第一段成功的匹配）
    mod_crop = None
    ok = miss = 0
    for sc in meta:
        clip = sc.get("clip")
        if not clip or not os.path.exists(clip):
            sc["crop"] = None
            miss += 1
            continue
        crop, hit = clip_crop(clip, mod_crop)
        if hit:
            ok += 1
            if mod_crop is None:
                mod_crop = crop
        else:
            miss += 1
        sc["crop"] = crop if (hit or mod_crop) else None
    total = assemble(name, meta, None, os.path.join(HERE, "work", "rb_" + name),
                     os.path.join(HERE, "out", out_name + ".mp4"))
    print(f"== {out_name} 重建完成: {total:.0f}s (标题栏定位 命中{ok}/未中{miss})", flush=True)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    JOBS = {
        # 06-11：首批混合录制素材完好
        "06": ("meta_h06.json", "06_洞察与选题", "h06", None, None),
        "07": ("meta_h07.json", "07_工具", "h07", None, None),
        "08": ("meta_h08.json", "08_批量", "h08", None, None),
        "09": ("meta_h09.json", "09_营销成片与工作流", "h09", None, None),
        "10": ("meta_h10.json", "10_发布与任务中心", "h10", None, None),
        "11": ("meta_h11.json", "11_短剧_助手_创作_总结", "h11", None, None),
        # 03/04：物理首批（桌面捕获期）素材
        "03": ("meta_m03_phys.json", "03_剪辑-剪同款", "m03p", None, None),
        "04": ("meta_m04_phys.json", "04_剪辑-智能包装", "m04p", None, None),
        # 05：首批 h05 前 5 段（草稿导出主体）+ h05b（超分/解密/小结）
        "05": ("meta_h05.json", "05_剪辑-草稿导出_超分_解密", "h05rb", 5, "meta_h05b.json"),
    }
    for k, (mp, out, name, cut, app) in JOBS.items():
        if which not in ("all", k):
            continue
        try:
            rebuild(os.path.join(HERE, mp), out, name, cut, app and os.path.join(HERE, app))
        except Exception:
            import traceback
            traceback.print_exc()
            print(f"!! {k} 重建失败", flush=True)
