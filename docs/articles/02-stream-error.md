---
title: HTTP 200 也可能是失败：上游把错误藏在响应流里
platforms:
  掘金: HTTP 200 也可能是失败：上游把错误藏在响应流里
  博客园: 一次"凭据失效"误判：错误帧排在 done 之后会发生什么
status: 成稿
---

# HTTP 200 也可能是失败：上游把错误藏在响应流里

## 现象

我们的 AI 文案/字幕链路，隔三差五会冒出这么一条报错：

```
Kimi 未返回内容，请检查后台的凭据是否有效
```

顺手去看凭据管理页——显示"有效"。点了"立即续期"，再跑一次，还是同一句。
更迷惑的是：**同一个凭据，换个时间跑又好了**。

于是我们花了两天在"凭据到底有没有失效"这个问题上打转。

## 第一反应（错的）

报错文案是我们自己写的，逻辑是：

```csharp
if (string.IsNullOrWhiteSpace(reply))
    throw new BizException("未返回内容，请检查凭据");
```

空回复 → 模型没说话 → 多半是不认这个 token。看起来天经地义。
但这里有个致命的隐含假设：**"空回复"是凭据问题的充分证据**。它不是。

真正的转折来自一次抓包。我们把流式响应原样落盘，逐帧拆开看，帧序是这样的：

```
{"heartbeat":{}}
{"heartbeat":{}}
{"done":{}}
{"error":{"code":"resource_exhausted","message":"..."}}
```

注意最后两行：**`error` 帧排在 `done` 帧之后**。

## 根因

我们原来的流解析长这样（简化）：

```csharp
foreach (var frame in frames)
{
    if (frame.HasDone)  goto streamDone;   // ← 见 done 就收尾
    if (frame.HasError) return Failure(frame.Error);
    ...
}
streamDone:
return Success(sb.ToString());
```

协议文档里写的是"正常流以 done 结束"，我们就照着实现了。
可这个上游的实现是：**限流之类的错误在流已经"正常结束"之后才补发一帧**。
结果就是：

1. 解析在 `done` 处收尾，返回 `success` + 空文本；
2. `error` 帧被彻底吞掉；
3. 上层拿到空文本，翻译成"凭据失效"。

也就是说，**一个限流错误（`resource_exhausted`）被我们一路误报成了凭据问题**。
而且它是间歇性的——只在触发限流时出现，所以"换个时间跑又好了"。

## 修法

两处改动，缺一不可。

**第一处：解析不再假设帧序。**

```csharp
// 见 done 不再立刻停，继续等到流真正结束；期间来了 error 就带出去
public async Task<(string Text, string? ErrorJson)> ReadGrpcStreamAsync(...)
{
    string? errorJson = null;
    await foreach (var frame in ReadFramesAsync(resp))
    {
        if (frame.HasError) { errorJson = frame.ErrorJson; continue; }  // 不 break
        if (frame.HasText) sb.Append(frame.Text);
        if (frame.HasDone) { /* 记住，但不收尾 */ }
    }
    return (sb.ToString(), errorJson);   // 有 error 就优先按 error 处理
}
```

**第二处：错误码翻译成人话，别让上游原文直接落地。**

```csharp
public static string DescribeStreamError(string code) => code switch
{
    "resource_exhausted" => "当前额度已打满/触发限流，稍后再试",
    "unauthenticated"    => "凭据已失效，请在后台重新配置",
    "permission_denied"  => "该账号无此能力权限",
    _                    => "上游服务异常，请稍后重试"
};
```

顺带把上层的兜底也改了：空回复时优先取服务里记录的 `LastFailureReason`
（最近一次失败的真实原因，带 10 分钟有效期），而不是无脑报"检查凭据"。

修完之后，同样的限流场景，用户看到的是：

```
当前额度已打满/触发限流，稍后再试
```

一句话，排查方向从"两天"变成"零"。

## 怎么防止再犯

补了一组解析层单测，喂的是**真实帧序的样本**：

- `done` 之后接 `error` → 必须返回错误，不能返回成功+空文本；
- `error` 在前、`done` 在后 → 同样返回错误；
- 纯正常流（heartbeat → text → done）→ 文本完整，无错误。

第三条很重要：改解析最容易改过头，把所有带 `done` 的正常流也判成失败。
**测试要同时钉住"该报错的"和"不该报错的"**。

## 带走的结论

- **状态码 200 不等于请求成功**。流式接口尤其如此：错误可能在流里，甚至在 `done` 之后。
- **不要假设帧序**。解析循环里"见到终止标记就收尾"是很自然、也很危险的写法，
  正确做法是"扫完整个流，谁优先级高听谁的"。
- **空结果不等于成功**。空字符串/null 是最容易被上层二次解读成别的东西的信号，
  一旦下游对空值做了归因，错误就会在归因层被放大成完全不相干的结论。
- 上游错误码**必须翻译成本系统的人话**再落地，别把 `resource_exhausted` 直接甩给用户。

---

> 这个坑出在我们做的一个开源 AI 视频工作台里（选题 → 创作 → 剪辑 → 发布全链路）。
> 这类"上游协议跟文档不一致"的坑我们踩了一整个系列，代码都是开源的，欢迎来翻：
> <https://github.com/HTWMedia/HTWClient>
