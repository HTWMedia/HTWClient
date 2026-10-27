# -*- coding: utf-8 -*-
"""03-11 全量重录（对齐 02 标准：全桌面捕获 + 窗口裁剪，无桌面无关画面）。
- 应用自愈：每个模块前确保打包版运行中（带 CDP 9223）
- 03：真实提交剪同款；渲染成功→结果展示，失败→任务中心实况（自适应合并）
- 05：草稿导出+超分+解密整合版
"""
import os
import subprocess
import sys
import time
import json
import traceback

HERE = r"D:\HTWClient\guide-videos"
sys.path.insert(0, HERE)
import pdrive as p

APP = r"D:\HTWClient\apps\desktop\dist\HTW Media 0.5.0.exe"
A = HERE + r"\assets"


def app_alive():
    import urllib.request
    try:
        tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9223/json", timeout=4))
        return any(t.get("type") == "page" and "工作台" in t.get("title", "") for t in tabs)
    except Exception:
        return False


def ensure_app():
    from hcdp import ensure_app as _heal
    return _heal()


def _unused_ensure_app():
    if app_alive():
        return True
    print("  [应用未运行，重启中]", flush=True)
    subprocess.Popen([APP, "--remote-debugging-port=9223", "--remote-allow-origins=*"],
                     stdout=open(r"D:\HTWClient\.claude-app2.log", "a"),
                     stderr=subprocess.STDOUT)
    for _ in range(30):
        time.sleep(2)
        if app_alive():
            time.sleep(4)
            return True
    raise RuntimeError("应用未能启动")


def run_module(name, fn):
    print(f"\n===== {name} =====", flush=True)
    ensure_app()
    try:
        fn()
        return True
    except Exception:
        traceback.print_exc()
        print(f"!! {name} 失败，继续下一个", flush=True)
        return False


# ---------------- 03（提交 + 自适应合并） ----------------
def module_03():
    import hybrid_a
    hybrid_a.h03()

    # 渲染是否成功 → 决定成片结构
    def cutsame_done():
        try:
            from cdp import CDP
            c = CDP()
            r = c.ev('document.getElementById("edit-cutsame-result").textContent.includes("下载成片")')
            c.close()
            return r is True
        except Exception:
            return False

    if cutsame_done():
        print("  [03] 渲染成功，采用完整结果展示版", flush=True)
        return

    # 渲染未完成：补录任务中心实况 + 回顾
    from hcdp import H
    from phys import record_physical

    def s_tc():
        d = H()
        d.nav("tasks")
        time.sleep(2)

    def s_back():
        d = H()
        d.nav("edit")
        d.scroll_card("panel-edit", "剪同款 Cut-same")

    scenes = [
        dict(narr="提交后云端合成约需一到三分钟。刚才服务端繁忙，进度条停了较长时间——这正是任务中心的价值：每条任务的状态、成功与失败原因都在这里实时可查，失败的任务可以直接回到面板重试。",
             sub="提交后云端合成 1-3 分钟；服务端繁忙时去任务中心查状态", run=s_tc, min_len=5),
        dict(narr="回到剪同款面板，流程本身已经完整演示：搜索、选模板、传素材、开始套模板。下一集演示智能包装。",
             sub="流程回顾：搜索 → 选模板 → 传素材 → 套模板；下一集：智能包装", run=s_back, min_len=2),
    ]
    record_physical("h03c", scenes, out_name="h03c_tmp")

    from pipeline import assemble
    m1 = json.load(open(os.path.join(HERE, "meta_h03.json"), encoding="utf-8"))
    m2 = json.load(open(os.path.join(HERE, "meta_h03c.json"), encoding="utf-8"))
    meta = m1[:4] + m2
    total = assemble("h03_final", meta, None, os.path.join(HERE, "work", "h03_final"),
                     os.path.join(HERE, "out", "03_剪辑-剪同款.mp4"))
    print(f"  [03] 合并完成: {total:.0f}s", flush=True)


# ---------------- 05（整合版） ----------------
def wait_card_text(title, texts, timeout, poll=25):
    """等待 panel-edit 里指定标题卡片出现任一文本（结果区无 id，按卡片圈定，
    避免被其他功能残留的结果误命中——02 号粗剪的成功结果会一直挂在面板里）。"""
    from hcdp import H
    t0 = time.time()
    js = '''(() => {
      const card = [...document.querySelectorAll("#panel-edit .card")].find(k => {
        const h = k.querySelector("h3"); return h && h.textContent.includes("__T__");
      });
      if (!card) return "nocard";
      return [__TX__].some(t => card.textContent.includes(t)) ? "yes" : "no";
    })()'''.replace("__T__", title).replace("__TX__", ", ".join('"%s"' % t for t in texts))
    while time.time() - t0 < timeout:
        time.sleep(poll)
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
                d.detach()
            except Exception:
                pass
    return False


def module_05():
    from hcdp import H
    from phys import record_physical

    # 🔴 开录前先定位+清屏：录制与动作是同时启动的，若开录后才导航，
    # 头几秒会录到上一画面（粗剪/超分卡片甚至残留结果）——线上两轮返工的教训。
    pre = H()
    pre.nav("edit")
    pre.scroll_card("panel-edit", "草稿导出 Draft-export")
    from phys import clear_card_results
    clear_card_results(pre, "panel-edit", ["草稿导出", "超分"])
    pre.attach()  # clear_card_results 结束时 detach，重连后才能继续 scroll
    pre.scroll_card("panel-edit", "草稿导出 Draft-export")

    def s1():
        pass

    def s2():
        d = H()
        d.set_file_card("panel-edit", "草稿导出 Draft-export", [A + r"\缺素材草稿.zip"])

    def s3():
        d = H()
        d.click_btn_text("panel-edit", "导出草稿")
        time.sleep(12)
        d.attach()
        d.scroll_card("panel-edit", "草稿导出 Draft-export")

    def s4():
        # 草稿导出的成功结果不是「下载成片」播放器，而是 JSON 数据块
        #（含 downloadUrl/OutputFile/复制结果）—— 等待条件必须匹配它实际的呈现形态。
        ok = wait_card_text("草稿导出",
                            ["下载成片", "下载视频", "OutputFile", "复制结果", "downloadUrl"],
                            timeout=420)
        print("    草稿渲染:", ok, flush=True)
        if not ok:
            raise RuntimeError("草稿导出渲染失败：420s 内卡片未出现结果文本")
        d = H()
        d.scroll_card("panel-edit", "草稿导出 Draft-export")

    def s5():
        d = H()
        d.scroll_card("panel-edit", "超分 Super-res")
        d.set_file_card("panel-edit", "超分 Super-res", [A + r"\待超分小视频.mp4"])

    def s6():
        d = H()
        d.click_btn_text("panel-edit", "超分")
        ok = wait_card_text("超分", ["下载成片", "下载视频"], timeout=540)
        print("    超分渲染:", ok, flush=True)
        if not ok:
            raise RuntimeError("超分渲染失败：540s 内卡片未出现下载链接")
        d.attach()
        d.scroll_card("panel-edit", "超分 Super-res")

    def s7():
        d = H()
        d.scroll_card("panel-edit", "解密 Decrypt")
        d.set_file_card("panel-edit", "解密 Decrypt", [A + r"\加密草稿.json"])
        time.sleep(0.5)
        d.click_btn_text("panel-edit", "解密")
        time.sleep(5)
        d.attach()
        d.scroll_card("panel-edit", "解密 Decrypt")

    scenes = [
        dict(narr="草稿导出是用户需求最多的功能：把剪映或 CapCut 的草稿包上传，云端直接渲染成片，本机无需安装剪映。", sub="草稿导出：草稿包 → 云端渲染成片", run=s1),
        dict(narr="选择草稿 ZIP。这条演示草稿故意缺了部分素材，用来展示系统的素材核对能力。", sub="选择草稿 ZIP（演示缺失素材场景）", run=s2),
        dict(narr="点击导出草稿，提交后系统先做素材核对：结果区明确列出缺失的素材类型、数量和文件名，并说明缺失部分会黑屏——按提示把素材补进包里重新上传即可。", sub="素材核对：明确列出缺失清单", run=s3, pad=1.5),
        dict(narr="核对通过的部分继续云端渲染，进度实时显示，完成后直接下载成片。画面加速。", sub="渲染进行中（画面加速）→ 下载成片", run=s4, speed_cap=4, pad=1.0),
        dict(narr="超分：选择一条 960 乘 540 的小视频，目标设为 1920 乘 1080。", sub="超分：540P → 1080P", run=s5, pad=1.0),
        dict(narr="点击超分，云端完成画质重建。画面加速。", sub="超分渲染（画面加速）→ 下载成片", run=s6, speed_cap=4, pad=1.0),
        dict(narr="解密：新版剪映的草稿 JSON 是加密的，选择加密文件点击解密，瞬间返回明文内容，可直接查看或交给其他工具使用。", sub="解密：加密草稿 → 明文 JSON（即时）", run=s7, pad=1.5),
        dict(narr="剪辑面板六个功能全部演示完毕：粗剪、包装、剪同款负责生成，草稿导出负责渲染，超分负责增强，解密负责处理草稿文件。下一集看洞察与选题。", sub="剪辑小结；下一集：洞察与选题", run=None, min_len=2),
    ]
    record_physical("h05r", scenes, out_name="05_剪辑-草稿导出_超分_解密")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "03"):
        run_module("03 剪同款", module_03)
    if which in ("all", "04"):
        import hybrid_a
        run_module("04 智能包装", hybrid_a.h04)
    if which in ("all", "05"):
        run_module("05 草稿导出+超分+解密", module_05)
    if which in ("all", "rest"):
        import hybrid_c
        for k, fn in [("06", hybrid_c.m06), ("07", hybrid_c.m07), ("08", hybrid_c.m08),
                      ("09", hybrid_c.m09), ("10", hybrid_c.m10), ("11", hybrid_c.m11)]:
            run_module(k, fn)
    elif which in ("06", "07", "08", "09", "10", "11"):
        import hybrid_c
        run_module(which, {"06": hybrid_c.m06, "07": hybrid_c.m07, "08": hybrid_c.m08,
                           "09": hybrid_c.m09, "10": hybrid_c.m10, "11": hybrid_c.m11}[which])
    print("\n全部完成", flush=True)
