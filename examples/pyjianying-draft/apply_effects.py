#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 pyJianYingDraft 生成的特效改写成「云端能渲」的形态。

## 两个坑，两条修法

### 1) 转场：资源 id 过期 → 整段黑场

pyJianYingDraft 的 `TransitionType.叠化` 带的是旧 `resource_id`
（6724845717472416269）。云端按 id 取不到资源时**不报错**，直接把转场区域
渲成黑色——黑场时长正好等于转场时长，很容易被误判成「后端不支持叠化」。

修法：把 `materials.transitions[]` 的 `resource_id` / `effect_id` 换成
现采目录里**非 VIP** 的 id，`type` 用管线验证过的 `dissolve`。

### 2) 滤镜：素材根本没落进草稿

pyJianYingDraft 0.3.1 的 `materials` 桶里**没有 `filters` 键**，
`FilterSegment` 只留了一条空的 filter 轨和一个悬空的 material_id——
素材本体从未序列化。所以「滤镜不生效」不是云端不认，而是**草稿里压根没有滤镜**。

修法：补建 `materials.filters[]`（`path` 置空、`enable_adjust=true`、
`source_platform=0`、`value=1.0`），再把滤镜挂到主轨每个视频段的
`extra_material_refs` 上，删掉空 filter 轨。

⚠️ **这个形态本身不会出效果**（2026-11-09 定案）。真正的官方形态是：
素材留在 `materials.effects`、`effect_id` 用 7 位短 id（彩果 = `7507484`）、
`path` 写 `/editor/effect/filter/<resource_id>`、并挂一条独立的 `type=filter` 轨
（段用 `material_id` 直指素材，`extra_material_refs=[]`，`render_index=1`），
视频段的 refs 里**不含**滤镜 id。

本脚本仍按旧形态输出——因为走 `/api/v2/edit/draft-export` 时，服务端
`Utils.UpgradeFiltersToWebShape` 会在上报云渲染前统一改写（开关
`HTW_FILTER_WEB_SHAPE`，默认开）。**如果你直连剪映云渲染、不过服务端，
就得自己按上面四条摆对**，否则云端静默跳过、不报错也不调色。
详见 README「滤镜」一节。

## 形态依据

- 服务端协议文档 transition-resource-protocol（Probe A 实机渲染通过）
- 服务端协议文档 style-filter-protocol
- 服务端 JianyingDraftAdapter 的 `BuildFilterMaterial`
"""

import json
import os
import uuid


def _load(draft_dir):
    path = os.path.join(draft_dir, "draft_content.json")
    with open(path, "r", encoding="utf-8") as fp:
        return path, json.load(fp)


def _save(path, data):
    with open(path, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False)


def _mount_segment_transition(tracks, trans_id, duration_us):
    """在引用该转场的段上补 `transition: {id, duration}`。

    pyJianYingDraft 只把转场写进 `extra_material_refs`，段上没有 `transition` 对象。
    管线（JianyingDraftAdapter）两处都写，这里对齐它——云端以段上的引用为准，
    少这一处时即使素材 id 正确也可能不生效。
    """
    mounted = 0
    for track in tracks:
        if track.get("type") != "video":
            continue
        for seg in track.get("segments") or []:
            refs = seg.get("extra_material_refs") or []
            if trans_id and trans_id in refs:
                seg["transition"] = {"id": trans_id, "duration": duration_us}
                mounted += 1
    return mounted


def apply_catalog_effects(draft_dir, transition_picks=None, filter_pick=None):
    """就地改写草稿。返回一段可打印的变更摘要（list[str]）。"""
    path, data = _load(draft_dir)
    materials = data.get("materials")
    if materials is None:
        raise SystemExit("草稿结构异常：没有 materials")
    tracks = data.get("tracks") or []
    notes = []

    # —— 1) 转场：换成目录里的可用资源 ——
    transitions = materials.get("transitions") or []
    if transitions:
        if not transition_picks:
            raise SystemExit("草稿里有转场，但没有给可用的转场资源")
        for idx, mat in enumerate(transitions):
            pick = transition_picks[idx % len(transition_picks)]
            old_rid = mat.get("resource_id")
            duration_us = int(pick.get("defaultDurationUs") or mat.get("duration") or 500000)
            mat["resource_id"] = str(pick["resourceId"])
            # 管线：effect_id 与 resource_id 同值（19 位）。填 7 位短 id 的行为
            # 在视频特效上已被证伪（2026-10-12 A/B），转场同样按长 id 走。
            mat["effect_id"] = str(pick["resourceId"])
            mat["type"] = "dissolve"
            mat["name"] = pick.get("title") or mat.get("name") or "转场"
            mat["duration"] = duration_us
            mat["is_overlap"] = bool(pick.get("isOverlap", True))
            n = _mount_segment_transition(tracks, mat.get("id"), duration_us)
            notes.append("转场 #%d %s：%s → %s（%dms，overlap=%s，挂 %d 段）" % (
                idx, mat.get("name"), old_rid, mat["resource_id"],
                duration_us // 1000, mat["is_overlap"], n))

    # —— 2) 滤镜：补建素材 + 改挂到主轨 refs ——
    if filter_pick:
        filter_ids = []
        kept_tracks = []
        for track in tracks:
            if track.get("type") != "filter":
                kept_tracks.append(track)
                continue
            for seg in track.get("segments") or []:
                mid = seg.get("material_id")
                if mid:
                    filter_ids.append(mid)

        if not filter_ids:
            # 没有 filter 轨也允许：直接给所有视频段挂一条全片滤镜
            notes.append("草稿里没有 filter 轨，按全片滤镜新建")

        fid = "flt_" + uuid.uuid4().hex
        adjustments = [
            {"adjust_id": k, "value": float(v)}
            for k, v in sorted((filter_pick.get("adjustments") or {}).items())
        ]
        entry = {
            "id": fid,
            "type": "filter",
            "name": filter_pick.get("title") or "风格调色",
            "adjustments": adjustments,
            "enable_adjust": True,
            "source_platform": 0,
            "apply_target_type": 0,
        }
        if filter_pick.get("resourceId"):
            # 资源型：与 JianyingDraftAdapter.BuildFilterMaterial 一致
            entry["resource_id"] = str(filter_pick["resourceId"])
            entry["effect_id"] = str(filter_pick["resourceId"])
            # 🔴 path 必须存在且为空。服务端只对 materials.effects 里的滤镜做
            # 「拆桶 + 清 path」，已经写在 materials.filters 的不会被补，本地路径
            # 留在里面云端解析不到就直接不生效。
            entry["path"] = ""
            entry["value"] = 1.0
        materials.setdefault("filters", []).append(entry)

        mounted = 0
        for track in kept_tracks:
            if track.get("type") != "video":
                continue
            for seg in track.get("segments") or []:
                refs = seg.get("extra_material_refs")
                if refs is None:
                    refs = []
                    seg["extra_material_refs"] = refs
                # 去掉悬空的旧滤镜 id（素材不存在的那些）
                refs[:] = [r for r in refs if r not in filter_ids]
                if fid not in refs:
                    refs.append(fid)
                mounted += 1

        data["tracks"] = kept_tracks
        kind = ("资源型 %s" % entry["resource_id"]) if entry.get("resource_id") else \
               ("参数型（云端不调色，仅供形状实验）%s" %
                ",".join("%s=%s" % (a["adjust_id"], a["value"]) for a in adjustments))
        notes.append("滤镜 %s（%s）：挂到 %d 个视频段" % (entry["name"], kind, mounted))
        # 形态事实（2026-11-09 定案）：
        # ① 旧形态（filters 桶 + 主轨 refs + 空 path + 19 位 effect_id）云端**静默跳过**，
        #    逐像素与基线相同 —— 原因不是资源包，是 effect_id 位数；
        # ② 官方形态 = effects 桶 + 7 位短 id + /editor/effect/filter/<rid> + 独立 filter 轨，
        #    实测 R−B 由 −5.21 走到 −9.69、meanDiff 10.64（噪声基线 0.056）。
        # 这里输出旧形态，交给服务端 UpgradeFiltersToWebShape 改写（HTW_FILTER_WEB_SHAPE，
        # 默认开）；直连剪映云渲染不经服务端时，需自行写成官方形态。
        notes.append("滤镜 %s：旧形态已落盘，服务端上报前会改写为官方 Web 形态" % entry["name"])

    _save(path, data)
    return notes
