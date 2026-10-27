# -*- coding: utf-8 -*-
"""phys.type_field / phys.clear_card_results 验证（真实 UI 上演练，输入值与 02 录制值一致）。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HTW_CDP", "http://127.0.0.1:9223")

import phys  # noqa: E402
from hcdp import H  # noqa: E402


def main():
    d = H()
    d.nav("edit")
    d.scroll_card("panel-edit", "视频粗剪 Coarse-cut")
    # 真实输入：先填一个错值，再 type_field 覆盖
    d.c.ev('''(() => {
      const w = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const i = document.getElementById("edit-coarse-min");
      w.call(i, "99"); i.dispatchEvent(new Event("input", {bubbles: true}));
      return "ok";
    })()''')
    phys.type_field(d, "panel-edit", "edit-coarse-min", "5")
    got = d.read('document.getElementById("edit-coarse-min").value')
    assert got == "5", f"type_field 未生效: {got!r}"
    print("PASS type_field")

    # 清场：先注入一条假结果，clear 后应检测不到
    d.attach()
    d.c.ev('''(() => {
      const card = [...document.querySelectorAll("#panel-edit .card")].find(k => {
        const h = k.querySelector("h3"); return h && h.textContent.includes("视频粗剪");
      });
      const div = document.createElement("div");
      div.textContent = "fake-result-xyz";
      card.appendChild(div);
      return "ok";
    })()''')
    d.detach()
    r = phys.clear_card_results(d, "panel-edit", ["视频粗剪"])
    print("clear:", r)
    d.attach()
    left = d.read('''(() => {
      const card = [...document.querySelectorAll("#panel-edit .card")].find(k => {
        const h = k.querySelector("h3"); return h && h.textContent.includes("视频粗剪");
      });
      if (!card) return "nocard";
      return [...card.children].filter(c => c.tagName === "DIV"
        && !c.querySelector("button") && !c.querySelector("input") && !c.querySelector("h3")
        && c.textContent.trim().length > 0).length;
    })()''')
    d.detach()
    assert str(left) == "0", f"清场后仍有残留: {left}"
    print("PASS clear_card_results")
    print("ALL PASS")


if __name__ == "__main__":
    main()
