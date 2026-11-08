#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 pyJianYingDraft 生成一条「复杂的自包含草稿」：多段拼接 + 转场 + 蒙版 +
关键帧 + 标题动画 + 字幕轨 + 双音轨，可直接交给 HTW 云端渲成 mp4。

和 build_draft.py 的区别：那个是单段最小示例，这个是「一条草稿里塞满常见特效」，
用来验证链路对复杂草稿的支持。实测结论见 README 的「复杂草稿实测」一节，
其中两条务必注意：

* ``叠化`` 转场会渲成整段黑场（时长正好等于转场时长）；``模糊``/``向左`` 正常。
* 滤镜（``add_filter``）在成片里不生效，像素级无变化；需要滤镜请先烧进素材。

用法：
    python build_complex.py --clips a.mp4,b.mp4,c.mp4 --out ./drafts
    python build_complex.py --clips a.mp4,b.mp4 --voice 旁白.mp3 --bgm 音乐.m4a --srt 字幕.srt
"""

import argparse
import json
import os
import sys

try:
    import pyJianYingDraft as jy
except ImportError:  # pragma: no cover
    sys.exit("缺少依赖：pip install pyJianYingDraft")

from build_draft import make_portable, trange

# 转场白名单：只留实测能出画的。叠化（is_overlap=True）会黑场，见 README。
SAFE_TRANSITIONS = ("模糊", "向左", "向右")


def pick_transition(name):
    if name not in SAFE_TRANSITIONS:
        sys.exit(
            "转场 %s 未验证；实测可用的是 %s（叠化 会渲成黑场）"
            % (name, "/".join(SAFE_TRANSITIONS))
        )
    return getattr(jy.TransitionType, name)


def build(args):
    clips = [os.path.abspath(p.strip()) for p in args.clips.split(",") if p.strip()]
    if len(clips) < 2:
        sys.exit("至少需要两段素材（--clips a.mp4,b.mp4）")
    for path in clips:
        if not os.path.isfile(path):
            sys.exit("找不到视频素材: {}".format(path))

    os.makedirs(args.out, exist_ok=True)
    script = jy.DraftFolder(args.out).create_draft(
        args.name, args.width, args.height, fps=args.fps, allow_replace=True
    )
    video_track = script.append_track(jy.TrackSpec(jy.TrackType.video))

    transitions = [pick_transition(t.strip()) for t in args.transitions.split(",") if t.strip()]
    cursor = 0.0
    total = 0.0
    for index, path in enumerate(clips):
        material = jy.VideoMaterial(path)
        available = material.duration / 1_000_000.0
        take = min(args.clip_seconds, available)
        speed = args.speed_second if index == 1 else 1.0
        source_len = take * speed

        segment = jy.VideoSegment(
            material,
            trange(cursor, take),
            source_timerange=trange(0, source_len),
            speed=speed,
            volume=1.0 if index == 0 else 0.8,
        )

        is_last = index == len(clips) - 1
        if not is_last:
            segment.add_transition(transitions[index % len(transitions)], duration=args.transition_seconds)

        if is_last and args.mask == "circle":
            segment.add_mask(jy.MaskType.圆形, center_x=0.0, center_y=0.0, size=0.75, feather=0.15)
        if is_last and args.zoom > 0:
            segment.add_keyframe(jy.KeyframeProperty.uniform_scale, 0, 1.0)
            segment.add_keyframe(
                jy.KeyframeProperty.uniform_scale,
                "{:.3f}s".format(max(take - 0.5, 0.5)),
                args.zoom,
            )

        script.add_segment(segment, video_track)
        cursor += take
        total = cursor

    if args.title:
        title_track = script.append_track(jy.TrackSpec(jy.TrackType.text))
        title = jy.TextSegment(
            args.title,
            trange(0.3, min(3.0, total - 0.4)),
            style=jy.TextStyle(size=args.title_size, bold=True, align=1),
            border=jy.TextBorder(width=30),
        )
        title.add_animation(jy.TextIntro.向右擦除, duration="0.5s")
        script.add_segment(title, title_track)

    if args.srt:
        srt = os.path.abspath(args.srt)
        if not os.path.isfile(srt):
            sys.exit("找不到字幕文件: {}".format(srt))
        script.import_srt(srt, "字幕")

    if args.voice:
        voice_path = os.path.abspath(args.voice)
        if not os.path.isfile(voice_path):
            sys.exit("找不到人声素材: {}".format(voice_path))
        material = jy.AudioMaterial(voice_path)
        seconds = min(total, material.duration / 1_000_000.0)
        track = script.append_track(jy.TrackSpec(jy.TrackType.audio, name="人声"))
        segment = jy.AudioSegment(material, trange(0, seconds), volume=args.voice_volume)
        segment.add_fade("0.3s", "0.8s")
        script.add_segment(segment, track)

    if args.bgm:
        bgm_path = os.path.abspath(args.bgm)
        if not os.path.isfile(bgm_path):
            sys.exit("找不到配乐素材: {}".format(bgm_path))
        material = jy.AudioMaterial(bgm_path)
        seconds = min(total, material.duration / 1_000_000.0)
        track = script.append_track(jy.TrackSpec(jy.TrackType.audio, name="BGM"))
        segment = jy.AudioSegment(material, trange(0, seconds), volume=args.bgm_volume)
        segment.add_fade("1.0s", "1.0s")
        script.add_segment(segment, track)

    script.save()

    draft_dir = os.path.join(args.out, args.name)
    if args.no_portable:
        copied, missing, rewritten = [], [], 0
        print("已跳过自包含改写（--no-portable）：这份草稿只能在**本机剪映**里打开。")
    else:
        copied, missing, rewritten = make_portable(draft_dir)

    if missing:
        print("警告：以下素材打包时找不到源文件，云端会渲不出这一段：")
        for path in missing:
            print("  " + path)

    summary = {
        "draft_dir": os.path.abspath(draft_dir),
        "clips": len(clips),
        "duration_sec": round(total, 3),
        "transitions": [t.name for t in transitions[: len(clips) - 1]],
        "canvas": "{}x{}@{}".format(args.width, args.height, args.fps),
        "materials_copied": copied,
        "paths_rewritten": rewritten,
        "missing": missing,
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        print("草稿已生成: {}".format(summary["draft_dir"]))
        print("  {} 段 / {}s / {}，转场 {}".format(
            summary["clips"], summary["duration_sec"], summary["canvas"],
            ",".join(summary["transitions"])))
        print("  拷入素材 {} 个，改写路径 {} 条".format(len(copied), rewritten))
        print("")
        print("下一步（草稿 → 成片）:")
        print('  python render.py --draft "{}" --cookie-file ./jy-cookie.txt --out ./out'.format(
            summary["draft_dir"]))
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="生成复杂的自包含剪映草稿（多段/转场/蒙版/双音轨/字幕）")
    parser.add_argument("--clips", required=True, help="逗号分隔的视频素材，按顺序拼接")
    parser.add_argument("--clip-seconds", type=float, default=4.0, help="每段取多长（默认 4 秒）")
    parser.add_argument("--speed-second", type=float, default=1.5, help="第 2 段的倍速（默认 1.5，1 = 不变速）")
    parser.add_argument("--transitions", default="模糊", help="逗号分隔的转场名，循环使用；可选 模糊/向左/向右")
    parser.add_argument("--transition-seconds", default="0.8s", help="转场时长（默认 0.8s）")
    parser.add_argument("--mask", choices=("circle", "none"), default="circle", help="末段蒙版，默认圆形")
    parser.add_argument("--zoom", type=float, default=1.12, help="末段结束时的缩放倍数，0 = 关闭")
    parser.add_argument("--title", default="复杂草稿：多段 · 转场 · 字幕", help="标题，传空串则不生成")
    parser.add_argument("--title-size", type=float, default=8.0)
    parser.add_argument("--srt", help="字幕文件（SRT），导入为独立文本轨")
    parser.add_argument("--voice", help="旁白/人声（mp3/wav/m4a；不能是带画面轨的 mp4）")
    parser.add_argument("--voice-volume", type=float, default=0.9)
    parser.add_argument("--bgm", help="配乐（mp3/wav/m4a）")
    parser.add_argument("--bgm-volume", type=float, default=0.18)
    parser.add_argument("--out", default="./drafts", help="草稿根目录")
    parser.add_argument("--name", default="pjy-complex", help="草稿名，也是目录名")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--json", action="store_true", help="只输出一行 JSON 摘要")
    parser.add_argument("--no-portable", action="store_true", help="不改写成自包含（只能本机剪映打开）")
    build(parser.parse_args(argv))


if __name__ == "__main__":
    main()
