# -*- coding: utf-8 -*-
"""物理自动化通用录制（每场景独立录制）：
scenes = [dict(narr, sub, run, pad, speed_cap, min_len)]
run() 里完成该场景全部动作；渲染等待放在 run 内（截图轮询目检）。
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import record_take, assemble, tts, audio_len
import pdrive as p
import pyautogui

def _ensure_narration(sc, i, work):
    """旁白缓存：文件名含文本哈希，同文本复用音频不重复合成（重录频繁，
    今天的 TTS 服务端 frequency limit 部分源于每次重录全量重合成）。"""
    import hashlib
    key = hashlib.md5(sc["narr"].encode("utf-8")).hexdigest()[:8]
    nf = os.path.join(work, f"narr_{i:02d}_{key}.mp3")
    if os.path.exists(nf) and audio_len(nf) > 0:
        sc["narr_file"] = nf
        sc["narr_dur"] = audio_len(nf)
        return nf
    sc["narr_file"] = nf
    sc["narr_dur"] = tts(sc["narr"], nf, spd=4)
    return nf


def _rec_lock(name):
    """录制互斥锁：两个录制进程并发会同时写同一 take 文件（已烧过一次真机教训）。
    已持锁抛 RuntimeError；调用方在 finally 中 _rec_unlock。"""
    path = os.path.join(HERE, f"rec_{name}.lock")
    if os.path.exists(path):
        pid = ""
        try:
            pid = open(path, encoding="ascii", errors="replace").read().strip()
        except Exception:
            pass
        raise RuntimeError(f"录制锁已存在: {path}（持有者 PID {pid or '?'}）——"
                           f"确认没有其他录制进程后手动删除该文件再试")
    with open(path, "w", encoding="ascii") as f:
        f.write(str(os.getpid()))
    return path


def _rec_unlock(path):
    try:
        os.remove(path)
    except OSError:
        pass


def record_physical(name, scenes, out_name=None, title="HTW 工作台"):
    lock = _rec_lock(name)
    import ctypes
    # 渲染等待常跨数分钟：系统/显示器休眠会让 gdigrab 报 error 5、物理点击打空
    #（2026-10-28 00:58 场景 3 实录）。录制期间禁用休眠与息屏，结束时恢复。
    ES_CONTINUOUS, ES_SYSTEM_REQ, ES_DISPLAY_REQ = 0x80000000, 0x1, 0x2
    try:
        ctypes.windll.kernel32.SetThreadExecutionState(
            ES_CONTINUOUS | ES_SYSTEM_REQ | ES_DISPLAY_REQ)
        _record_physical(name, scenes, out_name, title)
    finally:
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
        _rec_unlock(lock)


def _record_physical(name, scenes, out_name=None, title="HTW 工作台"):
    out_name = out_name or name
    # 应用必须先起来：否则窗口矩形取不到 → crop 退回全桌面（含任务栏/桌面图标），
    # 且首个场景的所有动作都打在空窗上（2026-10-27 录 07 实录）。
    try:
        import hcdp
        hcdp.ensure_app()
    except Exception as ex:
        print(f"  [应用未就绪] {ex}", flush=True)
    try:
        p.activate()  # 桌面整屏捕获：应用必须在前台，否则录到的是别的窗口
    except Exception:
        pass
    # 窗口必须先拉回标准几何：最大化状态下客户区尺寸与外框原点都会变，
    # 裁剪和「视口坐标×1.25」的点击换算同时失效（2026-10-27 录 04 实录）。
    try:
        W0 = p.ensure_window()
        if W0:
            print(f"  窗口已标准化: {W0}", flush=True)
    except Exception as ex:
        print(f"  [窗口标准化失败] {ex}", flush=True)
    work = os.path.join(HERE, "work", name)
    os.makedirs(work, exist_ok=True)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "scripts"), exist_ok=True)

    # 窗口裁剪：录制是全桌面捕获（窗口标题捕获在 Electron 上失焦后拿黑/白帧），
    # 合成时按应用窗口矩形裁掉桌面壁纸/任务栏等无关画面。
    # 没显式给 crop 的场景统一注入当前窗口矩形（窗口全程不动，取一次即可）；
    # 负坐标由 pipeline.assemble 钳制。2026-10-25：03-11 首批成品带桌面背景，用户要求重录。
    crop = None
    W = None
    try:
        W = p.window_rect()
    except Exception:
        pass
    if W:
        crop = (W[0], W[1], W[2] - W[2] % 2, W[3] - W[3] % 2)
    if crop:
        print(f"  窗口裁剪: {crop}", flush=True)
    else:
        # 别退化成全桌面：那会把任务栏和桌面图标录进去（用户明确要求最大化铺满）
        raise RuntimeError("应用窗口未就绪（客户区矩形取不到），录制中止")
    for sc in scenes:
        sc.setdefault("crop", crop)

    # TTS（带缓存：同文本复用已有音频）
    for i, sc in enumerate(scenes):
        _ensure_narration(sc, i, work)
        print(f"  TTS {i+1}/{len(scenes)}: {sc['narr_dur']:.1f}s", flush=True)

    meta = []
    for i, sc in enumerate(scenes):
        clip = os.path.join(work, f"clip_{i:02d}.mp4")

        def record_scene():
            """录一个场景（ffmpeg + 动作 + 补齐时长），返回错误信息或 None。"""
            # 全桌面捕获：前台不是应用，录到的就是别人的窗口（2026-10-27 06 集作废实录）
            if not p.activate():
                return "应用无法提到前台，录制会录到其它窗口"
            try:
                if os.path.exists(clip):
                    os.remove(clip)   # 别让上一次的片段充当本次结果
            except OSError:
                pass
            t0 = time.time()
            proc = record_take(title, clip, 0)
            err = None
            try:
                if sc.get("run"):
                    sc["run"]()
            except Exception as ex:
                err = str(ex)[:200] or ex.__class__.__name__
            # 录制期间被别的窗口抢前台 → 这一条必然有别人的画面
            if not p.is_foreground():
                err = err or "录制期间应用失去前台（可能录到其它窗口）"
            used = time.time() - t0
            need = max(sc["narr_dur"] + sc.get("pad", 0.6), sc.get("min_len", 0))
            if used < need:
                time.sleep(need - used)
            time.sleep(0.8)
            try:
                proc.stdin.write(b"q"); proc.stdin.flush()
            except Exception:
                pass
            time.sleep(1.2)
            proc.terminate()
            return err

        # 每场景重算裁剪：应用中途崩溃重启后窗口位置可能变化
        try:
            W = p.window_rect()
            if W:
                sc["crop"] = (W[0], W[1], W[2] - W[2] % 2, W[3] - W[3] % 2)
        except Exception:
            pass

        sc["err"] = record_scene()
        if sc["err"]:
            print(f"  [场景 {i+1} 出错] {sc['err']} —— 自愈后重录本场景", flush=True)
            try:
                import hcdp
                hcdp.ensure_app()
            except Exception as heal_ex:
                print(f"  [自愈失败] {heal_ex}", flush=True)
            sc["err"] = record_scene()
            if not sc["err"]:
                print(f"  [场景 {i+1}] 重试成功", flush=True)
        meta.append({"index": i, "clip": clip, "narr_dur": round(sc["narr_dur"], 2),
                     "sub": sc["sub"], "narr": sc["narr"], "narr_file": sc["narr_file"],
                     "pad": sc.get("pad", 0.6), "speed_cap": sc.get("speed_cap"),
                     "crop": sc.get("crop"),
                     "err": sc.get("err")})
        print(f"  场景 {i+1}/{len(scenes)} 录制完成", flush=True)

    json.dump(meta, open(os.path.join(HERE, f"meta_{name}.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    total = assemble(name, meta, None, work, os.path.join(HERE, "out", out_name + ".mp4"))
    # 文案
    md = [f"# {out_name} 教程文案\n"]
    tt = 0.0
    for i, m in enumerate(meta):
        md.append(f"## 场景 {i+1}（约 {tt:.0f}s 起）\n- 旁白/字幕：{m['narr']}\n")
        tt += (m.get("shown_len") or m["narr_dur"] + m["pad"])
    open(os.path.join(HERE, "scripts", out_name + ".md"), "w", encoding="utf-8").write("\n".join(md))
    print(f"== {out_name} 完成: out/{out_name}.mp4, {total:.0f}s", flush=True)


def type_field(h, panel, input_id, text):
    """真实键盘输入：CDP 定位输入框 → 脱离 CDP → 物理点击聚焦 → 清空原值 → 逐字符键入。
    全 ASCII 用 typewrite；含中文走剪贴板粘贴。结束后重连读回校验，不符即抛错。"""
    h.attach()
    r = h.c.ev(f'''(() => {{
      const i = document.getElementById("{input_id}");
      if (!i) return "";
      i.scrollIntoView({{block: "center"}});
      const r = i.getBoundingClientRect();
      return JSON.stringify({{x: r.left + r.width / 2, y: r.top + r.height / 2}});
    }})()''')
    if not r:
        raise RuntimeError(f"输入框未找到: #{input_id}")
    import json as _json
    pos = _json.loads(r)
    h.detach()
    time.sleep(0.4)
    px, py_ = p.to_physical(pos["x"], pos["y"])
    pyautogui.moveTo(px, py_, duration=0.2)
    pyautogui.click()
    time.sleep(0.3)
    pyautogui.hotkey("ctrl", "a")
    time.sleep(0.15)
    if all(ord(ch) < 128 for ch in text):
        pyautogui.typewrite(text, interval=0.04)
    else:
        import pyperclip
        pyperclip.copy(text)
        pyautogui.hotkey("ctrl", "v")
    time.sleep(0.3)
    h.attach()
    got = h.c.ev(f'document.getElementById("{input_id}").value')
    if str(got) != str(text):
        raise RuntimeError(f"type_field 输入未生效: #{input_id} 期望 {text!r} 实得 {got!r}")
    return True


def clear_card_results(h, panel, titles):
    """清空指定卡片的结果区（尾部无按钮/无输入的纯展示 div），防止录到残留结果。
    做法源自 2026-10-26 录 05 的教训：结果区无 id，按卡片圈定避免误清其他卡片。"""
    h.attach()
    ts = ", ".join('"%s"' % t for t in titles)
    sel = panel if panel.startswith("#") else "#" + panel
    r = h.c.ev(f'''(() => {{
      let cleared = 0;
      for (const title of [{ts}]) {{
        const card = [...document.querySelectorAll("{sel} .card")].find(k => {{
          const h3 = k.querySelector("h3"); return h3 && h3.textContent.includes(title);
        }});
        if (!card) continue;
        for (const child of [...card.children]) {{
          if (child.tagName === "DIV" && !child.querySelector("button")
              && !child.querySelector("input") && !child.querySelector("h3")
              && child.textContent.trim().length > 0) {{
            child.innerHTML = ""; cleared++;
          }}
        }}
      }}
      return "cleared:" + cleared;
    }})()''')
    h.detach()
    return r


def wait_card_text(panel, title, texts, timeout=420, poll=25):
    """按卡片圈定等待结果文本（结果区常无稳定 id）。
    🔴 与 hcdp.wait_result 的区别：后者按整个面板匹配，面板里其它卡片的历史结果会
    立刻命中 → 等待秒过、画面里还没有结果。07 的转写/总结皆无 id，必须按卡片等。"""
    from hcdp import H
    sel = panel if str(panel).startswith(("#", ".")) else "#" + panel
    js = '''(() => {
      const card = [...document.querySelectorAll("%s .card")].find(k => {
        const h = k.querySelector("h3"); return h && h.textContent.includes(%s);
      });
      if (!card) return "nocard";
      return %s.some(t => card.textContent.includes(t)) ? "yes" : "no";
    })()''' % (sel, json.dumps(title), json.dumps(list(texts), ensure_ascii=False))
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(poll)
        d = None
        try:
            d = H()
            d.attach()
            r = d.c.ev(js)
            d.detach()
            print(f"    [等待 {time.time()-t0:.0f}s] {title}: {r}", flush=True)
            if r == "yes":
                return True
        except Exception as ex:
            print(f"    [等待重连失败] {ex}", flush=True)
            try:
                if d:
                    d.detach()
            except Exception:
                pass
    return False


def wait_render(detect_fn, timeout=900, poll=20):
    """渲染等待：每 poll 秒截图调 detect_fn(screenshot_path) -> bool"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(poll)
        f = p.shot("_wait")
        try:
            if detect_fn(f):
                return True
        except Exception:
            pass
        print(f"  等待渲染 {time.time()-t0:.0f}s", flush=True)
    return False
