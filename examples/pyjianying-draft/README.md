# pyJianYingDraft → HTW 草稿渲染

用 Python 生成剪映草稿（[pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)），交给 HTW 云端渲成 mp4。
不用打开剪映、不用守着电脑，批量跑也不占本机。

```
build_draft.py    单段最小示例：一段视频 + 标题 + 配乐/字幕
build_complex.py  复杂示例：多段拼接 + 转场 + 蒙版 + 关键帧 + 标题动画 + 双音轨 + 字幕
render.py         草稿目录 → zip → POST /api/v2/edit/draft-export → 轮询 → 下载 mp4
```

## 跑起来

```bash
pip install pyJianYingDraft

# 1) 生成草稿：取素材前 15 秒，加标题和配乐
python build_draft.py --video 素材.mp4 --audio bgm.mp3 --title "开场标题" --seconds 15 --out ./drafts

# 1b) 复杂草稿：多段拼接 + 转场 + 蒙版 + 关键帧 + 双音轨 + 字幕
python build_complex.py --clips a.mp4,b.mp4,c.mp4 --voice 旁白.mp3 --bgm bgm.m4a --srt 字幕.srt --out ./drafts

# 2) 出片：AuthKey 从环境变量读，剪映 Cookie 从文件读
export HTW_API_KEY="你的-key"          # PowerShell: $env:HTW_API_KEY="你的-key"
python render.py --draft ./drafts/pjy-demo --cookie-file ./jy-cookie.txt --out ./out
```

两个凭据是两回事：

| 凭据 | 干什么 | 从哪来 |
| --- | --- | --- |
| `AuthKey` | HTW 平台账号，按成片时长计费 | [htwmedia.dpdns.org](https://htwmedia.dpdns.org) 邮箱申领 |
| 剪映 Cookie | 服务端拿**你自己的**剪映登录态跑渲染，用完不落盘 | 浏览器登录剪映网页版 → F12 → Network → 任一请求 → 复制 `Cookie` 整段 |

不写 Python 也行，仓库自带的 CLI 打的是同一个接口：

```bash
node agent/cli/htw-skills.mjs draft ./drafts/pjy-demo --cookie-file ./jy-cookie.txt --out ./out
```

## 为什么要有 `build_draft.py` 这一步

pyJianYingDraft 生成的 `draft_content.json` 里，素材写的是**你本机的绝对路径**
（`D:\素材\a.mp4`）。这份 JSON 上传到云端，`D:\素材\a.mp4` 不存在，
服务端只会返回一条「素材缺失」警告，然后渲出一段黑屏——**这条路必须改路径**。

`build_draft.py` 在 `script.save()` 之后做了两件事：

1. 把引用到的素材拷进草稿目录的 `materials/`；
2. 把 JSON 里的 `path` 改成剪映的草稿占位符形式
   `##_draftpath_placeholder_<草稿id>_##/materials/a.mp4`
   （`video_algorithm` / `audio_algorithm` 里那份 path 一起改）。

服务端的解析规则在 `HTWCore.Web/Common/MediaHelper.cs:53`，按顺序试三条：
带 `placeh` 的取 `##/` 之后的部分拼到草稿目录；绝对路径存在就用它；
最后按文件名在草稿目录里递归找。所以占位符前缀里的 id 是什么都无所谓，
真正起作用的是「文件确实在草稿目录里」。`render.py` 打的 zip 就是这个目录。

`--no-portable` 可以跳过这两步。那样生成的草稿只能在本机剪映里打开，**不要**拿去上传云端。

## 三个坑

**1. 秒 vs 微秒。** `trange(0, 6)` 是 **6 微秒**，不是 6 秒——pyJianYingDraft 把所有裸数字当微秒。
必须写 `trange("0s", "6s")`。这是最容易踩的一条：草稿看着正常，渲出来是 0 秒空片。
示例里的 `trange()` 包装函数已经处理了。

**2. zip 体积 = 源素材体积。** 自包含意味着把素材一起上传（5 分钟 1080p 大概 100–500MB）。
这是云端能读到文件的代价；不想传就别把大素材塞进草稿，改用已在云端的素材。

**3. 草稿结构版本。** pyJianYingDraft 0.3.x 写的是剪映 5.9 的结构
（`version: 360000` / `new_version: "110.0.0"`），HTW 云端按 `134.0.0` 提交。
**实测这条差异不影响出片**：服务端解析、素材定位、上传、渲染、回片全程正常，
6 秒 1080p 草稿出片参数与源草稿完全一致（见文末「验证到哪一步」）。
第一次用仍建议先渲一条 5 秒的短片确认画面，再上批量。

**4. `AudioMaterial` 不能吃带画面轨的 mp4。** 传视频会抛
`ValueError: 音频素材不应包含视频轨道`。BGM 想用视频里的音轨，先 `ffmpeg -vn -c:a aac` 抽出来。

**5. 同类型多条轨道必须起名。** 两条 audio 轨都用 `TrackSpec(TrackType.audio)` 会抛
`NameError: 'TrackType.audio' 类型的轨道已存在`，要写成 `TrackSpec(TrackType.audio, name="BGM")`。

## 复杂草稿实测（12 秒 / 3 段 / 双音轨）

`build_complex.py` 把常见特效塞进同一条草稿：3 段不同素材拼接、第 2 段 1.5 倍速、
两处转场（模糊 / 向左）、末段圆形蒙版 + 关键帧放大、标题入场动画、4 条 SRT 字幕、
人声 + BGM 双音轨。用本机实例 + 真实剪映登录态渲染，逐项抽帧核对：

| 特性 | 成片实测 |
| --- | --- |
| 三段拼接 / 1.5 倍速 | 通过。12.05s / 360 帧，段边界与时长都对 |
| 转场 `模糊`、`向左` | 通过。抽帧可见模糊过渡与滑动，无黑场 |
| 转场 `叠化` | **失败：整段纯黑**。黑场时长正好等于转场时长（0.8s、0.5s 各复现一次，亮度 0.0） |
| 圆形蒙版 | 通过。圆形外纯黑、边缘羽化，蒙版随缩放一起变大 |
| 关键帧缩放 1.0 → 1.12 | 通过。末段画面与蒙版同步放大，内容对得上源素材 |
| 标题入场动画（向右擦除） | 通过。0.45s 处只出现前半句，1.2s 完整 |
| SRT 字幕 4 条 | 通过。时间点、文本与 SRT 一致 |
| 人声 + BGM 双音轨 | 通过。混音非静音（mean −17.6dB / max −1.8dB） |
| 滤镜（冷蓝 / 清新 / 高清黑白） | **不生效**。4 段彩条对照，成片与无滤镜段落像素级一致（平均差 0.04） |

两条限制的规避方式：

- **转场只用 `模糊` / `向左` / `向右`。** `叠化` 会渲成黑场；它和 `模糊` 同属
  `is_overlap=true`，所以不是「重叠型转场」本身的问题，更像是该转场的资源在云端缺失。
  `build_complex.py --transitions` 只接受这三个，传别的会直接报错退出。
- **滤镜目前不要依赖。** 服务端会把 `materials.effects` 里 `type=filter` 的条目拆到
  `materials.filters` 并清空 `path`，但云端渲染不呈现（四种滤镜均无像素变化）。
  需要滤镜就先把效果烧进素材再进草稿，或等后端补齐资源上传。

## 接口契约（自己写客户端时照这张表）

```
POST /api/v2/edit/draft-export          multipart/form-data
  headers: AuthKey: <key>
           X-App-Source: HTWClient
  fields:  file=<草稿 zip>              # 必须含 draft_content.json（可以多一层同名目录）
           jianyingCookie=<Cookie 整段>  # 必填，缺了回 400
  → 200 { Ok, TaskId, Data: { warnings: [{ Type, Files }] } }

GET  /api/v2/edit/draft-status/{taskId}
  → 200 { Ok, Data: { status, progress, currentStep, downloadUrl, error } }
       status: running | completed | failed | cancelled
```

| 状态码 | 含义 |
| --- | --- |
| 400 | 草稿包没有 `draft_content.json`，或没带剪映 Cookie |
| 401 | AuthKey 无效 |
| 402 | 免费额度用尽（按月给成片时长，只在真正出片时扣） |
| 410 | 站点还停在「仅本地实例执行」的旧版本 |
| 429 | 并发任务达上限或提交过于频繁 |

`warnings` 不是错误：它列出「草稿引用了、但包里找不到的素材」，任务照常跑，
但那几段会是黑的。看到警告先补素材，别等渲完才发现。

## 这份示例验证到了哪一步

| 验证 | 结果 |
| --- | --- |
| `build_draft.py` 生成草稿（视频+标题+配乐 / 视频+SRT 字幕两种） | 通过，时长、轨道、素材都对 |
| HTW 客户端「草稿体检」解析同一份草稿（`apps/desktop/js/draft-local.js`） | 素材 0 缺失，结论「内容完整，可以直接导出成片」 |
| 服务端素材解析规则（`MediaHelper.ResolveMaterialPath`）逐条比对 | 本地素材全部命中，0 缺失 |
| `render.py` 打 zip / multipart 上传 / 轮询 / 错误提示（本机实例 127.0.0.1:5099） | 提交拿到 taskId；dummy Cookie 时正确显示 `初始化草稿失败（ret=1015）：check login error`；错 key 显示 401 并给出提示 |
| **真实出片**（本机实例 + 真实剪映登录态） | **通过**。6 秒草稿（视频 6s + 标题文字 + 配乐）→ 成片 1920×1080 / 30fps / 180 帧 / 6.06s，h264 + aac 44.1k 立体声，音轨 mean -20.8dB（非静音）；抽帧确认画面是源视频内容、标题压在前 2.5 秒，与时间轴一致 |
| 两条客户端路径一致性 | `render.py` 与 `node agent/cli/htw-skills.mjs draft` 产出的 mp4 字节数相同（1,165,201）、抽帧哈希相同 |
| **复杂草稿真实出片**（12 秒 / 3 段 / 双音轨 / 蒙版 / 关键帧 / 字幕，见上节） | **通过**。12.05s / 360 帧，无黑段；同时确认 `叠化` 黑场、滤镜不生效两条限制 |

实测数据（6.06 秒 1080p，云端耗时约 6 秒）：

```
video: h264 1920x1080 30fps 180 frames 6.046s
audio: aac 44100Hz stereo 6.060s
size : 1.10 MiB  bit_rate 1.54 Mbps
```

> 渲染执行在服务端，账号是调用方自己的：`jianyingCookie` 必填、站方不代管账号池，
> 按成片时长扣额度。所以这一段只能在你有剪映登录态的环境里跑。

## 文件

| 文件 | 作用 |
| --- | --- |
| `build_draft.py` | 建草稿 + 自包含改写；`--json` 输出一行摘要便于串联 |
| `build_complex.py` | 复杂草稿：多段、转场、蒙版、关键帧、标题动画、双音轨、字幕 |
| `render.py` | 纯标准库客户端：打包、上传、轮询、下载 |
| `requirements.txt` | 只依赖 pyJianYingDraft |
