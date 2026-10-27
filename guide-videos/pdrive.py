# -*- coding: utf-8 -*-
"""物理自动化驱动（零 CDP）：模板匹配定位 + 真实鼠标键盘"""
import os
import time
import pyautogui
import pyperclip

pyautogui.FAILSAFE = True  # 左上角甩鼠标可急停
pyautogui.PAUSE = 0.4
HERE = os.path.dirname(os.path.abspath(__file__))
TMPL = os.path.join(HERE, "tmpl")


def shot(name="shot"):
    p = os.path.join(HERE, name + ".png")
    pyautogui.screenshot(p)
    return p


def find(name, confidence=0.80):
    t = os.path.join(TMPL, name + ".png")
    box = pyautogui.locateCenterOnScreen(t, confidence=confidence, grayscale=True)
    return box  # (x, y) or None


def click(name, confidence=0.80, timeout=15, double=False):
    t0 = time.time()
    while time.time() - t0 < timeout:
        pos = find(name, confidence)
        if pos:
            pyautogui.moveTo(pos.x, pos.y, duration=0.25)
            pyautogui.click()
            time.sleep(0.5)
            return pos
        time.sleep(0.7)
    raise RuntimeError("模板未找到: " + name)


def paste(text):
    pyperclip.copy(text)
    pyautogui.hotkey("ctrl", "v")
    time.sleep(0.3)


def click_and_paste(name, text, **kw):
    click(name, **kw)
    paste(text)


def dialog_open(path_ascii):
    """原生文件对话框：文件名框输入路径回车"""
    time.sleep(1.2)
    pyautogui.typewrite(path_ascii, interval=0.02)
    time.sleep(0.3)
    pyautogui.press("enter")
    time.sleep(1.0)


def window_rect():
    """标题栏模板匹配 -> 应用窗口物理矩形 (x, y, w, h)；找不到先激活窗口再重测一次。
    失败常见于窗口被遮挡/最小化（瞬时态），录制场景本就需要应用在前台。"""
    import cv2
    import numpy as np
    t = os.path.join(TMPL, "titlebar.png")

    def _match():
        scr = pyautogui.screenshot()
        img = cv2.cvtColor(np.array(scr), cv2.COLOR_RGB2BGR)
        r = cv2.matchTemplate(img, cv2.imread(t), cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(r)
        if max_val < 0.6:
            return None
        return (max_loc[0] - 18, max_loc[1] - 15, 1482, 953)

    r = _match()
    if r is None:
        try:
            activate()
            time.sleep(0.6)
        except Exception:
            pass
        r = _match()
    return r


def activate():
    import pygetwindow as gw
    for w in gw.getAllWindows():
        if "HTW 工作台" in (w.title or ""):
            try:
                w.activate()
                time.sleep(0.5)
                return True
            except Exception:
                pass
    return False
