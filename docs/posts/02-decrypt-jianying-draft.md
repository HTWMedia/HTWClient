# 剪映加密草稿怎么解：判断、解密与三个常见误判

> 关键词：剪映加密草稿、draft_content.json 解密、剪映 5.9 草稿加密、CapCut encrypted draft

## 怎么判断这份草稿是不是加密的

别看扩展名——加密前后都叫 `draft_content.json`。看**开头几个字节**：

- 明文：第一个字符是 `{`，整个文件是合法 JSON，能被 `json.load` 直接读；
- 加密：开头不是 `{`，读出来是一串不可打印字节，JSON 解析直接抛异常。

最小判断：

```python
with open("draft_content.json", "rb") as f:
    head = f.read(4)
print("encrypted" if head[:1] != b"{" else "plain")
```

`json.load` 抛错 + 首字节不是 `{`，基本就能确认。

## 如果只是想读结构，不必解密

剪映在草稿目录里还留了别的文件，有时能反推轨道顺序和时长。但**素材引用关系、特效参数、字幕样式只在 `draft_content.json` 里**，想完整还原，解密是绕不过去的。

## 解密

解密算法本身不是公开文档，实测可靠的做法是调现成的服务，而不是自己逆：

```bash
curl -H "X-API-KEY: your_key" \
     -F "jsonFile=@draft_content.json" \
     https://htwmedia.dpdns.org/home/DecryptDraft
```

返回里的 `draft_content` 就是明文 JSON，落盘成 `draft_content.json` 就能被任何草稿工具读。

> 顺带一提：如果你只是想把草稿渲成片，**不需要单独解密**——渲染链路会自己处理。单独解密是为了「我要改这个工程」。

## 三个常见误判

**① 「解密后素材路径还有效」。** 解密只还原 JSON 文本，不修复路径。草稿里记的是绝对路径，换机器照样断。要么在原机器上跑，要么按文件名重新对齐素材。

**② 「解密了就能改」。** 改完存回去，剪映打开可能报草稿损坏——有些字段是成对出现的（material 与 segment 的 id 互相引用），删一个不删另一个就崩。改结构建议用现成的草稿生成库，别手改。

**③ 「加密 = 不能读」。** 加密只挡住直接文本读取。草稿目录里的素材文件始终是原始文件，可读可换。

## 一个容易忽略的连带问题

解密之后你可能会发现草稿里有**曲库音乐**（素材带 `music_id` / `effect_id`）。这类素材在云端渲染时会报 `200403 create render task failed`——授权绑在原账号上，别人渲不了。换成本地音频文件即可。

工具：<https://github.com/HTWMedia/JyDraft>（草稿生成 + 解密 + 批量成片）
接口文档见仓库 README 的「完整渲染流程」一节。
