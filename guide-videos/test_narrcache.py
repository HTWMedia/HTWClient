# -*- coding: utf-8 -*-
"""phys 旁白缓存验证：同文本复用已有音频（不再调 tts）；文本变化才重新合成。
RED：_ensure_narration 尚不存在。"""
import os
import sys
import shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import phys

WORK = os.path.join(os.environ.get("TEMP", r"C:\Users\kunni\AppData\Local\Temp"),
                    "opencode", "t_narrcache")
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work", "h03", "narr_00.mp3")


def _reset():
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)


def _fake_tts(calls):
    """写真实 mp3（复制现成旁白）并返回其真实时长——模拟 tts 的完整副作用"""
    def fake(text, out, spd=4):
        calls.append(text)
        shutil.copy(SRC, out)
        return phys.audio_len(out)
    return fake


def test_cache_hit_no_tts():
    _reset()
    calls = []
    orig = phys.tts
    phys.tts = _fake_tts(calls)
    try:
        sc = {"narr": "同一句旁白。"}
        p1 = phys._ensure_narration(sc, 0, WORK)   # 首次：合成
        assert calls, "首次应调用 tts"
        assert os.path.exists(p1)
        calls.clear()
        sc2 = {"narr": "同一句旁白。"}
        p2 = phys._ensure_narration(sc2, 0, WORK)  # 同文本：命中缓存
        assert p2 == p1, f"同文本应复用同一文件: {p1} vs {p2}"
        assert not calls, "缓存命中不应再调 tts"
        assert abs(sc2["narr_dur"] - sc["narr_dur"]) < 1e-6
    finally:
        phys.tts = orig


def test_text_change_resynthesizes():
    _reset()
    calls = []
    orig = phys.tts
    phys.tts = _fake_tts(calls)
    try:
        phys._ensure_narration({"narr": "旧文案。"}, 0, WORK)
        calls.clear()
        phys._ensure_narration({"narr": "新文案不一样。"}, 0, WORK)
        assert calls, "文本变化必须重新合成"
    finally:
        phys.tts = orig


def test_index_isolation():
    _reset()
    calls = []
    orig = phys.tts
    phys.tts = _fake_tts(calls)
    try:
        a = phys._ensure_narration({"narr": "场景零。"}, 0, WORK)
        b = phys._ensure_narration({"narr": "场景零。"}, 1, WORK)
        assert a != b, "不同场景序号不得共享缓存文件"
    finally:
        phys.tts = orig


if __name__ == "__main__":
    test_cache_hit_no_tts()
    print("PASS cache_hit_no_tts")
    test_text_change_resynthesizes()
    print("PASS text_change_resynthesizes")
    test_index_isolation()
    print("PASS index_isolation")
    print("ALL PASS")
