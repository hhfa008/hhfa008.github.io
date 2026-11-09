# 代码生成牌组（deck）

用**摄影级载体 + 代码绘制的油墨/雕刻层**生成三套完整牌组。字符与点数是字体和 SVG 排出来的，
不交给图像模型；载体只作为底，不被压平成纯色。

```
elements/*.png  +  deck.css  +  deck.js  ──►  Chrome headless (CDP)  ──┬─►  decks/<set>/png/<name>.png   (母版)
                                                                        ├─►  decks/<set>/webp/<name>.webp (站点产物)
                                                                        └─►  decks/_preview/*.png          (对照图)
```

## 命令

```bash
node scripts/art/deck.js --all                     # 102 张 + 三张对照图
node scripts/art/deck.js --set poker               # 只渲染扑克 54 张
node scripts/art/deck.js --set mahjong,xiangqi     # 可逗号分隔/重复 --set
node scripts/art/deck.js --preview                 # 用已有 WebP 重拼三张对照图
node scripts/art/deck.js --all --no-preview        # 只要牌，不要对照图
node scripts/art/deck.js --list                    # 列出 102 张 + 元素 alpha bbox 齐缺
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

仓库 `.gitattributes` 已把 `*.png`、`*.webp` 路由到 Git LFS。

### 当前基线（2026-11-10，摄影底 + 印刷/雕刻，两次全量运行）

| 套 | 张数 | WebP 总量 | WebP 平均 | WebP 最大单张 | PNG 母版总量 | PNG 平均 |
|---|---:|---:|---:|---:|---:|---:|
| poker | 54 | 437,820 B | 8,107 B | 11,858 B | 6,384,992 B | 118,240 B |
| mahjong | 34 | 310,740 B | 9,139 B | 13,994 B | 2,800,754 B | 82,375 B |
| xiangqi | 14 | 187,446 B | 13,389 B | 14,644 B (red-pao) | 1,228,454 B | 87,746 B |
| **合计** | **102** | **936,006 B** | **9,177 B** | **14,644 B** | **10,414,200 B** | **102,100 B** |

- WebP 总量 **0.89 MiB**，低于 3MB；单张最大 **14,644 B**，低于 30KB。
- 三张对照图：`poker-fan.png` 584,377 B、`mahjong-row.png` 683,513 B、`xiangqi-row.png` 592,452 B，合计 1,860,342 B（1.77 MiB）。
- 四张改前/改后放大图：合计 140,938 B。
- `decks/` 全目录约 **13.35 MB（12.73 MiB）**：PNG 母版 9.93 MiB + WebP 0.89 MiB + 对照图 1.77 MiB + 对比图 0.13 MiB。PNG 母版是主要重量，已走 Git LFS。

WebP 由 Chrome `Page.captureScreenshot(format:"webp", quality:90)` 直接输出。
抽查 `AS/10H/5t/red-shuai`：PIL 读回 **RGBA、四角 alpha=0、alpha 通道 MAE=0.00**；
RGB 每通道 MAE 约 1.3–7.4（red-shuai 红漆底细节最多），放大看没有可见色块或文字糊边。
因此没有改用 PNG-8。

## 元素载体与降级

需要的 9 个载体：

```
card-face-frame  pip-spade pip-heart pip-diamond pip-club  court-panel
mahjong-blank    xiangqi-blank-red  xiangqi-blank-black
```

载体是 1024×1024 的**产品摄影**方图，带纹理、微高光、边缘不完美。脚本只做 alpha bbox 映射，
不用纯色盖住它们。按 `@2x.png` → `.png` 顺序查找，先验证 PNG 签名，再用自带的最小 PNG
解码器（zlib + unfilter）算 alpha bbox：

| 元素 | alpha bbox（1024 源图） | 映射 |
|---|---|---|
| card-face-frame | 610×860 @ 207,82 | fill 256×358 |
| mahjong-blank | 637×860 @ 193,82 | fill 256×340 |
| xiangqi-blank-red | 843×860 @ 90,82 | fill 256×256，居中于 256×300 |
| xiangqi-blank-black | 847×860 @ 88,82 | 同上 |
| court-panel | 572×860 @ 226,82 | fill 152×206 |
| pip-spade / heart / diamond / club | 723×860 / 860×816 / 610×860 / 809×860 | contain 到方形点数框 |

**缺元素不崩**：任一载体缺失时自动走代码降级，并在结束时列出缺失项：

- `card-face-frame` → `--paper` 平涂 + 2px `--paper-line` 圆角线
- `pip-*` → 内联 SVG 花色，使用 `--red` / `--black`
- `court-panel` → 只画象牙色奖章 + 大字母
- `mahjong-blank` → `--ivory` 平涂 + 2px 内凹线
- `xiangqi-blank-*` → 同色系径向渐变圆盘 + 2px 外环/内环

验证降级不用改共享的 `elements/`（另一个 agent 可能正在写）：把 `--elements` 指向空目录即可：

```bash
mkdir -p /tmp/deck-empty-elements
node scripts/art/deck.js --all --no-preview \
  --elements /tmp/deck-empty-elements --out /tmp/deck-fallback
# 102 张照常生成，退出码 0，日志列出 9 个 MISSING ELEMENTS
```

## 视觉系统

### 调色板（从元素图取样，不自己调）

| 变量 | 值 | 来源 |
|---|---|---|
| `--red` | `#ac1a12` | `xiangqi-blank-red@2x.png` 均值（中位 `#ad110a`） |
| `--black` | `#262523` | `xiangqi-blank-black@2x.png` 均值（中位 `#1e1d1c`） |
| `--paper` | `#f0e3cb` | `card-face-frame@2x.png` 均值 |
| `--ivory` | `#e7d6b5` | `mahjong-blank@2x.png` 摄影版均值（中位 `#e8d9b9`） |
| `--gold` | `#c87838` | `court-panel@2x.png` 金色描边暗部簇 |
| `--mj-green` | `#1e6b47` | 麻将专用深墨绿，只作用在 `.mahjong` |

线色统一取基色 ×0.88（同色系深 12%）：`--paper-line #d3c8b3`、
`--ivory-line #cbbca0`、`--red-line #971710`、`--black-line #211f1f`、`--gold-line #b06a31`。

### 印刷感（扑克）

- **油墨**：页面内嵌 `#ink-rough` SVG filter。`feTurbulence` 做 0.45px 位移，0.3px 高斯模糊后
  与实心源叠加，再把 3.5% 的 turbulence 颗粒裁剪进字形并 multiply 进油墨。
  作用于点数、角标花色、中央点数、J/Q/K 大字母、JOKER 菱形/竖字、牌面 2px 内圈。
- **纸纤维**：`.paper-grain` 用 `feTurbulence` 生成 180×180 无缝灰度噪声，`mix-blend-mode: multiply`，
  `opacity: 0.025`，放在油墨层下方，不盖住载体纹理。
- **物理边**：`.card-edge` 用 1px 上/左亮边 + 下/右暗边模拟卡片厚度；
  对照图里用 `drop-shadow(2px 5px 3px)` + 长环境影，叠压时下方那张的边会暗。

### 雕刻感（麻将、象棋）

- 文字主体 = 原色 `color-mix(..., 65%, black)`（深 35%）；`text-shadow` 上 1px 亮边、下 1px 暗边。
  万子数字/萬、東南西北中發、象棋帥仕相…/將士象…全部走这套。
- 筒子圆环：环色同样深 35%，`.mj-dot` / `::before` / `::after` 各加 1px 内侧上亮/下暗，
  读起来是凹刻的同心环，不是描在表面的彩圈。
- 条子竖条：绿/红交替（序号 0 起为绿，绿为主），条身深 35%，左侧亮边/右侧暗边；节线仍是 2px `--gold`。
- 白板：双 2px `--ivory-line` 框，框线加内亮/内暗，保持留白但像刻出来的边框。
- 1条：绿身红翅红冠，鸟身整体加轻微上下 drop-shadow；它是全套里最“插画”、雕刻感最弱的一张。
- 所有高光从**左上**来；`.tile-edge`、`.xq-edge`、`.card-edge` 统一上/左亮、下/右暗。

### 字体（只有两种族）

| 用途 | 字体 | 证据 |
|---|---|---|
| 点数、J/Q/K、JOKER（拉丁） | `Helvetica Neue` 700，紧排 | `CSS.getPlatformFontsForNode` → `Helvetica Neue (HelveticaNeue-Bold)` |
| 全部汉字（麻将 + 象棋） | `Songti SC` 700 | `1w .mj-num`、`1w .mj-wan-char`、`red-shuai .xq-char` 均报 `Songti SC (STSongti-SC-Bold)` |

用 **Bold（700）而不是 Black（900）**：本机 Songti SC Black 缺 `帥將馬車砲萬東發` 等繁体字。
点数 `10` 用 31px + `scaleY(1.1)` 自适应，实测墨迹 29×24px，其他单字符 22×23px。

### 2px 压线

代码绘制的边框/环/内凹一律 `--line: 2px`，颜色取 12% 规则：
扑克卡面内圈、JOKER 菱形、court 奖章、白板双框、筒子三环、条子节线、象棋外环。
载体自带的摄影倒角不是矢量线（麻将内凹金线、象棋内刻环实测约 2px），脚本不重复描一遍。

### JOKER 角标

左右上角不再放 10px 小字；改成一个 **14×14px 旋转 45° 的菱形**、2px 描边，
红 Joker 红菱形、黑 Joker 黑菱形。中央竖排 `JOKER` 保留。

### 牌面排版

- **扑克**：左上 + 右下（旋转 180°）角标；A 单枚大花色；2–10 经典阵列；J/Q/K 用 `court-panel`
  + 象牙奖章 + 104px 大字母；JOKER 45° 菱形 + 竖排 JOKER + 角菱形。
- **麻将**：万 = 汉字数字 + 紅「萬」；筒 = 1 居中大圆、2 竖排、3 斜三角、4 四角、5 四角+心、
  6 两列三、7 上三+中一+下三、8 两列四、9 三行三列；条 = 1 画鸟，2–9 竖条；字牌 東南西北中發白。
- **象棋**：繁体 帥仕相馬車炮兵 / 將士象馬車砲卒，124px Songti SC Bold；红子深黑字、黑子暗金字。

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
**211 个文件**（102 WebP + 102 PNG 母版 + 3 对照图 + 4 对比图）md5 全部一致，
`diff` 退出码 0；排序清单指纹 `de8eec33bf9242b0d383b38dfeb04790`。

尺寸/透明度验收：102 张 WebP 全部 RGBA、尺寸正确、四角 alpha=0；单张最大 14,644 B。
PNG 母版用 `sips` 验过 54×256×358、34×256×340、14×256×300，0 个 0 字节。

## 本次检查的四张牌与对比图

| 牌 | 站点 WebP | PNG 母版 | 改前/改后放大 |
|---|---|---|---|
| AS | `decks/poker/webp/AS.webp` | `decks/poker/png/AS.png` | `decks/_preview/compare-AS.webp` |
| 10H | `decks/poker/webp/10H.webp` | `decks/poker/png/10H.png` | `decks/_preview/compare-10H.webp` |
| 5筒 | `decks/mahjong/webp/5t.webp` | `decks/mahjong/png/5t.png` | `decks/_preview/compare-5t.webp` |
| 帅 | `decks/xiangqi/webp/red-shuai.webp` | `decks/xiangqi/png/red-shuai.png` | `decks/_preview/compare-red-shuai.webp` |

三张对照图：`decks/_preview/poker-fan.png`、`mahjong-row.png`、`xiangqi-row.png`。

## 改哪里

| 想改 | 改哪里 |
|---|---|
| 点数阵列 / 圆点 / 条子位置 | `PIP_LAYOUT`、`DOT_LAYOUT`、`BAM_LAYOUT` |
| 油墨颗粒/毛刺 | `deck.js` 的 `INK_FILTER_SVG`；`deck.css` 的 `.paper-grain` |
| 雕刻深浅/亮暗边 | `deck.css` 的 `.mj-*`、`.xq-char` 的 `color-mix` 与 `text-shadow` |
| 麻将绿 / 环色轮换 | `.mahjong` 的 `--mj-green`；`MJ_RINGS`、`ringVarsFor` |
| 卡边/接触阴影 | `.card-edge`、`.tile-edge`、`.xq-edge`；`previewCss()` 的 drop-shadow |
| 调色板 | `deck.css` 顶部 `:root`（绿在 `.mahjong` 内） |
| WebP 质量 | `--quality`（默认 90） |

新增一张牌：在 `pokerCards` / `mahjongCards` / `xiangqiCards` 里加对象，并在对应内容分支处理。
