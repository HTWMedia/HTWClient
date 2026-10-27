# -*- coding: utf-8 -*-
"""窗口几何契约（2026-10-27 重写：Win32 实测客户区，最大化录制）。

背景：标题栏模板匹配在窗口最大化时会低置信度误命中（0.6 阈值），仍返回 1482x953，
裁剪与「视口坐标 ×1.25 + 外框常量」的点击换算同时失真 → 按钮点了没反应、录成静帧。
新契约：
  1. window_rect() = 客户区物理矩形 (x, y, w, h)，即真正被录制的画面区域；
  2. 录制要求窗口最大化（非最大化会录到窗口外的无关界面），ensure_window() 负责；
  3. 点击坐标 = 客户区原点 + 视口CSS × devicePixelRatio，to_physical() 统一换算。
"""
import ctypes
import os
import sys
import time
from ctypes import wintypes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HTW_CDP", "http://127.0.0.1:9223")

import pyautogui
import pdrive as p


def test_client_rect_matches_win32():
    """矩形必须等于 Win32 客户区（ClientToScreen + GetClientRect）。"""
    r = p.window_rect()
    assert r is not None, "window_rect 返回 None"
    h = p._hwnd()
    assert h, "找不到应用窗口"
    cr = wintypes.RECT()
    pt = wintypes.POINT(0, 0)
    ctypes.windll.user32.GetClientRect(h, ctypes.byref(cr))
    ctypes.windll.user32.ClientToScreen(h, ctypes.byref(pt))
    assert abs(r[0] - pt.x) <= 2 and abs(r[1] - pt.y) <= 2, f"客户区原点不符: {r} vs ({pt.x},{pt.y})"
    assert abs(r[2] - (cr.right - cr.left)) <= 2, f"宽不符: {r[2]} vs {cr.right - cr.left}"
    assert abs(r[3] - (cr.bottom - cr.top)) <= 2, f"高不符: {r[3]} vs {cr.bottom - cr.top}"
    print(f"PASS client_rect_matches_win32 {r}")


def test_maximized_client_covers_screen():
    """ensure_window 后窗口最大化，客户区宽度≈物理屏宽（录满屏，不夹带桌面）。"""
    r = p.ensure_window()
    assert r is not None, "ensure_window 返回 None"
    h = p._hwnd()
    assert ctypes.windll.user32.IsZoomed(h), "窗口未最大化"
    screen_w = ctypes.windll.user32.GetSystemMetrics(0)
    assert abs(r[2] - screen_w) <= 8, f"客户区宽度 {r[2]} 与屏宽 {screen_w} 不符（会录到桌面）"
    print(f"PASS maximized_client_covers_screen {r}")


def test_to_physical_math():
    """to_physical = 客户区原点 + CSS×DPR。"""
    r = p.ensure_window()
    x, y = p.to_physical(100, 200)
    k = p.dpr()
    assert abs(x - (r[0] + 100 * k)) <= 2, f"x 换算不符: {x} vs {r[0] + 100 * k}"
    assert abs(y - (r[1] + 200 * k)) <= 2, f"y 换算不符: {y} vs {r[1] + 200 * k}"
    print(f"PASS to_physical_math dpr={k} -> ({x},{y})")


def test_template_fallback():
    """Win32 取不到窗口时才回退模板匹配（历史标定路径保持可用）。"""
    snap = pyautogui.screenshot()
    _hwnd = p._hwnd
    _shot = pyautogui.screenshot
    p._hwnd = lambda *a, **k: None
    pyautogui.screenshot = lambda *a, **k: snap
    try:
        r = p.window_rect()
    finally:
        p._hwnd = _hwnd
        pyautogui.screenshot = _shot
    assert r is not None, "模板回退路径失效（当前桌面无应用窗口？）"
    print("PASS template_fallback", r)


if __name__ == "__main__":
    test_client_rect_matches_win32()
    test_maximized_client_covers_screen()
    test_to_physical_math()
    time.sleep(0.2)
    test_template_fallback()
    print("ALL PASS")
