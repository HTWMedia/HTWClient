# HTW Media Client

HTW 媒体平台的**开源桌面客户端**。本仓库由原先两个独立仓库整合而来：

| 原仓库 | 去向 |
|--------|------|
| [HTWMedia/HTWSkills](https://github.com/HTWMedia/HTWSkills) | 其 Agent Skills 与 CLI **原样保留**于 `agent/`（仍可用 `npx` 或 `htw-skills` 调用） |
| [HTWMedia/JyDraft](https://github.com/HTWMedia/JyDraft) | **已退役归档**。剪映草稿*生成*能力不再包含在客户端；其*解密 / 渲染*能力由平台服务端经 `edit/decrypt`、`edit/draft-export` 端点提供，客户端无需本地 C# 代码 |

> 设计决定：新客户端不含生成草稿的代码（JyDraft 源码不进本仓）。所有重活都在平台服务端完成，客户端只负责调用 `/api/v2/*` 契约。

## 结构

```
.
├─ apps/desktop/        # Electron 桌面客户端（Node）
│  ├─ main.js
│  ├─ preload.js
│  ├─ index.html
│  └─ package.json
├─ agent/               # 原 HTWSkills，原样保留
│  ├─ skills/           # htw-media-{insight,create,publish,tools,edit}
│  ├─ cli/              # htw-skills.mjs + package.json（Node CLI）
│  └─ README.md
└─ docs/
```

## 快速开始

```bash
# 1) 桌面客户端
cd apps/desktop
npm install
npm start

# 2) Agent / 命令行（原 HTWSkills 能力）
cd agent/cli
export HTW_API_KEY="你的-key"
node htw-skills.mjs list
node htw-skills.mjs call insight --hot --dry-run
```

## 能力

与 `agent/skills` 中的 SKILL.md 完全一致，统一 V2 契约
`{ ok, data, errCode, errMsg, taskId }`：

- **insight** 媒资洞察 · **create** 内容创作 · **publish** 多平台分发
- **tools** 音频 / 图片 / Agent · **edit** 粗剪 / 草稿导出 / 超分 / 解密

Base URL：`https://htwmedia.dpdns.org`，请求头 `AuthKey: <key>`。

## License

[MIT](LICENSE)
