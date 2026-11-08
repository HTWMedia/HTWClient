#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 pyJianYingDraft 生成一条「自包含」剪映草稿，可直接交给 HTW 云端渲成 mp4。

自包含 = 素材文件拷进草稿目录、draft_content.json 里的绝对路径改写成剪映的
草稿占位符（##_draftpath_placeholder_<id>_##/materials/xxx.mp4）。
不这么做的话，草稿里写的是你本机的 D:\\... 路径，上传到云端渲染时服务端
找不到文件，只会给一条「素材缺失」警告然后渲出黑屏。

用法：
    python build_draft.py --video 素材.mp4 --title "开场标题" --out ./drafts
    python build_draft.py --video 素材.mp4 --audio bgm.mp3 --seconds 15
    python build_draft.py --video 素材.mp4 --srt 字幕.srt --name 带字幕的一条
"""

import argparse
import json
import os
import shutil
import sys

try:
    import pyJianYingDraft as jy
except ImportError:  # pragma: no cover - 只是给出更友好的提示
    sys.exit("缺少依赖：pip install pyJianYingDraft")

# 剪映用这个占位符表示「草稿目录本身」。服务端按 "##/" 之后的部分拼回真实路径，
# 所以前缀里的 id 是什么都不影响解析，这里用草稿 id 保持和剪映一致。
PLACEHOLDER = "##_draftpath_placeholder_{}_##/"

# draft_content.json 里可能带本地文件路径的素材桶
MEDIA_BUCKETS = ("videos", "audios", "images", "photos")


def trange(start_sec, duration_sec):
    """按「秒」建时间区间。

    坑：pyJianYingDraft 的 trange(0, 6) 是 **6 微秒**（裸数字一律当微秒），
    必须写成字符串 "6s" 才会被解析成 6 秒 —— 否则渲出来是 0 秒的空片。
    """
    return jy.trange("{:.3f}s".format(start_sec), "{:.3f}s".format(duration_sec))


def _unique_name(mat_dir, filename, used):
    """同名素材进同一个目录时避免互相覆盖。"""
    stem, ext = os.path.splitext(filename)
    candidate = filename
    i = 2
    while candidate in used or os.path.exists(os.path.join(mat_dir, candidate)):
        candidate = "{}_{}{}".format(stem, i, ext)
        i += 1
    used.add(candidate)
    return candidate


def make_portable(draft_dir):
    """把草稿改成自包含：素材拷进 materials/，路径改成占位符形式。

    返回 (拷进来的文件名列表, 找不到源文件的路径列表, 改写的素材条数)。
    """
    content_path = os.path.join(draft_dir, "draft_content.json")
    with open(content_path, "r", encoding="utf-8") as fp:
        data = json.load(fp)

    materials = data.get("materials") or {}
    draft_id = data.get("id") or os.path.basename(os.path.abspath(draft_dir))
    prefix = PLACEHOLDER.format(draft_id)
    mat_dir = os.path.join(draft_dir, "materials")

    copied, missing, used = [], [], set()
    by_source = {}
    rewritten = 0

    for bucket in MEDIA_BUCKETS:
        for item in materials.get(bucket) or []:
            raw = item.get("path") or ""
            # 空路径 = 云端素材；以 / 开头 = 已上传过的云 path；带 placeh = 已经是占位符
            if not raw or raw.startswith("/") or "placeh" in raw:
                continue
            if not os.path.isfile(raw):
                missing.append(raw)
                continue

            key = os.path.normcase(os.path.abspath(raw))
            if key not in by_source:
                name = _unique_name(mat_dir, os.path.basename(raw), used)
                os.makedirs(mat_dir, exist_ok=True)
                shutil.copy2(raw, os.path.join(mat_dir, name))
                by_source[key] = name
                copied.append(name)

            item["path"] = prefix + "materials/" + by_source[key]
            # 视频/音频素材的 video_algorithm / audio_algorithm 里还有一份 path，
            # 漏改会留下一条本地路径，服务端会判成「渲染端取不到实体文件」直接拦下。
            for alg_key in ("video_algorithm", "audio_algorithm"):
                alg = item.get(alg_key)
                if isinstance(alg, dict) and alg.get("path"):
                    alg["path"] = item["path"]
            rewritten += 1

    with open(content_path, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False)

    return copied, missing, rewritten


def build(args):
    video = os.path.abspath(args.video)
    if not os.path.isfile(video):
        sys.exit("找不到视频素材: {}".format(video))

    os.makedirs(args.out, exist_ok=True)
    folder = jy.DraftFolder(args.out)
    script = folder.create_draft(
        args.name, args.width, args.height, fps=args.fps, allow_replace=True
    )

    material = jy.VideoMaterial(video)
    total = material.duration / 1_000_000.0
    take = min(args.seconds, total) if args.seconds else total

    video_track = script.append_track(jy.TrackSpec(jy.TrackType.video))
    script.add_segment(
        jy.VideoSegment(
            material,
            trange(0, take),
            source_timerange=trange(0, take) if args.seconds else None,
            volume=args.volume,
        ),
        video_track,
    )

    if args.title:
        # 标题默认压在前 2.5 秒，且不越界
        title_start = 0.2
        title_dur = max(min(2.5, take) - title_start, 0.5)
        text_track = script.append_track(jy.TrackSpec(jy.TrackType.text))
        script.add_segment(
            jy.TextSegment(
                args.title,
                trange(title_start, title_dur),
                style=jy.TextStyle(size=14, bold=True, align=1),
                border=jy.TextBorder(width=30),
            ),
            text_track,
        )

    if args.audio:
        audio_path = os.path.abspath(args.audio)
        if not os.path.isfile(audio_path):
            sys.exit("找不到音频素材: {}".format(audio_path))
        audio_material = jy.AudioMaterial(audio_path)
        audio_total = min(take, audio_material.duration / 1_000_000.0)
        audio_track = script.append_track(jy.TrackSpec(jy.TrackType.audio))
        script.add_segment(
            jy.AudioSegment(audio_material, trange(0, audio_total), volume=args.bgm_volume),
            audio_track,
        )

    if args.srt:
        srt_path = os.path.abspath(args.srt)
        if not os.path.isfile(srt_path):
            sys.exit("找不到字幕文件: {}".format(srt_path))
        script.import_srt(srt_path, "字幕")

    script.save()

    draft_dir = os.path.join(args.out, args.name)
    if args.no_portable:
        # 留在本机用剪映打开时用它：绝对路径照旧，剪映自己能找到素材。
        # 但这样的草稿直接上传云端会渲出黑屏（云端没有你本机的 D:\...）。
        print("已跳过自包含改写（--no-portable）：这份草稿只能在**本机剪映**里打开。")
        copied, missing, rewritten = [], [], 0
    else:
        copied, missing, rewritten = make_portable(draft_dir)

    if missing:
        print("警告：以下素材在打包时找不到源文件，云端会渲不出这一段：")
        for path in missing:
            print("  " + path)

    summary = {
        "draft_dir": os.path.abspath(draft_dir),
        "duration_sec": round(take, 3),
        "canvas": "{}x{}@{}".format(args.width, args.height, args.fps),
        "materials_copied": copied,
        "paths_rewritten": rewritten,
        "missing": missing,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
        return summary

    print("草稿已生成: {}".format(summary["draft_dir"]))
    print("  画布 {}  时长 {}s".format(summary["canvas"], summary["duration_sec"]))
    print("  拷入素材 {} 个，改写路径 {} 条".format(len(copied), rewritten))
    for name in copied:
        print("    materials/" + name)
    print("")
    print("下一步（草稿 → 成片）:")
    print('  python render.py --draft "{}" --cookie-file ./jy-cookie.txt --out ./out'.format(
        summary["draft_dir"]))
    print("或者用仓库自带的 Node CLI（同一个接口）:")
    print('  node agent/cli/htw-skills.mjs draft "{}" --cookie-file ./jy-cookie.txt --out ./out'.format(
        summary["draft_dir"]))
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="用 pyJianYingDraft 生成自包含剪映草稿（可直接给 HTW 云端渲染）"
    )
    parser.add_argument("--video", required=True, help="主视频素材（草稿画面就来自它）")
    parser.add_argument("--audio", help="配乐/旁白，混在视频原声之上")
    parser.add_argument("--srt", help="字幕文件（SRT），导入为独立文本轨")
    parser.add_argument("--title", default="HTW × pyJianYingDraft", help="开场标题文字，传空串则不生成")
    parser.add_argument("--seconds", type=float, default=0, help="只取素材前 N 秒，0 = 用全长")
    parser.add_argument("--out", default="./drafts", help="草稿根目录（草稿会建在 <out>/<name>）")
    parser.add_argument("--name", default="pjy-demo", help="草稿名，也是生成的目录名")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--volume", type=float, default=1.0, help="视频原声音量 0~1")
    parser.add_argument("--bgm-volume", type=float, default=0.35, help="配乐音量 0~1")
    parser.add_argument("--json", action="store_true", help="只输出一行 JSON 摘要，便于脚本串联")
    parser.add_argument("--no-portable", action="store_true",
                        help="不改写成自包含（素材路径留本机绝对路径，只能用本机剪映打开）")
    build(parser.parse_args(argv))


if __name__ == "__main__":
    main()
