# -*- coding: utf-8 -*-
"""混合驱动：CDP 做导航/滚动/设文件/读状态（精确），提交点击用物理鼠标并立即脱离 CDP，
上传/渲染期间零 CDP（避免渲染器被 CDP 干扰冻结/崩溃）。"""
import os
import sys
import time
import json

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cdp import CDP
import pyautogui
import pdrive as p


_DIST = os.path.join("D:", os.sep, "HTWClient", "apps", "desktop", "dist")
# 优先解包版：portable（dist 根目录的 "HTW Media <ver>.exe"）每次启动都要解压到 Temp，
# 冷启动慢且刚被杀过时容易解压失败（2026-10-27 夜：连启三次都没出窗口）。
_UNPACKED = os.path.join(_DIST, "win-unpacked", "HTW Media.exe")
_PORTABLE = os.path.join(_DIST, "HTW Media 0.5.0.exe")
APP = _UNPACKED if os.path.exists(_UNPACKED) else _PORTABLE
CDP_PORT = 9223

# 面板 id → 导航短名（click_btn_text 发现面板未激活时用来自愈切换）
_PANEL_NAV = {"panel-tools": "tools", "panel-insight": "insight", "panel-topics": "topics",
              "panel-create": "create", "panel-workflow": "workflow", "panel-edit": "edit",
              "panel-publish": "publish", "panel-marketing": "market", "panel-batch": "batch",
              "panel-shortdrama": "shortdrama", "panel-assistant": "assistant",
              "panel-tasks": "tasks", "panel-settings": "settings"}


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
    # 🔴 只按应用自身的可执行文件名杀，**绝不能杀 electron.exe**：
    # 这是通用名，宿主（WorkBuddy 等 Electron 应用）也叫它，/T 会连带杀掉
    # 调用方自己的进程树 —— 2026-10-27 表现为整条命令无故被 SIGTERM。
    for im in ("HTW Media 0.5.0.exe", "HTW Media 0.4.0.exe", "HTW Media.exe"):
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
        p.ensure_window()       # 录制要求最大化 + 前台：客户区即录制画面，避免录到无关界面
        self.c = CDP()          # 可随时 close/detach
        self._sync_dpr()
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

    def scroll_result(self, panel, title):
        """滚到指定卡片的**结果区**（卡片最后一个子节点）。
        卡片常高过视口，scroll_card 居中后结果区正好在画面外 —— 07 转写/总结实录。"""
        r = self.c.ev(f'''(() => {{
          const cands = [...document.querySelectorAll("#{panel} .card")].filter(k => k.textContent.includes("{title}"));
          if (!cands.length) return "nocard";
          cands.sort((a, b) => a.querySelectorAll(".card").length - b.querySelectorAll(".card").length);
          const card = cands[0];
          const region = card.lastElementChild || card;
          region.scrollIntoView({{block: "center"}});
          return "ok";
        }})()''')
        time.sleep(0.6)
        return r

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
          // 🔴 只按 .card 圈定，并取**最内层**匹配：此前用 ".card, section, div" 时，
          // 外层网格容器也会命中（它的 querySelector("h3") 返回第一张卡的标题），
          // 于是 pop() 取到面板里最后一个 file input —— 文件被设到别的卡片上，
          // 点按钮只会报「请选择音频」（2026-10-27 录 07 实录：文件跑到了「字幕提取」）。
          const cands = [...scope.querySelectorAll(".card, section")].filter(k => {{
            const h = k.querySelector("h3, h2");
            return h && h.textContent.includes("{title}");
          }});
          if (!cands.length) return "nocard";
          cands.sort((a, b) => a.querySelectorAll(".card").length - b.querySelectorAll(".card").length);
          const root = cands[0];
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
        def _find():
            return self.c.ev(f'''(() => {{
              const b = [...document.querySelectorAll("#{panel} button")]
                .find(x => x.textContent.trim().includes("{text}") && x.offsetParent);
              if (!b) return "";
              b.scrollIntoView({{block: "center"}});
              const r = b.getBoundingClientRect();
              return JSON.stringify({{x: r.left + r.width / 2, y: r.top + r.height / 2}});
            }})()''')

        self.attach()
        r = _find()
        if not r:
            # 🔴 非激活面板是 display:none —— 里面所有按钮 offsetParent 都是 null，
            # 只看 DOM 会误报「按钮未找到」。先确认面板激活态，必要时切过去再找。
            # （2026-10-27 录 04：场景 1 的 nav 崩在窗口矩形上 → 面板没切过去 → 场景 3 找不到按钮）
            active = self.c.ev('(document.querySelector(".panel.active")||{}).id || ""')
            if active != panel:
                name = _PANEL_NAV.get(panel)
                if name:
                    print(f"    [面板未激活] {active or '?'} → 切换 {name}", flush=True)
                    self.nav(name)
                    self.attach()
                r = _find()
        if not r:
            self.attach()
            now = self.c.ev('(document.querySelector(".panel.active")||{}).id || ""')
            raise RuntimeError(f"按钮未找到: {text}（面板 {panel}，实际激活 {now or '无'}）")
        import json
        pos = json.loads(r)
        win = p.window_rect()
        if win is None:
            # 渲染器可能刚崩：重启应用后重新定位按钮再点（窗口位置重启后可能变化）
            ensure_app()
            self.attach()
            r2 = _find()
            if not r2:
                raise RuntimeError(f"按钮未找到(自愈后): {text}")
            pos = json.loads(r2)
            win = p.window_rect()
            if win is None:
                raise RuntimeError("window_rect 自愈后仍为 None")
        self.detach()
        time.sleep(0.6)
        # rect 为视口 CSS 坐标；物理坐标 = 客户区原点 + CSS×devicePixelRatio
        # （不再用「外框+9/+40」常量：最大化窗口的边框/标题栏会变）
        px, py_ = p.to_physical(pos["x"], pos["y"])
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
            self._sync_dpr()

    def _sync_dpr(self):
        """视口 CSS → 物理的倍率以渲染进程实测值为准（缩放设置变了也不会点偏）。"""
        try:
            p.set_dpr(self.c.ev("devicePixelRatio"))
        except Exception:
            pass

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
            if p.window_rect() is None:
                # 🔴 2026-10-27：此前这里直接 win[0] 崩成「'NoneType' object is
                # not subscriptable」，导航中断但场景照录 → 后面全部动作打在未激活面板上。
                ensure_app()
                if p.window_rect() is None:
                    raise RuntimeError("nav: 应用窗口未就绪（客户区矩形取不到）")
            self.detach()
            time.sleep(0.5)
            import pyautogui
            px, py_ = p.to_physical(pos["x"], pos["y"])
            pyautogui.moveTo(px, py_, duration=0.25)
            pyautogui.click()
            time.sleep(0.6)
            self.attach()
        time.sleep(0.8)
        # 导航必须落地：面板没切过去就继续录制，等于把整集录成静帧（03/04 已有先例）
        pid = H._PANELS.get(name)
        if pid:
            self.attach()
            now = self.c.ev('(document.querySelector(".panel.active")||{}).id || ""')
            if now != pid:
                raise RuntimeError(f"导航未生效: 期望 {pid}，实际 {now or '无激活面板'}")

    def wait_result_state(self, panel, ok_text, fail_texts=("出错", "失败", "错误"),
                          timeout=900, poll=25, first=20):
        """渲染等待（快失败版）：返回 ("ok"|"error"|"timeout", 命中原文)。
        提交被网关直接拒（如 Cloudflare 524）时结果区几秒内就出现「出错」，
        此时按成功文本硬等 timeout 等于白烧一次真机录制（04 集 2026-10-27 实录）。"""
        t0 = time.time()
        sel = panel if str(panel).startswith(("#", ".")) else "#" + panel
        js = '''(() => {
          const s = document.querySelector("%s");
          if (!s) return "";
          const t = s.textContent || "";
          if (t.includes(%s)) return "OK";
          for (const f of %s) { if (t.includes(f)) return "ERR:" + t.trim().slice(0, 120); }
          return "";
        })()''' % (sel, json.dumps(ok_text, ensure_ascii=False),
                   json.dumps(list(fail_texts), ensure_ascii=False))
        time.sleep(first)
        while True:
            try:
                self.attach()
                r = self.c.ev(js) or ""
                self.detach()
                print(f"    [渲染等待 {time.time()-t0:.0f}s] {r or '进行中'}", flush=True)
                if r == "OK":
                    return "ok", ""
                if r.startswith("ERR:"):
                    return "error", r[4:]
            except Exception as ex:
                print(f"    [等待重连失败] {ex}", flush=True)
                try:
                    self.detach()
                except Exception:
                    pass
            if time.time() - t0 >= timeout:
                return "timeout", ""
            time.sleep(poll)

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
