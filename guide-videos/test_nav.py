# -*- coding: utf-8 -*-
"""验证 nav() 在 detach 后可安全回退（Task 2 RED→GREEN 用）。
通过 monkeypatch pdrive.click 强制走 nav 的 except 回退分支。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdrive

pdrive.click = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("force-fallback"))

from hcdp import H  # noqa: E402

d = H()
d.detach()          # 复现悬空：click_btn_text 之后 c 为 None
d.nav("edit")       # 修复前：NoneType has no attribute 'ev'
active = d.read('(document.querySelector(".panel.active")||{}).id')
print("active:", active)
assert active == "panel-edit", f"导航未到 edit: {active}"
print("PASS nav-after-detach")
