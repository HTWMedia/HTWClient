# -*- coding: utf-8 -*-
"""06-11 混合模式生产"""
import sys, os, time
HERE = r"D:\HTWClient\guide-videos"
sys.path.insert(0, HERE)
from hcdp import H
import phys
from phys import record_physical

A = HERE + r"\assets"


def m06():
    def s1():
        d = H(); d.nav("insight")
        from phys import clear_card_results
        clear_card_results(d, "panel-insight", ["热榜", "搜索"])
        d.attach(); d.scroll_top()
    def s2():
        d = H()
        d.click_btn_text("panel-insight", "获取热榜")
        time.sleep(8)
    def s3():
        d = H()
        # 输入框没有 id：先打临时 id，再用真实键盘输入（视频里能看到逐字键入）
        r = d.read('''(() => {
          const p = document.getElementById("panel-insight");
          const i = [...p.querySelectorAll("input[type=text]")].pop();
          if (!i) return "noinput";
          i.id = "__hkw"; return "ok";
        })()''')
        if r != "ok":
            raise RuntimeError("洞察搜索框未找到: " + str(r))
        phys.type_field(d, "panel-insight", "__hkw", "露营")
        time.sleep(0.3)
        d.click_btn_text("panel-insight", "搜索")
        time.sleep(8)
    def s4():
        d = H()
        d.nav("topics"); time.sleep(1.5)
        d.scroll_card("panel-topics", "今日选题") if False else d.c.ev('window.scrollTo(0,0)')
        time.sleep(1)
    scenes = [
        dict(narr="洞察面板提供创作前的数据分析：文案分析、视频分析、账号分析、热榜和全网搜索，输入链接或文案即可获得结构化结果。",
             sub="洞察 Analysis：文案 / 视频 / 账号分析 + 热榜 + 搜索", run=s1),
        dict(narr="点击获取热榜，拉取当前各平台的热点榜单，正在上升的话题一目了然。", sub="获取热榜：实时热点", run=s2, pad=1.2),
        dict(narr="全网搜索：选择平台与关键词，返回热门内容列表，用于对标调研。", sub="全网搜索：按平台与关键词调研", run=s3, pad=1.2),
        dict(narr="选题面板：每天结合热榜趋势与垂类画像生成选题建议，每条都带数据证据；点击去创作直接流转到创作流程。黄条提示会提醒补充对标账号，画像越用越准。",
             sub="选题 Topics：每日选题 + 数据证据 + 去创作", run=s4, pad=1.2),
        dict(narr="下一集演示工具面板。", sub="下一集：工具面板", run=None, min_len=1),
    ]
    record_physical("h06", scenes, out_name="06_洞察与选题")


def m07():
    def s1():
        d = H(); d.nav("tools")
        # 清掉上一轮残留结果（工具面板结果区常无 id，按卡片圈定）
        from phys import clear_card_results
        clear_card_results(d, "panel-tools", ["语音转写", "总结 Summarize", "图像识别"])
        d.attach(); d.scroll_top()
    def s2():
        d = H()
        d.set_file_card("panel-tools", "语音转写 Transcribe", [A + r"\语音样本.mp3"])
        time.sleep(0.5)
        d.click_btn_text("panel-tools", "转写")
        # 🔴 必须按卡片等：wait_result 看整个面板，别的卡片的历史「下载」会立刻命中
        ok = phys.wait_card_text("panel-tools", "语音转写", ["下载", "复制"], timeout=420)
        print("转写:", ok, flush=True)
        if not ok:
            raise RuntimeError("语音转写渲染失败：420s 内转写卡片未出现结果")
        d.attach(); d.scroll_result("panel-tools", "语音转写 Transcribe")
    def s3():
        d = H()
        d.set_file_card("panel-tools", "总结 Summarize", [A + r"\语音样本.mp3"])
        time.sleep(0.5)
        d.click_btn_text("panel-tools", "总结")
        ok = phys.wait_card_text("panel-tools", "总结", ["下载", "复制", "要点"], timeout=420)
        print("总结:", ok, flush=True)
        if not ok:
            raise RuntimeError("总结渲染失败：420s 内总结卡片未出现结果")
        d.attach(); d.scroll_result("panel-tools", "总结 Summarize")
    def s4():
        d = H()
        d.scroll_card("panel-tools", "图像识别 Recognize")
        d.set_file_card("panel-tools", "图像识别 Recognize", [A + r"\演示图片.jpg"])
        time.sleep(0.5)
        d.click_btn_text("panel-tools", "识别图片")
        time.sleep(10)
        d.attach(); d.scroll_result("panel-tools", "图像识别 Recognize")
    scenes = [
        dict(narr="工具面板是创作工具箱：语音转写、翻译、总结、歌词提取、人声伴奏分离、语音合成、图像生成与识别、字幕提取、模板搜索等，全部云端执行。",
             sub="工具 Tools：转写 · 翻译 · 总结 · 歌词 · 分离 · TTS · 图像", run=s1),
        dict(narr="演示语音转写：选择一段音频，点击转写，云端识别后返回文字稿。画面加速。", sub="语音转写：音频 → 文字稿（画面加速）", run=s2, speed_cap=4, pad=1.0),
        dict(narr="总结：把音频或视频的内容自动总结成要点，上传后一键完成。画面加速。", sub="总结：长内容 → 要点摘要（画面加速）", run=s3, speed_cap=4, pad=1.0),
        dict(narr="图像识别：上传图片返回内容描述；图像生成则相反，输入描述直接出图。其余工具操作方式相同：选文件、点按钮、等结果。", sub="图像识别 / 生成；其余工具同套路", run=s4, pad=1.2),
        dict(narr="下一集演示批量面板。", sub="下一集：批量", run=None, min_len=1),
    ]
    record_physical("h07", scenes, out_name="07_工具")


def m08():
    def s1():
        d = H(); d.nav("batch")
    def s2():
        d = H()
        d.scroll_top()
        # 页签 DOM 状态跨录制残留（上一轮 s4 点过「批次状态」）：先回到「发起批次」，
        # 否则状态页里没有 kind 按钮和素材文件分区（nokind/nocard 两连败实录）。
        r = d.c.ev('''(() => {
          const t = [...document.querySelectorAll("#panel-batch .wf-tab")]
            .find(x => x.textContent.includes("发起批次"));
          if (!t) return "notab";
          if (!t.className.includes("active")) { t.click(); return "switched"; }
          return "ok";
        })()''')
        print("    页签:", r, flush=True)
        time.sleep(0.8)
        # 默认 kind 是营销成片：只有剪同款/智能包装 kind 才渲染「选模板」「素材文件」
        # 分区（2026-10-28 录 08 实录：没选类型就设文件 → nocard，两连败）。
        r = d.c.ev('''(() => {
          const k = [...document.querySelectorAll("#panel-batch .wf-kind")]
            .find(x => x.textContent.includes("剪同款"));
          if (!k) return "nokind";
          k.click(); return "ok";
        })()''')
        if r != "ok":
            raise RuntimeError("批次类型未找到剪同款: " + str(r))
        time.sleep(0.6)
        # 真实输入模板关键词 → 搜模板（只读接口）→ 选第一个可用模板（整批共用）
        r = d.read('''(() => {
          const p = document.getElementById("panel-batch");
          const i = p.querySelector("input[placeholder=\\'模板关键词\\']");
          if (!i) return "noinput";
          i.id = "__hbtpl"; return "ok";
        })()''')
        if r != "ok":
            raise RuntimeError("模板关键词输入框未找到: " + str(r))
        phys.type_field(d, "panel-batch", "__hbtpl", "旅行")
        time.sleep(0.3)
        d.click_btn_text("panel-batch", "搜模板")
        time.sleep(4)
        d.attach()
        r = d.c.ev('''(() => {
          const cards = [...document.querySelectorAll("#panel-batch .wf-topic")]
            .filter(c => !c.textContent.includes("不可用"));
          if (!cards.length) return "notpl";
          cards[0].click();
          cards[0].scrollIntoView({block: "center"});
          return "ok";
        })()''')
        time.sleep(0.6)
        sel = d.c.ev('document.querySelector("#panel-batch .wf-topic.active") ? "selected" : "none"')
        print("    模板:", r, sel, flush=True)
        if r != "ok" or sel != "selected":
            raise RuntimeError(f"模板未选中: {r} / {sel}")
    def s3():
        d = H()
        d.set_file_card("panel-batch", "素材文件", [A + r"\demo_video1.mp4", A + r"\demo_video2.mp4"])
        time.sleep(0.5)
        d.click_btn_text("panel-batch", "提交批次")
        # 提交成功的形态因版本而异：旧版留在本页显示「已启动 N 条」，新版直接切到
        # 「批次状态」并渲染「批次 <32位ID>」（2026-10-28 干跑实录：等旧文案必超时）。
        # 被拒时留在本页显示原因（含失败/被拒字样）→ 立刻判失败。
        t0 = time.time()
        st, detail = "timeout", ""
        time.sleep(8)
        while time.time() - t0 < 150:
            try:
                d.attach()
                r = d.c.ev('''(() => {
                  const t = (document.getElementById("panel-batch") || {}).textContent || "";
                  if (t.includes("已启动")) return "OK";
                  if (/批次\\s*[0-9a-f]{32}/i.test(t)) return "OK";
                  const m = t.match(/(失败|出错|错误|被拒|拒绝)[^\\n]{0,40}/);
                  return m ? "ERR:" + m[0] : "";
                })()''')
                d.detach()
                print(f"    [提交等待 {time.time()-t0:.0f}s] {r or '进行中'}", flush=True)
                if r == "OK":
                    st = "ok"
                    break
                if isinstance(r, str) and r.startswith("ERR:"):
                    st, detail = "error", r[4:]
                    break
            except Exception as ex:
                print(f"    [等待重连失败] {ex}", flush=True)
                try:
                    d.detach()
                except Exception:
                    pass
            time.sleep(6)
        print("批次提交:", st, detail, flush=True)
        if st != "ok":
            raise RuntimeError(f"批次提交未返回：{st} {detail}")
    def s4():
        d = H()
        d.click_btn_text("panel-batch", "批次状态")
        time.sleep(2)
        # 提交成功后状态页会自动渲染批次卡（名称/批次ID/成功数）与逐条进度，
        # 滚到卡片顶部让「进度 + 条目状态」同框。
        d.attach()
        d.c.ev('''(() => {
          const card = document.querySelector("#panel-batch .wf-card");
          if (card) card.scrollIntoView({block: "start"});
          return "ok";
        })()''')
        d.detach()
        time.sleep(2)
    scenes = [
        dict(narr="批量面板解决一个模板跑多条视频的问题：支持批量剪同款、批量智能包装和批量营销成片，按批次类型、选模板、素材文件的顺序配置。",
             sub="批量 Batch：一个模板 × N 条素材", run=s1),
        dict(narr="第一步选择批次类型，第二步搜索并选择模板。", sub="① 选类型 ② 选模板", run=s2, pad=1.2),
        dict(narr="第三步批量选择素材文件，点击提交批次，多条素材由云端队列并行处理。", sub="③ 批量上传 → 提交批次", run=s3, pad=1.2),
        dict(narr="批次状态里可以看到每批的进度、成功数和失败原因。提示：批量能力需要相应账号档位，免费档会被拒绝并返回明确原因。", sub="批次状态与档位提示", run=s4, min_len=3),
    ]
    record_physical("h08", scenes, out_name="08_批量")


def m09():
    def s1():
        d = H(); d.nav("market"); time.sleep(1.5)
    def s2():
        d = H(); d.nav("workflow")
    def s3():
        d = H()
        r = d.read('''(() => {
          const p = document.getElementById("panel-workflow");
          // 主题框无显式 type 属性，input[type=text] 按属性匹配永远落空（09 首录实录）
          const i = p.querySelector("input[placeholder='主题 / 话题']");
          if (!i) return "noinput";
          i.id = "__hwf"; return "ok";
        })()''')
        if r != "ok":
            raise RuntimeError("工作流主题输入框未找到: " + str(r))
        phys.type_field(d, "panel-workflow", "__hwf", "秋季旅行好物推荐")
        time.sleep(0.4)
        d.click_btn_text("panel-workflow", "开始工作流")
        time.sleep(8)
    scenes = [
        dict(narr="营销成片：面向电商与本地商家的批量出片面板，按批次类型、选模板、商品条目、素材文件四步配置，最后批量启动。",
             sub="营销成片：四步配置，批量启动", run=s1),
        dict(narr="工作流面板是全链路自动化：选择内容形态，填入选题或让系统选题，勾选发布平台。注意提示：工作流会跑到待你确认为止，最后的发布动作由你手动确认，不做一键到底。",
             sub="工作流：选题 → 成片 → 包装 → 待你确认的发布", run=s2),
        dict(narr="点击开始工作流，任务进入云端队列，各阶段进度在面板与任务中心同步展示。耗时长，建议提交后去任务中心盯进度。", sub="开始工作流 → 云端排队执行", run=s3, speed_cap=4, pad=1.2),
        dict(narr="下一集演示发布与任务中心。", sub="下一集：发布与任务中心", run=None, min_len=1),
    ]
    record_physical("h09", scenes, out_name="09_营销成片与工作流")


def m10():
    def s1():
        d = H(); d.nav("publish")
    def s2():
        d = H()
        r = d.read('''(() => {
          const p = document.getElementById("panel-publish");
          const i = p.querySelector("input[type=text]");
          if (!i) return "noinput";
          i.id = "__hpub"; return "ok";
        })()''')
        if r != "ok":
            raise RuntimeError("发布标题输入框未找到: " + str(r))
        phys.type_field(d, "panel-publish", "__hpub", "秋日旅行 Vlog：三天两晚的治愈之旅")
        time.sleep(0.4)
        d.click_btn_text("panel-publish", "AI 生成文案")
        time.sleep(12)
    def s3():
        d = H()
        d.c.ev('''(() => {
          const tabs = [...document.querySelectorAll("#panel-publish .tab, #panel-publish button")];
          const q = tabs.find(x => x.textContent.includes("任务队列"));
          if (q) q.click();
        })()''')
        time.sleep(2)
    def s4():
        d = H(); d.nav("tasks"); time.sleep(2)
    scenes = [
        dict(narr="发布面板管理内容分发：发布编辑、任务队列、历史记录、Cookie 配置四个页签。发布编辑里可以 AI 生成文案，再跑合规检测。",
             sub="发布 Publish：AI 文案 · 合规检测 · 多平台分发", run=s1),
        dict(narr="填入标题后点击 AI 生成文案，系统自动撰写；上传媒体与封面，配置平台 Cookie 后提交发布。Cookie 失效会有明确的重新配置提示。", sub="AI 生成文案 → 合规检测 → 提交", run=s2, pad=1.5),
        dict(narr="任务队列与历史记录管理所有分发任务；Cookie 配置集中维护各平台登录状态。", sub="任务队列 · 历史记录 · Cookie 配置", run=s3, pad=1.2),
        dict(narr="任务中心实时汇总所有云端任务，SSE 实时推送无需刷新；已结束记录可一键清空。", sub="任务中心：全模块任务实时汇总", run=s4, min_len=3),
        dict(narr="下一集看短剧创作、助手与创作。", sub="下一集：短剧 · 助手 · 创作", run=None, min_len=1),
    ]
    record_physical("h10", scenes, out_name="10_发布与任务中心")


def m11():
    def s1():
        d = H(); d.nav("shortdrama"); time.sleep(2)
    def s2():
        d = H(); d.nav("assistant"); time.sleep(1.5)
    def s3():
        d = H()
        r = d.read('''(() => {
          const p = document.getElementById("panel-assistant");
          const i = p.querySelector("textarea, input[type=text]");
          if (!i) return "noinput";
          i.id = "__hasst"; return "ok";
        })()''')
        if r != "ok":
            raise RuntimeError("助手输入框未找到: " + str(r))
        phys.type_field(d, "panel-assistant", "__hasst", "帮我起三个秋天旅行视频的标题")
        time.sleep(0.4)
        d.click_btn_text("panel-assistant", "发送")
        time.sleep(15)
    def s4():
        d = H(); d.nav("create"); time.sleep(2)
    scenes = [
        dict(narr="短剧创作：面向短剧赛道的批量生产面板，从剧本、分集到成片按流程走，同样基于云端渲染。",
             sub="短剧创作 ShortDrama：剧本 → 分集 → 成片", run=s1),
        dict(narr="AI 助手：直接对话，可以问使用问题、生成文案或选题建议，回答流式返回。", sub="AI 助手：对话式答疑与内容生成", run=s2, pad=0.8),
        dict(narr="比如让它起三个秋天旅行视频的标题，几秒钟就给出结果。", sub="示例：AI 生成视频标题", run=s3, pad=1.2),
        dict(narr="创作面板承接选题面板的去创作，把选题、素材和成片方式组织成一次创作任务。", sub="创作 Create：选题 → 创作任务", run=s4, min_len=2),
        dict(narr="全系列总结：洞察和选题找方向，剪辑和工具做内容，批量和营销成片做规模，工作流串全程，发布管分发，任务中心盯进度。HTW 工作台感谢观看。",
             sub="总结：洞察 → 选题 → 剪辑/工具 → 批量/成片 → 工作流 → 发布 → 任务中心", run=None, min_len=3),
    ]
    record_physical("h11", scenes, out_name="11_短剧_助手_创作_总结")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    fns = {"06": m06, "07": m07, "08": m08, "09": m09, "10": m10, "11": m11}
    if which == "all":
        for k in sorted(fns):
            print(f"===== {k} =====", flush=True)
            try:
                fns[k]()
            except Exception:
                import traceback; traceback.print_exc()
                print(f"!! {k} 失败继续", flush=True)
    else:
        fns[which]()
