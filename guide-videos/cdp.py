# -*- coding: utf-8 -*-
"""极简 CDP 驱动：连接 Electron 渲染进程，evaluate JS / 设置文件输入 / 截图"""
import json, time, urllib.request
import websocket

import os as _os
DEBUG = _os.environ.get("HTW_CDP", "http://127.0.0.1:9222")

def page_ws():
    last = []
    for _ in range(30):
        try:
            tabs = json.load(urllib.request.urlopen(DEBUG + "/json", timeout=4))
            pages = [t for t in tabs if t.get("type") == "page"]
            # 标题匹配优先；渲染器忙时标题可能瞬时为空 —— 应用只有一个页面目标，
            # 退化为取第一个 page（锁屏/忙时也能连上）。
            hit = [t for t in pages if "工作台" in (t.get("title") or "")]
            if hit:
                return hit[0]["webSocketDebuggerUrl"]
            if len(pages) == 1:
                return pages[0]["webSocketDebuggerUrl"]
            last = [(t.get("title") or "")[:20] for t in pages]
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("找不到工作台页面, 可见页面: " + repr(last))

class CDP:
    def __init__(self):
        self.ws = None
        self.mid = 0
        self._connect()
    def _connect(self):
        self.ws = websocket.create_connection(page_ws(), timeout=600,
                                              enable_multithread=True)
    def cmd(self, method, **params):
        self.mid += 1
        mid = self.mid
        payload = json.dumps({"id": mid, "method": method, "params": params})
        try:
            self.ws.send(payload)
            while True:
                msg = json.loads(self.ws.recv())
                if msg.get("id") == mid:
                    if "error" in msg:
                        raise RuntimeError(method + ": " + str(msg["error"]))
                    return msg.get("result", {})
        except (websocket.WebSocketException, OSError, TimeoutError) as ex:
            # 断线自动重连一次（CDP 无状态，重发安全）
            print(f"  [CDP 断线重连] {type(ex).__name__}: {ex}")
            try:
                self.ws.close()
            except Exception:
                pass
            self._connect()
            self.ws.send(payload)
            while True:
                msg = json.loads(self.ws.recv())
                if msg.get("id") == mid:
                    if "error" in msg:
                        raise RuntimeError(method + ": " + str(msg["error"]))
                    return msg.get("result", {})
    def ev(self, js):
        r = self.cmd("Runtime.evaluate", expression=js, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            raise RuntimeError("JS 异常: " + json.dumps(r["exceptionDetails"])[:400])
        return r.get("result", {}).get("value")
    def set_file(self, selector, files):
        doc = self.cmd("DOM.getDocument")
        node = self.cmd("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector=selector)["nodeId"]
        if not node:
            raise RuntimeError("找不到 " + selector)
        self.cmd("DOM.setFileInputFiles", files=files, nodeId=node)
    def close(self):
        self.ws.close()

if __name__ == "__main__":
    c = CDP()
    print(c.ev("document.title"))
