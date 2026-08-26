# HTW Media 桌面客户端 — 能力界面设计 (Spec)

- 日期: 2026-08-26
- 范围: `apps/desktop` —— 把 `agent/skills` 的 5 个技能(insight / create / publish / tools / edit)接成具体按钮与界面
- 状态: 设计已确认,待实现

## 1. 技术决策(已与用户确认)

| 项 | 决定 |
|----|------|
| 外壳 | Electron (Node),`apps/desktop` |
| 前端栈 | 原生 JS,**无构建步骤**(Electron 直接加载 `index.html`) |
| 调用方式 | 渲染进程经 preload 的 `window.htw.call` **直接 fetch V2 API**(不 spawn CLI) |
| 范围 | 全量 5 技能,含 create 多步会话向导 |
| 密钥 | 顶栏 AuthKey 输入框,仅内存使用,不落盘 |

## 2. 架构

```
apps/desktop/
├─ index.html        应用外壳:顶栏(AuthKey + API Base)+ 5 标签(洞察/创作/分发/工具/编辑)+ 内容区
├─ css/app.css       暗色主题(沿用现有 index.html 风格)
├─ preload.js        扩展:window.htw.call(JSON) + window.htw.upload(FormData 文件上传)
├─ js/api.js         共享:call 包装、通用轮询 pollTask()、结果渲染、错误横幅
├─ js/ui.js          小组件:标签页切换、表单生成、toast
└─ js/skills/
   ├─ insight.js  create.js  publish.js  tools.js  edit.js   各渲染本技能表单并接线
```
- 每个技能模块只依赖 `window.htw` 与 `js/api.js` / `js/ui.js`,互不耦合。
- `main.js` 保持现状(创建 BrowserWindow + preload);如需菜单可后置。

## 3. 数据流

1. 顶栏填 AuthKey(内存)、可选改 API Base(默认 `https://htwmedia.dpdns.org`)。
2. 按钮 → 对应 `skills/*.js` 收集表单字段 → `api.call(method, path, body)`(JSON)或 `api.upload(formData, path)`(文件类)。
3. 同步端点:直接渲染返回的 `data`(pretty JSON / 结构化列表)。
4. 异步端点:拿到 `taskId`/`sessionId` → `pollTask(getStatusFn, onUpdate)` 定时(默认 3s)轮询状态接口,直到 `completed`/`failed`,实时刷新进度与结果(含下载链接/产物)。

## 4. preload 扩展

现有 `window.htw.call(method, path, body, apiKey)` 仅支持 JSON。新增:

```js
window.htw.upload = async (formData, path, apiKey) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { AuthKey: apiKey || "" },   // 不设 Content-Type,浏览器自动加 boundary
    body: formData,                        // FormData
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
};
```
供音频上传、图片识别、视频粗剪/超分、草稿导出(ZIP)、字幕提取、草稿解密等文件类端点使用。

## 5. 各技能界面(全量)

### 5.1 insight — 媒资洞察
| UI 元素 | 端点 |
|----|----|
| 按钮「全网热搜」 | GET `/api/v2/insight/hot-rankings` |
| 视频分析(url) | POST `/api/v2/insight/analyze-video` `{url}` |
| 账号分析(url) | POST `/api/v2/insight/analyze-account` `{url}` |
| 文案分析(text) | POST `/api/v2/insight/analyze-copy` `{text}` |
| 平台搜索(platform+keyword+count) | POST `/api/v2/insight/search` |
| 头条:用户信息/作品/搜索 | POST `/api/v2/insight/toutiao-user-info|works|search` |

结果区:热搜渲染为「平台 → 榜单列表」;其余渲染 `data` 结构化/JSON。

### 5.2 create — 内容创作(向导)
1. `GET /api/v2/creation/types` → 下拉选择视频类型预设 + 填主题 → `POST /api/v2/creation/start` `{type, topic, videoTypeId}` → 得 `sessionId`。
2. 会话面板展示 `GET /api/v2/creation/status?sessionId=&type=` 的当前 step 与产物。
3. 操作按钮:
   - approve: `POST /api/v2/creation/approve` `{sessionId, type}`
   - regenerate: `POST /api/v2/creation/regenerate` `{sessionId, instruction, type}`
   - refine: `POST /api/v2/creation/refine` `{sessionId, message, type}`
   - toggle-step: `POST /api/v2/creation/toggle-step` `{sessionId, stepId, enabled, type}`
4. 每次操作后轮询 `status` 刷新产物;可选 上传素材 `POST /api/v2/creation/upload-material`(文件)。

### 5.3 publish — 多平台分发
表单:标题、正文、标签[]、媒体URL[]、封面、平台(抖音/小红书/B站/头条 多选)。
- 提交: `POST /api/v2/publish/submit` → `taskId` → 轮询 `GET /api/v2/publish/task-status?taskId=`。
- 辅助:合规检查 `POST /api/v2/publish/check-compliance`、生成标签 `POST /api/v2/publish/generate-tags`、生成文案 `POST /api/v2/publish/generate-content`、上传文件 `POST /api/v2/publish/upload-file`(文件)、队列 `GET /api/v2/publish/queue-status`、历史 `GET /api/v2/publish/history`。
- 失败子任务可 `POST /api/v2/publish/retry` `{subTaskId}`。

### 5.4 tools — 在线工具
- **音频**:`upload` 文件 → `fileId`;按钮 transcribe(`{fileId,format}`)/translate(`{fileId,language}`)/summarize/separate(`{fileId,type}`)/lyrics/tts(`{text,speaker}`)→ 各自 `taskId` → 轮询 `GET /api/v2/voice/status/{taskId}`;结果可用 `GET /api/v2/voice/download/{fileId}` 下载。
- **图片**:generate(`{prompt,model,ratio,...}`)→ 轮询 `GET /api/v2/image/status?taskId=`;recognize(`upload` 文件)→ 同步返回 `{result}`;qwen-generate 同 generate。
- **Agent**:one-click(`{topic,platform,length,style,ratio,mode,referenceText,voice}`)→ `{taskId,statusUrl,streamUrl}`;或 start(全 VideoOptions)→ `taskId`;轮询 `GET /api/v2/agent/status?taskId=`;产物图 `GET /api/v2/agent/image?taskId=&shotId=`。
- **字幕**:extract(`upload` 视频 + `format`/`engine`)→ `taskId` → 轮询 `GET /api/v2/subtitle/status/{taskId}`。
- **模板**:search(`keyword,page,pageSize`)→ `{list}`(同步)。

### 5.5 edit — 视频编辑
- coarse-cut:`upload` 视频 + `voice`/`durationMin`/`durationMax`/`blur` → `taskId` → 轮询 `GET /api/v2/edit/status/{taskId}`。
- draft-export:`upload` 草稿 ZIP → `{taskId, warnings}` → 轮询同上。
- super-res:`upload` 视频 + `width`/`height` → `taskId` → 轮询同上。
- decrypt:`upload` 草稿 JSON(.json ≤50MB)→ 同步 `{isPlain, msg, draft_content}`。

## 6. 错误处理

- 所有 `api.call` / `api.upload` 返回 `{status, ok, data}`。
- `ok:false` 或 HTTP 非 2xx:顶部红色横幅显示 `errCode` + `errMsg`。
- 401 → 提示「请填写 AuthKey」并聚焦顶栏输入框。
- 402 → 显示配额耗尽文案(含充值链接,沿用服务端 `redirectUrl`)。
- 文件类端点返回非 2xx 同样走横幅。

## 7. 文件清单(实现产物,均在 apps/desktop/)

- `index.html`(重写外壳)
- `css/app.css`(新增)
- `preload.js`(扩展 upload)
- `js/api.js`、`js/ui.js`(新增)
- `js/skills/insight.js`、`create.js`、`publish.js`、`tools.js`、`edit.js`(新增)
- `main.js`(基本不变)
- `package.json`(基本不变;`electron` 已在 devDeps)

## 8. 验证

- 纯前端、无单测框架:`node --check` 校验每个 `.js` 语法。
- 人工走查(`cd apps/desktop && npm install && npm start`):
  1. 填 AuthKey → 热搜/视频分析即时出结果。
  2. tools→音频上传→转写→轮询 voice/status 出文稿。
  3. edit→decrypt 上传 JSON→同步出 draft_content。
  4. create→选类型+主题→start→approve/regenerate→status 刷新产物。
  5. publish→提交多平台→轮询 task-status→完成。
- headless 环境无法自动启 Electron,以人工走查为准;交付时附步骤清单。

## 9. 明确不做(YAGNI)

- 不引入前端框架 / 构建步骤。
- 不 spawn `htw-skills.mjs` CLI(直接调 API)。
- 不做「复制为 CLI 命令」(用户选直接 API)。
- 不内置草稿生成(JyDraft 已退役,生成不在客户端)。
- 不做账号体系 / 本地数据库;密钥仅内存。
