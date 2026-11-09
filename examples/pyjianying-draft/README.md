# pyJianYingDraft → HTW 草稿渲染

用 Python 生成剪映草稿（[pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)），交给 HTW 云端渲成 mp4。
不用打开剪映、不用守着电脑，批量跑也不占本机。

```
build_draft.py      单段最小示例：一段视频 + 标题 + 配乐/字幕
build_complex.py    复杂示例：多段拼接 + 转场 + 滤镜 + 蒙版 + 关键帧 + 标题动画 + 双音轨 + 字幕
effects_catalog.py  特效应资源目录：按标题挑非 VIP 的 19 位资源 id（--list-fx 看清单）
apply_effects.py    把转场/滤镜改写成云端能认的形态（build_complex 在 save 之后自动调）
render.py           草稿目录 → zip → POST /api/v2/edit/draft-export → 轮询 → 下载 mp4
```

> 转场和滤镜**不能直接用 pyJianYingDraft 自带的元数据**：那是过期快照，`resource_id`
> 云端可能已无对应资源，而且失败是静默的（转场变整段黑、滤镜干脆不参与计算）。
> 详见「复杂草稿实测」一节。

## 跑起来

```bash
pip install pyJianYingDraft

# 1) 生成草稿：取素材前 15 秒，加标题和配乐
python build_draft.py --video 素材.mp4 --audio bgm.mp3 --title "开场标题" --seconds 15 --out ./drafts

# 1b) 复杂草稿：多段拼接 + 转场 + 蒙版 + 关键帧 + 双音轨 + 字幕
python build_complex.py --clips a.mp4,b.mp4,c.mp4 --voice 旁白.mp3 --bgm bgm.m4a --srt 字幕.srt --out ./drafts

# 1c) 想换转场/看有哪些非 VIP 资源
python build_complex.py --list-fx
python build_complex.py --clips a.mp4,b.mp4 --transitions 中心旋转,复古放映 --out ./drafts

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
两处转场、末段圆形蒙版 + 关键帧放大、标题入场动画、4 条 SRT 字幕、
人声 + BGM 双音轨。用本机实例 + 真实剪映登录态渲染，逐项抽帧核对：

| 特性 | 成片实测 |
| --- | --- |
| 三段拼接 / 1.5 倍速 | 通过。12.05s / 360 帧，段边界与时长都对 |
| 转场（目录现采 id，如 `中心旋转` / `复古放映`） | **通过**。资源自带动效可见：旋转扫屏的紫色几何面、放映机圆形光圈收拢；无异常黑段（`复古放映` 中途 0.13s 闪黑是该资源自带的换片效果） |
| 圆形蒙版 | 通过。圆形外纯黑、边缘羽化，蒙版随缩放一起变大 |
| 关键帧缩放 1.0 → 1.12 | 通过。末段画面与蒙版同步放大，内容对得上源素材 |
| 标题入场动画（向右擦除） | 通过。0.45s 处只出现前半句，1.2s 完整 |
| SRT 字幕 4 条 | 通过。时间点、文本与 SRT 一致 |
| 人声 + BGM 双音轨 | 通过。混音非静音（mean −17.6dB / max −1.8dB） |
| 滤镜 | **不呈现**。资源型（含 VIP 与 artist 活 id）/ 参数型 × 两种字段名，渲出的帧与无滤镜基线**逐像素相同**；根因是滤镜资源包（3D LUT）没进 `package_assets` |

### 转场：黑场的真因是资源 id，不是「不支持叠化」

`pyJianYingDraft` 的 `TransitionType.叠化` 写的是 `resource_id=6724845717472416269`——
这是一份过期快照，云端已无此资源；取不到资源时它**不报错**，直接把转场区域渲成黑色，
黑场时长正好等于转场时长，看起来很像「后端不支持叠化」。

换成 `Services/Editing/TransitionCatalog.json` 里现采的 id 就正常了。三点补充：

- **叠化类目前 52 条全部 VIP**，非 VIP 取不到。所以「要叠化效果」这件事在免费资源里
  没有解，同属 `is_overlap=true` 的非 VIP 样本只有 `复古放映`。
- 转场时长取目录的 `defaultDurationUs`，别沿用 `TransitionType` 的默认值——
  实际节奏由资源本身的 `sdk_extra.transition.defaultDura` 决定。
- **VIP 资源在云端不呈现，且失败方式不统一**（2026-11-09 实测）：`偏移叠化`
  `7667876831474830617`（VIP，2s）渲成整段黑场，时长正好 2.00 秒；`径向模糊`
  `7683443266288766260`（VIP，2s）不黑但画面完全清晰、没有放射拖影，等于被忽略成硬切。
  同类别里唯一非 VIP 的 `模糊` 正常出画。凡是 VIP，不要指望它出效果。

`build_complex.py --transitions` 收的是**目录里的标题或分类**（`--list-fx` 看清单），
选型阶段就把「VIP / 不存在」拦掉，不会渲完一条黑片才发现。

### 滤镜：形态对了，但云端拿不到 LUT

素材形态按 `docs/2026-10-11-style-filter-protocol.md` 摆好（进 `materials.filters`、
`path` 置空、`enable_adjust=true`、挂主轨每段 `extra_material_refs`）之后，
**成片与无滤镜基线逐像素相同**：同一帧 PNG 的 md5 完全一致，差值 0.000。

2026-11-09 二次复测把「id 无效」和「VIP 授权」两个猜测都排掉了。做法是同一画面切
4 段、四段共用同一个 `source_timerange`，段 1 当基线：

| 段 | 滤镜 | id 来源 | 与段 1 的 mean abs diff |
| --- | --- | --- | --- |
| 1 | 无（基线） | — | 0 |
| 2 | 冷蓝（非 VIP） | artist 接口可查、能下到 md5 与 CDN 地址 | 0.54 |
| 3 | 清晰（VIP） | 同上，`requirements=["blit"]` | 0.59 |
| 4 | 净白（VIP） | 同上 | 0.59 |

三条滤镜都换成了 **artist 平台活 id**（`7127618237117877518` / `7447719105563610404` /
`7127667352782572807`），不是 `FilterCatalog.json` 里那批查不到的死 id，结果依然不动，
0.5~0.6 就是同一条成片内不同位置的编码噪声。**VIP 与非 VIP 表现完全一致。**

根因看资源包结构就清楚了：滤镜本体是一张 3D LUT（冷蓝包 3.4MB，内含
`AmazingFeature/texture/filter_bg.3dl.vf`，64³×RGB×float32；清晰包 214KB，内含
`filter.cube.vf`，33³）。草稿里的 `resource_id` 只是索引，LUT 文件得由渲染方自己取到——
当前链路只上传音视频和贴纸，滤镜资源包从来没进过 `package_assets`，所以云端不调色、
也不报错。VIP 的实际限制在下载授权，而实测连这一步都没拦：三条资源的 `item_urls`
都正常返回、都下载成功（`is_vip` 只出现在返回的 `business_info` 里）。

判定方法（别只看「渲染成功」）：

```bash
# 1) 同一条草稿渲两次，量出编码噪声基线 —— 实测 mean abs diff ≈ 3.1（median 2）
# 2) 滤镜版 vs 基线，同一帧号比对 —— mean abs diff = 0.000
ffmpeg -i A.mp4 -i B.mp4 -lavfi "[0:v][1:v]psnr=stats_file=psnr.log" -f null -
```

⚠️ 用 `-ss <秒>` 抽帧对比会骗人：带转场的草稿渲出来可能是 29.77fps 而不是 30fps，
两片同一秒不是同一帧，PSNR 会显示 23dB 的假差异。要按帧号抽
（`-vf "select=eq(n\,30)"`）再比。

需要真实调色就把效果烧进素材再进草稿（`ffmpeg -vf eq=contrast=1.14 ...`）。
要打通「草稿里带滤镜」，得让服务端先下载资源包、上传云空间，并在 `package_assets`
里登记 `{md5, source_path, size}`（`Models/Utils.cs` 的
`QueryEffectResourceFileAsync` 已能查 md5 与 CDN 地址，但没有调用者）。

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
| **复杂草稿真实出片**（12 秒 / 3 段 / 双音轨 / 蒙版 / 关键帧 / 字幕，见上节） | **通过**。12.05s / 360 帧，无黑段 |
| **资源型转场**（`中心旋转` / `复古放映`，2026-11-09 复测） | **通过**。转场区域出现资源自带几何动效，无异常黑段；`叠化` 旧 id 的整段黑场不再复现 |
| **VIP 转场**（`偏移叠化` / `径向模糊`，2026-11-09 补测） | **不呈现**。前者黑场 2.00 秒（= 转场时长），后者无黑场但画面完全清晰、转场被忽略；同类别唯一非 VIP 的 `模糊` 正常 |
| **滤镜**（资源型 / 参数型 / VIP / artist 活 id，2026-11-09 两轮复测） | **不呈现**。同画面四段对照：三条滤镜与基线 mean abs diff 0.54 / 0.59 / 0.59，落在编码噪声内；根因是资源包（3D LUT）没上传，不是 id 或 VIP 限制 |

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
| `build_complex.py` | 复杂草稿：多段、转场、滤镜、蒙版、关键帧、标题动画、双音轨、字幕 |
| `effects_catalog.py` | 特效应资源目录：按标题挑非 VIP 的 19 位资源 id（`--list-fx`） |
| `apply_effects.py` | 把草稿里的转场/滤镜改写成云端能认的形态（save 之后跑） |
| `render.py` | 纯标准库客户端：打包、上传、轮询、下载 |
| `requirements.txt` | 只依赖 pyJianYingDraft |
