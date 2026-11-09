# 代码生成牌组（deck）

用**字体 + SVG + 元素载体**渲染三套完整牌组，字符与点数全部由代码排出来，不交给图像模型。
零 npm 依赖：Node 内置 `WebSocket` 直连本机 Chrome 的 DevTools 协议，一次 Chrome 启动渲染全部 102 张。

```
elements/*.png  +  deck.css  +  deck.js  ──►  Chrome headless (CDP)  ──►  decks/<set>/*.png
                                                                   └──►  decks/_preview/*.png
```

## 命令

```bash
node scripts/art/deck.js --all                     # 102 张 + 三张对照图
node scripts/art/deck.js --set poker               # 只渲染扑克 54 张
node scripts/art/deck.js --set mahjong,xiangqi     # 可逗号分隔/重复 --set
node scripts/art/deck.js --preview                 # 用已有 PNG 重拼三张对照图
node scripts/art/deck.js --all --no-preview        # 只要牌，不要对照图
node scripts/art/deck.js --list                    # 列出 102 张 + 元素 alpha bbox 齐缺
```

可选参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--elements <dir>` | `games/assets/art/elements` | 元素载体目录，只读，不写入 |
| `--out <dir>` | `games/assets/art/decks` | 输出根目录 |
| `--preview` | 关 | `--all` 会自动开；单独用则重拼已有牌 |
| `--no-preview` | — | 压过 `--preview` |

环境变量 `CHROME_PATH` 可覆盖 Chrome 可执行文件。需要 Node 22+（本机 v24 已验证）与本机 Google Chrome。

## 输出

| 套 | 张数 | 尺寸 | 文件名 |
|---|---:|---|---|
| poker | 54 | 256×358 | `AS 2S … KS AH … KC joker-red joker-black` |
| mahjong | 34 | 256×340 | `1w…9w 1t…9t 1s…9s east south west north red green white` |
| xiangqi | 14 | 256×300 | `red-shuai red-shi red-xiang red-ma red-ju red-pao red-bing` / `black-jiang … black-zu` |

全部**透明背景**。扑克/麻将的圆角外、象棋圆盘上下留白都是 alpha=0，可以直接叠在任何底色上。
`_preview/poker-fan.png`、`_preview/mahjong-row.png`、`_preview/xiangqi-row.png` 是对照图，深色底只为看清透明边缘，不是交付牌面。

当前基线（2026-11-10 两次全量运行）：102 张 · 10,920,951 B · 单张平均 107,068 B。

## 元素载体与降级

需要的 9 个载体：

```
card-face-frame  pip-spade pip-heart pip-diamond pip-club  court-panel
mahjong-blank    xiangqi-blank-red  xiangqi-blank-black
```

每个元素都按 `@2x.png` → `.png` 顺序查找，先验证 PNG 签名，再解码 alpha bbox。
载体图是 1024×1024 带透明留白的方图；脚本用自带的最小 PNG 解码器（zlib + unfilter）算出
alpha bbox，再把 bbox 映射到 256 宽的目标框，所以卡面/麻将/棋子能铺满输出，不会因为
1024 方图的透明边距而缩成一小块。

| 元素 | alpha bbox（1024 源图） | 映射方式 |
|---|---|---|
| card-face-frame | 610×860 @ 207,82 | fill 256×358 |
| mahjong-blank | 637×860 @ 193,82 | fill 256×340 |
| xiangqi-blank-red | 843×860 @ 90,82 | fill 256×256，居中于 256×300 |
| xiangqi-blank-black | 847×860 @ 88,82 | 同上 |
| court-panel | 572×860 @ 226,82 | fill 152×206 |
| pip-spade / heart / diamond / club | 723×860 / 860×816 / 610×860 / 809×860 | contain 到方形点数框 |

**缺元素不崩**：任何一个载体缺失时自动走代码降级，并在结束时列出缺失项与对应降级：

- `card-face-frame` → `--paper` 平涂 + 2px `--paper-line` 圆角线
- `pip-*` → 内联 SVG 花色，使用 `--red` / `--black`
- `court-panel` → 只画象牙色奖章 + 大字母
- `mahjong-blank` → `--ivory` 平涂 + 2px 内凹线
- `xiangqi-blank-*` → 同色系径向渐变圆盘 + 2px 外环/内环

验证降级不需要改共享的 `elements/`（另一个 agent 可能正在写）：把 `--elements` 指向空目录即可，
效果等价且不会抢文件：

```bash
mkdir -p /tmp/deck-empty-elements
node scripts/art/deck.js --all --no-preview \
  --elements /tmp/deck-empty-elements --out /tmp/deck-fallback
# 102 张照常生成，退出码 0，日志列出 9 个 MISSING ELEMENTS
```

## 视觉系统

### 调色板（从元素图取样，不自己调）

PIL 取不透明像素均值/中位数：

| 变量 | 值 | 来源 |
|---|---|---|
| `--red` | `#ac1a12` | `xiangqi-blank-red@2x.png` 均值（中位 `#ad110a`） |
| `--black` | `#262523` | `xiangqi-blank-black@2x.png` 均值（中位 `#1e1d1c`，不用纯黑） |
| `--paper` | `#f0e3cb` | `card-face-frame@2x.png` 均值 |
| `--ivory` | `#eed7a3` | `mahjong-blank@2x.png` 均值（中位 `#f0daa7`） |
| `--gold` | `#c87838` | `court-panel@2x.png` 金色描边的暗部簇（亮部 `#d08840`） |

线色统一取基色 ×0.88（同色系深 12%）：
`--paper-line #d3c8b3`、`--ivory-line #d1bd8f`、`--red-line #971710`、`--black-line #211f1f`、`--gold-line #b06a31`。

### 字体（只有两种族）

| 用途 | 字体 | 证据 |
|---|---|---|
| 点数、J/Q/K、JOKER（拉丁） | `Helvetica Neue` 700，紧排 | `CSS.getPlatformFontsForNode` → `Helvetica Neue (HelveticaNeue-Bold)` |
| 全部汉字（麻将 + 象棋） | `Songti SC` 700 | `1w .mj-num`、`1w .mj-wan-char`、`red-shuai .xq-char` 均报 `Songti SC (STSongti-SC-Bold)` |

注意用 **Bold（700）而不是 Black（900）**：本机 Songti SC Black 缺 `帥將馬車砲萬東發` 等繁体字，
Bold 覆盖这些字。`--han` 不写 `STKaiti`/`PingFang SC` 作为同用途备选，避免同一用途换字形。
点数 `10` 用 31px + `scaleY(1.1)` 自适应：实测墨迹 29×24px，其他单字符 22×23px，高度一致且不越出 38px 角标框。

### 2px 压线

代码绘制的边框/环/内凹一律 `--line: 2px`，颜色取上面 12% 规则：

- 扑克：卡面内圈 2px `--paper-line`（inset 7px，圆角 10px）；JOKER 菱形外框 2px `--gold` + 内框 2px `--gold-line`；court 奖章 2px `--paper-line`
- 麻将：白板双 2px `--ivory-line`；筒子同心环 2px（红/金/黑）；条子节线 2px `--gold`
- 象棋：圆盘外环 2px `--red-line`/`--black-line`（距轮廓 1px）

载体图自带的摄影倒角不是矢量线：麻将空白的内凹金线在 256 输出下实测约 2px，象棋内刻环约 2px，
脚本不重复描一遍；上面列的是代码自己画的那一层。

### 牌面排版

- **扑克**：左上 + 右下（旋转 180°）角标；A 单枚大花色居中；2–10 用经典阵列
  （`PIP_LAYOUT`：行 0/⅓/⅔/1，列 0/1；7/8 加 ⅙、⅚ 中点；10 是两列各 4 + 中间 ⅓/⅔）；
  J/Q/K 用 `court-panel` + 象牙奖章 + 104px 大字母；JOKER 用 45° 菱形 + 竖排 JOKER。
- **麻将**：万 = 汉字数字 + 紅「萬」；筒 = 1 居中大圆、2 竖排、3 斜三角、4 四角、5 四角+心、
  6 两列三、7 上三+中一+下三、8 两列四、9 三行三列；条 = 1 画鸟，2–9 按
  `BAM_LAYOUT` 摆竖条；字牌 東南西北中發白，白板只留双描边。
  颜色只用调色板：中=红、發=近黑（没有绿色，不另造色）。
- **象棋**：繁体 帥仕相馬車炮兵 / 將士象馬車砲卒，124px Songti SC Bold；
  红子深黑字、黑子暗金字，保证对比。

## 确定性与验收

```bash
node scripts/art/deck.js --all
find games/assets/art/decks -name '*.png' -exec md5 -r {} + | sort > /tmp/a.txt
node scripts/art/deck.js --all
find games/assets/art/decks -name '*.png' -exec md5 -r {} + | sort > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt        # 必须无输出
```

固定顺序 + 等 `document.fonts.ready` + 等所有图片 `decode()` + 两帧 rAF + 固定
`deviceScaleFactor=1` / `--force-color-profile=srgb`；PNG 里不写时间戳。
2026-11-10 实测两次全量运行 105 个 PNG（102 牌 + 3 对照图）md5 全部一致，`diff` 退出码 0。

尺寸验收（`sips`）：

```bash
for set in poker mahjong xiangqi; do
  case $set in poker) H=358;; mahjong) H=340;; xiangqi) H=300;; esac
  for f in games/assets/art/decks/$set/*.png; do
    sips -g pixelWidth -g pixelHeight "$f" | grep -E 'pixel(Width|Height)'
  done
done
# 扑克 54×256×358，麻将 34×256×340，象棋 14×256×300，0 个 0 字节
```

## 改哪里

| 想改 | 改哪里 |
|---|---|
| 点数阵列 / 圆点 / 条子位置 | `deck.js` 的 `PIP_LAYOUT`、`DOT_LAYOUT`、`BAM_LAYOUT` |
| 花色、点数大小、角标位置 | `deck.css` 的 `.corner`、`.rank`、`.pip`、`.pips` |
| 麻将字/颜色/字距 | `deck.css` 的 `.mj-*`；`deck.js` 的 `mahjongContent` |
| 象棋字/颜色 | `deck.js` 的 `XIANGQI`；`deck.css` 的 `.xq-*` |
| 调色板 | `deck.css` 顶部 `:root`，改完在注释里写清取自哪个元素 |
| 输出目录/元素目录 | `--out` / `--elements` |

新增一张牌：在对应的 `pokerCards` / `mahjongCards` / `xiangqiCards` 里加对象，并在
`mahjongContent` / `xiangqiPiece` / 扑克分支里处理它的 kind；输出文件名就是 `card.name`。
