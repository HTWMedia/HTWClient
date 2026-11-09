#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""特效资源目录：把「渲染得出来」的 19 位资源 id 供给草稿。

## 为什么需要这一层

pyJianYingDraft 自带的 `FilterType` / `TransitionType` 元数据是**某个版本的快照**，
里面的 `resource_id` 会过期：云端按 id 找不到资源时**不会报错**，只会安静地
渲出「没效果」（滤镜）或「整段黑场」（转场）。实测两条：

| 名称 | pyJianYingDraft 内置 id | 2026-10-11 现采 id | 结果 |
| --- | --- | --- | --- |
| 滤镜 冷蓝 | 7127618237117877518 | 7083947556689941028 | 旧 id 无像素变化 |
| 转场 叠化 | 6724845717472416269 | （无，叠化类全部 VIP） | 旧 id 整段黑场 |

本模块只做两件事：按名字/分类挑一条**非 VIP** 资源，返回它的 id 与元数据。
草稿形态的改写由 `apply_catalog_effects()` 负责（见 build_complex.py）。

## 数据来源

优先读 HTWCore.Web 仓库里 2026-10-11 现采的目录：

    Services/Editing/TransitionCatalog.json   503 条
    Services/Editing/FilterCatalog.json       240 条

找不到就用下面 FALLBACK 里的小表（条目少但都实测/现采过）。
"""

import io
import json
import os

# 现采目录的默认探测位置（跨仓库，找不到不算错）
DEFAULT_CATALOG_DIRS = (
    os.environ.get("HTW_EDITING_DIR", ""),
    r"D:\HTWCore.Web\Services\Editing",
)

# 兜底小表。⚠️ 每条都必须能追到出处，别凭猜加 id。
FALLBACK_TRANSITIONS = [
    # 2026-10-11 Probe A 实机渲染通过：成片里能看到资源自带的旋转扫屏动效
    {"title": "中心旋转", "resourceId": "6858191434294497805",
     "defaultDurationUs": 500000, "isOverlap": False, "category": "MG动画"},
    # isOverlap=True 的非 VIP 样本（叠化类目前全部 VIP，只能拿它验重叠型）
    {"title": "复古放映", "resourceId": "7237068402945167909",
     "defaultDurationUs": 600000, "isOverlap": True, "category": "拍摄"},
    {"title": "向右流动", "resourceId": "6858191483573375495",
     "defaultDurationUs": 500000, "isOverlap": False, "category": "MG动画"},
]

FALLBACK_FILTERS = [
    {"title": "冷蓝", "resourceId": "7083947556689941028", "effectId": "2938823", "category": "selected"},
    {"title": "亮肤", "resourceId": "7065993373412233741", "effectId": "2938869", "category": "selected"},
    {"title": "净白", "resourceId": "7078652411866255886", "effectId": "2938814", "category": "selected"},
]

# 参数型滤镜配方（无 resource_id，全靠 adjustments）。值域 -1..1。
#
# 🔴 已证伪（2026-11-09 像素 A/B）：这一类**云端不会调色**。
#    不论放 materials.filters 还是 effects、挂主轨 refs 还是独立 filter 轨，
#    成片与无滤镜基线 meanDiff 都只有 0.054（编码噪声）；官方 Web 草稿的
#    materials 桶里既没有 filters 也没有 adjusts。
#    见 `docs/2026-10-11-style-filter-protocol.md` 第七节；服务端
#    `EditingPlaybookLoader` 已拒绝加载被启用的纯参数滤镜节。
#
# 保留原因：仅供「草稿形状」实验与历史兼容。pick_filter 目前仍会优先匹配
# 这里的名字（历史行为，本次未改动）；要出效果请传资源型标题
# （如「冷蓝」「彩果」，目录里带 7 位短 effectId）。
PARAM_FILTERS = {
    "冷调": {"brightness": -0.02, "contrast": 0.05, "saturation": -0.10},
    "暖调": {"brightness": 0.03, "contrast": 0.03, "warmth": 0.12},
    "高对比": {"brightness": 0.0, "contrast": 0.14, "saturation": 0.08},
    "淡雅": {"brightness": 0.04, "contrast": 0.03, "saturation": 0.08},
}


def _read_entries(path):
    try:
        with io.open(path, "r", encoding="utf-8") as fp:
            return json.load(fp).get("entries") or []
    except (IOError, ValueError):
        return []


def _resolve_dir(explicit=None):
    for cand in ((explicit,) + DEFAULT_CATALOG_DIRS):
        if cand and os.path.isfile(os.path.join(cand, "TransitionCatalog.json")):
            return cand
    return None


def load_catalogs(catalog_dir=None):
    """返回 (transitions, filters)。目录缺失时回落到 FALLBACK。"""
    found = _resolve_dir(catalog_dir)
    if found:
        trans = _read_entries(os.path.join(found, "TransitionCatalog.json"))
        filt = _read_entries(os.path.join(found, "FilterCatalog.json"))
        if trans and filt:
            return trans, filt, found
    return list(FALLBACK_TRANSITIONS), list(FALLBACK_FILTERS), ""


def _match(entries, title, allow_vip=False):
    """按标题精确 → 包含 → 分类 三级匹配，跳过 VIP。

    返回 (hit, reason)。reason 用于把「为什么没选中」讲清楚——
    静默回落到默认值是最难查的一类问题。
    """
    pool = [e for e in entries if allow_vip or e.get("isVip") is not True]
    for e in pool:
        if (e.get("title") or "") == title:
            return e, ""
    for e in pool:
        if title and title in (e.get("title") or ""):
            return e, ""
    for e in pool:
        if title and (e.get("category") or "") == title:
            return e, ""
    vip_hit = any((e.get("title") or "") == title for e in entries)
    if vip_hit:
        return None, "「%s」是 VIP 资源，云端会拒绝或渲不出来" % title
    return None, "目录里没有「%s」" % title


def pick_transition(title, catalog_dir=None, allow_vip=False):
    """按名字挑一条转场。返回 dict，字段与目录条目同构。"""
    trans, _filt, _dir = load_catalogs(catalog_dir)
    hit, reason = _match(trans, title, allow_vip)
    if hit is None:
        names = [e.get("title") for e in trans if e.get("isVip") is not True][:12]
        raise SystemExit("转场选型失败：%s。可选：%s" % (reason, " / ".join(str(n) for n in names)))
    return hit


def pick_filter(title, catalog_dir=None, allow_vip=False):
    """按名字挑一条滤镜。

    ⚠️ 历史遗留的匹配顺序：先查 `PARAM_FILTERS`（参数型），没有再查资源型目录。
    参数型已于 2026-11-09 用像素 A/B 证伪（云端不调色），**新脚本不要用**；
    这里保留只为不破坏既有命令。要出效果请传资源型标题（如「冷蓝」）。
    返回的 dict 里：
      * 参数型：`{"title", "adjustments": {key: value}}` —— 云端无效
      * 资源型：`{"title", "resourceId", "effectId", ...}` —— 经服务端改写后有效

    ⚠️ 资源型 id 取自 `FilterCatalog.json`，这批精选通道 id 在 artist 接口
    （`mget_artist_item`）里查不到。2026-11-09 定案：滤镜**是能出效果的**，
    之前不出效果是草稿形态问题（位置、`effect_id` 位数、`path`、挂接方式），
    与这批 id 无关，也与资源包无关。走服务端导出时会自动改写为官方形态；
    直连剪映云渲染需自己按官方形态写，见 README「滤镜」一节。
    """
    if title in PARAM_FILTERS:
        return {"title": title, "adjustments": dict(PARAM_FILTERS[title])}

    _trans, filt, _dir = load_catalogs(catalog_dir)
    hit, reason = _match(filt, title, allow_vip)
    if hit is None:
        names = list(PARAM_FILTERS.keys()) + [
            e.get("title") for e in filt if e.get("isVip") is not True][:10]
        raise SystemExit("滤镜选型失败：%s。可选：%s" % (reason, " / ".join(str(n) for n in names)))
    return hit


def describe(catalog_dir=None):
    """给 --list-fx 用：打印可选转场与滤镜。"""
    trans, filt, found = load_catalogs(catalog_dir)
    lines = ["目录来源：%s" % (found or "内置 FALLBACK（未找到 Services/Editing）")]
    ok_t = [e for e in trans if e.get("isVip") is not True]
    ok_f = [e for e in filt if e.get("isVip") is not True]
    lines.append("转场 %d 条可选（总 %d）：" % (len(ok_t), len(trans)))
    for e in ok_t[:40]:
        lines.append("  %-8s %s  overlap=%s  dur=%sms  [%s]" % (
            e.get("category") or "", e.get("title"), e.get("isOverlap"),
            int((e.get("defaultDurationUs") or 0) // 1000), e.get("resourceId")))
    lines.append("滤镜 %d 条资源型可选（总 %d）：" % (len(ok_f), len(filt)))
    for e in ok_f[:40]:
        lines.append("  %-8s %s  %s / %s" % (
            e.get("category") or "", e.get("title"), e.get("resourceId"), e.get("effectId")))
    lines.append("参数型滤镜（历史遗留，2026-11-09 像素 A/B 证伪：云端不调色，仅供形状实验）：")
    for name, adj in PARAM_FILTERS.items():
        lines.append("  %-6s %s" % (name, ", ".join("%s=%s" % kv for kv in adj.items())))
    return "\n".join(lines)
