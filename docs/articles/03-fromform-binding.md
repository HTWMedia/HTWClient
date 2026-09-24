---
title: 一个漏掉的 [FromForm]，让参数静默变成默认值
platforms:
  掘金: 一个漏掉的 `[FromForm]`，让参数静默变成默认值
  博客园: 排查三天：接口一直用默认值在跑，而路由探测说是好的
status: 成稿
---

# 一个漏掉的 `[FromForm]`，让参数静默变成默认值

## 现象

我们的字幕提取接口支持两种引擎：整文件上传给模型（`kimi`），或者抽帧拼图走 OCR（`ocr`）。
前端下拉框选了 `ocr`，提交，后端日志显示——**走的还是 `kimi`**。

同一时期，视频超分接口也出现"传了宽高但出来的分辨率不对"，
智能包装接口"传了输入路径但说找不到文件"。

三个接口，同一个症状：**参数好像没进到 action 里**。

## 第一反应（错的）

先怀疑前端：`FormData` 是不是没 append 上？抓包看了，`------WebKitFormBoundary` 里
`engine: ocr` 清清楚楚。

再怀疑序列化：是不是枚举解析失败了？可后端拿到的是默认值 `kimi`，不是解析异常。

最后我们还跑了一遍**部署后的路由探测脚本**——对所有端点发请求，看返回是不是 404。
结论：全部正常。**这一步给了我们错误的信心**，因为路由探测根本测不到参数绑定。

## 根因

这些接口都是 `multipart/form-data`（要传文件）。写法大致是：

```csharp
[HttpPost("extract")]
public async Task<IActionResult> Extract(
    IFormFile file,
    string engine = "kimi",     // ← 漏了 [FromForm]
    string lang   = "auto")
```

问题在于 ASP.NET Core 的绑定规则：

> **简单类型（`string`/`int`/`bool`/枚举…）默认只从 route 和 query string 绑定**，
> 不会自动去 `multipart/form-data` 的字段里找。

`IFormFile` 因为类型特殊会自动从表单取，所以文件那一路一直是好的——
这也解释了为什么"接口能跑，只是参数不对"。

最要命的是：**漏标不报错**。绑定失败时拿默认值，action 照常执行，
日志里一切正常。这种 bug 不会自己冒出来，只能靠人发现。

## 定位手法：传不同值做对照

路由探测查不出这类问题，因为它只关心"端点在不在"。
真正管用的手法是**给同一个参数传两个不同的值，看错误文案会不会分叉**：

```bash
# 对照 A：engine=ocr，配一个很小的文件
# 对照 B：engine=kimi，同样的小文件
```

如果参数真的进了 action，两条请求的行为/报错应当不同（比如 OCR 分支会先抽帧、
会抱怨 ffmpeg；kimi 分支会先上传）。我们实测两条**完全一样**——
说明 `engine` 从头到尾就是默认值。

**"传不同值看响应是否分叉"是验证参数绑定的最小成本手段**，
比读代码可靠，比打断点快。

## 修法

**第一步：给所有 multipart 端点的简单类型参数显式补 `[FromForm]`。**

```csharp
public async Task<IActionResult> Extract(
    IFormFile file,
    [FromForm] string engine = "kimi",
    [FromForm] string lang   = "auto")
```

我们一共补了 7 个 v2 控制器里的若干端点（字幕 `engine`、粗剪 `voice/durationMin/durationMax/blur`、
超分宽高、智能包装 `assembledPath`……）。

**第二步：加一个源码扫描测试当守卫。**

人工"记得加"是靠不住的，人总会忘。写一个测试去扫源码：

```csharp
[Fact]
public void Multipart_Endpoints_Simple_Parameters_Must_Have_FromForm()
{
    var violations = ScanControllers()
        .Where(c => c.ConsumesMultipart)                       // 有 IFormFile 参数
        .SelectMany(c => c.Parameters)
        .Where(p => p.IsSimpleType                             // string/int/bool/enum...
                 && !p.HasAttribute("FromForm")
                 && !p.HasAttribute("FromRoute")
                 && !p.HasAttribute("FromQuery"))
        .ToList();

    Assert.Empty(violations);
}
```

实现扫源码（而不是反射）有两个原因：反射拿不到"有没有写这个特性"之外的上下文，
而且我们希望**报错信息直接给出文件名和行号**，改的人一眼能定位。

写这类扫描测试时踩到一个坑：**注释里常有反面例子会被误报**。
比如代码注释里写"错误示范：`string engine`（没有 FromForm）"，扫描器会把它抓出来。
解决办法是先剥掉 `//` 开头的行，再做匹配。

## 怎么防止再犯

- 新写 multipart 端点时，**每个简单类型参数都显式标注来源**，别依赖默认值行为。
- 让扫描测试跑在 CI 里——它不依赖运行时、不依赖数据库，几毫秒出结果。
- 部署后的验证脚本要升级：**只探测"路由在不在"是不够的**，
  至少对关键端点加一组"传不同参数值看行为是否分叉"的对照用例。

## 带走的结论

- **绑定失败静默取默认值**，是比抛异常更难查的一类问题：系统看起来很健康，只是"不听话"。
- **探测能证明"存在"，不能证明"可用"**。存在性和参数绑定是两件事。
- 靠"记得加"维持的约定，最终都会漏；**能自动化的守卫就自动化**，
  尤其是这种一次写好、永久生效的静态检查。
- 三个不同接口同时出现"参数不对"时，先想**共同点**（都是 multipart + 简单类型），
  别一个一个查。

---

> 这个坑出在我们做的一个开源 AI 视频工作台里（选题 → 创作 → 剪辑 → 发布全链路）。
> 接口契约这块的坑我们踩了一整个系列，代码都是开源的，欢迎来翻：
> <https://github.com/HTWMedia/HTWClient>
