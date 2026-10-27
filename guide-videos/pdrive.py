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


# 客户区尺寸判据（物理像素）：最大化时约 1920x990，标准窗口 1482x953。
# 录制一律最大化（用户要求：非最大化会录到窗口外的无关界面）。
MIN_CLIENT = (1200, 700)

# 视口 CSS → 物理的缩放比（Electron devicePixelRatio，本机 1.25）。
# 由 hcdp 在 attach 时用 CDP 实测值刷新，不再硬编码。
_DPR = 1.25


def set_dpr(v):
    global _DPR
    try:
        if v and float(v) > 0:
            _DPR = float(v)
    except Exception:
        pass
    return _DPR


def dpr():
    return _DPR


def _dpi_aware():
    """Win32 取物理像素：pyautogui/pygetwindow 已在物理坐标系工作，坐标空间必须统一。"""
    import ctypes
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def _hwnd(title="HTW 工作台"):
    """按标题找可见应用窗口句柄（取面积最大的那个，避免命中残留小窗）。"""
    import ctypes
    from ctypes import wintypes
    _dpi_aware()
    u = ctypes.windll.user32
    hits = []

    def cb(h, _):
        if not u.IsWindowVisible(h):
            return True
        n = u.GetWindowTextLengthW(h)
        if n:
            b = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(h, b, n + 1)
            if title in b.value:
                wr = wintypes.RECT()
                u.GetWindowRect(h, ctypes.byref(wr))
                hits.append(((wr.right - wr.left) * (wr.bottom - wr.top), h))
        return True

    u.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(cb), 0)
    if not hits:
        return None
    hits.sort(reverse=True)
    return hits[0][1]


def client_rect(h):
    """客户区物理矩形 (x, y, w, h)：左上角取 ClientToScreen(0,0)。
    渲染内容就画在这个矩形里，裁剪和点击换算都以它为基准 —— 不再依赖外框常量，
    窗口最大化/普通尺寸用同一套公式。"""
    import ctypes
    from ctypes import wintypes
    u = ctypes.windll.user32
    cr = wintypes.RECT()
    pt = wintypes.POINT(0, 0)
    u.GetClientRect(h, ctypes.byref(cr))
    u.ClientToScreen(h, ctypes.byref(pt))
    w, hh = cr.right - cr.left, cr.bottom - cr.top
    if w < MIN_CLIENT[0] or hh < MIN_CLIENT[1]:
        return None
    return (pt.x, pt.y, w - w % 2, hh - hh % 2)


def ensure_window(maximize=True):
    """确保应用窗口处于录制态：前台 + 最大化（默认），返回客户区矩形。
    🔴 2026-10-27：标题栏模板匹配在最大化时仍会低置信度误命中（0.6 阈值），
    返回固定的 1482x953 —— 裁剪和「视口×1.25」的点击换算同时失真，
    表现为「按钮点了没反应 / 场景录成静帧」。改用 Win32 实测客户区，彻底去掉模板依赖。"""
    import ctypes
    u = ctypes.windll.user32
    h = _hwnd()
    if not h:
        return None
    activate()
    if maximize and not u.IsZoomed(h):
        u.ShowWindow(h, 3)  # SW_MAXIMIZE
        time.sleep(1.2)
    return client_rect(h)


def _rect_template():
    """标题栏模板匹配（仅 Win32 取不到窗口时兜底；最大化下不可信，仅供诊断）。"""
    import cv2
    import numpy as np
    t = os.path.join(TMPL, "titlebar.png")
    scr = pyautogui.screenshot()
    img = cv2.cvtColor(np.array(scr), cv2.COLOR_RGB2BGR)
    r = cv2.matchTemplate(img, cv2.imread(t), cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(r)
    if max_val < 0.6:
        return None
    # 模板匹配的 (-18,-15) 是外框偏移；这里换算成客户区原点（边框 9 / 标题栏 40）
    return (max_loc[0] - 18 + 9, max_loc[1] - 15 + 40, 1482, 953)


def window_rect():
    """应用窗口客户区物理矩形 (x, y, w, h) = 真正被录制的画面区域。
    优先 Win32 实测；取不到才回退模板匹配。"""
    h = _hwnd()
    if h:
        r = client_rect(h)
        if r:
            return r
    try:
        activate()
        time.sleep(0.6)
    except Exception:
        pass
    return _rect_template()


def to_physical(css_x, css_y, d=None):
    """视口 CSS 坐标 → 屏幕物理坐标（客户区原点 + CSS×DPR）。"""
    r = window_rect()
    if not r:
        raise RuntimeError("to_physical: 应用窗口未就绪（客户区矩形取不到）")
    k = _DPR if d is None else d
    return int(round(r[0] + css_x * k)), int(round(r[1] + css_y * k))


def is_foreground():
    """应用窗口是否真的在最前面。录制是全桌面捕获，前台一变就录到别的窗口
    （2026-10-27 实录：录 06 时前台是个调试工具，整集素材作废）。"""
    import ctypes
    u = ctypes.windll.user32
    h = _hwnd()
    if not h:
        return False
    fg = u.GetForegroundWindow()
    return fg == h or u.GetAncestor(fg, 2) == h  # GA_ROOT


def activate(tries=3):
    """把应用窗口提到前台并确认成功；返回是否真的在前台。
    pygetwindow 的 activate() 会静默失败（后台进程抢焦点被系统前台锁拦下），
    所以这里补 AttachThreadInput 强提 + 逐次校验。"""
    import ctypes
    u = ctypes.windll.user32
    _dpi_aware()
    h = _hwnd()
    if not h:
        return False
    for _ in range(tries):
        if is_foreground():
            return True
        if u.IsIconic(h):
            u.ShowWindow(h, 9)  # SW_RESTORE
        try:
            fg = u.GetForegroundWindow()
            tid_fg = u.GetWindowThreadProcessId(fg, None)
            tid_me = ctypes.windll.kernel32.GetCurrentThreadId()
            u.AttachThreadInput(tid_me, tid_fg, True)
            u.BringWindowToTop(h)
            u.SetForegroundWindow(h)
            u.AttachThreadInput(tid_me, tid_fg, False)
        except Exception:
            pass
        time.sleep(0.6)
        if is_foreground():
            return True
        # 兜底：pygetwindow
        try:
            import pygetwindow as gw
            for w in gw.getAllWindows():
                if "HTW 工作台" in (w.title or ""):
                    w.activate()
                    break
        except Exception:
            pass
        time.sleep(0.5)
        if is_foreground():
            return True
    return is_foreground()
