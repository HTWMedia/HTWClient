# pyJianYingDraft → HTW 草稿渲染

用 Python 生成剪映草稿（[pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)），交给 HTW 云端渲成 mp4。
不用打开剪映、不用守着电脑，批量跑也不占本机。

```
build_draft.py      单段最小示例：一段视频 + 标题 + 配乐/字幕
build_complex.py    复杂示例：多段拼接 + 转场 + 滤镜 + 蒙版 + 关键帧 + 标题动画 + 双音轨 + 字幕
effects_catalog.py  资源目录：转场挑非 VIP id；滤镜只放行已验证的 7 位短 id（--list-fx 看清单）
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

> 每条命令的实际输出、生成的草稿结构、资源清单与选型结果见下一节「示例展示」。

## 示例展示

下面都是脚本的实际输出。示例素材是一段 3 秒测试视频、一份两条字幕的字幕文件、两段从同一视频抽出的音频；换成自己的素材即可。**造草稿这一步不联网、不需要凭据**，只有第 4 步出片需要 AuthKey 与剪映登录态。为便于阅读，输出里的临时绝对路径统一简写成 `./drafts/...`，其余数字与资源标识均为实测值。

### 1）最小草稿：一段视频 + 标题

```bash
python build_draft.py --video clip.mp4 --title "开场标题" --seconds 3 --out ./drafts
```

```
草稿已生成: ./drafts/pjy-demo
  画布 1920x1080@30  时长 3.0s
  拷入素材 1 个，改写路径 1 条
    materials/clip.mp4

下一步（草稿 → 成片）:
  python render.py --draft "./drafts/pjy-demo" --cookie-file ./jy-cookie.txt --out ./out
```

加 `--json` 只输出一行摘要，便于脚本串联：

```json
{"draft_dir": "./drafts/pjy-demo", "duration_sec": 3.0, "canvas": "1920x1080@30", "materials_copied": ["clip.mp4"], "paths_rewritten": 1, "missing": []}
```

草稿目录是自包含的，素材就在目录里，不依赖本机绝对路径：

```
drafts/pjy-demo/
├── draft_content.json
├── draft_meta_info.json
└── materials/clip.mp4
```

`draft_content.json` 里原本的 `D:\...\clip.mp4` 已被换成剪映占位符；前缀里的草稿 id 每次生成都不同，服务端只取 `##/` 之后的部分：

```
videos[0].path = ##_draftpath_placeholder_91E08AC5-..._##/materials/clip.mp4
tracks         = [video×1, text×1]
```

### 2）复杂草稿：多段 + 转场 + 滤镜 + 蒙版 + 关键帧 + 字幕 + 双音轨

```bash
python build_complex.py --clips clip.mp4,clip2.mp4 --clip-seconds 2 \
  --transitions 中心旋转 --filter 净透 --srt demo.srt \
  --voice voice.mp3 --bgm bgm.mp3 --out ./drafts --name pjy-complex
```

```
草稿已生成: ./drafts/pjy-complex
  2 段 / 4.0s / 1920x1080@30，转场 中心旋转
  滤镜 净透
  · 转场 #0 中心旋转：6911569618171597320 → 6858191434294497805（500ms，overlap=False，挂 1 段）
  · 滤镜 净透（资源型 7085360406423671303）：挂到 2 个视频段
  · 滤镜 净透：旧形态已落盘，服务端上报前会改写为官方 Web 形态
  拷入素材 4 个，改写路径 4 条
```

第一行改写日志左边是 pyJianYingDraft 内置 `TransitionType.模糊` 的旧资源标识，右边是目录现采的「中心旋转」——这就是「转场黑场」那条坑的修法落点。`build_complex.py` 同样支持 `--json`，会把这些改写日志放进 `fx_notes` 数组。

落盘后的草稿结构：

```
tracks     = [video×2, text×1, text(字幕)×2, audio(人声)×1, audio(BGM)×1]
非空素材桶 = videos 2 / audios 2 / audio_fades 2 / common_mask 1 / masks 1 /
             material_animations 1 / speeds 4 / texts 3 / transitions 1 / filters 1
filters[0] = {type: filter, name: 净透, resource_id: 7085360406423671303,
              effect_id: 7085360406423671303, path: ""}
```

注意 `filters[0]` 仍是**本仓内部旧形态**：`effect_id` 是 19 位、`path` 为空、滤镜挂在主视频段的 `extra_material_refs` 上。走 `/api/v2/edit/draft-export` 时，服务端 `Utils.UpgradeFiltersToWebShape` 会在上报云渲染前改成官方形态（7 位短 id `2938816`、独立 filter 轨）；自己直连云端则要按「滤镜」一节自行摆对。

### 3）资源清单与选型闸门

```bash
python build_complex.py --list-fx
```

```
目录来源：服务端 Services/Editing 现采目录
转场 39 条可选（总 503）：
  MG动画     中心旋转  overlap=False  dur=500ms  [6858191434294497805]
  ...（其余转场略）
滤镜 25 条可用（7 位短 effectId，2026-11-09 逐条云端 A/B 生效；总 240）：
  selected 净透  7085360406423671303 / 2938816
  selected 彩果  7175127220808061477 / 7507484
  ...（其余 23 条略）
另有 215 条不可用，不列入可选清单：19 位 effectId 会被云端静默忽略，VIP 同理。
  其中 4 条虽标非 VIP 但仍是长 id，最容易被误选：日落飞车 / 空灵 / 去黄增质 / 高清冬日
参数型滤镜（历史遗留，2026-11-09 像素 A/B 证伪：云端不调色，仅供形状实验；选了会告警）：
  冷调     brightness=-0.02, contrast=0.05, saturation=-0.1
```

选型层的三种结果，可直接在 Python 里试：

```bash
python -c "import effects_catalog as fx; print(fx.pick_filter('净透'))"
# {'title': '净透', 'resourceId': '7085360406423671303', 'effectId': '2938816', ...}

python -c "import effects_catalog as fx; fx.pick_filter('日落飞车')"
# 报错退出：滤镜「日落飞车」不可用：effectId=7505662247407013135（19 位）…19 位 id 会被云端静默跳过…

python -c "import effects_catalog as fx; fx.pick_filter('冷调')"
# stderr：注意：「冷调」是参数型滤镜，2026-11-09 像素 A/B 已证伪（云端不调色），仅供草稿形状实验…
```

### 4）出片

```bash
export HTW_API_KEY="你的-key"
python render.py --draft ./drafts/pjy-demo --cookie-file ./jy-cookie.txt --out ./out
```

`render.py` 依次打印已打包体积、提交地址、任务编号、轮询进度，最后输出「完成: <路径> (x.x MB)」。缺凭据时直接给可操作的提示，例如：

```
缺少 AuthKey：设 HTW_API_KEY 或传 --key（https://htwmedia.dpdns.org 邮箱申领）
缺少剪映 Cookie：草稿渲染用你自己的剪映账号，--cookie 或 --cookie-file 必填。
  取法：浏览器登录剪映网页版 → F12 → Network → 任意请求 → 复制 Request Headers 里 Cookie 整段
```

真实出片的成片参数（6.06 秒 1080p、h264 + aac、1.10 MiB）以及「`render.py` 与 Node 命令行产出字节一致」的核对，见文末「这份示例验证到了哪一步」。

### 5）选型层回归

```bash
python -m unittest -v test_effects_catalog.py
# Ran 7 tests in 0.012s
# OK
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

服务端的解析规则在 `Common/MediaHelper.cs`，按顺序试三条：
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
| 资源型滤镜 | **通过**（2026-11-09 定案）。真因不是资源包，是草稿形态三处不符：位置该在 `materials.effects` 而非 `filters`、`effect_id` 该用 7 位短 id 而非 19 位 `resource_id`、`path` 该写 `/editor/effect/filter/<rid>`；且要挂独立 `type=filter` 轨。服务端 `Utils.UpgradeFiltersToWebShape` 已自动改写，实测 R−B 由 −5.21 走到 −9.69 |

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

### 滤镜：根因是草稿形态，不是资源包（2026-11-09 定案）

> 本节原先写「形态对了，但云端拿不到 LUT」，**那个结论是错的**。当时的依据是
> 「过滤器本体是 3D LUT，没进 `package_assets` 云端就取不到」。但 `docs/2026-10-11-effects-animation-sfx-protocol.md`
> 已经记过：官方渲染视频特效时 `package_assets` 只有源视频一条，特效包从不上传；
> 而且历史上有两组实验试过「上传特效包 + 写 `source_path`」，都是保存即拒
> `ERR_DRAFT_NOT_COMPLETE`。下面保留排查过程，结论看最后一段。

前两轮复测（2026-11-09）把「id 无效」和「VIP 授权」都排掉了：同一画面切 4 段、
共用同一个 `source_timerange`、段 1 当基线，

| 段 | 滤镜 | id 来源 | 与段 1 的 mean abs diff |
| --- | --- | --- | --- |
| 1 | 无（基线） | — | 0 |
| 2 | 冷蓝（非 VIP） | artist 接口可查、能下到 md5 与 CDN 地址 | 0.54 |
| 3 | 清晰（VIP） | 同上，`requirements=["blit"]` | 0.59 |
| 4 | 净白（VIP） | 同上 | 0.59 |

0.5~0.6 是同一条成片内不同位置的编码噪声，**VIP 与非 VIP 表现完全一致**。
但注意：这四段**都没改 `effect_id` 的位数**——这正是它们全体不生效的原因。

真正的取证是反过来做**正例**：直接用真实剪映网页版给同一段彩条素材加「彩果」并导出，
成片饱和度 192 → 135.5（−29%）、亮度 122 → 92。滤镜**确实**会被云渲染；官方
`render_task/create` 里的 `app_version=11.5.1` / `sdk_version=15.7.0` 与我们一致，
云端能力相同，只差草稿形态。

官方 `video_draft/save` 抓包里，滤镜与本仓原实现有三处相反：

| # | 维度 | 官方 | 本仓原实现 |
| --- | --- | --- | --- |
| 1 | 位置 | 留在 `materials.effects`，草稿里**没有** `filters` 键 | 搬到 `materials.filters` |
| 2 | `effect_id` | **7 位短 id**（彩果 `7507484`） | 19 位 `resource_id` |
| 3 | `path` | `/editor/effect/filter/<rid>` | 空串（或误用视频特效的 `effects2`） |

挂接也不一样：官方建**独立 `type=filter` 轨**，段用 `material_id` 直指素材、
`extra_material_refs=[]`、`render_index=1`；**视频段的 refs 里不含滤镜 id**。

第 2 条和视频特效是同一条教训 —— 特效也是必须 7 位短 id，`path` 反而不是必需条件。
改完实测：段 2/4 的 R−B 从 −5.21 走到 **−9.69**、meanDiff **10.64**（噪声基线 0.056），
肉眼即右帧偏紫。

`pyJianYingDraft` 这边**不需要改**：它写 `materials.filters` 也行，服务端上报云渲染前会
统一搬进 `effects` 并改写（开关 `HTW_FILTER_WEB_SHAPE`，默认开；设 `0` 回退到旧行为）。
自己直连剪映云渲染、不过服务端的话，就得自己按上表三处摆对。

判定方法（别只看「渲染成功」）：

```bash
# 1) 同一条草稿渲两次，量出编码噪声基线 —— 实测 mean abs diff ≈ 3.1（median 2）
# 2) 滤镜版 vs 基线，同一帧号比对 —— 生效时 mean abs diff ≈ 10
ffmpeg -i A.mp4 -i B.mp4 -lavfi "[0:v][1:v]psnr=stats_file=psnr.log" -f null -
```

⚠️ 用 `-ss <秒>` 抽帧对比会骗人：带转场的草稿渲出来可能是 29.77fps 而不是 30fps，
两片同一秒不是同一帧，PSNR 会显示 23dB 的假差异。要按帧号抽
（`-vf "select=eq(n\,30)"`）再比。

> 另有一处历史遗留：`FilterCatalog.json` 里精选 25 条的 `effectId` **从 2026-10-11 起
> 就已经是短 id**，但 `BuildFilterMaterial` 一直填 `resource_id`。不是「查不到」，
> 是取字段时选错了 —— 新增素材类型时照抄官方抓包，别照抄同仓旧实现。

### ⚠️ 参数型滤镜（纯 `adjustments`）已证伪

上面说的「通过」**只针对资源型**（有 `resourceId` 且目录里带 7 位短 `effectId`）。
`effects_catalog.py` 里的 `PARAM_FILTERS`（冷调 / 暖调 / 高对比 / 淡雅）是纯参数配方：
2026-11-09 的像素 A/B 里，不论放 `materials.filters` 还是 `effects`、挂主轨 refs
还是独立 `filter` 轨，成片与无滤镜基线 meanDiff 都只有 0.054（编码噪声）。
官方 Web 草稿的 `materials` 桶里既没有 `filters` 也没有 `adjusts`。
参数化调色那一族（`hsl` / `material_colors` / `color_curves` / `primary_color_wheels` /
`log_color_wheels`）2026-11-09 晚已静态取证**否定**：官方抓包、模板草稿、本机 1257 份
草稿里这些桶恒为空，也没有对应面板接口（`adjust` / `color` 等一律 `200501`），
**Web 链路没有可照抄的参数化调色形态**。

服务端 `EditingPlaybookLoader` 现在会**拒绝加载**被 `enabled=true` 启用的纯参数滤镜节
并点名告警；本示例保留这类配方仅供观察草稿形状，`--list-fx` 与运行日志均已标注无效，
别把它当调色功能用。

✅ 同日晚些时候，服务端把 25 条精选资源型滤镜用 26 段同源云渲染**逐条**做了像素 A/B
（25/25 生效，最小 meanDiff 4.0015；无滤镜对照段间噪声 0.0179~0.0189），并据此给
7 个创作风格各配了一条：`Default=净透`、`HistoricalDocumentary=暮色`、
`TechExplainer=冷蓝`、`AnimeGhibli=彩果`、`Cinematic=橙蓝`、`Educational=清晰`、
`Marketing=高饱和`（不变）。改任一条都要先按帧号抽帧重跑云端 A/B，
别拿「渲染没报错」当通过。详见服务端协议文档 style-filter-protocol 第十节。

### 选型闸门：只放行那 25 条

服务端定案后，示例层也把约束钉死（`effects_catalog.py`）：

- `--list-fx` 只列 **25 条有 7 位短 `effectId` 的可用滤镜**；另外 215 条（19 位 id）
  明确标为不可用、不列入可选清单。其中 4 条标着「非 VIP」却是长 id
  （日落飞车 / 空灵 / 去黄增质 / 高清冬日），以前最容易被误选。
- `pick_filter` 遇到长 id 或 VIP 直接报错退出，不再静默返回一张渲不出调色的草稿；
  参数型配方仍可返回（兼容旧命令），但会在 stderr 点名「已证伪」。
- `apply_effects.py` 输出的仍是本仓内部旧形态，靠服务端 `UpgradeFiltersToWebShape`
  改写：**把 `HTW_FILTER_WEB_SHAPE` 设为 `0`，或直连剪映云渲染不过服务端，滤镜就会失效**。
  这是有意的设计取舍，不是遗漏 —— 自己直连时按上表三处写成官方形态即可。

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
| **资源型滤镜**（2026-11-09 定案） | **通过**（经服务端改写）。真因是草稿形态：位置该在 `materials.effects`、`effect_id` 该 7 位短 id、`path` 该 `/editor/effect/filter/<rid>`、该挂独立 `filter` 轨。改写后四段对照 meanDiff 10.639 / 10.640，基线噪声 0.056；R−B 由 −5.21 → −9.69 |
| **参数型滤镜**（纯 `adjustments`，2026-11-09 补测） | **不呈现**。两种素材桶 × 两种挂法，成片与基线 meanDiff 全在 0.054~0.058（编码噪声）；官方 Web 草稿的 `materials` 桶里既没有 `filters` 也没有 `adjusts` |
| **示例层选型闸门**（2026-11-09 补） | **通过**。`--list-fx` 只列 25 条短 id 可用滤镜，215 条长 id 明确排除；长 id / VIP 被 `pick_filter` 拒绝，参数型告警；7 项标准库单元测试通过 |

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
| `effects_catalog.py` | 资源目录：转场挑非 VIP id，滤镜只放行有 7 位短 `effectId` 的 25 条（`--list-fx`） |
| `apply_effects.py` | 把草稿里的转场/滤镜改写成服务端能识别的形态（save 之后跑） |
| `render.py` | 纯标准库客户端：打包、上传、轮询、下载 |
| `test_effects_catalog.py` | 选型层回归：锁短 id / 拒绝长 id 与 VIP / 参数型告警 |
| `requirements.txt` | 只依赖 pyJianYingDraft |

选型层回归不需要 pyJianYingDraft、不联网、不依赖服务端仓库：

```bash
python -m unittest -v test_effects_catalog.py
```
