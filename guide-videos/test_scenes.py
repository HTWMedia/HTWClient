# -*- coding: utf-8 -*-
"""静态检查：所有场景函数若引用了名字 d，必须先在本函数内定义（d = H()）。
防止「预改时顶层 d 被删、场景内漏定义」这类 NameError 再烧真机录制时间。"""
import ast
import os
import sys

FILES = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "hybrid_a.py"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "hybrid_b2.py"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "hybrid_c.py"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "hybrid_02.py"),
]

bad = 0
for f in FILES:
    tree = ast.parse(open(f, encoding="utf-8").read())
    # 收集所有函数 def（含嵌套）
    fns = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef,))]
    for fn in fns:
        defined = any(isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store) and n.id == "d"
                      for n in ast.walk(fn))  # 本函数内定义（含嵌套函数内的定义，保守视作可用）
        if defined:
            continue
        # 未定义 d：检查是否引用了全局 d（模块级赋值）
        mod_global = any(isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "d" for t in n.targets)
                         for n in tree.body)
        if mod_global:
            continue
        used = any(isinstance(n, ast.Name) and n.id == "d" and isinstance(n.ctx, ast.Load)
                   for n in ast.walk(fn))
        if used:
            print(f"FAIL {os.path.basename(f)}:{fn.lineno} 函数 {fn.name} 引用 d 但未定义")
            bad += 1

if bad:
    sys.exit(1)
print("ALL PASS：无悬空 d 引用")
