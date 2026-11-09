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

# 参数型滤镜配方（无 resource_id，全靠 adjustments）。
#
# 🔴 为什么它是**默认**：资源型滤镜（19 位 resource_id）在剪同款管线里只有
# 「单个滤镜可渲染成功」的口头记录，从没做过 A/B 对照；实际拿现采 id 跑，
# 成片与无滤镜基线**逐像素相同**（同一帧 md5 一致）。参数型则被 Probe A
# 实机验证过（`docs/2026-10-11-style-filter-protocol.md` 二·参数型）。
# 值域都是 -1..1。
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

    先查参数型配方（`PARAM_FILTERS`，零资源依赖、实机验证过），
    没有再查资源型目录。返回的 dict 里：
      * 参数型：`{"title", "adjustments": {key: value}}`
      * 资源型：`{"title", "resourceId", "effectId", ...}`

    ⚠️ 资源型 id 取自 `FilterCatalog.json`，这批精选通道 id 在 artist 接口
    （`mget_artist_item`）里查不到，且实测**渲不成**——换 artist 活 id 也一样。
    根因是滤镜资源包（3D LUT）没有上传，见 README「滤镜」一节。选资源型时
    只把它当作「写进草稿的配置」，不要期待成片有色偏。
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
    lines.append("参数型滤镜（推荐，实机验证过）：")
    for name, adj in PARAM_FILTERS.items():
        lines.append("  %-6s %s" % (name, ", ".join("%s=%s" % kv for kv in adj.items())))
    return "\n".join(lines)
