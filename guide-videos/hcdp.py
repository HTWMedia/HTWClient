# -*- coding: utf-8 -*-
"""混合驱动：CDP 做导航/滚动/设文件/读状态（精确），提交点击用物理鼠标并立即脱离 CDP，
上传/渲染期间零 CDP（避免渲染器被 CDP 干扰冻结/崩溃）。"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cdp import CDP
import pyautogui
import pdrive as p


APP = os.path.join("D:", os.sep, "HTWClient", "apps", "desktop", "dist", "HTW Media 0.5.0.exe")
CDP_PORT = 9223


def app_alive():
    """页面目标在才算活：渲染器崩掉后主进程还挂着（僵尸窗口），只有 /json 说了算。"""
    import json as _json
    import urllib.request as _ur
    try:
        tabs = _json.load(_ur.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=4))
        return any(t.get("type") == "page" and "工作台" in t.get("title", "") for t in tabs)
    except Exception:
        return False


def ensure_app():
    """应用死了就地复活：杀掉全部残留进程（含僵尸子进程）→ 重启 → 等页面目标就绪。"""
    import subprocess as _sp
    if app_alive():
        return True
    print("  [应用自愈] 页面目标不在，清理并重启应用", flush=True)
    for im in ("HTW Media 0.5.0.exe", "HTW Media.exe", "electron.exe"):
        try:
            _sp.run(["taskkill", "/IM", im, "/F", "/T"], capture_output=True, timeout=30)
        except Exception:
            pass
    time.sleep(3)
    _sp.Popen([APP, f"--remote-debugging-port={CDP_PORT}", "--remote-allow-origins=*"],
              stdout=open(r"D:\HTWClient\.claude-app2.log", "a"),
              stderr=_sp.STDOUT)
    for _ in range(45):
        time.sleep(2)
        if app_alive():
            time.sleep(4)
            return True
    raise RuntimeError("应用重启失败")


class H:
    def __init__(self):
        ensure_app()
        self.c = CDP()          # 可随时 close/detach
        p.activate()

    # --- CDP 精确操作 ---
    def scroll_card(self, panel, title):
        self.c.ev(f'''(() => {{
          const card = [...document.querySelectorAll("#{panel} .card, #{panel} [id*=card], #{panel} section")]
            .find(k => k.textContent.includes("{title}"));
          if (card) {{ card.scrollIntoView({{block: "center"}}); return "ok"; }}
          // 兜底：按文本找最近的容器
          const el = [...document.querySelectorAll("#{panel} h3, #{panel} h2")].find(h => h.textContent.includes("{title}"));
          if (el) {{ el.scrollIntoView({{block: "center"}}); return "ok"; }}
          return "notfound";
        }})()''')
        time.sleep(0.6)

    def scroll_top(self):
        self.c.ev("window.scrollTo(0, 0)")
        time.sleep(0.4)

    def scroll_by(self, dy):
        self.c.ev(f"window.scrollBy(0, {dy})")
        time.sleep(0.4)

    def set_file_card(self, panel, title, files):
        # 🔴 id 必须唯一：此前固定用 "__hfile"，多个卡片先后打过同一个 id 后
        # querySelector("#__hfile") 命中 DOM 里第一个（比如粗剪的输入框）——
        # 文件设错对象、目标功能报「请先选择视频文件」（2026-10-25 录 04 实录）。
        # 每次调用先清掉面板内所有 __hfile* 旧 id，再用本次的唯一 id。
        import uuid
        uid = "__hfile_" + uuid.uuid4().hex[:8]
        r = self.c.ev(f'''(() => {{
          const scope = document.querySelector("#{panel}");
          if (!scope) return "nopanel";
          scope.querySelectorAll("input[type=file][id^='__hfile']").forEach(i => i.removeAttribute("id"));
          const card = [...scope.querySelectorAll(".card, section, div")]
            .find(k => k.querySelector("h3,h2") && (k.querySelector("h3,h2").textContent.includes("{title}")));
          const root = card || scope;
          const inp = [...root.querySelectorAll("input[type=file]")].pop();
          if (!inp) return "nofile";
          inp.id = "{uid}";
          return "ok";
        }})()''')
        if r != "ok":
            raise RuntimeError(f"set_file_card {title}: {r}")
        norm = [f.replace("\\", "/") for f in files]
        self.c.set_file("#" + uid, norm)
        # 设置后校验：files 为空说明设错对象或路径无效 —— 立刻失败别带病往下录。
        got = self.c.ev(f'document.getElementById("{uid}").files.length')
        if not got:
            raise RuntimeError(f"set_file_card {title}: 文件未生效（files=0，路径或目标错误）")

    def click_btn_text(self, panel, text):
        """CDP 找按钮坐标 -> 关闭 CDP -> 物理点击（提交类操作专用）"""
        r = self.c.ev(f'''(() => {{
          const b = [...document.querySelectorAll("#{panel} button")]
            .find(x => x.textContent.trim().includes("{text}") && x.offsetParent);
          if (!b) return "";
          b.scrollIntoView({{block: "center"}});
          const r = b.getBoundingClientRect();
          return JSON.stringify({{x: r.left + r.width / 2, y: r.top + r.height / 2}});
        }})()''')
        if not r:
            raise RuntimeError(f"按钮未找到: {text}")
        import json
        pos = json.loads(r)
        win = p.window_rect()
        if win is None:
            # 渲染器可能刚崩：重启应用后重新定位按钮再点（窗口位置重启后可能变化）
            ensure_app()
            self.attach()
            r2 = self.c.ev(f'''(() => {{
              const b = [...document.querySelectorAll("#{panel} button")]
                .find(x => x.textContent.trim().includes("{text}") && x.offsetParent);
              if (!b) return "";
              b.scrollIntoView({{block: "center"}});
              const r = b.getBoundingClientRect();
              return JSON.stringify({{x: r.left + r.width / 2, y: r.top + r.height / 2}});
            }})()''')
            if not r2:
                raise RuntimeError(f"按钮未找到(自愈后): {text}")
            pos = json.loads(r2)
            win = p.window_rect()
            if win is None:
                raise RuntimeError("window_rect 自愈后仍为 None")
        self.detach()
        time.sleep(0.6)
        # rect 为视口 CSS 坐标（逻辑）；物理 = 窗口左上 + 边框 9px + 逻辑*1.25
        px = int(win[0] + 9 + pos["x"] * 1.25)
        py_ = int(win[1] + 40 + pos["y"] * 1.25)
        pyautogui.moveTo(px, py_, duration=0.25)
        pyautogui.click()
        time.sleep(0.5)

    def detach(self):
        try:
            self.c.close()
        except Exception:
            pass
        self.c = None

    def attach(self):
        if self.c is None:
            ensure_app()
            self.c = CDP()

    def read(self, js):
        self.attach()
        return self.c.ev(js)

    # --- 物理操作 ---
    # nav 短名 → 面板 id（激活态回退用）
    _PANELS = {"tools": "panel-tools", "insight": "panel-insight", "topics": "panel-topics",
               "create": "panel-create", "workflow": "panel-workflow", "edit": "panel-edit",
               "publish": "panel-publish", "market": "panel-marketing", "batch": "panel-batch",
               "shortdrama": "panel-shortdrama", "assistant": "panel-assistant",
               "tasks": "panel-tasks", "settings": "panel-settings"}

    def nav(self, name):
        p.activate()
        try:
            p.click("nav_" + name, timeout=15)
        except Exception:
            # 模板是「未激活」态截的：目标已处于激活态（高亮样式不同）匹配必失败。
            # 回退① 已激活 → 无需点击；回退② CDP 取坐标 → 物理点击。
            # 🔴 此前 click_btn_text 已 detach（c=None），这里必须先重连，
            # 否则 NoneType has no attribute 'ev' —— 03/04 大量场景录成静帧的根源。
            self.attach()
            pid = H._PANELS.get(name)
            active = self.c.ev('(document.querySelector(".panel.active")||{}).id || ""')
            if pid and active == pid:
                time.sleep(0.4)
                return
            import json as _json
            r = ""
            for _try in range(2):
                try:
                    r = self.c.ev(f'''(() => {{
                      const b = [...document.querySelectorAll("button.nav-item")].find(
                        x => x.textContent.trim().toLowerCase().includes("{name.lower()}") && x.offsetParent);
                      if (!b) return "";
                      const r = b.getBoundingClientRect();
                      return JSON.stringify({{x: r.left + r.width / 2, y: r.top + r.height / 2}});
                    }})()''')
                    break
                except Exception:
                    self.attach()  # 连接丢失：重连后取坐标重试一次
            if not r:
                raise
            pos = _json.loads(r)
            win = p.window_rect()
            self.detach()
            time.sleep(0.5)
            import pyautogui
            pyautogui.moveTo(int(win[0] + 9 + pos["x"] * 1.25),
                             int(win[1] + 40 + pos["y"] * 1.25), duration=0.25)
            pyautogui.click()
            time.sleep(0.6)
            self.attach()
        time.sleep(0.8)

    def wait_result(self, panel, text, timeout=900, poll=20):
        """渲染等待：期间零 CDP，靠截图判断结束再重连读取"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            time.sleep(55)
            try:
                self.attach()
                sel = panel if str(panel).startswith(("#", ".")) else "#" + panel
                r = self.c.ev(f'''(() => {{
                  const s = document.querySelector("{sel}");
                  return s && s.textContent.includes("{text}") ? "yes" : "no";
                }})()''')
                self.detach()
                print(f"    [渲染等待 {time.time()-t0:.0f}s] {text}: {r}", flush=True)
                if r == "yes":
                    return True
            except Exception as ex:
                print(f"    [等待重连失败] {ex}", flush=True)
                try:
                    self.detach()
                except Exception:
                    pass
        return False
