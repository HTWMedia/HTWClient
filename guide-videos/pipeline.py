# -*- coding: utf-8 -*-
"""教程视频制作流水线：
tts       项目语音合成接口（/api/v2/voice/tts）-> mp3 + 时长
recorder  整段录屏（gdigrab 抓应用窗口）+ CDP 逐场景执行动作
assemble  场景拼接（等待段加速）、配音对齐、ASS 字幕烧录
"""
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"


# ---------------------------------------------------------------- TTS
def tts_baidu(text, out_mp3, spd=4):
    """百度翻译 TTS，返回音频时长(秒)。一次调用约 ≤120 字，超长自行分段。（仅作回退，录制已改用 tts）"""
    url = ("https://fanyi.baidu.com/gettts?lan=zh&text=" +
           urllib.parse.quote(text) + f"&spd={spd}&source=web")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(5):
        try:
            data = urllib.request.urlopen(req, timeout=30).read()
            break
        except Exception as ex:
            if attempt == 4:
                raise
            print(f"    [TTS {attempt+1}/5 重试] {ex}", flush=True)
            time.sleep(25 * (attempt + 1))
    with open(out_mp3, "wb") as f:
        f.write(data)
    return audio_len(out_mp3)


# 接口基地址:HTW_BASE 环境变量优先。免费二级域名后缀(dpdns.org)被运营商出口
# 按 TLS SNI 关键词阻断后,被拦链路上可设 HTW_BASE=http://123.57.217.155 直连源站过渡。
# TODO(换域名): 新域名上线后替换各工具的 fallback 常量 —— 全局搜 "TODO(换域名)"。
TTS_API = os.environ.get("HTW_BASE", "https://htwmedia.dpdns.org")
TTS_SPEAKER = "zh_female_aoyunliuyuxi"
TTS_CONFIG = os.path.expandvars(r"%APPDATA%\htwsuite-desktop\htw-config.json")


def _authkey():
    """从桌面端配置读取 apiKey；缺失则立即报错（不产出无声音频）。"""
    try:
        with open(TTS_CONFIG, encoding="utf-8") as f:
            key = json.load(f).get("apiKey")
    except Exception:
        key = None
    if not key:
        raise RuntimeError("AuthKey 缺失：无法读取 " + TTS_CONFIG + " 的 apiKey，旁白合成终止")
    return key


def _split_text(text, limit=100):
    """按句号等标点贪心合并到 ≤limit 字；无标点超长则硬切。"""
    parts, buf = [], ""
    segs = []
    cur = ""
    for ch in text:
        cur += ch
        if ch in "。！？；\n":
            segs.append(cur)
            cur = ""
    if cur:
        segs.append(cur)
    for seg in segs:
        if len(seg) > limit:  # 无标点长句硬切
            for i in range(0, len(seg), limit):
                parts.append(seg[i:i + limit])
        elif len(buf) + len(seg) <= limit:
            buf += seg
        else:
            if buf:
                parts.append(buf)
            buf = seg
    if buf:
        parts.append(buf)
    return parts or [text]


def _tts_once(text, key):
    """单段合成：提交 → 轮询 → 下载，返回 mp3 字节。"""
    payload = json.dumps({"text": text, "speaker": TTS_SPEAKER}).encode("utf-8")
    headers = {"AuthKey": key, "Content-Type": "application/json; charset=utf-8",
               "User-Agent": UA}
    req = urllib.request.Request(TTS_API + "/api/v2/voice/tts", data=payload,
                                 headers=headers, method="POST")
    r = json.loads(urllib.request.urlopen(req, timeout=30).read())
    task = r.get("TaskId") or (r.get("Data") or {}).get("taskId")
    if not task:
        raise RuntimeError("TTS 提交失败: " + json.dumps(r, ensure_ascii=False)[:200])
    for _ in range(150):  # 2s × 150 = 300s 轮询超时（不含单次请求超时）
        time.sleep(2)
        # 服务端高峰/限流时 status 响应会卡到 30s+（2026-10-27 夜实况）：
        # 单次读超时放宽到 60s，轮询循环内自愈，不轻易抛给上层重试重新提交
        s = json.loads(urllib.request.urlopen(
            urllib.request.Request(TTS_API + "/api/v2/voice/status/" + task,
                                   headers=headers), timeout=60).read())
        d = s.get("Data") or {}
        st = d.get("status")
        if st == "completed":
            url = d.get("audioUrl") or d.get("downloadUrl")
            if not url:
                raise RuntimeError("TTS 完成但无 audioUrl: " + json.dumps(s, ensure_ascii=False)[:200])
            req2 = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req2, timeout=60).read()
        if st == "failed":
            raise RuntimeError("TTS 服务失败: " + str(d.get("error"))[:200])
    raise RuntimeError("TTS 轮询超时: " + task)


def _tts_dub_once(text, key):
    """备用通道：剪映 capflow aroll TTS（union_pc 生成 aroll 的同一条云通道，
    服务端 /api/v2/edit/tts-dub 包装 JianyingDubService）。
    与 /api/v2/voice/tts 不同配额——主通道限流时由 tts() 回落到此。"""
    payload = json.dumps({"text": text, "speaker": TTS_SPEAKER}).encode("utf-8")
    headers = {"AuthKey": key, "Content-Type": "application/json; charset=utf-8",
               "User-Agent": UA}
    req = urllib.request.Request(TTS_API + "/api/v2/edit/tts-dub", data=payload,
                                 headers=headers, method="POST")
    return urllib.request.urlopen(req, timeout=300).read()


def tts(text, out_mp3, spd=4):
    """项目语音合成（发音人 TTS_SPEAKER），返回音频时长(秒)。
    spd 保留兼容旧签名（项目接口无语速参数，忽略）。
    主通道（/api/v2/voice/tts）重试耗尽后回落 capflow aroll 备用通道。"""
    key = _authkey()
    parts = _split_text(text)
    tmpdir = out_mp3 + "_parts"
    os.makedirs(tmpdir, exist_ok=True)
    seg_files = []
    try:
        for i, part in enumerate(parts):
            f = os.path.join(tmpdir, f"p{i:02d}.mp3")
            try:
                for attempt in range(3):
                    try:
                        data = _tts_once(part, key)
                        break
                    except Exception:
                        if attempt == 2:
                            raise
                        backoff = 15 * (attempt + 1)  # 15s/30s：给限流窗口留恢复时间
                        print(f"    [TTS 段 {i+1}/{len(parts)} 重试 {attempt+1}/2（{backoff}s 后）]", flush=True)
                        time.sleep(backoff)
            except Exception as main_ex:
                # 主通道 3 连败 → capflow aroll 备用通道（音色同为 TTS_SPEAKER）
                data = None
                for attempt in range(2):
                    try:
                        print(f"    [TTS 段 {i+1}/{len(parts)} 走备用 capflow 通道（第 {attempt+1} 次）]", flush=True)
                        data = _tts_dub_once(part, key)
                        break
                    except Exception as dub_ex:
                        print(f"    [备用通道失败] {str(dub_ex)[:120]}", flush=True)
                        time.sleep(10)
                if data is None:
                    raise main_ex
            with open(f, "wb") as fh:
                fh.write(data)
            if audio_len(f) <= 0:
                raise RuntimeError(f"TTS 段 {i+1} 音频为空")
            seg_files.append(f)
        if len(seg_files) == 1:
            data = open(seg_files[0], "rb").read()
            with open(out_mp3, "wb") as fh:
                fh.write(data)
        else:
            cat = os.path.join(tmpdir, "list.txt")
            with open(cat, "w", encoding="utf-8") as fh:
                for f in seg_files:
                    fh.write(f"file '{os.path.abspath(f).replace(chr(92), '/')}'\n")
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-f", "concat", "-safe", "0", "-i", cat, "-c", "copy", out_mp3])
        return audio_len(out_mp3)
    finally:
        try:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


def audio_len(path):
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        return float(p.stdout.strip())
    except Exception:
        return 0.0


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(cmd[0] + " 失败: " + r.stderr.decode("utf-8", "replace")[-400:])
    return r


# ---------------------------------------------------------------- 场景模型
class Scene:
    def __init__(self, narr, sub=None, run=None, pad=0.6, speed_cap=None,
                 min_len=None):
        """
        narr  旁白文案（也是字幕）
        sub   字幕覆盖（默认用 narr）
        run   动作函数 fn(cdp)；场景实际时长 = max(动作耗时, 配音时长+pad)
        speed_cap 渲染等待场景：录制后画面加速到不超过该秒数
        min_len  场景最短展示秒数
        """
        self.narr = narr
        self.sub = sub or narr
        self.run = run
        self.pad = pad
        self.speed_cap = speed_cap
        self.min_len = min_len or 0


def probe_window(title):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-f", "gdigrab", "-i",
                        f"title={title}", "-frames:v", "1", "-y",
                        os.path.join(HERE, "_probe.png")],
                       capture_output=True)
    ok = os.path.exists(os.path.join(HERE, "_probe.png"))
    if ok:
        os.remove(os.path.join(HERE, "_probe.png"))
    return ok


def record_take(title, out_mp4, seconds):
    """gdigrab 按窗口标题录屏，返回。需另行 stop。返回 Popen"""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-f", "gdigrab", "-framerate", "30", "-i", "desktop",
           "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
           "-pix_fmt", "yuv420p", out_mp4]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


# ---------------------------------------------------------------- 组装
def seg_speed(raw, narr_dur, cap):
    """场景加速倍率：speed_cap 语义 = 倍率上限（渲染等待段进度条肉眼可见），
    且不快过配音节奏（显示时长 ≥ 配音时长）。cap=None 或 raw 不足时 1 倍速。"""
    floor = max(narr_dur + 0.4, 1.0)
    if not cap or raw <= max(floor, float(cap)):
        return 1.0
    return min(raw / floor, float(cap))


def assemble(module, scenes, take_mp4, workdir, out_mp4, fps=30):
    """scenes 元数据由 recorder 回填: [start,end(原始),narr_dur,sub]"""
    os.makedirs(workdir, exist_ok=True)
    seg_files = []
    ass_lines = ["[Script Info]", "ScriptType: v4.00+",
                 "PlayResX: 1600", "PlayResY: 1000", "",
                 "[V4+ Styles]",
                 "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, BorderStyle",
                 "Style: Sub,Microsoft YaHei,46,&H00FFFFFF,&H00000000,&H80000000,1,3,1,2,40,40,36,1",
                 "", "[Events]",
                 "Format: Layer, Start, End, Style, Text"]
    t_cursor = 0.0
    total = None
    for i, sc in enumerate(scenes):
        if sc.get("clip"):  # 逐场景片段模式
            raw = audio_len(sc["clip"])
            sc["start"], sc["end"] = 0, raw
            take_mp4 = sc["clip"]
        else:
            raw = sc["end"] - sc["start"]
        narr_dur = sc["narr_dur"]
        speed = seg_speed(raw, narr_dur, sc.get("speed_cap"))
        out_len = raw / speed
        seg = os.path.join(workdir, f"seg_{i:02d}.mp4")
        cut_args = (["-ss", f'{sc["start"]:.2f}', "-t", f"{raw:.2f}"]
                    if not sc.get("clip") else [])
        crop = sc.get("crop")
        if crop:
            # 窗口贴到屏幕边缘时矩形原点可能为负（模板匹配的边框常数所致），
            # ffmpeg crop 不接受负偏移 —— 钳到 0，代价是裁掉屏幕外的十几像素。
            cx = max(0, int(crop[0])); cy = max(0, int(crop[1]))
            cw = int(crop[2]) - (cx - int(crop[0])); ch = int(crop[3]) - (cy - int(crop[1]))
            vf = f"crop={cw - cw % 2}:{ch - ch % 2}:{cx}:{cy},"
        else:
            vf = ""
        vf += f"setpts=PTS/{speed:.4f}"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             *cut_args, "-i", take_mp4,
             "-vf", vf,
             "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
             "-pix_fmt", "yuv420p", seg])
        # 补齐到时长（尾帧冻结），保证 >= 配音
        need = max(out_len, narr_dur + 0.5)
        if need - out_len > 0.05:
            last = os.path.join(workdir, f"last_{i:02d}.png")
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-sseof", "-0.1", "-i", seg, "-frames:v", "1", last])
            padf = os.path.join(workdir, f"pad_{i:02d}.mp4")
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-loop", "1", "-i", last, "-t", f"{need - out_len:.2f}",
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                 "-pix_fmt", "yuv420p", padf])
            cat = os.path.join(workdir, f"cat_{i:02d}.txt")
            with open(cat, "w", encoding="utf-8") as f:
                f.write(f"file '{os.path.abspath(seg)}'\nfile '{os.path.abspath(padf)}'\n")
            merged = os.path.join(workdir, f"mseg_{i:02d}.mp4")
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-f", "concat", "-safe", "0", "-i", cat,
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                 "-pix_fmt", "yuv420p", merged])
            seg = merged
            out_len = need
        # 配音：起点 0.3s（录制前已生成则直接用）
        narr = sc.get("narr_file") or os.path.join(workdir, f"narr_{i:02d}.mp3")
        if not sc.get("narr_file"):
            tts(sc["narr"], narr, spd=4)
        nd = sc["narr_dur"] or audio_len(narr)
        mixed = os.path.join(workdir, f"wseg_{i:02d}.mp4")
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-i", seg, "-i", narr,
             "-filter_complex",
             f"[1:a]adelay=300|300,apad=whole_dur={out_len:.2f}[a]",
             "-map", "0:v", "-map", "[a]", "-c:v", "copy",
             "-c:a", "aac", "-b:a", "160k", "-shortest", mixed])
        # 字幕（可能多行：手动换行）
        sub_text = sc["sub"].replace("\n", "\\N")
        s, e = t_cursor + 0.2, t_cursor + out_len - 0.2
        def ts(x):
            h = int(x // 3600); m = int(x % 3600 // 60); s2 = x % 60
            return f"{h}:{m:02d}:{s2:05.2f}"
        ass_lines.append(f"Dialogue: 0,{ts(s)},{ts(e)},Sub,{sub_text}")
        seg_files.append(mixed)
        t_cursor += out_len
        sc["shown_len"] = out_len
    # 拼接
    cat = os.path.join(workdir, "all.txt")
    with open(cat, "w", encoding="utf-8") as f:
        for s in seg_files:
            f.write(f"file '{os.path.abspath(s)}'\n")
    joined = os.path.join(workdir, "joined.mp4")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "concat", "-safe", "0", "-i", cat, "-c", "copy", joined])
    ass = os.path.join(workdir, "subs.ass")
    with open(ass, "w", encoding="utf-8") as f:
        f.write("\n".join(ass_lines))
    ass_esc = os.path.abspath(ass).replace("\\", "/").replace(":", "\\:")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", joined,
         "-vf", f"ass='{ass_esc}'", "-c:v", "libx264", "-preset", "medium",
         "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "copy", out_mp4])
    return t_cursor
