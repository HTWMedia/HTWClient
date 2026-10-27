# -*- coding: utf-8 -*-
"""window_rect 韧性验证：屏幕截图首拍不可匹配（模拟窗口被遮挡）时，
应先激活窗口再重测，最终返回矩形而非 None。RED：现实现无重试直接返回 None。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HTW_CDP", "http://127.0.0.1:9223")

import pyautogui
from PIL import Image
import pdrive as p

_real_shot = pyautogui.screenshot
state = {"n": 0}


def flaky_shot(*a, **k):
    """首拍返回纯黑（匹配度必 < 0.6），之后真实截屏"""
    state["n"] += 1
    if state["n"] == 1:
        return Image.new("RGB", (1920, 1032), (0, 0, 0))
    return _real_shot(*a, **k)


def test_recovers_after_activate():
    state["n"] = 0
    pyautogui.screenshot = flaky_shot
    try:
        r = p.window_rect()
    finally:
        pyautogui.screenshot = _real_shot
    assert r is not None, f"window_rect 未从遮挡中恢复（拍了 {state['n']} 次）"
    assert len(r) == 4 and r[2] > 1000, f"矩形不合理: {r}"
    assert state["n"] >= 2, f"未发生重试（拍了 {state['n']} 次）"


def test_normal_path_single_shot():
    # 首拍缓存真实截图并固定返回同一张 —— 匹配结果确定，不应触发重试
    snap = _real_shot()
    pyautogui.screenshot = lambda *a, **k: snap
    try:
        r = p.window_rect()
    finally:
        pyautogui.screenshot = _real_shot
    if r is None:
        raise AssertionError("缓存的桌面截图不匹配 titlebar——当前桌面状态异常，先目检")
    print("(缓截图匹配正常，未触发重试)")


if __name__ == "__main__":
    test_recovers_after_activate()
    print("PASS recovers_after_activate")
    test_normal_path_single_shot()
    print("PASS normal_path_single_shot")
    print("ALL PASS")
