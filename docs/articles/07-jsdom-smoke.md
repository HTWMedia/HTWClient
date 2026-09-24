---
title: 用 jsdom 给 Electron 面板做冒烟：不开真机也能守住回归
platforms:
  掘金: 用 jsdom 给 Electron 面板做冒烟：不开真机也能守住回归
  博客园: 没有真机联调之后，我们用 jsdom + 真实后端重建了回归网
status: 成稿
---

# 用 jsdom 给 Electron 面板做冒烟：不开真机也能守住回归

## 现象

桌面端有十个面板，每个都要跟真实后端对话。改完代码验证一次，流程是：
打包 → 装 → 登录 → 点面板 → 填表单 → 等任务 → 看结果。
**一轮十几分钟，而且只能覆盖你顺手点的那几个功能。**

结果就是：改了 A 面板，B 面板悄悄坏了，等用户反馈才知道。

## 我们的目标不是"单元测试"

我们试过给面板写单测，结论是**单元测试在这个场景性价比很低**：
面板逻辑的绝大部分是"拼请求 + 渲染响应"，单测里把请求 mock 掉之后，
测的其实是"我 mock 的东西和我渲染的东西对不对"，**契约错误一个都测不出来**
（比如后端字段名改了、参数名写错了）。

真正想抓住的是这类问题：

- 端点拼错、参数名写错；
- 响应字段改名/改大小写；
- 任务轮询逻辑坏了；
- 某个面板在 429 / 402 下的降级路径失效。

**这些只有在真实后端面前才测得出来。** 于是我们把目标定为：
**用 jsdom 把页面跑起来，但请求真发到真实后端**。

## 脚手架的四个关键点

### 1. JSDOM 必须开 `runScripts: "outside-only"`

```js
const dom = new JSDOM("<!doctype html><html><body><div id='p'></div></body></html>", {
  url: "http://localhost/",
  runScripts: "outside-only",   // 关键
  pretendToBeVisual: true,      // 有 requestAnimationFrame
});
```

不开的话，我们通过 `window.eval` 注入的面板脚本会落在 Node 上下文里，
脚本内部看不到 `window`，表现为各种"xxx is undefined"，而且错误信息完全指不到真因。

### 2. 补齐 `window.htw`：返回契约必须和 preload 一致

面板通过 `window.htw.call(...)` 发请求（preload 注入）。冒烟里要自己实现它：

```js
window.htw = {
  apiBase: base,
  call:   (m, p, b, k) => apiCall(m, p, b, k),
  upload: (m, p, files, fields, k, onProgress, fileField, base) => apiUpload(...),
  openExternal: () => {},
  saveConfig: async () => true,
  loadConfig: async () => null,
};
```

这里有个必须对齐的点：**`call` 返回的是 `{ ok, status, data }`，
其中 `data` 才是服务端原始信封 `{ Ok, Data, ErrCode, ErrMsg }`**。
一开始我们直接把服务端 JSON 塞回去，页面显示 "HTTP undefined"——
因为页面期待的是外层信封，拿到的是里层。

### 3. `upload` 要支持 multipart，否则带文件的面板根本跑不起来

```js
async function apiUpload(method, p, files, fields, authKey, ...) {
  const fd = new FormData();
  for (const f of files || []) {
    const buf = f.buffer instanceof Uint8Array ? f.buffer : new Uint8Array(f.buffer);
    fd.append(fileField || "file", new Blob([buf]), f.name || "file.bin");
  }
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
  ...
}
```

剪辑、营销这类带文件上传的面板，没有这个就只能跳过——**而它们恰恰是最容易回归的地方**。

### 4. 别用固定 `sleep` 等任务

后端是异步任务，冒烟要轮询。我们踩过的坑：

```js
await sleep(5000);
assert(done);   // 冷启动时必挂，重跑一次又好了
```

**冷启动的第一个请求常常要 3 秒以上**（依赖加载、连接池、JIT），固定等待时间必然偶发失败。
正确做法是**轮询 + 超时上限**，而不是"等一个我觉得够长的时间"。
而且冒烟失败时，**先原样重跑一次再查**——我们有过几次"失败"纯粹是冷启动慢。

## 两个反直觉的坑

**坑一：取"最后一个按钮"会取错。**

我们的结果渲染函数会在末尾追加一个「复制结果」按钮。于是：

```js
const buttons = panel.querySelectorAll("button");
buttons[buttons.length - 1].click();   // ← 点到了「复制结果」
```

正确做法是**取第一个**（或者按文案/类名精确匹配）。这个 bug 的表现是
"点了没反应"，很不容易联想到"我点错按钮了"。

**坑二：别在冒烟里点真实「重试」。**

重试按钮会真的重新提交任务、真的扣额度。冒烟跑一次是验证，
跑十次就是十次真实计费。我们现在的规矩是：**冒烟只验证按钮存在与可点击状态，不触发真实计费动作**。

## 这套东西给我们带来了什么

- 改完后端跑一遍全套冒烟（选题 / 创作 / 剪辑 / 发布 / 营销 / 洞察 / 工具），
  **几分钟内知道十个面板是不是都还活着**；
- 冒烟脚本本身成了最好的"接口用法文档"——新人照着它就能知道每个面板怎么调后端；
- 它挖出过好几个真 bug：空文案照样跑模型白扣额度、上游错误原文直出给用户、
  某个面板在 429 下没有降级……

**这些都是 mock 单测永远抓不到的问题。**

## 带走的结论

- **mock 掉的测试测不到契约**。要抓"字段名改了""参数写错了"这类问题，必须打真实后端。
- jsdom 跑页面脚本的两个硬条件：`runScripts: "outside-only"` + 补齐宿主 API（尤其是上传）。
- **异步等待一律用轮询 + 超时，不要用 `sleep(n)`**；冒烟偶发失败先重跑一次再怀疑代码。
- 取元素别用"最后一个"，渲染函数经常会追加按钮。
- 冒烟**不要触发真实计费/发布动作**，只验证可点击与状态流转。

---

> 这套冒烟脚手架出在我们做的一个开源 AI 视频工作台里（Electron 桌面端 + 真实 `/api/v2/*` 后端）。
> 脚本和面板代码都是开源的，可以直接抄：
> <https://github.com/HTWMedia/HTWClient>
