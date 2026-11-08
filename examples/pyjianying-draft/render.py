#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把一条剪映草稿目录提交给 HTW 云端渲染，拿回 mp4。只用标准库。

    python render.py --draft ./drafts/pjy-demo --cookie-file ./jy-cookie.txt --out ./out

两个凭据是两回事，别混：
  AuthKey    — HTW 平台账号，环境变量 HTW_API_KEY 或 --key，计费用
  剪映 Cookie — 你自己的剪映登录态，服务端拿它代跑渲染，用完不落盘
"""

import argparse
import http.client
import json
import os
import shutil
import time
import urllib.parse
import urllib.request
import zipfile

DEFAULT_BASE = "https://htwmedia.dpdns.org"
TERMINAL_FAILED = ("failed", "cancelled")


def log(msg):
    print(msg, flush=True)


def clean_cookie(value):
    """从浏览器开发者工具复制来的经常带 "Cookie: " 前缀和换行，服务端只认成对的值。"""
    text = (value or "").strip()
    if text.lower().startswith("cookie:"):
        text = text[len("cookie:"):]
    return " ".join(text.replace("\r", " ").replace("\n", " ").replace("\t", " ").split())


def zip_draft(draft_dir, keep_zip):
    if not os.path.isfile(os.path.join(draft_dir, "draft_content.json")):
        raise SystemExit("这个目录里没有 draft_content.json，不是草稿目录: {}".format(draft_dir))

    zip_path = os.path.abspath(draft_dir.rstrip("\\/") + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(draft_dir):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git")]
            for name in files:
                if name in (".DS_Store", "Thumbs.db"):
                    continue
                full = os.path.join(root, name)
                zf.write(full, os.path.relpath(full, draft_dir))
    if not keep_zip:
        return zip_path, True
    return zip_path, False


class _ConcatReader:
    """把 头 + 文件 + 尾巴 拼成一个可 read() 的流，避免把几百 MB 的 zip 读进内存。"""

    def __init__(self, *parts):
        self.parts = list(parts)
        self.index = 0
        self.offset = 0

    def read(self, size=-1):
        if size is None or size < 0:
            size = 1 << 20
        out = bytearray()
        while len(out) < size and self.index < len(self.parts):
            part = self.parts[self.index]
            if isinstance(part, (bytes, bytearray)):
                if self.offset < len(part):
                    chunk = part[self.offset:self.offset + (size - len(out))]
                    out += chunk
                    self.offset += len(chunk)
                if self.offset >= len(part):
                    self.index += 1
                    self.offset = 0
            else:
                chunk = part.read(size - len(out))
                if chunk:
                    out += chunk
                else:
                    self.index += 1
                    self.offset = 0
        return bytes(out)


def submit(base, api_key, zip_path, cookie):
    url = urllib.parse.urlparse(base.rstrip("/") + "/api/v2/edit/draft-export")
    conn_cls = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(url.hostname, url.port, timeout=600)

    boundary = "----htwpy" + os.urandom(8).hex()
    safe_name = os.path.basename(zip_path).encode("ascii", "ignore").decode() or "draft.zip"
    head = (
        "--{0}\r\nContent-Disposition: form-data; name=\"jianyingCookie\"\r\n\r\n{1}\r\n"
        "--{0}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{2}\"\r\n"
        "Content-Type: application/octet-stream\r\n\r\n"
    ).format(boundary, cookie, safe_name).encode("utf-8")
    tail = "\r\n--{}--\r\n".format(boundary).encode("ascii")
    size = os.path.getsize(zip_path)

    with open(zip_path, "rb") as fh:
        body = _ConcatReader(head, fh, tail)
        conn.request(
            "POST",
            url.path,
            body=body,
            headers={
                "AuthKey": api_key,
                "X-App-Source": "HTWClient",
                "Content-Type": "multipart/form-data; boundary=" + boundary,
                "Content-Length": str(len(head) + size + len(tail)),
            },
        )
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8", "replace")
    conn.close()

    try:
        return resp.status, json.loads(raw)
    except ValueError:
        return resp.status, {"Ok": False, "ErrMsg": raw[:400] or "HTTP {}".format(resp.status)}


def api_get(base, api_key, path):
    req = urllib.request.Request(
        base.rstrip("/") + path, headers={"AuthKey": api_key, "X-App-Source": "HTWClient"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def explain(http_status, body):
    code = body.get("ErrCode") or http_status
    msg = body.get("ErrMsg") or body.get("error") or "未知错误"
    hints = {
        400: "草稿包不合规（没有 draft_content.json）或缺剪映 Cookie",
        401: "AuthKey 无效或未认证",
        402: "免费额度用尽（成片时长按月计算，只在真正出片时扣）",
        410: "站点还停在「仅本地实例执行」的旧版本，需要服务端升级",
        429: "并发任务已达上限或提交过于频繁，等一会再试",
    }
    hint = hints.get(code)
    return "提交失败（{}）: {}{}".format(code, msg, "  ← " + hint if hint else "")


def wait(base, api_key, task_id, interval, timeout):
    started = time.time()
    last = None
    while True:
        data = api_get(base, api_key, "/api/v2/edit/draft-status/" + urllib.parse.quote(task_id))
        if data.get("Ok") is False:
            return False, data.get("ErrMsg") or "查询进度失败", {}
        payload = data.get("Data") or {}
        status = payload.get("status") or ""
        shown = "{} {}".format(status, "{}%".format(payload.get("progress")) if payload.get("progress") is not None else "").strip()
        if shown != last:
            step = payload.get("currentStep")
            log("  任务状态: {}{}".format(shown, " · " + step if step else ""))
            last = shown
        if status == "completed":
            return True, "", payload
        if status in TERMINAL_FAILED:
            return False, payload.get("error") or "任务{}".format(status), payload
        if time.time() - started > timeout:
            return False, "等待超时，任务可能还在服务端跑", payload
        time.sleep(interval)


def download(base, api_key, url, dest):
    absolute = url if url.lower().startswith(("http://", "https://")) else base.rstrip("/") + (
        url if url.startswith("/") else "/" + url
    )
    req = urllib.request.Request(absolute, headers={"AuthKey": api_key})
    with urllib.request.urlopen(req, timeout=600) as resp, open(dest, "wb") as out:
        shutil.copyfileobj(resp, out)
    return os.path.getsize(dest)


def main(argv=None):
    parser = argparse.ArgumentParser(description="剪映草稿目录 → HTW 云端渲染 → mp4")
    parser.add_argument("--draft", required=True, help="草稿目录（含 draft_content.json）")
    parser.add_argument("--key", default=os.environ.get("HTW_API_KEY", ""), help="HTW AuthKey，默认读 HTW_API_KEY")
    parser.add_argument("--cookie", default=os.environ.get("HTW_JIANYING_COOKIE", ""), help="剪映 Cookie（整段）")
    parser.add_argument("--cookie-file", help="从文件读剪映 Cookie，避免落进 shell 历史")
    parser.add_argument("--base", default=os.environ.get("HTW_BASE", DEFAULT_BASE), help="接口基地址")
    parser.add_argument("--out", default="./out", help="成片输出目录")
    parser.add_argument("--interval", type=float, default=5.0, help="轮询间隔（秒）")
    parser.add_argument("--timeout", type=float, default=45 * 60, help="最长等待（秒）")
    parser.add_argument("--no-wait", action="store_true", help="提交后立刻返回 taskId")
    parser.add_argument("--keep-zip", action="store_true", help="保留打包出的 zip")
    args = parser.parse_args(argv)

    api_key = (args.key or "").strip()
    if not api_key:
        raise SystemExit("缺少 AuthKey：设 HTW_API_KEY 或传 --key（https://htwmedia.dpdns.org 邮箱申领）")

    cookie = clean_cookie(args.cookie)
    if args.cookie_file:
        with open(args.cookie_file, "r", encoding="utf-8") as fp:
            cookie = clean_cookie(fp.read())
    if "=" not in cookie:
        raise SystemExit(
            "缺少剪映 Cookie：草稿渲染用你自己的剪映账号，--cookie 或 --cookie-file 必填。\n"
            "  取法：浏览器登录剪映网页版 → F12 → Network → 任意请求 → 复制 Request Headers 里 Cookie 整段"
        )

    draft_dir = os.path.abspath(args.draft)
    zip_path, remove_after = zip_draft(draft_dir, args.keep_zip)
    log("已打包 {} ({:.1f} MB)".format(os.path.basename(zip_path), os.path.getsize(zip_path) / 1048576))

    try:
        log("提交到 {} …".format(args.base))
        http_status, body = submit(args.base, api_key, zip_path, cookie)
        if body.get("Ok") is False or http_status >= 400:
            raise SystemExit(explain(http_status, body))

        task_id = body.get("TaskId") or (body.get("Data") or {}).get("taskId")
        if not task_id:
            raise SystemExit("服务端没返回 taskId: " + json.dumps(body, ensure_ascii=False)[:300])
        log("已提交，taskId={}".format(task_id))

        warnings = (body.get("Data") or {}).get("warnings") or []
        if warnings:
            log("  警告 {} 条（素材缺失等），仍会继续渲染：".format(len(warnings)))
            for item in warnings:
                files = item.get("Files") or item.get("files") or []
                log("    {}: {}".format(item.get("Type") or item.get("type"), ", ".join(files[:5])))

        if args.no_wait:
            log("不等待。之后可查: GET {}/api/v2/edit/draft-status/{}".format(args.base, task_id))
            return

        ok, error, payload = wait(args.base, api_key, task_id, args.interval, args.timeout)
        if not ok:
            log("\n渲染失败: {}".format(error))
            if payload.get("downloadUrl"):
                log("部分产物: " + payload["downloadUrl"])
            raise SystemExit(1)

        url = payload.get("downloadUrl")
        if not url:
            raise SystemExit("任务完成但没拿到成片地址: " + json.dumps(payload, ensure_ascii=False)[:300])

        os.makedirs(args.out, exist_ok=True)
        stamp = time.strftime("%Y%m%d%H%M%S")
        dest = os.path.join(os.path.abspath(args.out), "{}-成片-{}.mp4".format(os.path.basename(draft_dir), stamp))
        log("下载成片 …")
        size = download(args.base, api_key, url, dest)
        log("\n完成: {} ({:.1f} MB)".format(dest, size / 1048576))
    finally:
        if remove_after and os.path.exists(zip_path):
            os.remove(zip_path)


if __name__ == "__main__":
    main()
