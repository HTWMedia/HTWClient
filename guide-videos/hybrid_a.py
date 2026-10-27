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
        time.sleep(6)
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
    def s6():
        d = H()
        d.attach()
        # 结果区在卡片底部：以「下载成片」链接为锚点居中，成片播放器与下载按钮同框
        d.c.ev('''(() => {
          const r = document.getElementById("edit-cutsame-result");
          if (!r) return "no";
          const link = [...r.querySelectorAll("a, button")].find(x => x.textContent.includes("下载成片")) || r;
          link.scrollIntoView({block: "center"});
          return "ok";
        })()''')
        time.sleep(0.6)
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
        d.set_file_card("panel-edit", "智能包装 Smart-package", [A + r"\demo_video1.mp4"])
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
    def s4():
        d = H()
        d.attach()
        # 结果展示与 03 同理：以「下载成片」为锚点滚动，播放器与下载按钮同框
        d.c.ev('''(() => {
          const r = document.getElementById("edit-pack-result");
          if (!r) return "no";
          const link = [...r.querySelectorAll("a, button")].find(x => x.textContent.includes("下载成片")) || r;
          link.scrollIntoView({block: "center"});
          return "ok";
        })()''')
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
