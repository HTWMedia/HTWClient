# PRD：选题雷达（Topic Selection）📝

> 版本 v0.1 ｜ 状态：原型已实现（前端 mock），待服务端实现
> 关联：[roadmap.md](roadmap.md) 近期项 ｜ 原型代码：`apps/desktop/js/skills/topics.js`

## 1. 背景与问题

创作者每天最痛的决策不是"怎么做"，而是"**做什么**"。当前产品要求用户自带主题
才能进入创作流程，缺少上游的选题能力：

- 热点卡片只展示当天快照，无法判断"上升期还是已过气"；
- 同垂类的同行爆了什么，用户不知道；
- AI 生成的选题没有数据背书，用户不敢直接用。

## 2. 目标与指标

| 目标 | 度量 |
| ---- | ---- |
| 让用户每天打开一次选题面板 | 选题面板 DAU / 整体 DAU ≥ 40% |
| 选题可被采纳 | 选题采纳率（点击"去创作"）/ 展示 ≥ 15% |
| 采纳的选题真的有效 | 采纳选题的视频平均播放 ≥ 未采纳的 1.2×（需数据回流验证） |

非目标（本版本不做）：付费档位、跨用户选题热门榜（合规风险高）。

## 3. 用户故事

1. 作为创作者，我每天打开工作台就能看到 **5~6 条带数据证据的选题**，点一下就能进入创作；
2. 作为创作者，我添加 3~5 个**对标账号**后，同行出现爆款时收到提醒，附上数据倍数；
3. 作为创作者，我想知道某个热点处于**上升期还是已过气**，避免追错热点；
4. 作为创作者，我想看到选题的**历史采纳效果**，判断是否值得信任。

## 4. 功能规格（三个 Tab）

### 4.1 今日选题（Topic Factory）

- 服务端每日生成 N 张**选题卡**（默认 6，可配置），按预估潜力排序；
- 选题卡信息结构见 §5.1；证据类型三种：对标爆款（peer）/ 热榜上升（hot）/ 趋势缺口（gap）；
- 卡片操作：**去创作**（标题写入创作面板主题框）/ **换一批** / 不感兴趣（负反馈，记录并降权）。

### 4.2 对标雷达（Radar）

- 用户添加对标账号（B站 / 小红书 / 抖音主页 URL），服务端周期采样其视频数据；
- 每账号维护**基线**：最近 10 条视频的播放/点赞均值；
- **爆款告警**：新视频数据 ≥ max(3 × 基线播放, 基线 + 500) 时生成告警卡；
- 告警卡操作：查看拆解（跳转洞察·视频分析）/ 静音该账号；
- 配额：免费用户 3 个账号 / 每日 2 次采样；付费档位提升（远期）。

### 4.3 热榜趋势（Trends）

- 现有热榜升级：增加 `delta`（较昨日热度变化）与 `stage`（rising / plateau / fading）；
- 服务端每小时采样一次热榜，形成热度曲线；stage 由近 24h 斜率判定；
- 前端以表格 + 趋势角标展示；点击行可"以此选题创作"。

## 5. 接口契约（/api/v2 扩展）

### 5.1 选题卡数据结构

```json
{
  "id": "tp_20260830_001",
  "date": "2026-08-30",
  "title": "打工人一周备餐指南：成本 50 块吃五天",
  "hook": "开头用价格对比制造冲突：一顿外卖 = 一天备餐",
  "category": "美食",
  "tags": ["备餐", "省钱", "上班族"],
  "evidence": {
    "type": "peer",                       // peer | hot | gap
    "ref_url": "https://www.xiaohongshu.com/explore/xxx",
    "ref_title": "本周备餐挑战",
    "metric_label": "数据超对标账号均值",
    "metric_value": "5.2×",
    "source": "对标雷达"
  },
  "score": 87                              // 预估潜力分，用于排序
}
```

### 5.2 端点

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/v2/topics/daily?count=6` | 今日选题卡列表（服务端按用户画像生成并缓存当日结果） |
| GET | `/api/v2/topics/trends?category=` | 热榜趋势（含 delta 与 stage） |
| GET | `/api/v2/topics/radar/accounts` | 对标账号列表（含基线数据） |
| POST | `/api/v2/topics/radar/accounts` | 添加对标账号 `{ platform, url }`，服务端解析并初始采样 |
| DELETE | `/api/v2/topics/radar/accounts/:id` | 移除对标账号 |
| GET | `/api/v2/topics/radar/alerts?since=` | 爆款告警列表 |
| POST | `/api/v2/topics/feedback` | 负反馈 `{ topic_id, reason }` |

### 5.3 数据模型（服务端）

```
radar_account(id, user_id, platform, url, display_name, avatar,
              baseline_plays, baseline_likes, sample_count, last_sampled_at)
radar_sample(id, account_id, video_id, title, published_at,
             plays, likes, comments, sampled_at)              -- 采样流水
radar_alert(id, user_id, account_id, video_id, multiplier, created_at, read_at)
trend_sample(id, source, title, rank, heat, sampled_at)        -- 热榜小时级采样
topic_card(id, date, user_id, title, hook, category, tags,
           evidence_json, score, feedback)                     -- 当日缓存 + 负反馈
user_profile(user_id, category, persona, covered_topics[])     -- 用户垂类画像
```

### 5.4 后台任务

- **对标采样**：cron 每小时，按用户配额轮询（免费档：每日 2 次/账号）；
- **热榜采样**：cron 每小时，按平台分头抓取并计算 delta / stage；
- **选题生成**：每日凌晨为活跃用户生成当日选题卡（LLM × 证据库，结果缓存）。

## 6. 前端原型说明

`js/skills/topics.js` 为**原型实现**：界面与交互完整，数据来自内置 mock
（`MOCK` 对象，接口形状与 §5 一致）。服务端实现后，将 `mockApi()` 替换为
`HTWApi.call()` 即可切换，UI 不需要改动。原型界面右上角有"原型模式"角标提示。

## 7. 风险与对策

| 风险 | 对策 |
| ---- | ---- |
| 平台数据采样的合规与风控 | 服务端限频采样、仅公开数据、标注来源；不提供批量导出 |
| LLM 生成选题质量不稳 | 选题必须挂证据卡；负反馈回流；无证据的选题不展示 |
| 免费用户采样成本 | 配额限制（3 账号/每日 2 采样）；采样任务错峰 |

## 8. 里程碑

| 里程碑 | 内容 | 依赖 |
| ------ | ---- | ---- |
| M0（已完成） | 前端原型（mock） | — |
| M1 | 选题工场服务端：热榜采样 + 垂类画像 + 选题生成 | 热榜采样 cron |
| M2 | 对标雷达服务端：账号采样 + 基线 + 告警 | 采样任务框架 |
| M3 | 数据回流与采纳效果统计 | 发布数据回流 |
