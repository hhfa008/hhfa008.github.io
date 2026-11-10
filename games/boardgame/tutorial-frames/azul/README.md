# Azul（花砖物语）B 站教程关键帧

本目录保存从 B 站公开教程视频中**按技术手段**抽取的关键帧，用于后续制作 Azul 精美版时的参考资料。
仅做了视频下载、I 帧抽取、固定时间间隔采样与文件保存；**未做 OCR、未做图像识别、未对画面内容作任何描述**。

- 游戏：Azul / 花砖物语（Michael Kiesling，2018 Spiel des Jahres）
- 抽取日期：2026-11-10
- 工具：`yt-dlp 2026.10.26`（macOS 单文件版）、`ffmpeg 8.0.1`、`ffprobe 8.0.1`
- 网络：B 站访问经本机代理 `http://127.0.0.1:7899`

## 一、B 站候选清单

检索接口：`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=...`
关键词：`花砖物语 规则 教程`、`Azul 桌游 教程`。
搜索接口在无 Cookie 时返回 HTTP 412，先访问 `https://www.bilibili.com/` 取得匿名 `buvid3` Cookie 后恢复正常（无需登录）。

| # | 标题 | UP 主 | BV 号 / 链接 | 时长 | 播放 | 发布 | 简介中的规则要点 |
|---|------|-------|--------------|------|------|------|------------------|
| 1 | 【桌游规则】10分钟学会《花砖物语 Azul》！全程动画图解，新手一看就懂 | 扑雷汪电玩社 | [BV1aPxx6dEHL](https://www.bilibili.com/video/BV1aPxx6dEHL) | 10:42 | 555 | 2026-11-01 | 配件、准备、三个阶段、计分方法、终局奖励，附 5 个新手技巧；2–4 人，8 岁以上，30–45 分钟 |
| 2 | 花砖物语｜规则讲解+试玩演示 | 零门槛桌游 | [BV1fK9zYSEo6](https://www.bilibili.com/video/BV1fK9zYSEo6) | 12:56 | 44,640 | 2025-03-03 | 规则讲解 + 试玩演示；简介称“颜值爆表、简单易懂、有策略性” |
| 3 | 【桌游】花砖物语AZUL基础游戏规则介绍 | 是你大菇子呀 | [BV1Fi4y187Ww](https://www.bilibili.com/video/BV1Fi4y187Ww) | 12:24 | 36,299 | 2020-03-29 | 基础玩法规则介绍 |
| 4 | 析弈讲规则#花砖物语/8+/2-4/Asmodee | 析弈讲规则 | [BV1Fy4y187Vo](https://www.bilibili.com/video/BV1Fy4y187Vo) | 7:26 | 3,449 | 2021-04-07 | 无简介；标题标注 8+ / 2–4 人 / Asmodee |
| 5 | 嘚舎的桌游小屋：花砖物语教学 | 塞外苍鹰IORI | [BV1cb411x7Vi](https://www.bilibili.com/video/BV1cb411x7Vi) | 9:23 | 3,535 | 2019-03-27 | 教学视频（简介仅一句） |
| 6 | 【桌游评测+试玩】花砖物语 Azul｜如果你只能拥有一款桌游 | 桌游怪 | [BV1j3411q7BZ](https://www.bilibili.com/video/BV1j3411q7BZ) | 18:28 | 66,108 | 2021-09-09 | 评测 + 试玩；2–4 人，最佳 2 人，一局约 30 分钟，8 岁以上 |

最终下载 2 个：候选 1（动画规则讲解）与候选 2（规则 + 试玩）。

## 二、下载记录

两个视频均可匿名下载，无需登录 B 站账号。使用从首页取得的匿名 Cookie（`buvid3`）规避 412 风控。

```bash
# 取匿名 Cookie
curl -s -x http://127.0.0.1:7899 -c bili.jar \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ..." \
  "https://www.bilibili.com/" -o home.html

# 下载（视频 + 音频合流为 mp4）
~/.local/bin/yt-dlp --proxy http://127.0.0.1:7899 --cookies bili.jar \
  -f "bv*+ba/b" --no-playlist --merge-output-format mp4 \
  -o "BV1aPxx6dEHL.%(ext)s" "https://www.bilibili.com/video/BV1aPxx6dEHL"

~/.local/bin/yt-dlp --proxy http://127.0.0.1:7899 --cookies bili.jar \
  -f "bv*+ba/b" --no-playlist --merge-output-format mp4 \
  -o "BV1fK9zYSEo6.%(ext)s" "https://www.bilibili.com/video/BV1fK9zYSEo6"
```

下载结果（原始视频不提交到仓库）：

| BV | 文件大小 | 时长 | 视频编码 | 分辨率 | 帧率 |
|----|----------|------|----------|--------|------|
| BV1aPxx6dEHL | 38 MiB | 641.47 s | H.264 | 1920×1080 | 30 fps |
| BV1fK9zYSEo6 | 96 MiB | 775.57 s | AV1 | 1920×1080 | 30 fps |

## 三、抽帧方法

对每个视频分别执行两种抽帧，再合并去重；单视频上限 40 帧，超出部分按时间均匀间隔保留。

```bash
# (a) I 帧
ffmpeg -v error -i VIDEO.mp4 -vf "select='eq(pict_type,I)'" -vsync vfr \
  -q:v 2 iframe-%03d.jpg

# (b) 每 30 秒一帧
ffmpeg -v error -i VIDEO.mp4 -vf "fps=1/30" -q:v 2 sample-%03d.jpg

# (c) 用 ffprobe 取出 I 帧时间戳，与 30 s 采样点合并；1 s 内视为重复，只保留一个；
#     超过 40 帧时按序号均匀间隔抽取；输出文件名带 mm ss 时间戳。
ffprobe -v error -select_streams v:0 \
  -show_entries frame=pict_type,pts_time -of csv=p=0 VIDEO.mp4 > iframes.csv
```

**实际结果说明**：两个视频的 I 帧间隔均为 5 s（GOP=5 s），30 s 采样点与 I 帧时间戳完全重合；
按 1 s 容差去重后，均匀采样没有贡献额外帧。最终每视频 40 帧全部来自 I 帧，
但选帧过程保证覆盖整段视频（约 16 s 一帧），符合“合并去重 + 均匀间隔保留”的规则。
`manifest.tsv` 记录了每帧的精确时间戳与来源类型。

## 四、输出统计

| BV | 帧数 | 目录 | 大小 |
|----|------|------|------|
| BV1aPxx6dEHL | 40 | `frames/BV1aPxx6dEHL/` | 9.9 MiB |
| BV1fK9zYSEo6 | 40 | `frames/BV1fK9zYSEo6/` | 11 MiB |
| 合计 | 80 | `frames/` | 21,195,580 B（20.2 MiB） |

校验：80 个文件全部非空，`ffprobe` 读取尺寸均为 1920×1080。

## 五、文件清单

### BV1aPxx6dEHL（40）

```
iframe-00m00s.jpg iframe-00m20s.jpg iframe-00m35s.jpg iframe-00m55s.jpg
iframe-01m10s.jpg iframe-01m30s.jpg iframe-01m45s.jpg iframe-02m05s.jpg
iframe-02m20s.jpg iframe-02m40s.jpg iframe-02m55s.jpg iframe-03m15s.jpg
iframe-03m30s.jpg iframe-03m50s.jpg iframe-04m10s.jpg iframe-04m25s.jpg
iframe-04m45s.jpg iframe-05m00s.jpg iframe-05m20s.jpg iframe-05m35s.jpg
iframe-05m55s.jpg iframe-06m06s.jpg iframe-06m26s.jpg iframe-06m36s.jpg
iframe-06m56s.jpg iframe-07m06s.jpg iframe-07m26s.jpg iframe-07m41s.jpg
iframe-07m56s.jpg iframe-08m11s.jpg iframe-08m26s.jpg iframe-08m41s.jpg
iframe-08m56s.jpg iframe-09m11s.jpg iframe-09m26s.jpg iframe-09m41s.jpg
iframe-09m56s.jpg iframe-10m11s.jpg iframe-10m26s.jpg iframe-10m41s.jpg
```

### BV1fK9zYSEo6（40）

```
iframe-00m00s.jpg iframe-00m20s.jpg iframe-00m40s.jpg iframe-01m00s.jpg
iframe-01m20s.jpg iframe-01m40s.jpg iframe-02m00s.jpg iframe-02m20s.jpg
iframe-02m40s.jpg iframe-03m00s.jpg iframe-03m20s.jpg iframe-03m40s.jpg
iframe-04m00s.jpg iframe-04m20s.jpg iframe-04m40s.jpg iframe-05m00s.jpg
iframe-05m20s.jpg iframe-05m40s.jpg iframe-06m00s.jpg iframe-06m20s.jpg
iframe-06m35s.jpg iframe-06m55s.jpg iframe-07m15s.jpg iframe-07m35s.jpg
iframe-07m55s.jpg iframe-08m15s.jpg iframe-08m35s.jpg iframe-08m55s.jpg
iframe-09m15s.jpg iframe-09m35s.jpg iframe-09m55s.jpg iframe-10m15s.jpg
iframe-10m35s.jpg iframe-10m55s.jpg iframe-11m15s.jpg iframe-11m35s.jpg
iframe-11m55s.jpg iframe-12m15s.jpg iframe-12m35s.jpg iframe-12m55s.jpg
```

`manifest.tsv`：`video, frame, timestamp_sec, source`，共 80 行数据。

## 六、限制与说明

1. **版权**：视频与画面版权归原 UP 主及版权方所有；本目录帧仅作学习/开发参考，请勿商用或二次分发。
2. **匿名下载**：仅使用首页匿名 Cookie，未使用任何登录态；B 站搜索 API 无 Cookie 时 412，接口不稳定属平台风控行为。
3. **视频未入库**：原始视频共 134 MiB，未提交仓库，只提交帧与元数据。
4. **帧质量**：帧来自平台 1080p 转码流（H.264 / AV1），JPEG 质量参数 `-q:v 2`；不代表原始片源画质。
5. **采样局限**：I 帧间隔固定 5 s，30 s 采样点被去重；若需要更密集/更稀疏的帧，可按 `manifest.tsv` 的时间戳重新抽取。
6. **未做图像理解**：未运行 OCR、图像识别或画面描述，本文件不包含任何帧内容描述。
