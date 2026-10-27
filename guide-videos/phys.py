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


def record_physical(name, scenes, out_name=None, title="HTW 工作台"):
    out_name = out_name or name
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
    else:
        # 模板对不上时（窗口最大化后标题栏像素变了）：用 pygetwindow 判断，
        # 最大化 → 物理裁剪取整屏去任务栏（125% DPI：1550x830 逻辑 ≈ 1920x1032 物理）
        try:
            import pygetwindow as _gw
            htws = [w for w in _gw.getAllWindows() if "HTW 工作台" in (w.title or "")]
            if htws and htws[-1].isMaximized:
                crop = (0, 0, 1920, 1032)
        except Exception:
            pass
    if crop:
        print(f"  窗口裁剪: {crop}", flush=True)
    else:
        print("  [窗口定位失败，退化为全桌面画面]", flush=True)
    for sc in scenes:
        sc.setdefault("crop", crop)

    # TTS
    for i, sc in enumerate(scenes):
        sc["narr_file"] = os.path.join(work, f"narr_{i:02d}.mp3")
        sc["narr_dur"] = tts(sc["narr"], sc["narr_file"], spd=4)
        print(f"  TTS {i+1}/{len(scenes)}: {sc['narr_dur']:.1f}s", flush=True)

    meta = []
    for i, sc in enumerate(scenes):
        clip = os.path.join(work, f"clip_{i:02d}.mp4")

        def record_scene():
            """录一个场景（ffmpeg + 动作 + 补齐时长），返回错误信息或 None。"""
            t0 = time.time()
            proc = record_take(title, clip, 0)
            err = None
            try:
                if sc.get("run"):
                    sc["run"]()
            except Exception as ex:
                err = str(ex)[:200]
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
    win = p.window_rect()
    if win is None:
        raise RuntimeError("type_field: window_rect 失败")
    h.detach()
    time.sleep(0.4)
    pyautogui.moveTo(int(win[0] + 9 + pos["x"] * 1.25),
                     int(win[1] + 40 + pos["y"] * 1.25), duration=0.2)
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
