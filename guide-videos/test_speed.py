# -*- coding: utf-8 -*-
"""assemble 的加速倍率函数 seg_speed：speed_cap 语义 = 倍率上限（进度条可见）。
RED 阶段应报 AttributeError。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pipeline


def test_long_render_capped():
    # 283s 渲染 + 22.3s 配音，cap=4 → 4 倍速（显示 ~71s），而不是旧的 12 倍
    s = pipeline.seg_speed(283, 22.3, 4)
    assert s == 4.0, f"期望 4.0，实得 {s}"


def test_short_render_narr_bound():
    # 30s 动作 + 16s 配音 → 只需 1.83 倍即可盖住配音，不应超过 4
    s = pipeline.seg_speed(30, 16.0, 4)
    assert abs(s - 30 / 16.4) < 0.01, f"期望 ~1.83，实得 {s}"


def test_tiny_raw_no_slowmo():
    # raw 比配音还短 → 1 倍速（不许慢放）
    assert pipeline.seg_speed(10, 22.0, 4) == 1.0


def test_no_cap():
    assert pipeline.seg_speed(300, 5.0, None) == 1.0


def test_old_cap12_backcompat():
    # cap=12 时与旧行为一致：283s → 12 倍
    s = pipeline.seg_speed(283, 22.3, 12)
    assert s == 12.0, f"期望 12.0，实得 {s}"


if __name__ == "__main__":
    for name, fn in [("long_capped", test_long_render_capped),
                     ("narr_bound", test_short_render_narr_bound),
                     ("no_slowmo", test_tiny_raw_no_slowmo),
                     ("no_cap", test_no_cap),
                     ("cap12_compat", test_old_cap12_backcompat)]:
        fn()
        print(f"PASS {name}")
    print("ALL PASS")
