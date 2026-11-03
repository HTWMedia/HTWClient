# HTW 工作台 · 桌面端使用教程视频

每个模块一个视频：功能介绍 + 真实操作过程 + 结果展示 + 提示信息说明。
高分辨率窗口纯净画面 + 中文配音 + 烧录字幕；云端渲染等待段已加速并标注。

成片 mp4 以 GitHub Release 附件分发（不入 git），点击直达下载；旁白文案在 [../scripts/](../scripts/)。
> GitHub Release 资产名仅限 ASCII，下载文件名用英文缩写（与 modules/ 命名对应）；Release 页显示中文标签，对应关系见下表。

| 视频 | 时长 | 文案 |
|---|---|---|
| [01 安装与初始配置](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/01-setup.mp4) | 1:59 | [01_安装与初始配置.md](../scripts/01_安装与初始配置.md) |
| [02 剪辑 · 视频粗剪](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/02-coarse-cut.mp4) | 2:28 | [02_剪辑-视频粗剪.md](../scripts/02_剪辑-视频粗剪.md) |
| [03 剪辑 · 剪同款](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/03-cutsame.mp4) | 1:18 | [03_剪辑-剪同款.md](../scripts/03_剪辑-剪同款.md) |
| [04 剪辑 · 智能包装](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/04-smart-pack.mp4) | 0:53 | [04_剪辑-智能包装.md](../scripts/04_剪辑-智能包装.md) |
| [05 剪辑 · 草稿导出 / 超分 / 解密](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/05-draft-sr-decrypt.mp4) | 1:44 | [05_剪辑-草稿导出_超分_解密.md](../scripts/05_剪辑-草稿导出_超分_解密.md) |
| [06 洞察与选题](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/06-insight-topics.mp4) | 1:00 | [06_洞察与选题.md](../scripts/06_洞察与选题.md) |
| [07 工具](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/07-tools.mp4) | 0:49 | [07_工具.md](../scripts/07_工具.md) |
| [08 批量](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/08-batch.mp4) | 0:51 | [08_批量.md](../scripts/08_批量.md) |
| [09 营销成片与工作流](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/09-marketflow.mp4) | 0:46 | [09_营销成片与工作流.md](../scripts/09_营销成片与工作流.md) |
| [10 发布与任务中心](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/10-publish-tasks.mp4) | 0:56 | [10_发布与任务中心.md](../scripts/10_发布与任务中心.md) |
| [11 短剧 · 助手 · 创作 · 总结](https://github.com/HTWMedia/HTWClient/releases/download/v0.5.0/11-shortdrama-assistant.mp4) | 1:07 | [11_短剧_助手_创作_总结.md](../scripts/11_短剧_助手_创作_总结.md) |

合计约 14 分钟。

> 2026-10-28 重录完成：01-03、05-07、09-11 与 04、08 全部为真机录制（逐场景录制、
> 旁白用项目语音合成「奥运刘雨熙」、结果特写对齐下载按钮）。
> 04 智能包装：8 秒合成小样片会被上游包装算法稳定拒绝（sami_video_decoration RPC），
> 已换用 40 秒真实录屏素材，渲染成功并展示播放中的成片预览；
> 08 批量：批量提交在服务端修复后实测成功（批次自动建立、状态页逐条显示进度）。
> 2026-10-29：01-03 已按 1920×990 窗口重录，全部 11 集分辨率统一；
> 早期 1478×938 的 01 重复文件（「01_快速上手与设置」）已归档到 ../_archive/。

## 观看顺序
1. 01 安装与初始配置（必看：AuthKey 配置）
2. 02-05 剪辑面板（粗剪 → 剪同款 → 智能包装 → 草稿导出/超分/解密）
3. 06 洞察与选题  4. 07 工具  5. 08 批量  6. 09 营销成片与工作流
7. 10 发布与任务中心  8. 11 短剧创作 · AI 助手 · 创作 · 总结

## 制作说明
- 演示素材在 assets/（带口播的演示视频、缺素材草稿包、加密草稿等真实文件）
- 重制入口：rebuild.py（离线重合成+自动窗口裁剪）、rerecord_all.py（真机重录，需解锁会话）、hybrid_02.py（02 单独重录）
- 2026-10-26：05 已全真机重录（草稿导出+超分+解密，含服务端超分 bug 修复后的真实成功画面）
- 2026-10-28：04 使用 assets/包装示例.mp4（40s 真实录屏）作为演示素材，勿换回 8s 合成小样片