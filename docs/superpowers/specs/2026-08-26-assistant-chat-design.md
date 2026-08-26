# 助手（聊天）模块设计

日期：2026-08-26

## 目标
在桌面端新增一个「助手」聊天界面，满足两类需求：
1. 用户想了解某个具体功能时，可一键查看该功能的结构化介绍（本地知识库，离线、秒回）。
2. 用户有其它任意问题时，可与 LLM 自由对话提问。

## 后端
复用服务端已有接口 `POST /api/backend/chat`（DeepSeek）。请求体 `{ Prompt: string }`，
返回 `{ result: string }`。该接口不强制 AuthKey，桌面端调用时可选带上 AuthKey。
多轮对话的上下文由**客户端**维护：把历史消息拼成一段文本作为 Prompt 提交（服务端为单轮接口）。

## 入口与布局
- 侧边栏新增一个导航项「助手」（聊天气泡图标），放在「发布」之后、「设置」之前。
- 主区为聊天面板：
  - 顶部：标题栏
  - 中部：消息列表（用户气泡 / 助手气泡，支持简单 Markdown 渲染）
  - 顶部功能速览区：一排「功能介绍」快捷标签（语音转写、语音合成、视频创作、图片创作、文章创作、发布、Cookie 配置等），点击即在会话中展示该功能的本地介绍。
  - 底部：多行输入框 + 发送按钮 + 清空按钮。

## 两类能力
- **功能介绍（本地知识库）**：维护 `FEATURES` 映射（功能名 → {title, summary, points[]}）。
  点击快捷标签 → 直接以助手气泡展示本地介绍（不依赖网络）。
- **自由提问（LLM）**：输入框发送 → 调用 `/api/backend/chat`，把「历史 + 当前问题」拼成 Prompt。
  返回结果作为助手回复；结果为空时显示友好提示。

## 数据流与健壮性
- 调用方式：`window.htw.call("POST", "/api/backend/chat", { Prompt })`；该接口不在 V2 信封内，
  直接取 `data.result`。
- 多轮历史保存于前端内存，并持久化到 `userData/assistant-chat.json`（通过新增的 preload
  `saveJson`/`loadJson`）。加载面板时恢复。
- 网络 / 服务端异常时显示错误气泡，不崩溃。
- 「助手」面板不要求 AuthKey，因此不展示「未设置 AuthKey」警告（在 `refreshKeyUI` 中排除助手面板）。

## 文件改动
- 新增 `apps/desktop/js/skills/assistant.js`：聊天 UI + 本地 `FEATURES` 知识库 + 调用逻辑，导出 `mount(panel)`。
- `apps/desktop/preload.js`：新增 `saveJson(name, data)` / `loadJson(name)` 通用持久化（写入 `userData/<name>.json`）。
- `apps/desktop/js/app.js`：把 `assistant` 加入 `SKILLS`；`refreshKeyUI` 排除助手面板。
- `apps/desktop/index.html`：新增 `nav-item`（助手）与 `panel-assistant` 容器，并引入 `assistant.js` 脚本。
- `apps/desktop/css/app.css`：聊天面板 / 气泡 / 快捷标签样式。
