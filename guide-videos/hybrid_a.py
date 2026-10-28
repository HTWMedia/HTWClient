# -*- coding: utf-8 -*-
"""混合模式模块库：h03-h11（提交瞬间零 CDP）"""
import sys, os, time
HERE = r"D:\HTWClient\guide-videos"
sys.path.insert(0, HERE)
from hcdp import H
import phys
from phys import record_physical

A = HERE + r"\assets"


def h03():
    def s1():
        d = H()
        d.nav("edit")
        d.scroll_card("panel-edit", "剪同款 Cut-same")
        # 清掉上一轮残留结果（结果区有稳定 id），整集不出现旧成片
        d.c.ev('(() => { const r = document.getElementById("edit-cutsame-result"); if (r) r.innerHTML = ""; return "ok"; })()')
        time.sleep(0.4)
    def s2():
        d = H()
        phys.type_field(d, "panel-edit", "edit-cutsame-keyword", "旅行")
        time.sleep(0.3)
        d.click_btn_text("panel-edit", "搜索模板")
        # 搜索接口 6-15s 不定，固定等待会录到空列表（2026-10-29 03 实录）
        for _ in range(30):
            time.sleep(1)
            d.attach()
            n = d.c.ev('(() => { const g = document.getElementById("edit-cutsame-grid"); return g ? g.children.length : 0; })()')
            d.detach()
            if n:
                break
        time.sleep(1.5)
        d.attach()
        d.scroll_card("panel-edit", "剪同款 Cut-same")
    def s3():
        d = H()
        d.c.ev('''(() => {
          const g = document.getElementById("edit-cutsame-grid");
          if (g && g.children.length) { g.children[0].click(); g.scrollIntoView({block: "center"}); }
          return g ? g.children.length : 0;
        })()''')
        time.sleep(1.2)
    def s4():
        d = H()
        d.set_file_card("panel-edit", "剪同款 Cut-same", [A + r"\demo_video1.mp4", A + r"\demo_video2.mp4"])
    def s5():
        d = H()
        d.click_btn_text("panel-edit", "开始套模板")
        ok = d.wait_result("#edit-cutsame-result", "下载成片", timeout=900)
        print("    剪同款渲染:", ok, flush=True)
        if not ok:
            raise RuntimeError("剪同款渲染等待超时")
        # 等预览真正起播：只等链接出现会录到缓冲转圈（2026-10-28 03 集实录）
        phys.wait_preview(d, "edit-cutsame-result")
    def s6():
        d = H()
        d.attach()
        # 成片是竖屏（1080×1920），播放器比窗口还高：按下载链接居中会把画面主体顶出
        # 窗口只剩黑边（2026-10-29 实录）。滚动容器是 main 而非 window，scrollTo 无效，
        # 先 scrollIntoView 再把容器上移 150，画面主体、控件与下载链接同框。
        d.c.ev('''(() => {
          const r = document.getElementById("edit-cutsame-result");
          if (!r) return "no";
          const v = r.querySelector("video");
          if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(function () {}); }
          const el = v || r;
          el.scrollIntoView({block: "start"});
          let sc = el.parentElement;
          while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement;
          (sc || document.scrollingElement).scrollTop += 150;
          return "ok";
        })()''')
        d.detach()
        time.sleep(0.8)
    scenes = [
        dict(narr="剪同款：选一个热门模板，把自己的素材套进去，云端自动生成同款视频。输入关键词，点击搜索模板。", sub="剪同款：关键词搜索模板", run=s1),
        dict(narr="搜索结果以卡片展示，含封面、时长和可用状态。付费或未解锁的模板会标记不可用，无法套用。", sub="选择模板：注意可用状态", run=s2, pad=1.0),
        dict(narr="点击选择一个可用模板，下方显示已选模板信息。", sub="点击选择模板", run=s3, pad=0.8),
        dict(narr="上传素材视频，可以多选；素材少于模板片段数时会自动循环复用。", sub="上传素材：可多选", run=s4),
        dict(narr="点击开始套模板，云端按模板的节奏、转场和音乐重新合成素材。画面加速播放。", sub="开始套模板 → 云端合成（画面加速）", run=s5, speed_cap=4, pad=1.0),
        dict(narr="完成后结果区直接出现成片和下载按钮。提交不可用模板或素材异常时会有明确提示。", sub="完成：预览与下载", run=s6, min_len=3),
        dict(narr="下一集演示智能包装。", sub="下一集：智能包装", run=None, min_len=1),
    ]
    record_physical("h03", scenes, out_name="03_剪辑-剪同款")


def h04():
    def s1():
        d = H()
        d.nav("edit"); d.scroll_card("panel-edit", "智能包装 Smart-package")
        # 清掉上一轮残留结果（结果区有稳定 id）
        d.c.ev('(() => { const r = document.getElementById("edit-pack-result"); if (r) r.innerHTML = ""; return "ok"; })()')
        time.sleep(0.4)
    def s2():
        d = H()
        # demo_video1（8s 合成样片）会被上游 sami_video_decoration RPC 稳定拒绝
        # （2026-10-28 两次实录），换用真实录屏裁出的 40s 素材；接口直测已通过。
        d.set_file_card("panel-edit", "智能包装 Smart-package", [A + r"\包装示例.mp4"])
    def s3():
        d = H()
        d.click_btn_text("panel-edit", "开始包装")
        # 快失败：结果区出现「出错」立刻判定，不再按成功文本硬等 900s
        st, detail = d.wait_result_state("#edit-pack-result", "下载成片", timeout=900)
        print("    包装渲染:", st, detail, flush=True)
        # 渲染失败必须记 err（自愈重试一次再提交），否则带病出片：
        # 旁白说「包装完成」而画面里没有结果 —— gen-1 的 04 就是这个成功假象。
        if st != "ok":
            raise RuntimeError(f"包装渲染{st}：{detail or '等待超时'}")
        # 结果 URL 走云端限速链路：起播后首帧要缓冲十几秒，光等「下载成片」出现
        # 录到的仍是转圈（2026-10-28 四录实录）。等 currentTime 真正前进再结束本场。
        d = H()
        d.attach()
        d.c.ev('''(() => {
          const v = document.querySelector("#edit-pack-result video");
          if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(function () {}); }
          return "ok";
        })()''')
        d.detach()
        t0 = time.time()
        while time.time() - t0 < 120:
            time.sleep(2)
            try:
                d.attach()
                t = d.c.ev('(() => { const v = document.querySelector("#edit-pack-result video"); return v ? v.currentTime : -1; })()')
                d.detach()
            except Exception:
                t = -1
            if isinstance(t, (int, float)) and t > 1.0:
                print(f"    预览起播: {t:.1f}s（等待 {time.time()-t0:.0f}s）", flush=True)
                break
        else:
            print("    [警告] 预览 120s 内未起播", flush=True)
    def s4():
        d = H()
        d.attach()
        # 结果展示与 03 同理：以「下载成片」为锚点滚动，播放器与下载按钮同框。
        # 播放器不点播放会一直停在转圈（readyState=4 但未起播，2026-10-28 三录实录）——
        # 静音起播，避免成片音轨盖住旁白。
        d.c.ev('''(() => {
          const r = document.getElementById("edit-pack-result");
          if (!r) return "no";
          const v = r.querySelector("video");
          if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(function () {}); }
          const link = [...r.querySelectorAll("a, button")].find(x => x.textContent.includes("下载成片")) || r;
          link.scrollIntoView({block: "center"});
          return "ok";
        })()''')
        d.detach()
        time.sleep(0.6)
    scenes = [
        dict(narr="智能包装：为视频自动加上字幕、音效、贴纸并突出重点内容，一条素视频一键成品化。选择视频后点击开始包装。", sub="智能包装：一键字幕 音效 贴纸", run=s1),
        dict(narr="选择一条示例视频。仅支持 mp4、mov、m4v 格式。", sub="选择视频（mp4 / mov / m4v）", run=s2),
        dict(narr="点击开始包装，云端自动分析并生成包装方案，全程约三到八分钟。画面加速播放。", sub="开始包装 → 云端处理（画面加速）", run=s3, speed_cap=4, pad=1.0),
        dict(narr="包装完成，结果区出现成片与下载按钮，可预览可下载。", sub="完成：预览与下载", run=s4, min_len=3),
        dict(narr="下一集演示草稿导出、超分和解密。", sub="下一集：草稿导出 · 超分 · 解密", run=None, min_len=1),
    ]
    record_physical("h04", scenes, out_name="04_剪辑-智能包装")


def h05():
    """旧版已废弃：05 集由 rerecord_all.module_05 录制（预定位+清屏+按卡片等待）。
    保留 h03/h04 供 module_03 自适应合并与直接录制使用。"""
    raise NotImplementedError("05 集请运行 rerecord_all.module_05")


if __name__ == "__main__":
    which = sys.argv[1]
    {"03": h03, "04": h04}[which]()
