#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 pyJianYingDraft 生成一条「复杂的自包含草稿」：多段拼接 + 转场 + 滤镜 +
蒙版 + 关键帧 + 标题动画 + 字幕轨 + 双音轨，可直接交给 HTW 云端渲成 mp4。

和 build_draft.py 的区别：那个是单段最小示例，这个是「一条草稿里塞满常见特效」，
用来验证链路对复杂草稿的支持。

## 转场 / 滤镜必须过一层目录

pyJianYingDraft 自带的两套元数据都有坑，而且**都不报错**，只表现为「效果没了」：

* **转场**：``TransitionType.叠化`` 的 resource_id（6724845717472416269）云端已无资源
  → 转场区域整段渲成黑色，黑场时长正好等于转场时长。换用现采目录里的 id 才出画。
* **滤镜**：0.3.1 的 ``materials`` 桶里没有 ``filters`` 键，``FilterSegment`` 只留下一条
  空轨道 —— 素材本体从未写进草稿，所以「滤镜不生效」不是云端不认。

两者都交给 ``apply_effects.apply_catalog_effects()`` 在 ``script.save()`` 之后改写，
形态与服务端剪同款管线一致（见 ``docs/2026-10-11-*`` 两份协议文档）。
``--list-fx`` 可以看目录里当前有哪些非 VIP 资源可选。

用法：
    python build_complex.py --clips a.mp4,b.mp4,c.mp4 --out ./drafts
    python build_complex.py --clips a.mp4,b.mp4 --filter 冷蓝 --out ./drafts
    python build_complex.py --clips a.mp4,b.mp4 --transitions 中心旋转,复古放映 --list-fx
"""

import argparse
import json
import os
import sys

try:
    import pyJianYingDraft as jy
except ImportError:  # pragma: no cover
    sys.exit("缺少依赖：pip install pyJianYingDraft")

import effects_catalog as fx
from apply_effects import apply_catalog_effects
from build_draft import make_portable, trange

# 骨架转场：只用来让 pyJianYingDraft 建出 transition 素材与段上引用，
# 真正的 resource_id / name / duration 会被 apply_catalog_effects 全量覆盖。
SKELETON_TRANSITION = jy.TransitionType.模糊


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

    # 转场：参数是目录里的标题（或分类），选型这一步就把「VIP / 不存在」拦下来，
    # 而不是等渲染出一条黑片才发现。
    transition_names = [t.strip() for t in args.transitions.split(",") if t.strip()]
    transition_picks = [fx.pick_transition(n, args.fx_dir) for n in transition_names] or None
    filter_pick = fx.pick_filter(args.filter, args.fx_dir) if args.filter else None

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
        if not is_last and transition_picks:
            segment.add_transition(SKELETON_TRANSITION, duration=args.transition_seconds)

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

    if filter_pick:
        # 骨架滤镜轨：pyJianYingDraft 0.3.1 不会把滤镜素材写进 materials，
        # 这里只保证段上有一个 material_id 可替换。真正的素材由
        # apply_catalog_effects 补建并改挂到主轨每个视频段的 extra_material_refs。
        filter_track = script.append_track(jy.TrackSpec(jy.TrackType.filter))
        script.add_segment(
            jy.FilterSegment(jy.FilterType.冷蓝, trange(0, total), intensity=1.0),
            filter_track,
        )

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
    # 🔴 必须在 save() 之后：这一段改的是已落盘的 draft_content.json
    fx_notes = apply_catalog_effects(
        draft_dir, transition_picks=transition_picks, filter_pick=filter_pick
    )

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
        "transitions": [p.get("title") for p in (transition_picks or [])][: len(clips) - 1],
        "filter": filter_pick.get("title") if filter_pick else "",
        "fx_notes": fx_notes,
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
            ",".join(summary["transitions"]) or "无"))
        if summary["filter"]:
            print("  滤镜 {}".format(summary["filter"]))
        for note in fx_notes:
            print("  · " + note)
        print("  拷入素材 {} 个，改写路径 {} 条".format(len(copied), rewritten))
        print("")
        print("下一步（草稿 → 成片）:")
        print('  python render.py --draft "{}" --cookie-file ./jy-cookie.txt --out ./out'.format(
            summary["draft_dir"]))
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="生成复杂的自包含剪映草稿（多段/转场/滤镜/蒙版/双音轨/字幕）")
    parser.add_argument("--clips", help="逗号分隔的视频素材，按顺序拼接")
    parser.add_argument("--clip-seconds", type=float, default=4.0, help="每段取多长（默认 4 秒）")
    parser.add_argument("--speed-second", type=float, default=1.5, help="第 2 段的倍速（默认 1.5，1 = 不变速）")
    parser.add_argument("--transitions", default="中心旋转",
                        help="逗号分隔的转场标题（或分类），循环使用；--list-fx 看可选清单")
    parser.add_argument("--filter", default="", help="滤镜标题（--list-fx 看可选）。资源型经服务端改写后有效；参数型已证伪（云端不调色）")
    parser.add_argument("--fx-dir", help="Services/Editing 目录（默认探测 HTW_EDITING_DIR 环境变量）")
    parser.add_argument("--list-fx", action="store_true", help="只打印目录里可用的转场/滤镜然后退出")
    parser.add_argument("--transition-seconds", default="0.8s", help="转场时长（仅骨架用，最终取目录 defaultDurationUs）")
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
    args = parser.parse_args(argv)
    if args.list_fx:
        print(fx.describe(args.fx_dir))
        return
    if not args.clips:
        parser.error("--clips 是必填项（--list-fx 除外）")
    build(args)


if __name__ == "__main__":
    main()
