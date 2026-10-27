# -*- coding: utf-8 -*-
"""pipeline.tts 验证：短文本 / 超长文本分段 / AuthKey 缺失报错。RED 时应 ImportError。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pipeline


def test_short():
    out = os.path.join(tempfile.gettempdir(), "opencode", "_tt_short.mp3")
    d = pipeline.tts("接口验证短句。", out)
    assert d > 0, f"短文本时长 {d}"


def test_long():
    out = os.path.join(tempfile.gettempdir(), "opencode", "_tt_long.mp3")
    text = "这是一段用于验证超长文本分段合成的旁白，包含多个分句。" * 12  # ~600 字
    d = pipeline.tts(text, out)
    assert d > 15, f"超长文本时长 {d}（应远大于短句）"


def test_no_authkey():
    saved = pipeline.TTS_CONFIG
    pipeline.TTS_CONFIG = r"C:\nonexistent\htw-config.json"
    try:
        pipeline.tts("测试", os.path.join(tempfile.gettempdir(), "opencode", "_t3.mp3"))
        raise AssertionError("AuthKey 缺失应报 RuntimeError")
    except RuntimeError as ex:
        assert "AuthKey" in str(ex) or "apiKey" in str(ex), f"报错信息不明确: {ex}"
    finally:
        pipeline.TTS_CONFIG = saved


if __name__ == "__main__":
    for name, fn in [("short", test_short), ("long", test_long), ("no_authkey", test_no_authkey)]:
        fn()
        print(f"PASS {name}")
    print("ALL PASS")
