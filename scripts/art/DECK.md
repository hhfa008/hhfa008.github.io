# 代码生成牌组（deck）

用**摄影级载体 + 代码绘制的油墨/雕刻层**生成三套完整牌组。字符与点数是字体和 SVG 排出来的，
不交给图像模型；载体只作为底，不被压平成纯色。

三套载体都先算 **alpha 包围盒**，裁掉 1024 画布四周的透明留白，再按真实比例 **contain** 到牌面区域。
不会出现“整张 1024 缩到 256 后棋子只剩一个小点”。

```
elements/*.png  +  deck.css  +  deck.js  ──►  Chrome headless (CDP)  ──┬─►  decks/<set>/png/<name>.png   (母版)
                                                                        ├─►  decks/<set>/webp/<name>.webp (站点产物)
                                                                        └─►  decks/_preview/*              (对照图)
```

## 命令

```bash
node scripts/art/deck.js --all                     # 102 张 + 三张对照图
node scripts/art/deck.js --set poker               # 只渲染扑克 54 张
node scripts/art/deck.js --set mahjong,xiangqi     # 可逗号分隔/重复 --set
node scripts/art/deck.js --preview                 # 用已有 WebP 重拼三张对照图
node scripts/art/deck.js --all --no-preview        # 只要牌，不要对照图
node scripts/art/deck.js --list                    # 102 张 + 元素 bbox / mean
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--elements <dir>` | `games/assets/art/elements` | 元素载体目录，只读，不写入 |
| `--out <dir>` | `games/assets/art/decks` | 输出根目录 |
| `--quality <0-100>` | `90` | WebP 质量（q0.9） |
| `--preview` | 关 | `--all` 会自动开；单独用则重拼已有牌 |
| `--no-preview` | — | 压过 `--preview` |

需要 Node 22+（本机 v24 已验证）与本机 Google Chrome。`CHROME_PATH` 可覆盖 Chrome 路径。

## 输出：源与产物

| 路径 | 角色 | 格式 | 用途 |
|---|---|---|---|
| `decks/<set>/png/<name>.png` | **母版 / 源** | 无损 PNG，RGBA，透明底 | 重新压 WebP、重新上色、重新量化都从这份来；不要删 |
| `decks/<set>/webp/<name>.webp` | **站点产物** | WebP q0.9，RGBA，透明底 | 页面实际引用；单张目标 ≤30KB |
| `decks/_preview/*.png` | 三张对照图 | PNG | 检查用，不是牌面资产 |
| `decks/_preview/compare-*.webp` | 改前/改后局部放大 | WebP | 检查用 |
| `decks/_preview/xiangqi-red-black.webp` | 红帥/黑將材质对照 | WebP | 检查用 |

仓库 `.gitattributes` 已把 `*.png`、`*.webp` 路由到 Git LFS。

### 当前基线（2026-11-10，最终载体 + 印刷/雕刻，两次全量运行）

| 套 | 张数 | WebP 总量 | WebP 平均 | WebP 最大单张 | PNG 母版总量 | PNG 平均 |
|---|---:|---:|---:|---:|---:|---:|
| poker | 54 | 666,170 B | 12,336 B | 14,720 B (QH) | 7,619,606 B | 141,103 B |
| mahjong | 34 | 315,300 B | 9,274 B | 14,260 B (9t) | 2,760,241 B | 81,183 B |
| xiangqi | 14 | 183,824 B | 13,130 B | 14,732 B (black-xiang) | 1,143,725 B | 81,694 B |
| **合计** | **102** | **1,165,294 B** | **11,424 B** | **14,732 B** | **11,523,572 B** | **112,976 B** |

- WebP 总量 **1.11 MiB**，低于 3MB；单张最大 **14,732 B**，低于 30KB。
- 三张对照图：`poker-fan.png` 682,827 B、`mahjong-row.png` 664,276 B、`xiangqi-row.png` 667,092 B，合计 2,014,195 B（1.92 MiB）。
- 五张改前/改后/红黑对照：合计 205,700 B。
- `decks/` 全目录约 **14.91 MB（14.22 MiB）**：PNG 母版 10.99 MiB + WebP 1.11 MiB + 对照图 1.92 MiB + 对比图 0.20 MiB。PNG 母版是主要重量，已走 Git LFS。

WebP 由 Chrome `Page.captureScreenshot(format:"webp", quality:90)` 直接输出。
PIL 抽查四张：`RGBA`、四角 `alpha=0`、alpha 通道 MAE=0.00；放大看没有可见色块或文字糊边。
没有改用 PNG-8。

## 载体裁切：包围盒 → contain

载体已按真实尺寸归一化（1mm=8px），所以 1024 画布里只有中间一小块不透明。脚本用自带的
最小 PNG 解码器（zlib + unfilter）算 alpha 包围盒，**先裁包围盒，再按真实比例 contain**，
不拉伸成正方形：

| 载体 | 1024 画布里的 bbox | 裁后 contain 到牌面 | 若整张 1024 直接缩到牌面 |
|---|---|---|---|
| card-face-frame | 498×698 @ 263,163 | **255.4×358.0** / 256×358 | 124.5×174.5 |
| mahjong-blank | 150×206 @ 437,409 | **247.6×340.0** / 256×340 | 37.5×51.5 |
| xiangqi-blank | 234×238 @ 395,393 | **251.7×256.0** / 256×256（y=22 居中） | 58.5×59.5 |
| court-panel | 572×860 @ 226,82 | 137.0×206.0 / 152×206 | — |
| pip-* | 见 `--list` | contain 到方形点数框 | — |

边/环覆盖层跟随裁后的可见矩形：麻将 `.tile-edge` 用 `--tile-x/y/w/h`，象棋 `.xq-rule` /
`.xq-edge` 用 `--xq-x/y/w/h`；不会在透明留白里画出一圈假边。

## 元素与降级

需要的 9 个载体：

```
card-face-frame  pip-spade pip-heart pip-diamond pip-club  court-panel
mahjong-blank    xiangqi-blank
```

旧的 `xiangqi-blank-red` / `xiangqi-blank-black` 仍保留在目录里，但**不再用于棋子底色**。
按 `@2x.png` → `.png` 顺序查找；缺元素不崩，自动走代码降级并列出缺失：

- `card-face-frame` → `--paper` 平涂 + 2px `--paper-line`
- `pip-*` → 内联 SVG 花色
- `court-panel` → 象牙奖章 + 大字母
- `mahjong-blank` → `--ivory` 平涂 + 2px 内凹线
- `xiangqi-blank` → 浅木/象牙 `#e0b671` 圆盘 + 2px 木色环

验证降级不用改共享 `elements/`（另一个 agent 可能正在写）：把 `--elements` 指向空目录：

```bash
mkdir -p /tmp/deck-empty-elements
node scripts/art/deck.js --all --no-preview \
  --elements /tmp/deck-empty-elements --out /tmp/deck-fallback
# 102 张照常生成，退出码 0，日志列出 MISSING ELEMENTS
```

## 视觉系统

### 调色板（从元素图取样）

| 变量 | 值 | 来源 |
|---|---|---|
| `--red` | `#ac1a12` | `xiangqi-blank-red@2x.png` 均值 |
| `--black` | `#262523` | `xiangqi-blank-black@2x.png` 均值 |
| `--paper` | `#e9e0cd` | `card-face-frame@2x.png` 均值 |
| `--ivory` | `#e5d0a1` | `mahjong-blank@2x.png` 均值 |
| `--gold` | `#c87838` | `court-panel@2x.png` 金色暗部簇 |
| `--mj-green` | `#1e6b47` | 麻将专用深墨绿 |
| `--xq-wood` | `#e0b671` | `xiangqi-blank@2x.png` 均值（运行时注入，外环取 ×0.88 `#c5a063`） |

线色：`--paper-line #cdc5b4`、`--ivory-line #cab78e`、`--red-line #971710`、
`--black-line #211f1f`、`--gold-line #b06a31`（都是基色 ×0.88）。

### 印刷感（扑克）

- **油墨**：页面内嵌 `#ink-rough` SVG filter。`feTurbulence` 0.45px 位移 + 0.3px 高斯模糊
  后与实心源叠加，再把 3.5% turbulence 颗粒裁剪进字形并 multiply。作用于点数、角标花色、
  中央点数、J/Q/K 大字母、JOKER 菱形/竖字、牌面 2px 内圈。
- **纸纤维**：`.paper-grain` 用 180×180 `feTurbulence` 灰度噪声，`mix-blend-mode: multiply`，
  `opacity: 0.025`，放在油墨层下方。
- **物理边/叠压**：`.card-edge` 1px 上/左亮 + 下/右暗；对照图用
  `drop-shadow(2px 5px 3px)` + 长环境影，叠压时下方那张的边会暗。

### 雕刻感（麻将、象棋）

- 文字主体 = 原色 `color-mix(..., 65%, black)`（深 35%）；`text-shadow` 上 1px 亮边、下 1px 暗边。
- 筒子圆环：环色同样深 35%，`.mj-dot` / `::before` / `::after` 各加 1px 内侧上亮/下暗。
- 条子竖条：绿/红交替（序号 0 起为绿，绿为主），条身深 35%，左亮/右暗；节线 2px `--gold`。
- 白板：双 2px `--ivory-line` 框，框线加内亮/内暗。
- 1条：绿身红翅红冠，鸟身加轻微上下 drop-shadow；它是全套里雕刻感最弱的一张。
- 所有高光从**左上**来；`.tile-edge`、`.xq-edge`、`.card-edge` 统一上/左亮、下/右暗。

### 象棋：两边同一副浅木

- 底色统一用 `xiangqi-blank@2x.png`（浅木/象牙），红黑双方**材质、底色、外环完全相同**。
- 红方 7 枚：`帥仕相馬車炮兵`，暗红刻字（`--red` 深 35%）。
- 黑方 7 枚：`將士象馬車砲卒`，近黑刻字（`--black` 深 35%）。
- 外圈细环用载体均值 ×0.88 的木色 `--xq-wood-line`，不再用红/黑。
- 刻字效果不变：凹刻 + 上缘亮边 + 下缘暗边。

**红/黑一致性验证**（PNG 母版，PIL）：

```
alpha diff bbox = None, extrema = (0, 0)          # 轮廓完全一致
rgb diff bbox = (67, 97, 189, 219)                # 只落在字区
outside central char box: max diff 0, pixels>2 0   # 字区外底色逐像素相同
sample (30,150): red (229,187,118) = black (229,187,118)
sample (128,50): red (231,191,119) = black (231,191,119)
```

对照图：`decks/_preview/xiangqi-red-black.webp`。

### 字体（只有两种族）

| 用途 | 字体 | 证据 |
|---|---|---|
| 点数、J/Q/K、JOKER（拉丁） | `Helvetica Neue` 700，紧排 | `CSS.getPlatformFontsForNode` → `Helvetica Neue (HelveticaNeue-Bold)` |
| 全部汉字（麻将 + 象棋） | `Songti SC` 700 | `1w .mj-num`、`1w .mj-wan-char`、`red-shuai .xq-char` 均报 `Songti SC (STSongti-SC-Bold)` |

用 **Bold（700）**：本机 Songti SC Black 缺 `帥將馬車砲萬東發` 等繁体字。
点数 `10` 用 31px + `scaleY(1.1)` 自适应，实测墨迹 29×24px，其他单字符 22×23px。

### 2px 压线与 JOKER

代码绘制的边框/环/内凹一律 `--line: 2px`，取 12% 线色：扑克内圈、JOKER 菱形、court 奖章、
白板双框、筒子三环、条子节线、象棋外环。JOKER 角标是 14×14px 旋转 45° 的菱形（红/黑），
中央竖排 `JOKER` 保留。

## 确定性与验收

```bash
node scripts/art/deck.js --all
find games/assets/art/decks -type f \( -name '*.png' -o -name '*.webp' \) \
  -exec md5 -r {} + | sort > /tmp/a.txt
node scripts/art/deck.js --all
find games/assets/art/decks -type f \( -name '*.png' -o -name '*.webp' \) \
  -exec md5 -r {} + | sort > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt        # 必须无输出
```

固定顺序 + `document.fonts.ready` + 图片 `decode()` + 两帧 rAF + `deviceScaleFactor=1` +
`--force-color-profile=srgb`；PNG/WebP 不写时间戳。2026-11-10 实测两次全量运行
**212 个文件**（102 WebP + 102 PNG + 3 对照图 + 5 对比图）md5 全部一致，`diff` 退出码 0；
排序清单指纹 `317b1d1b97c3ccf26e7ec16b1b4f5217`。

尺寸/透明度：102 张 WebP 全部 `RGBA`、尺寸正确、四角 `alpha=0`；单张最大 14,732 B。
PNG 母版 `sips` 验过 54×256×358、34×256×340、14×256×300，0 个 0 字节。

## 实际输出与对照图

| 牌 | WebP | PNG 母版 |
|---|---|---|
| AS | `decks/poker/webp/AS.webp` | `decks/poker/png/AS.png` |
| 5筒 | `decks/mahjong/webp/5t.webp` | `decks/mahjong/png/5t.png` |
| 红帥 | `decks/xiangqi/webp/red-shuai.webp` | `decks/xiangqi/png/red-shuai.png` |
| 黑將 | `decks/xiangqi/webp/black-jiang.webp` | `decks/xiangqi/png/black-jiang.png` |

三张对照图：`decks/_preview/poker-fan.png`、`mahjong-row.png`、`xiangqi-row.png`。
改前/改后局部放大：`compare-AS.webp`、`compare-10H.webp`、`compare-5t.webp`、
`compare-red-shuai.webp`；红黑素材对照：`xiangqi-red-black.webp`。

## 改哪里

| 想改 | 改哪里 |
|---|---|
| 点数阵列 / 圆点 / 条子位置 | `PIP_LAYOUT`、`DOT_LAYOUT`、`BAM_LAYOUT` |
| 油墨颗粒/毛刺 | `deck.js` 的 `INK_FILTER_SVG`；`deck.css` 的 `.paper-grain` |
| 雕刻深浅/亮暗边 | `.mj-*`、`.xq-char` 的 `color-mix` 与 `text-shadow` |
| 麻将绿 / 环色轮换 | `.mahjong` 的 `--mj-green`；`MJ_RINGS`、`ringVarsFor` |
| 象棋双方字色 | `.xiangqi.red` / `.xiangqi.black` 的 `--char-*`；底色仍是同一个 `xiangqi-blank` |
| 载体裁切/比例 | `carrierBg()` / `carrierRect()`，模式 `contain` |
| 卡边/接触阴影 | `.card-edge`、`.tile-edge`、`.xq-edge`；`previewCss()` 的 drop-shadow |
| WebP 质量 | `--quality`（默认 90） |

新增一张牌：在 `pokerCards` / `mahjongCards` / `xiangqiCards` 里加对象，并在对应内容分支处理。
