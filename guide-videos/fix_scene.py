# -*- coding: utf-8 -*-
"""单场景重录修复：只重录指定场景的 clip 并重新 assemble，不重新提交渲染任务。
用法: python fix_scene.py <meta名> <场景index>
前提: 页面已处于该场景应展示的状态（如渲染结果仍在结果区）。"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pipeline import record_take, audio_len, assemble
from hcdp import H
import pdrive as p

name = sys.argv[1]
idx = int(sys.argv[2])
meta = json.load(open(os.path.join(HERE, f"meta_{name}.json"), encoding="utf-8"))
sc = meta[idx]
assert sc.get("clip"), f"meta {name}[{idx}] 无 clip 字段（仅支持逐场景片段模式）"

# 锁
lock = os.path.join(HERE, f"rec_{name}.lock")
if os.path.exists(lock):
    raise RuntimeError("录制进行中: " + lock)
open(lock, "w", encoding="ascii").write(str(os.getpid()))
try:
    # 窗口裁剪（当前状态）
    W = p.window_rect()
    if W is None:
        raise RuntimeError("window_rect 失败")
    crop = (W[0], W[1], W[2] - W[2] % 2, W[3] - W[3] % 2)
    print("crop:", crop, flush=True)

    t0 = time.time()
    proc = record_take("HTW 工作台", sc["clip"], 0)
    err = None
    try:
        d = H()
        d.attach()
        # 场景动作：滚动到「下载成片」链接（由命令行第 3 参数选择动作变体）
        variant = sys.argv[3] if len(sys.argv) > 3 else "link"
        if variant == "link":
            js = '''(() => {
              const r = document.getElementById("edit-cutsame-result");
              if (!r) return "no";
              const link = [...r.querySelectorAll("a, button")].find(
                x => x.textContent.includes("下载成片")) || r;
              link.scrollIntoView({block: "center"});
              return "ok";
            })()'''
        else:
            raise RuntimeError("未知动作变体: " + variant)
        r = d.c.ev(js)
        print("action:", r, flush=True)
        time.sleep(0.8)
    except Exception as ex:
        err = str(ex)[:200]
    used = time.time() - t0
    need = max(sc["narr_dur"] + sc.get("pad", 0.6), 0)
    if used < need:
        time.sleep(need - used)
    time.sleep(0.8)
    try:
        proc.stdin.write(b"q"); proc.stdin.flush()
    except Exception:
        pass
    time.sleep(1.2)
    proc.terminate()

    sc["crop"] = crop
    sc["err"] = err
    if audio_len(sc["clip"]) <= 0:
        raise RuntimeError("重录片段为空")
    json.dump(meta, open(os.path.join(HERE, f"meta_{name}.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    total = assemble(name, meta, None, os.path.join(HERE, "work", name),
                     os.path.join(HERE, "out", "03_剪辑-剪同款.mp4"))
    print(f"== 重新拼装完成: {total:.0f}s (err={err})", flush=True)
finally:
    try:
        os.remove(lock)
    except OSError:
        pass
