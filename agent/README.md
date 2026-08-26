<h1 align="center">🐬 HTW Media Skills</h1>

<p align="center">
  <strong>给你�?AI Agent 一键接�?HTW 媒体平台</strong>
</p>

<p align="center">
  媒资洞察 · 内容创作 · 多平台分�?· 在线工具 · 视频编辑 —�?一�?AuthKey，五个技�?</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/HTWMedia/HTWSkills/tags"><img src="https://img.shields.io/github/v/tag/HTWMedia/HTWSkills?style=for-the-badge" alt="Latest tag"></a>
  <a href="#快速安�?><img src="https://img.shields.io/badge/install-npx%20one--liner-yellow.svg?style=for-the-badge" alt="npx install"></a>
</p>

<p align="center">
  <a href="#为什么需�?>为什么需�?/a> · <a href="#四个能力">四个能力</a> · <a href="#快速安�?>快速安�?/a> · <a href="#快速上�?>快速上�?/a> · <a href="#API-速览">API 速览</a> · <a href="#版本发布">版本发布</a> · <a href="#关于">关于</a> · <a href="README.en.md">English</a>
</p>

---

## 为什么需要？

你的 AI Agent 能写代码、改文档、管项目——但让它去分析一条视频、写一篇小红书文案、把一个作品分发到 6 个平台，它就无从下手了：

- 🎬 "分析一下这条抖音视频的爆款逻辑" �?**做不�?*，没有数据接�?- 📈 "今天抖音/小红�?微博有什么热�? �?**查不�?*，要一个个平台去抓
- ✍️ "根据这个主题帮我写一篇带推荐语的短视频文�? �?**要自己调一�?prompt**
- 📤 "把这条内容同步发到抖音、小红书、B站、头�? �?**要登录四个后台手动操�?*
- 🎙�?"把这段音频转成字幕、再总结成要�? �?**要装 ffmpeg、找 ASR、调各家 API**
- 🎬 "把这段文案做成一�?AI 视频" �?**要串起脚本、画面、配音、剪辑一堆工�?*

**这些不是做不到，是要自己折腾�?*

每个能力背后都是平台 API、登录态、异步任务、限流——你花一个下午调通，下一次换个平台又得重来�?
**HTW Media Skills 把这件事变成一条命令：**

```
npx -y github:HTWMedia/HTWSkills#v2.1.0 install
```

你的 Agent 装好后，就能自动分析视频、查热搜、写文案、分发多平台、转字幕、生�?AI 视频了。所有能力共�?*一�?AuthKey**�?
> �?**Star 这个项目**，我们持续迭代新的能力和平台，接口换代你无感�?
### 在你用之前，你可能想知道

| | |
|---|---|
| 🔑 **一�?Key 全�?* | 四个能力共用一�?`AuthKey`，申请一次，处处可用 |
| ⏱️ **异步任务** | 耗时任务（视频生成、音频转写、多平台分发）统一「提�?`taskId` �?轮询 status」模式，永不超时 |
| 🛡�?**安全** | 只暴露公开 API 契约（路�?字段/用法），不含任何源码与内部细节；API Key 只在内存中使用，不落�?|
| 🤖 **兼容所�?Agent** | Claude Code、Codex、Cursor、Windsurf……任何能�?SKILL.md / 跑命令行�?Agent 都能�?|
| 🔍 **自带 Dry-run** | 每条命令�?`--dry-run` 先看将发送的请求，不发真实请�?|

---

## 五个能力

| 技�?| 能力 | 一句话说明 |
|------|------|-----------|
| 🔍 **insight** | 媒资洞察 | 分析视频/账号/文案、全网热搜、多平台搜索 |
| ✍️ **create** | 内容创作 | 从一句话主题到分步骤产出�?AI 创作会话 |
| 📤 **publish** | 多平台分�?| 一键分发到抖音/小红�?B�?头条，可追踪可重�?|
| 🧰 **tools** | 在线工具 | 音频转写/翻译/总结/人声分离/歌词、AI 视频/图片、Agent 管线 |
| ✂️ **edit** | 视频编辑 | AI 粗剪配音、CapCut 草稿导出成片、视频超�?|

### 🔍 insight �?媒资洞察

�?这条内容为什么火"变成可回答的问题�?
- **视频分析** �?传一个视�?URL，返回结构化的分析结果（封面、标题、完播要素等�?- **账号分析** �?分析一个账号的内容策略
- **文案分析** �?拆解一条文案的写法
- **全网热搜** �?一条命令拿到抖�?小红�?微博/百度/B�?头条的热搜聚�?- **平台搜索** �?按平台（小红�?B站返回条目，抖音/头条返回直达链接）搜关键�?- **头条号能�?* �?用户信息、作品列表、视频地址解析

### ✍️ create �?内容创作

�?写个文案"变成一条从主题到成片的**分步创作流水�?*：选题 �?脚本 �?分镜 �?配音 �?画面 �?成片，每一步产物可见、可审、可改�?
- **视频类型预设** �?内置 9 种成片人设：口播/知识博主、知识科普、带货种草、剧情短剧、Vlog 生活、新闻资讯、教程讲解、情感故事、企业宣传。每种预设锁�?*平台、画风、分镜风格、脚本长度、角色音色、人设与画幅**，选一个类型，全链路自动对�?- **推荐选题** �?热新�?+ 选题预设，灵感不用愁
- **分步流水�?* �?一次会话推�?10 个步骤：`调研 �?关键�?�?脚本 �?配音 �?素材 �?画面 �?音乐 �?模板 �?合成 �?发布`，每步返回独立产�?- **脚本与分�?* �?脚本步骤�?*镜头（Shot�?*产出：每句文�?+ 画面描述 + 时长，天然形成分镜结构，后续素材匹配、画面生成都以镜头为单位
- **角色与配�?* �?角色由预设的「人设（Persona�? 音色（Speaker）」决定：短剧是多角色对话、科普是男声讲原理、种草是女声带节奏；脚本、配音、画面全程沿用同一人设
- **逐步驱动** �?`approve`（通过�? `regenerate`（按指令重做�? `refine`（按反馈打磨�? `toggle-step`（开关可选步骤）
- **状态追�?* �?随时查询会话当前进度与各步骤产物
- **素材管理** �?上传素材、按需拉取素材/媒体文件，素材可参与镜头匹配

### 📤 publish �?多平台分�?
�?发多个平�?变成一次提交：

- **一键提�?* �?一个请求同时分发到 `douyin / xhs / bilibili / toutiao`
- **全程可追�?* �?任务状态、活跃队列、历史记�?- **失败重试** �?单个子任务失败可单独重试，不影响其他平台
- **合规辅助** �?内容合规检查、自动生成标签、按平台生成文案
- **素材上传** �?统一上传，拿到可直接引用�?URL
- **Cookie 管理** �?服务端保�?校验各平台登录态（API 从不回传 Cookie 原文�?
### 🧰 tools �?在线工具

把杂活变成异步任务，视频生成走�?*提交 `taskId` �?轮询 �?下载成片**」：

- **音频** �?上传 �?转写/翻译/总结/人声分离/歌词识别/TTS（提�?�?轮询 �?下载结果�?- **字幕提取** �?视频字幕提取（`txt`/`srt`），同样异步（`/api/v2/subtitle/*`�?- **草稿成片 / 视频编辑** �?CapCut 草稿导出成片、AI 粗剪配音、视频超分、草稿解密见独立�?**`edit`** 技能（`/api/v2/edit/*`）；加密草稿解密�?[JyDraft](https://github.com/HTWMedia/JyDraft) 提供
- **图文成片** �?一句话主题 �?AI 创作会话，见 `create` 技能（v2 `/api/v2/creation/*`�?- **图片** �?AI 图片生成（异步）、图片识别（`/api/v2/image/*`�?- **模板 / Agent** �?模板搜索（`/api/v2/template/search`）；多智能体全流程视频管线见 `/api/v2/agent/*`：选题 �?脚本 �?分镜 �?素材 �?合成，一条任务全自动跑完（`agent/one-click` 给个主题即出片）

---

## 快速安�?
复制这句话给你的 AI Agent（Claude Code、Codex、Cursor、Windsurf 等）�?
```bash
npx -y github:HTWMedia/HTWSkills#v2.1.0 install
```

它会把四个技能安装到 `~/.agents/skills`（装�?Claude Code 还会装到 `~/.claude/skills`）�?
> 🔄 **想换版本�?* �?`#v2.1.0` 换成目标 tag 即可，见 [版本发布](#版本发布)�?
### 获取 API Key

在平台用邮箱申请，一条命令即得：

```bash
# 服务器返回你�?Key
curl -X POST "https://htwmedia.dpdns.org/auth/applykey?email=<you@example.com>" \
     -H "X-App-Source: HDraft"
```

然后导出为环境变量（CLI 只从环境变量�?Key，绝不写盘、绝不上命令行）�?
```bash
# PowerShell
$env:HTW_API_KEY = "your-key"
# macOS / Linux
export HTW_API_KEY="your-key"
```

---

## 快速上�?
```bash
htw-skills list                                     # 列出四个技�?htw-skills guide insight                            # 查看某个技能的用法

# 媒资洞察
htw-skills call insight --video "https://www.douyin.com/video/xxxx"    # 视频分析
htw-skills call insight --hot                       # 全网热搜

# 内容创作
htw-skills call create --topic "旅行vlog" --type video                 # 开始创�?
# 多平台分�?htw-skills call publish --submit --title "标题" --content "正文" --platforms douyin,xhs

# 在线工具
htw-skills call edit --decrypt draft.json           # 解密草稿
htw-skills call tools --audio-upload <fileId> --convert --format txt   # 音频转写
htw-skills call tools --audio-status <taskId>       # 轮询音频任务
```

> 🔍 任何命令�?`--dry-run` 只打印将发送的请求（含 `AuthKey=<redacted>`），不发真实请求�?
**耗时任务都是异步�?*：提交类接口立刻返回 `{ taskId }`，然后轮询对应的 `status` 接口直到 `status = completed`。CLI 为音�?字幕/草稿/图文成片/图片/Agent 都提供了对应�?status 命令�?
---

## API 速览

> 基础地址 `https://htwmedia.dpdns.org`，所有请求带 `AuthKey: <key>`。统一使用 **V2** 接口（`/api/v2/*`），返回统一信封 `{ ok: true, data, errCode, errMsg, taskId }`，失败为 `{ ok: false, errCode, errMsg }`。所有能力（含字幕提取、草稿解密、模板搜索）均已接入 V2�?
### insight �?媒资洞察 (`/api/v2/insight`)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v2/insight/analyze-video` | `{ url }` 视频分析 |
| POST | `/api/v2/insight/analyze-account` | `{ url }` 账号分析 |
| POST | `/api/v2/insight/analyze-copy` | `{ text }` 文案分析 |
| GET | `/api/v2/insight/hot-rankings` | 全网热搜（平�?�?榜单数组�?|
| POST | `/api/v2/insight/search` | `{ platform, keyword, count }` 平台搜索 |
| POST | `/api/v2/insight/toutiao/user-info` | `{ userUrl }` 头条用户信息 |
| POST | `/api/v2/insight/toutiao/works` | `{ userUrl }` 头条作品列表 |
| POST | `/api/v2/insight/toutiao-video-url` | `{ videoId }` 头条视频地址解析 |

### create �?内容创作 (`/api/v2/creation`)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v2/creation/types` | 视频类型预设 |
| POST | `/api/v2/creation/start` | `{ type, topic, ... }` 开始创�?�?`{ sessionId, step }` |
| POST | `/api/v2/creation/approve` | `{ sessionId, type }` 通过当前步骤 |
| POST | `/api/v2/creation/regenerate` | `{ sessionId, instruction, type }` 按指令重�?|
| POST | `/api/v2/creation/refine` | `{ sessionId, message, type }` 按反馈打�?|
| POST | `/api/v2/creation/toggle-step` | `{ sessionId, stepId, enabled, type }` 开关步�?|
| GET | `/api/v2/creation/status` | `?sessionId=&type=` 会话进度 |
| GET | `/api/v2/creation/recommendations` | 热新�?+ 选题预设 |
| POST | `/api/v2/creation/upload-material` | 上传素材 |
| GET | `/api/v2/creation/media-file` | 取媒体文�?|
| GET | `/api/v2/creation/proxy-media` | 代理媒体 URL |

### publish �?多平台分�?(`/api/v2/publish`)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v2/publish/submit` | 一键分发（douyin/xhs/bilibili/toutiao）→ `{ taskId }` |
| GET | `/api/v2/publish/task-status` | `?taskId=` 任务状�?|
| GET | `/api/v2/publish/queue-status` | 活跃任务队列 |
| GET | `/api/v2/publish/history` | `?page=&pageSize=` 历史记录 |
| POST | `/api/v2/publish/retry` | `{ subTaskId }` 重试子任�?|
| GET | `/api/v2/publish/platform-config` | 平台元数�?|
| GET | `/api/v2/publish/platform-status` | 各平台连接状�?|
| GET | `/api/v2/publish/check-connections` | 校验全部平台连接 |
| POST | `/api/v2/publish/upload-file` | 素材上传 �?`{ url, contentType }` |
| POST | `/api/v2/publish/check-compliance` | 内容合规检�?|
| POST | `/api/v2/publish/generate-tags` | 生成标签 |
| POST | `/api/v2/publish/generate-content` | 按平台生成文�?|
| POST | `/api/v2/publish/save-cookie` | 保存平台登录�?|
| POST | `/api/v2/publish/check-cookie` | 校验登录�?|
| GET | `/api/v2/publish/cookie-status` | 各平�?Cookie 有无 |

### tools �?在线工具 (`/api/v2/voice`, `/api/v2/image`, `/api/v2/agent`)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v2/voice/upload` | 上传音频 �?`{ fileId }` |
| POST | `/api/v2/voice/transcribe` | 转写/对齐 �?`{ taskId }` |
| POST | `/api/v2/voice/translate` | 语音翻译 �?`{ taskId }` |
| POST | `/api/v2/voice/summarize` | 总结 �?`{ taskId }` |
| POST | `/api/v2/voice/lyrics` | 歌词识别 �?`{ taskId }` |
| POST | `/api/v2/voice/separate` | 人声分离 �?`{ taskId }` |
| POST | `/api/v2/voice/tts` | 文本转语�?�?`{ taskId }` |
| GET | `/api/v2/voice/status/{taskId}` | 轮询状�?|
| GET | `/api/v2/voice/download/{fileId}` | 下载结果 |
| POST | `/api/v2/image/generate` | AI 生图 �?`{ taskId }` |
| GET | `/api/v2/image/status` | `?taskId=` 轮询状�?|
| POST | `/api/v2/image/recognize` | 图片识别 �?`{ result }` |
| POST | `/api/v2/agent/start` | 多智能体视频 �?`{ taskId }` |
| POST | `/api/v2/agent/one-click` | 一键成片（给主题即出片）→ `{ taskId, statusUrl, streamUrl }` |
| GET | `/api/v2/agent/status` | `?taskId=` 轮询状�?|
| GET | `/api/v2/agent/image` | `?taskId=&shotId=` 取产物图�?|

### edit �?视频编辑 (`/api/v2/edit`)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v2/edit/coarse-cut` | AI 粗剪+配音（multipart）→ `{ taskId }` |
| POST | `/api/v2/edit/draft-export` | CapCut 草稿包导出成片（multipart ZIP）→ `{ taskId, warnings }` |
| POST | `/api/v2/edit/super-res` | 视频超分（multipart）→ `{ taskId }` |
| POST | `/api/v2/edit/decrypt` | 解密 CapCut 草稿 JSON（multipart）→ `{ isPlain, msg, draft_content }` |
| GET | `/api/v2/edit/status/{taskId}` | 轮询状�?�?`{ status, downloadUrl, ... }` |

### subtitle �?字幕提取 (`/api/v2/subtitle`)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v2/subtitle/extract` | 视频字幕提取（multipart，`format`=txt/srt，`engine`=ocr/kimi）→ `{ taskId }` |
| GET | `/api/v2/subtitle/status/{taskId}` | 轮询状�?�?`{ status, format, result, lineCount, error }` |

### template �?模板搜索 (`/api/v2/template`)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v2/template/search` | `?keyword=&page=&pageSize=` �?`{ list }` |

> 错误码：�?�?Key �?`401`，配额耗尽 �?`402`，其余失�?�?`{ ok: false, errCode: 400, errMsg }`�?

---

## 设计理念

**HTW Media Skills 是一个能力层（capability layer），不是又一个工具�?*

底层�?HTW 媒体平台的完�?API，这套技能负�?*契约、封装、指�?*——Agent 不需要关心端点的请求格式、异步任务怎么轮询、平�?Cookie 怎么配，读一�?SKILL.md 就会用了�?
### 🔑 一�?Key，四个能�?
```
insight �?create �?publish �?tools
        └──── 共用 AuthKey ────�?```

申请一�?Key，四个能力全通。CLI 只从 `HTW_API_KEY` 环境变量读取，Key 永不写盘、永不进命令行历史�?
### ⏱️ 统一的异步模�?
耗时操作（视频生成、音频转写、多平台分发）全部是�?*提交 �?轮询**」：

```
POST /api/v2/agent/one-click    ──�? { taskId }     （秒回，不等结果�?GET  /api/v2/agent/status        ──�? { status }     （completed / running / failed�?GET  /api/v2/agent/image         ──�? 结果文件
```

接口不会超时，Agent 拿到 `taskId` 后按自己的节奏轮询即可�?
### 🛡�?安全与边�?
- 只暴�?*公开 API 契约**：路径、字段名、用法。不含源码与内部实现�?- Cookie �?*服务�?*，API 从不回传原文；本地只存你�?API Key 环境变量�?- 请保管好 Key，怀疑泄露就轮换。完整说明见 `docs/getting-started.md`�?
---

## 版本发布

本项目用「语义化版本 + GitHub tag」管理，安装时用 `#<tag>` 锁定版本�?
```bash
npx -y github:HTWMedia/HTWSkills#<tag> install
```

| 版本 | 日期 | 内容 |
|------|------|------|
| [v2.1.0](https://github.com/HTWMedia/HTWSkills/releases/tag/v2.1.0) | 2026-08 | **补齐最后三�?V2 端点**：新�?`subtitle`（`/api/v2/subtitle/extract` + `status`）、`template`（`/api/v2/template/search`）、`edit/decrypt`；CLI �?skills 全量指向 V2，不再依赖任�?v1 路径 |
| [v2.0.0](https://github.com/HTWMedia/HTWSkills/releases/tag/v2.0.0) | 2026-08 | **全量迁移�?V2 API（`/api/v2/*`�?*：insight/create/publish/tools 全部指向 v2，新�?`edit` 技能（视频粗剪/草稿导出/超分），CLI 新增 `edit` 功能�?`voice/translate`、`agent/one-click`；信封统一�?`{ ok, data, errCode, errMsg, taskId }` |
| [v1.0.1](https://github.com/HTWMedia/HTWSkills/releases/tag/v1.0.1) | 2026-08 | 音频/字幕接口改为异步契约：`audio/convert`、`audio/summarize`、`audio/separate`、`audio/lyrics`、`subtitle/extract` 提交后返�?`taskId`，新�?`audio/status`、`subtitle/status` 轮询；CLI 新增 `--audio-status`、`--subtitle-status` |
| [v1.0.0](https://github.com/HTWMedia/HTWSkills/releases/tag/v1.0.0) | 2026-08 | 首发：四个技能（insight / create / publish / tools�? `htw-skills` CLI + 文档 |

> Release 页面�?tag 一一对应，包含该版本的服务端 API 对照说明�?
---

## 关于

**HTW Media Skills** �?**HTWMedia 音视�?AI 平台**（`https://htwmedia.dpdns.org`）的开�?Agent Skills 包，由平台团队维护�?
平台的定位：把音视频内容生产链路（洞�?�?创作 �?分发 �?工具化）沉淀为可调用�?API，再�?SKILL.md + CLI 的形式交付给 AI Agent。任何能�?SKILL.md �?Agent 都能在几分钟内接入完整能力�?
这个仓库本身只是**契约�?*：公开 API 的路径、字段与用法，外加一个薄 CLI。核心的媒资洞察、AI 创作、多平台分发、音视频处理逻辑都在服务端完成�?
**技术栈**：Node.js (�?8) CLI · Markdown skills · 服务�?.NET 8 + AI 管线

**标签（Topics�?*�?
```
ai-agent · agent-skills · claude-code · codex · cursor · llm ·
video-generation · content-creation · multi-platform-publish ·
audio-transcription · subtitle · capcut · douyin · xiaohongshu · bilibili · api
```

> 想被更多人搜到？把这些标签填进仓�?**Topics**（`仓库设置 �?Topics`）�?
📖 快速上手指南：[docs/getting-started.md](docs/getting-started.md)

---

## 联系

- 📧 **邮箱:** 1005354833@qq.com
- 💬 **微信:** haitunwanav

Bug 反馈与功能建议请�?[GitHub Issues](https://github.com/HTWMedia/HTWSkills/issues)，更容易跟踪�?
---

## License

[MIT](LICENSE)

