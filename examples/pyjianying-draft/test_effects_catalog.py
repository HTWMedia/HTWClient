#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""选型层回归：只放行「云端真的会出效果」的滤镜。

自包含，不依赖服务端仓库，也不需要 pyJianYingDraft：

    python -m unittest -v test_effects_catalog.py

背景：2026-11-09 用 26 段同源云渲染把 25 条精选（7 位短 effectId）逐条
做了像素 A/B，25/25 生效；19 位 effectId 的 artist 滤镜一律被云端静默跳过。
`FilterCatalog.json` 里有 4 条标着「非 VIP」却是长 id，以前 `--list-fx` 会把它们
列成可选资源，选了就渲出一张没调色的成片且不报错。这里把闸门钉死。
"""

import contextlib
import io
import json
import os
import tempfile
import unittest

import effects_catalog as fx


FILTERS = [
    {"title": "净透", "resourceId": "7085360406423671303", "effectId": "2938816",
     "category": "selected"},
    # 三条非 VIP 但 19 位长 id：正是历史上被误列为「可选」的那一族
    {"title": "日落飞车", "resourceId": "7505662247407013135",
     "effectId": "7505662247407013135", "category": "秋日"},
    {"title": "空灵", "resourceId": "7353555308448419098",
     "effectId": "7353555308448419098", "category": "秋日"},
    {"title": "高清冬日", "resourceId": "7450317804554685708",
     "effectId": "7450317804554685708", "category": "高清"},
    {"title": "VIP短id", "resourceId": "111", "effectId": "1234567",
     "isVip": True, "category": "测试"},
]

TRANSITIONS = [
    {"title": "中心旋转", "resourceId": "6858191434294497805",
     "defaultDurationUs": 500000, "isOverlap": False, "category": "MG动画"},
]


class FilterSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = cls.tmp.name
        for name, entries in (("FilterCatalog.json", FILTERS),
                              ("TransitionCatalog.json", TRANSITIONS)):
            with io.open(os.path.join(cls.dir, name), "w", encoding="utf-8") as fp:
                json.dump({"entries": entries}, fp, ensure_ascii=False)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_short_id_filter_is_selectable(self):
        hit = fx.pick_filter("净透", self.dir)
        self.assertEqual("2938816", str(hit["effectId"]))
        self.assertTrue(fx.is_usable_filter(hit))

    def test_long_id_filter_is_rejected_loudly(self):
        # 不能静默返回：否则成片没调色，只能靠抽帧才发现
        with self.assertRaises(SystemExit) as ctx:
            fx.pick_filter("日落飞车", self.dir)
        msg = str(ctx.exception)
        self.assertIn("19 位", msg)
        self.assertIn("静默跳过", msg)

    def test_vip_filter_is_rejected(self):
        with self.assertRaises(SystemExit) as ctx:
            fx.pick_filter("VIP短id", self.dir)
        self.assertIn("VIP", str(ctx.exception))

    def test_param_filter_still_works_but_warns(self):
        # 历史命令兼容：仍返回配方，但必须在 stderr 点名「已证伪」
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            hit = fx.pick_filter("冷调", self.dir)
        self.assertIn("adjustments", hit)
        self.assertNotIn("resourceId", hit)
        self.assertIn("已证伪", err.getvalue())

    def test_describe_lists_only_usable_filters(self):
        out = fx.describe(self.dir)
        self.assertIn("滤镜 1 条可用", out)
        self.assertIn("另有 4 条不可用", out)
        # 可用清单行形如「  category title  rid / eid」，长 id 不该混进去
        usable_lines = [
            line for line in out.splitlines()
            if line.startswith("  ") and " / " in line and "其中" not in line
        ]
        self.assertEqual(1, len(usable_lines), out)
        self.assertIn("2938816", usable_lines[0])

    def test_is_usable_filter_boundaries(self):
        self.assertTrue(fx.is_usable_filter({"effectId": "1234567"}))
        self.assertTrue(fx.is_usable_filter({"effectId": "12345678"}))
        self.assertFalse(fx.is_usable_filter({"effectId": "123456789"}))
        self.assertFalse(fx.is_usable_filter({"effectId": ""}))
        self.assertFalse(fx.is_usable_filter({}))
        self.assertFalse(fx.is_usable_filter({"effectId": "1234567", "isVip": True}))
        self.assertTrue(fx.is_usable_filter(
            {"effectId": "1234567", "isVip": True}, allow_vip=True))

    def test_fallback_catalog_has_only_short_ids(self):
        # 找不到 Services/Editing 时也不能给出无效 id
        self.assertTrue(fx.FALLBACK_FILTERS)
        for entry in fx.FALLBACK_FILTERS:
            self.assertTrue(fx.is_usable_filter(entry), entry)


if __name__ == "__main__":
    unittest.main()
