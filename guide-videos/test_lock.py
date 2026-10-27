# -*- coding: utf-8 -*-
"""phys 录制互斥锁验证：可获取 / 重复获取报错 / 释放后可再获取。RED：函数尚不存在。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import phys


def main():
    name = "t_lock_test"
    p1 = phys._rec_lock(name)
    assert os.path.exists(p1), "锁文件未创建"
    try:
        phys._rec_lock(name)
        raise AssertionError("重复获取应报 RuntimeError")
    except RuntimeError:
        pass
    phys._rec_unlock(p1)
    assert not os.path.exists(p1), "释放后锁文件应删除"
    p2 = phys._rec_lock(name)
    phys._rec_unlock(p2)
    print("PASS lock acquire/exclude/release")
    print("ALL PASS")


if __name__ == "__main__":
    main()
