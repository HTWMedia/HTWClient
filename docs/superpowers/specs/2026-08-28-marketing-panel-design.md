# 桌面端「营销成片」面板设计

日期：2026-08-28
状态：已批准（brainstorming）
关联代码：`D:\HTWClient\apps\desktop`，参考服务端 `D:\HTWCore.Web`

## 目标

在桌面端（Electron）新增一个「营销成片 MarketVideo」面板，仿照 web端
`Views/WebAI/marketVideo.cshtml` 的字段与流程，但后端走桌面可直连（`AuthKey` 鉴权）的
V2 创作接口，并**主要用 Seedance 生成钩子分镜（i2v 动态化）**。

## 背景与约束

- web端 营销成片（`WebAIController.MarketVideo*`）走 `/WebAI/*` 且**必须 session 登录**，
  桌面端 `AuthKey` 客户端无法直接调用。
- 桌面端能直连且真正使用 Seedance 的只有 V2 创作接口
  `POST /api/v2/creation/start`（带 `EnableSeedance` + `EnableMarketingOverlay` +
  `ProductImageUrls`）。Seedance 在创作流里负责「钩子镜头 i2v 动态化」；静态分镜图仍由即梦生成。
- 逐张「分镜图确认/替换」仅存在于 `/api/tools/video/*`（即梦，非 Seedance），本方案不采用。

## 方案（Approach A）

新增桌面 skill `marketing`，提交到 `/api/v2/creation/start`（Type=video），轮询
`/api/v2/creation/status`，用 `approve`/`regenerate`/`refine` 推进，成片经
`/api/v2/creation/media-file`（或 `proxy-media`）播放/下载。

## 注册改动（沿用现有 skill 模式）

- 新增 `apps/desktop/js/skills/marketing.js`，导出 `Skills.marketing = { mount }`。
- `apps/desktop/index.html`：
  - 侧栏 `<button class="nav-item" data-skill="marketing"><i class="fa-solid fa-bag-shopping"></i>营销成片 MarketVideo</button>`
  - `<main>` 内新增 `<section class="panel" id="panel-marketing"></section>`
  - `<script>` 引入 `js/skills/marketing.js`（在 `js/app.js` 之前）
- `apps/desktop/js/app.js`：`SKILLS` 数组加入 `"marketing"`。

## UI 字段（仿 web端，仅保留 V2 可接收项）

| 控件 | 说明 | 映射 |
|---|---|---|
| 商品名称 | 文本，必填 | 拼入 `Topic` |
| 卖点 | textarea，每行一条（手动填） | 拼入 `Topic`（web端自动挖卖点接口为 session 专用，桌面用文本框） |
| 商品素材 | 多选上传（图片/视频，≤20MB/个） | `POST /creation/upload-material?sessionId` → `UserMaterialIds` |
| 文案 | textarea，可选；留空=AI 生成脚本 | 拼入 `Topic` |
| 优惠活动 | 文本，可选 | `MarketingCtaText` |
| 适用人群 | 文本，可选（逗号分隔） | `MarketingHeroText` |
| Seedance 钩子镜头数 | number，默认 2 | `SeedanceMaxClips` |
| 营销浮层 | switch，默认开 | `EnableMarketingOverlay=true` |
| 视频类型 | select，从 `/api/v2/creation/types` 取，默认 `kol` | `VideoTypeId` |
| 可选步骤 | 复选：调研/关键点提取/素材搜索/自动发布，默认关键点提取开 | `OptionalSteps[]` |

> **画幅比例 / 时长档位**：V2 创作接口无对应字段（系 capflow/MarketVideo 专用），按批准意见
> **直接从面板移除**，不保留灰色预留控件。

## API 契约（桌面调用，均带 `AuthKey` 头）

| 步骤 | 方法 & 路径 | 请求 | 响应（信封 `{ok,data,...}`） |
|---|---|---|---|
| 视频类型 | `GET /api/v2/creation/types` | — | `data:[{id,name,description}]` |
| 开始 | `POST /api/v2/creation/start` | `{type:"video", topic, optionalSteps[], videoTypeId, enableSeedance:true, seedanceMaxClips:int, enableMarketingOverlay:true, marketingCtaText, marketingHeroText, productImageUrls:[], userMaterialIds:[]}` | `data.sessionId` |
| 上传素材 | `POST /api/v2/creation/upload-material` | multipart `file` + query `sessionId` | `data:{materialId, url, type, size}` |
| 轮询 | `GET /api/v2/creation/status?sessionId=&type=video` | — | `data:{status, currentStepLabel, progressLogs[], artifact}`；`status`∈`running|waiting_approval|completed|failed` |
| 确认 | `POST /api/v2/creation/approve` | `{sessionId, type:"video"}` | 信封 |
| 重生成 | `POST /api/v2/creation/regenerate` | `{sessionId, instruction, type:"video"}` | 信封 |
| 精修 | `POST /api/v2/creation/refine` | `{sessionId, message, type:"video"}` | 信封 |
| 取媒体 | `GET /api/v2/creation/media-file?sessionId=&fileName=` | — | 文件字节 |
| 代理媒体 | `GET /api/v2/creation/proxy-media?url=` | — | 代理字节（需绝对 URL） |

## 交互流程

1. 填表单 → 点「生成成片」：
   - `POST /creation/start`（Topic = 商品名 + 卖点 + 文案；其余旗标如上）→ 取 `sessionId`。
   - 逐文件 `POST /creation/upload-material?sessionId` 挂到会话。
2. 轮询 `/creation/status`（每 2s）：展示 `progressLogs`、`currentStepLabel`、状态徽标。
3. `status==="waiting_approval"`：显示「确认 / 重新生成 / 精修」按钮。
4. `status==="completed"`：展示脚本（`artifact.video_script.scriptText`）与成片视频
   （如 `artifact` 含媒体文件名则经 `media-file` 播放/下载；外部 URL 经 `proxy-media`）。

## 已知缺口 / 取舍

- `ProductImageUrls`（脚本参考图）仅 `/start` 时可传，素材在 `/start` 之后才上传，故暂留空；
  脚本仍正常生成（仅少商品参考图）。
- 无逐张分镜图替换交互（Seedance 路径为流程内生成）。
- 画幅/时长不在 V2 创作范围，已移除对应控件。

## 测试

- 用 Playwright 启动桌面端，设置面板填入有效 `AuthKey`（本地读取，不提交）；
  跑一个真实营销任务（小商品图）。
- 校验：无 JS 控制台报错；`/start` 返回 `sessionId`；素材上传成功；轮询至
  `waiting_approval` 或 `completed`；Seedance 钩子镜头生效（进度日志体现）；
  成片可播放/下载。
- **不提交任何密钥**：`config.json` / `测试数据.txt` 保持 `.gitignore` 忽略。

## 交付物

- 代码：`apps/desktop/js/skills/marketing.js` + `index.html` / `app.js` 注册改动。
- 文档（GitHub，对应「更新 skills」）：
  - `README.md` 功能特性新增「营销成片」条目（Seedance 生成分镜 + 营销浮层）。
  - `agent/skills/htw-media-marketing/SKILL.md` + `references/api.md`：记录营销成片 V2 API 契约。

## 风险

- `proxy-media` 对外部 URL 有 host 白名单，成片若为 `/MediaFiles/*` 本地路径用 `media-file` 更稳。
- Seedance 依赖服务端豆包配额；实时失败会体现在 `status==="failed"` 的 `error`，面板照常展示。
