# Arcade BGM — CC0 授权台账

本目录的 5 首 BGM 全部取自 OpenGameArt，条目页 `License(s)` 字段为 **CC0**，并链接到
CC0 1.0 法律文本 <https://creativecommons.org/publicdomain/zero/1.0/>。访问/核对日期：
**2026-11-11**（逐条核对条目正文的 `License(s)` 字段，不采用全站页脚的 CC0 链接）。

每首提供两种编码：
- `.ogg` — Ogg Vorbis q4 VBR（Chrome / Firefox / Edge 首选；Safari 18.4+ 才支持，见下）
- `.m4a` — AAC（Safari / iOS 首选兜底）

统一处理：44.1 kHz 立体声；峰值归一 −1 dBFS；**每条都做了 250 ms 尾部→头部交叉淡化**
（把原曲结尾平滑叠入开头，保证循环接缝样本连续；成品因此比输入短 250 ms）。04/05/06/12
类超长源截取前 90 s。OGG 与 M4A 内容一致。

| 文件 slug | 曲名 | 作者 | 原始页面 URL | CC0 授权 | BPM | 调 | 成品时长 |
|---|---|---|---|---|---|---|---|
| `board-musicbox` | 4 Music Box Tracks — musicbox2_cute_tune | Aureolus_Omicron | https://opengameart.org/content/4-music-box-tracks | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 112.3 | A# major | 89.75 s |
| `reaction-childrens-march` | Children's March Theme | CleytonKauffman | https://opengameart.org/content/childrens-march-theme | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 89.1 | F major | 63.75 s |
| `memory-apple-cider` | Apple Cider | Zane Little Music | https://opengameart.org/content/apple-cider | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 99.4 | G major | 89.75 s |
| `pong-happy-adventure` | Happy Adventure (Loop) | TinyWorlds | https://opengameart.org/content/happy-adventure-loop | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 123.0 | G major | 46.56 s |
| `numbers-flowerbed` | Flowerbed Fields [Loop] | Zane Little Music | https://opengameart.org/content/flowerbed-fields-loop | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 143.6 | A# minor | 89.75 s |

原始直链见各条目页；09（Children's March Theme）与 05（4 Music Box Tracks）的官方下载是
zip 包，这里取的是包内对应曲目。

## 浏览器格式支持（决定为什么两种格式都保留）

- Safari 自 **18.4**（macOS Sequoia 15.4 / iOS 18.4 / iPadOS 18.4 / visionOS 2.4）起才加入
  Ogg 容器（Opus 与 Vorbis）支持：Apple「Safari 18.4 Release Notes」与 WebKit blog
  "WebKit Features in Safari 18.4"（<https://webkit.org/blog/16574/>）。
- 在此之前（Safari 3–14、iOS 3–17.3）完全不支持 Vorbis；14.1–18.3 只有不稳定的部分支持。
  iOS 上所有浏览器都用 WebKit，所以能否解码取决于系统版本。
- 结论：不能假设 Ogg 在目标浏览器全覆盖，**两种格式都发布**，运行时用 `canPlayType`
  探测后只请求其中一种，失败再按需请求另一种。
