<div align="center">

# HTW Media

### 短视频工作台：选题 → 脚本 → 剪辑 → 四平台发布

一个后端包完「今天发什么 → 发出去没」。桌面端是图形壳，CLI 与 Agent Skills 调的是同一套 `/api/v2/*`。

<sub>非官方工具，与字节跳动 / 剪映无从属关系。涉及剪映的部分只处理**你自己**的草稿与登录态：登录态由你提供、只随请求使用一次，平台不代管他人账号、不下载他人模板，见文末「合规边界」。</sub>

<p align="center">
  <img src="docs/images/banner.png" width="720" alt="HTW Media">
</p>

[![Version](https://img.shields.io/badge/version-v0.5.0-blue.svg)](https://github.com/HTWMedia/HTWClient/releases/latest)
[![Download](https://img.shields.io/badge/download-Windows%20exe-brightgreen.svg)](https://github.com/HTWMedia/HTWClient/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://htwmedia.dpdns.org)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/HTWMedia/HTWClient?style=social)](https://github.com/HTWMedia/HTWClient/stargazers)

简体中文 ｜ [English](README_EN.md) ｜ [问题反馈](https://github.com/HTWMedia/HTWClient/issues) ｜ [版本发布](https://github.com/HTWMedia/HTWClient/releases) ｜ [在线体验](https://htwmedia.dpdns.org)

**关键词**：短视频工作台 · 抖音小红书B站头条一键发布 · AI 选题 · 爆款拆解 · 批量出片 · 剪映草稿工程 · 草稿导出 · Agent Skills

</div>

---

## 60 秒跑通：先看「今天发什么」

```bash
git clone --depth 1 https://github.com/HTWMedia/HTWClient
cd HTWClient

export HTW_API_KEY="你的-key"        # PowerShell: $env:HTW_API_KEY="你的-key"

node agent/cli/htw-skills.mjs call topics --daily
```

不用配任何平台账号就能跑：

- 每条选题带**数据证据**（对标账号近期的高播放内容、热榜走势），不是拍脑袋的标题；
- 采纳后直接进创作，脚本 / 图文 / 文章三种形态都能出；
- `--json` 输出机器可读结果，方便接进自己的流程。

> 需要 AuthKey：到 [HTW 媒体平台](https://htwmedia.dpdns.org) 注册后在「设置」里创建。
> 免费档每月 **60 分钟**渲染时长，按月重置；额度只在真正出片时扣，失败不扣。

### 进阶：把自己剪的草稿工程渲成片（云端渲染）

```bash
node agent/cli/htw-skills.mjs draft "<草稿目录>" --cookie-file ./jy-cookie.txt
```

传**目录**会自动打包（含素材、保留子目录），也可以直接传已打好的 `.zip`；成片回写到同目录。
草稿路径不用猜：剪映里右键草稿 →「打开草稿文件夹」，就是它。

- **渲染在云端执行**：任务提交到平台服务端，按成片时长扣会员额度（额度不足回 402）；
- **账号是你自己的**：必须提供你自己的登录态（`--cookie` / `--cookie-file` / `HTW_JIANYING_COOKIE`），
  平台不代管、不轮换账号；登录态只随这一次请求使用，服务端用完不落盘，
  桌面端把它明文存在本机配置文件 `userData/htw-jianying.json`（与 AuthKey 同一个目录），点「清除」即删；
- 想直连本机实例（若你自己有）可以加 `--local-base`，那是可选覆盖，不再是前提；
- **它不是绕过会员权益的途径**：没有该账号的权益，需要会员的功能照样渲不出来；
- 加密草稿（5.9 之后默认加密）本地能读，不用先处理；
- 参数：`--out <目录>` 指定输出位置 · `--no-wait` 只提交不等待 · `--json` 输出 JSON。
  退出码：`0` 成功 · `1` 渲染失败 · `2` 参数/路径错误 · `3` 未设置 key。

---

## 桌面端：同一套能力的图形壳

不习惯命令行就下载客户端，九个面板走完「选题 → 创作 → 剪辑 → 发布」：

| 文件 | 说明 | 直接下载 |
| --- | --- | --- |
| `HTW.Media.Setup.0.5.0.exe` | 安装版，带开始菜单快捷方式 | [下载](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/HTW.Media.Setup.0.5.0.exe) |
| `HTW.Media.0.5.0.exe` | 便携版，双击即用，不写注册表 | [下载](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/HTW.Media.0.5.0.exe) |

> Mac / Linux 直接用 Web 端 <https://htwmedia.dpdns.org>，与桌面端同一账号、同一配额、同一套接口。

![HTWClient 30 秒演示](docs/images/demo.gif)

桌面端与 CLI 调用的是同一套 `/api/v2/*` 契约，重活（转写、渲染、发布）都在服务端跑，老笔记本也能挂着批量任务。草稿导出同样在服务端执行，但登录态要你自己提供、平台不代管账号（见上文）。

---

## 三个入口，同一个后端

1. **一条流水线串起来。** 选题 → 脚本 → 剪辑 → 发布，四段各自能单独用，也能一次跑完；产物在后端直接传给下一步，不用在四个工具之间搬文件。桌面端、CLI、Agent Skills 用的是同一套接口。
2. **渲完直接发四个平台。** 抖音 · 小红书 · B站 · 今日头条，一次提交，发布前跑合规检测，失败可单独重试。
3. **同一套能力以 Agent Skills 开放。** `agent/skills/` 可装进 Claude Code / Cursor，让 AI 助手自己编排「查热点 → 写脚本 → 出片 → 发布」。

> 姊妹项目 [HDraft](https://github.com/HTWMedia/JyDraft) 是草稿渲染的纯 CLI 版（多草稿并发、断点续传），定位更单一。

---

## 能力全景

| 面板 | 输入 → 输出 | 核心能力 | 什么时候用 |
| --- | --- | --- | --- |
| ✂️ **剪辑 Edit** | 视频 / 自己的草稿工程 → 成片或工程 | 粗剪、智能包装、超分、草稿导出成片、加密草稿读取 | 已有素材要加工；或把自己的工程渲成片 |
| 📤 **发布 Publish** | 成片 → 四个平台 | 一次分发到抖音 · 小红书 · B站 · 今日头条；发布前合规检测；AI 生成文案与封面；任务队列 / 历史 / 重试 | 一次搞定四个平台 |
| 💡 **选题 Topics** | 垂类画像 → 今日选题卡 | 今日选题（带数据证据）、对标雷达、热榜趋势（上升 / 平台 / 过气） | 每天早上决定「今天发什么」 |
| 📈 **洞察 Analysis** | 文案 / 视频链接 / 账号主页 → 报告 | 文案拆解（标题 · 标签 · 钩子 · 爆款元素）、视频解析（B站 / 小红书 / 抖音）、热榜速览 | 拆解同行爆款，找可复用套路 |
| ✨ **创作 Create** | 一句话主题 → 可拍脚本 | 脚本 / 图文 / 文章；可选调研、关键点提取、素材搜索、自动发布；实时进度 + 确认 / 重生成 / 精修 | 从想法到可拍的脚本 |
| 🎬 **营销成片** | 商品图 / 视频 → 带货短视频 | 自动提炼卖点与口播文案，产出带营销浮层的成片 | 电商带货、商品种草 |
| 🎭 **短剧创作** | 剧情创意 → 成片 | 规划 → 剧本 → 分镜 → 成片，支持多轮细化与动态镜头 | 剧情号连续更新 |
| 🧰 **工具 Tools** | 音视频 / 图片 → 文本或素材 | 转写、翻译、总结、歌词提取、人声分离、TTS 配音、图像生成、图像识别、字幕提取、模板搜索 | 处理素材 |
| 💬 **助手 Assistant** | 自然语言 → 上面的能力 | 对话式入口驱动全流程（唯一不走 `/api/v2/*` 的面板） | 不想找按钮的时候 |

其他值得一提的：大文件超 10MB 自动分片上传；客户端只做调度，升级不影响你的素材；全流程可脚本化（`agent/` 下的 Skills 与 CLI 暴露同样的能力）。

选题模块的接口契约与数据模型见 [docs/prd-topic-selection.md](docs/prd-topic-selection.md)。

---

## 📺 视频教程（11 集 · 约 14 分钟）

每个功能一集：功能介绍 + 真实操作 + 结果展示，中文配音与烧录字幕，云端渲染等待段已加速。
也可以在 B 站合集里一口气看完：[HTW 工作台全流程教程](https://www.bilibili.com/video/BV1ddxm68Edo)。

| # | 视频 | 时长 | 看点 |
|---|---|---|---|
| 01 | [安装与初始配置](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/01-setup.mp4) | 1:59 | AuthKey 配置（**必看**）、本地模式 |
| 02 | [剪辑 · 视频粗剪](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/02-coarse-cut.mp4) | 2:28 | 带口播的长视频 → 自动剪出带配音字幕的成片 |
| 04 | [剪辑 · 智能包装](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/04-smart-pack.mp4) | 0:53 | 一键加字幕、音效、贴纸 |
| 05 | [剪辑 · 草稿导出 / 超分](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/05-draft-sr-decrypt.mp4) | 1:44 | 自己的草稿工程渲成片、画质增强 |
| 06 | [洞察与选题](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/06-insight-topics.mp4) | 1:00 | 爆款文案拆解、带数据证据的每日选题 |
| 07 | [工具](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/07-tools.mp4) | 0:49 | 转写、翻译、人声分离、配音、图像生成 |
| 08 | [批量](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/08-batch.mp4) | 0:51 | 按商品条目批量出片（营销成片 / 智能包装） |
| 09 | [营销成片与工作流](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/09-marketflow.mp4) | 0:46 | 电商带货批量出片、全链路自动串接 |
| 10 | [发布与任务中心](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/10-publish-tasks.mp4) | 0:56 | 四平台一键分发、任务进度实时推送 |
| 11 | [短剧 · 助手 · 创作 · 总结](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/11-shortdrama-assistant.mp4) | 1:07 | 剧本 → 分集 → 成片的短剧批量生产 |

> 图文版教程（9 章，功能点 / 步骤 / 效果 / 注意事项）：[guide-videos/out/使用说明.md](guide-videos/out/使用说明.md)。

---

## 从源码启动

```bash
cd apps/desktop
npm install      # 首次需下载 Electron
npm start
```

---

## 🧩 本地模式（可选 · 自备可执行文件）

桌面端可以在这台机器上拉起一个**本地实例**进程（转写 / 渲染等重活跑在本机），并在「设置 → 本地实例」里管理它。**默认关闭。**

| 要填什么 | 怎么填 | 填错会怎样 |
| --- | --- | --- |
| 可执行文件路径 | 填**绝对路径**，例如 `C:\tools\local-instance.exe` | 状态行提示「找不到该可执行文件：<你填的路径>」 |
| 本地实例地址 | **一般不用填** —— 客户端启动实例后自动发现并回填 | 非本机地址 / 带路径的地址会被拒绝并说明原因 |

- **可执行文件从哪来**：由你自行获取，本项目**不附带、不分发**任何可执行文件；填好后记在本机，下次启动自动回填。
- **能力边界**：本地模式负责进程启停、地址发现与配对；业务请求按**端点能力清单**切到本机，需在设置里显式启用总开关。清单只收**能在本机独立执行**的端点，其余（含大文件上传 / 下载）仍走云端。
- **可检查更新与一键更新**：与服务器下发的本地实例包比对版本，下载并解压到版本化新目录（旧目录与配置不动），完成后「重启并启用」。
- **不兼容会被拦下来**：启动后自动做连通性与协议版本自检，对不上会提示「本地实例与客户端不兼容」，配对也会被拒绝（不会把账号材料发给对不上的实例）。
- **设置页可看最近请求走了本机还是云端**：最近 8 条（时间、方法、路径、本地/云端，失败带 ✕），只存本轮内存，重启清零。

---

## 🆕 v0.5.0 更新

| 模块 | 内容 |
| --- | --- |
| ⏱️ **任务中心** | 所有面板的创作任务统一登记、按域聚合，展示真实进度与终态 |
| 📡 **进度推送** | 长任务经 SSE 实时推送，断线自动恢复并重新挂接已有记录 |
| 🧭 **会话与批量** | 同域任务复用同一会话；批量统一登记，不留「永远进行中」的僵尸记录 |
| ✋ **审批等待** | 等待用户确认的任务不再空转轮询 |
| 🔧 **修复** | 启动时服务端不可达不再停在「没有任务记录」；推送恢复后正确清除「状态未确认」标记 |

---

## 三条典型工作流

**① 日更博主**：选题看今日卡 → 进入创作生成脚本（实时进度，不满意就精修）→ 成片送发布 → 勾四个平台，合规检测完提交。

**② 带货短视频**：营销成片上传商品图 → 自动生成卖点与口播 → 预览下载 → 进发布配好平台直接发。

**③ 批量出片**：草稿目录批量丢给 `htw-skills draft`，或直接用 [HDraft](https://github.com/HTWMedia/JyDraft) 多草稿并发跑。

---

## 给 AI 助手用 🤖

`agent/` 下的 Skills 与 CLI 覆盖了和桌面端相同的能力，可被任意支持 Skill 的 AI Agent 调用：

```bash
cd agent/cli
export HTW_API_KEY="你的-key"
node htw-skills.mjs list                        # 列出可用能力
node htw-skills.mjs call insight --hot --dry-run
```

能力清单：`insight` · `create` · `topics` · `publish` · `tools` · `edit` · `workflow`。
完整 CLI 参数见 [docs/getting-started.md](docs/getting-started.md)。

---

## 项目结构 📂

```
.
├─ apps/desktop/        # Electron 桌面客户端（图形壳）
│  ├─ main.js  preload.js  index.html
│  ├─ js/               # 工作台 UI 与 9 个能力面板
│  └─ assets/icon.ico
├─ agent/               # Agent Skills + Node CLI（草稿成片、洞察、发布…）
│  ├─ skills/           # htw-media-{insight,create,topics,publish,tools,edit,…}
│  └─ cli/
├─ guide-videos/        # 教程视频流水线：TTS → CDP 真机录制 → 加速拼接 → 字幕烧录
└─ docs/                # 上手指南、选题 PRD、路线图、踩坑记
```

---

## 🔒 数据与信任 🛡️

以下每一行都与代码行为一致，欢迎直接审阅源码验证。

| 你担心的 | 实际情况 |
| --- | --- |
| 素材 / 成片存在哪？ | 仅在服务端处理期间临时使用，**任务完成即销毁，不做保留** |
| 平台 Cookie 会传给服务器吗？ | **会**。在「发布 → 配置 Cookie」保存时，Cookie 会上传并存放在服务端，用于服务端代你发布；`get-cookie` 也可取回。它是账号的完整登录凭据，**等同于把账号密码交给我们**，请只在信任本服务的前提下填写，并定期在各平台改密码 / 退出登录使其失效 |
| 有人看我的内容吗？ | **没有**。转写 / 剪辑 / 发布均由自动化流水线处理，无人工介入 |
| 会不会跑一半跑路？ | 平台持续运营中；免费档每月 60 分钟额度，按月重置。演进规划公开在[路线图](docs/roadmap.md) |
| AuthKey 是干什么用的？ | 防流量攻击的准入闸口，不做内容授权、不采集素材 |

---

## 合规边界

这个项目**不是剪映的替代品，也不是绕过剪映付费权益的工具**。为避免误解，把边界写清楚：

**做这些**：处理你自己拍摄、自己剪辑的素材与工程；用你自己的账号发布到各平台。

**不做这些**（部分功能已因此下线）：

| 事项 | 现状 |
| --- | --- |
| 下载、套用剪映的模板 / 贴纸 / 特效并对外出片（「剪同款」） | **已于 2026-11-06 下线**。模板与素材的版权属于剪映及其模板作者，站外提供同类服务已有生效判决认定构成不正当竞争 |
| 多账号轮换以绕开剪映按账号的限流（原「账号池」） | **已移除**。现在固定使用一个账号，撞限流就如实失败，不换号重试 |
| 代用户用站方配置的账号渲染草稿并按时长转售（原「代操作」形态） | **不做**。草稿导出虽在服务端执行、按成片时长计费，但登录态必须由用户自己提供：站方不持有账号池、不轮换账号，登录态只随该次请求使用、用完不落盘 |
| 提供剪映会员专属功能给非会员 | **不提供**。没有对应权益，需要会员的功能照样渲不出来 |

商标「剪映」「CapCut」归其权利人所有，本项目仅以指示性方式说明兼容的文件格式。
如果你认为本项目的某项行为越过了边界，请提 issue 或邮件联系，我们会核实并调整。

---

## 常见问题 🤔

<details>
<summary><b>没有 AuthKey 怎么办？</b></summary>

打开 [HTW 媒体平台](https://htwmedia.dpdns.org)，在 Web 端「设置」创建 AuthKey，粘贴到桌面端左侧「设置」或 `HTW_API_KEY` 环境变量。所有接口通过 `AuthKey` 请求头校验。
</details>

<details>
<summary><b>提示 402 / 额度用完？</b></summary>

`402` 表示**本月额度已用完**（不是 Key 失效，Key 失效是 `401`）。到平台充值后即可继续；额度只在真正出片时扣减，失败任务不扣（草稿导出同样按成片时长扣，只是登录态要你自己提供）。
</details>

<details>
<summary><b>`draft` 命令报「没有 draft_content.json」？</b></summary>

传的目录不是剪映草稿目录。剪映里右键草稿 →「打开草稿文件夹」，用那个目录；它下面应该直接有 `draft_content.json`。
</details>

<details>
<summary><b>草稿导出报 410 / 提示「只在本机执行」？</b></summary>

这条链路现在只在你自己的机器上跑（渲染用你自己的剪映账号与权益，登录态不出本机），云端不再代跑。

- **桌面端**：「设置 → 本地模式」勾选「启用本地模式」→ 点「启动本地实例」→ 等状态变成「本地实例运行中」→ 点「一键配对」看到「本地模式就绪」。再到「剪辑 → 草稿导出」填自己的剪映 Cookie。
- **CLI**：加 `--local-base http://127.0.0.1:<端口>`（端口在设置页显示，每个进程随机）和 `--cookie-file <文件>`。

410 就是「请求打到了云端」的意思——地址没指到本地实例。
</details>

<details>
<summary><b>草稿里有「曲库」音乐，渲染报 200403？</b></summary>

曲库音乐的授权绑定在剪映账号上。现在渲染用的是**你自己**的账号：先在剪映里把那条曲库音乐换成本地音频文件，再导出草稿包重跑。
</details>

<details>
<summary><b>上传大视频很慢 / 卡住？</b></summary>

客户端内置分片上传：单文件超 10MB 自动切 10MB 分片逐个提交，规避反向代理请求体限制。自建部署可用环境变量 `HTW_API_DIRECT` 指定直连地址。
</details>

<details>
<summary><b>发布到抖音 / 小红书失败？</b></summary>

多平台发布依赖各平台登录态（Cookie）。在「发布」面板点对应平台「配置 Cookie」填入后再提交；缺少时会提示「以下平台尚未配置 Cookie，无法发布」。
</details>

<details>
<summary><b>Mac 能用吗？</b></summary>

能。CLI 在 macOS / Linux 上直接跑（Node 18+）；图形界面用 Web 端 <https://htwmedia.dpdns.org>，能力与桌面端一致。
</details>

---

## 配置要求 📦

| 项目 | 说明 |
| --- | --- |
| 系统 | Windows 10+（桌面端）／ macOS、Linux、任意带浏览器的设备（CLI 与 Web 端） |
| 运行 | CLI 需 Node.js 18+；下载版桌面端无需 Node |
| 账号 | 需 HTW 媒体平台 `AuthKey`，免费档每月 60 分钟 |

## 参与贡献 🤝

Issue 与 PR 都欢迎。提 Bug 时附上客户端版本 / CLI 版本、系统与复现步骤会快很多。
功能建议请直接开 Issue 描述你的使用场景 —— 场景比功能清单更好评估优先级。

## 许可证 📝

[MIT](LICENSE)

## Star History

<a href="https://www.star-history.com/?repos=HTWMedia%2FHTWClient&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=HTWMedia/HTWClient&type=date&theme=dark&legend=top-left">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=HTWMedia/HTWClient&type=date&theme=light&legend=top-left">
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=HTWMedia/HTWClient&type=date&legend=top-left">
  </picture>
</a>
