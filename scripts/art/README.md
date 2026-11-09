# 代码组装配图（compose）

用透明元素图 + 固定版面配置，在 Chrome headless 里拼出一张**同一台相机下的桌面场景**并截图。
它取代「让图像模型直接画一整张场景图」的做法：元素可复用、风格统一、换背景或挪位置不用重新生成整张图。

```
elements/<name>@2x.png  +  scenes.json  +  template.html
        │                     │                │
        └──────── compose.js ─┴────────────────┘
                              │
                      Chrome headless --screenshot
                              │
                composed/<game>-og.png   1200×630
                composed/<game>-card.png 480×320
```

相机固定：`perspective: 1600px`，桌面平面 `rotateX(52deg) rotateZ(-14deg)`，`transform-style: preserve-3d`。所有场景共用这一个相机，所以 12 张图的桌面角度、地平消失方向一致。

## 命令

```bash
node scripts/art/compose.js --game chess   # 一款：og + card
node scripts/art/compose.js --all          # 全部已配置场景
node scripts/art/compose.js --sheet        # 全部重渲染 + 总览拼图 _sheet.png
node scripts/art/compose.js --list         # 列出场景、元素齐缺
```

可选参数：`--elements <dir>`（元素图目录，默认 `games/assets/art/elements`）、`--out <dir>`（输出目录，默认 `games/assets/art/composed`）。环境变量 `CHROME_PATH` 可覆盖 Chrome 路径。

零 npm 依赖，只需要 Node 18+（本机 v24 已验证）和本机 Chrome。

## 三个边界

### 1. 素材从哪来

**元素**：`games/assets/art/elements/` 下的透明 PNG，由 AI 图像模型逐件生成、再像素级 floodfill 抠图导出。`compose.js` 会现场解码 PNG 的 alpha bbox，按真实毫米目标尺寸把可见轮廓映射到桌面上。

**牌面**：`games/assets/art/decks/{poker,mahjong,xiangqi}/webp/*.webp`，由 `scripts/art/deck.js` 用字体 + SVG + 空白载体渲染，共 102 张（扑克 54、麻将 34、象棋 14）。场景里用 `src` 直接引用。

两者都不在本管线里生成。不要手改这些目录；缺图时管线会走占位降级并打印清单。

### 2. 怎么加一款新游戏

1. 在 `scenes.json` 里加一个以游戏 slug 命名的键（slug 必须和 `games/<slug>/` 一致）。
2. 选背景：`charcoal-warm` / `charcoal-cool` / `felt-green`。
3. 选棋盘：`chess8` / `go9` / `xiangqi9x10` / `reversi8` / `connect4frame` / `backgammon` / `cardtable` / `aeroplaneCross` / `none`。
4. 摆物件：`flat` 进桌面平面，`standing` 是广告牌；有网格棋盘的场景用 `cell` 记格点，`x,y` 用棋盘盒子归一化坐标。
5. 声明 `realism`，跑 `node scripts/art/compose.js --game <slug>`；`REALISM FAIL` 会直接阻断。

场景示例（象棋真实开局的一枚红車）：

```json
{
  "xiangqi": {
    "background": "charcoal-warm",
    "board": "xiangqi9x10",
    "realism": { "pieceCount": 32, "mustTouchSurface": true, "board": "xiangqi9x10" },
    "items": [
      { "src": "decks/xiangqi/webp/red-ju.webp", "shape": "flat", "rot": 0,
        "cell": { "col": 0, "row": 9 }, "x": 0.056, "y": 0.95 }
    ]
  }
}
```

| 字段 | 含义 |
|---|---|
| `el` / `src` | 二选一。`el` → `elements/<el>@2x.png`；`src` → `games/assets/art/` 下的 WebP |
| `shape` | `flat`（默认，进桌面平面）或 `standing`（屏幕直立广告牌） |
| `board` | 棋盘/桌面几何，见下表；缺省 `none` |
| `x`,`y` | 有棋盘的场景是**棋盘盒子归一化坐标**；`none` 时是桌面平面归一化坐标 |
| `cell` | `{col,row}`：格点/交叉点/孔位/三角点，供对位和真实校验 |
| `realScale` | 默认 `1.0`；只用于远景压缩，普通场景不要用 |
| `rot` | `flat` 绕桌面法线；`standing` 是屏幕旋转（±8°） |
| `role` | `hand` / `public` / `hole` / `wall` / `chip` / `dice` 等，参与计数与校验 |
| `side` | `dark` / `light`，用于双方棋子区分 |
| `stack` | 同一位置叠放的实物数量（筹码、西洋双陆棋子） |
| `stackStep` | 每层叠放的毫米厚度，缺省 3mm |
| `filter` | 可选的 CSS filter，用于把同一素材变成另一方颜色 |
| `shadow` | 是否画接触阴影，缺省 `true` |

棋盘物理规格（1 unit = 1mm）：

| board | 实际尺寸 | 网格/孔位 | 当前场景 |
|---|---|---|---|
| `chess8` | 440×440mm | 8×8 格，格宽 55mm | chess、checkers-jump |
| `xiangqi9x10` | 270×300mm | 9 列 10 行，格距 30mm，含河界/九宫 | xiangqi |
| `go9` | 200×200mm | 9×9 线，格距 22mm，5 星位 | go9 |
| `reversi8` | 260×260mm | 8×8 格，格距 30mm | reversi |
| `connect4frame` | 280×240mm | 7×6 孔，孔距 40mm，孔半径 18mm | connect4 |
| `backgammon` | 600×300mm | 24 个三角点，点宽 50mm，中线 20mm | backgammon |
| `cardtable` | 600×600mm 特写桌面 | 软边 + 极细压线，无网格；可叠加 `zoom` 拉近 | mahjong、texas-holdem、doudizhu |
| `aeroplaneCross` | 500×500mm | 十字轨道 + 4 个停机坪 | aeroplane |
| `none` | 400×400mm 参考框 | 不画棋盘，只用于确定全局缩放 | tcg-sample |

### 3. 尺寸怎么算

- **1 unit = 1mm**。每个场景有一个全局缩放系数 `k`（平面 px / mm），在 `sceneScale()` 里二分求出：让整个棋盘/桌面带 4% 边距完整落在画框内。`[scale]` 行会打印 `board=...mm  og k=...  card k=...`。
- 同一场景内**所有物件共用同一个 `k`**。物件的实际毫米尺寸来自：
  - 元素：新导出的 chess 12 件按 `1mm=8px` 直接取 alpha bbox（王 94.4mm、后 81.3mm、象 69.5mm、马 61.4mm、车 54.5mm、兵 44.5mm；王/兵实际 2.12×，不是 1.7×）；其余元素用 `ELEMENT_PHYS` 的真实目标尺寸（围棋 20mm、黑白棋 28mm、四子棋 33mm、跳棋 30mm、筹码 39mm、骰子 16mm、扑克 63×88mm、麻将 30×40mm、灯灵 80mm），再用 PNG 的实际 alpha bbox 换算成方图盒子。
  - deck 牌面：扑克 63×88mm、麻将 30×40mm、象棋 28mm 直径。
- `realScale` 默认 `1.0`。除远景压缩外，不要逐件改；否则会破坏真实比例。棋盘相对物件的比例由毫米规格保证。

### 4. 真实局面校验（REALISM FAIL）

`realism` 声明：

```json
"realism": { "pieceCount": 32, "mustTouchSurface": true, "board": "xiangqi9x10" }
```

`validateRealism()` 在启动 Chrome 之前检查：

- `pieceCount` 是否等于实际件数（`stack` 按数量计；`wall`/`dice`/`chip`/`accessory` 不计入）
- 所有物件是否在桌面/棋盘范围内（`mustTouchSurface`）
- `board` 是否与 `scene.board` 一致
- 按场景追加规则：象棋无同色重复骑士、象棋 32 子 16+16；围棋 10–16 子且黑白差 ≤1、全部在交叉点；黑白棋 4 子标准开局；四子棋每列从底行连续堆叠；跳棋 24 子只在深色格；西洋双陆一方 15 子、另一方 3–5；麻将 13 张手牌 + 牌墙；德州 5 公牌 + 2 底牌；斗地主 17 张；飞行棋 4 架 + 2 骰。
- 不满足打印 `REALISM FAIL` 并 **退出码 3，不出图**。

用一个临时场景文件即可验证拦截，不会碰正式场景：

```bash
node -e "let s=require('./scripts/art/scenes.json');s.connect4.items[0].cell.row=0;require('fs').writeFileSync('/tmp/bad.json',JSON.stringify(s))"
node scripts/art/compose.js --scenes /tmp/bad.json --game connect4 --out /tmp/nope
# REALISM FAIL (1) — refusing to render:
#   - connect4: column 0 floats: rows 5,4,... 
```

## 重叠检查

每次渲染对 `flat` 物件的**实际 alpha 可见轮廓**做投影 AABB/椭圆检查：

- 普通场景：任意两件重叠不得超过较小者的 **12%**
- `texas-holdem` / `doudizhu` 的扑克牌对：允许到 **45%**（扇形叠压是有意的）
- 圆片类（围棋/黑白棋/四子棋/跳棋/筹码/象棋棋饼）按椭圆采样，不按方形 AABB，避免相邻棋子误报

超限打印 `OVERLAP WARNINGS`，列出场景、元素对、比例、上限和尺寸，**不阻断**。最终 12 款当前为 0 条告警。

## 相机与光影

- **唯一相机**：`perspective: 1600px`、桌面 `rotateX(52deg) rotateZ(-14deg)`。`template.html` 与 `compose.js` 的 `CAMERA` 必须一起改。
- **桌面**：平面 = 画布 × 1.6，居中；点阵织纹给 12 张图提供统一的透视参照。
- **棋盘**：`BOARD_PHYS` 给真实毫米尺寸，`boardSvg` 用毫米坐标画线格/孔/三角点；线宽 `1.5/k` mm（屏幕约 1.5px），线色 `rgba(245,238,220,0.20)`，带 `drop-shadow` 微光。
- **接触阴影**：所有物件共用 `.shadow`——椭圆径向渐变，中心在物件底部，平面偏移 `(6,18)`px（屏幕约右下 10–12px），`blur(6px)` 固定。
- **光源**：屏幕左上暖光晕 + 桌面平面柔光池；所有阴影落右下。

### 牌类特写

mahjong / texas-holdem / doudizhu 用 600×600mm 特写桌面，并分别加 `zoom`（1.55 / 1.45 / 1.2）把相机拉近。桌子会被裁切，但 480×320 card 里麻将「一萬」和扑克左上角点数/花色都可辨认。`zoom` 与全局 k 相乘，仍然只有一个缩放系数；所有物件同倍放大。

### chess 标准开局

chess 现在是 32 枚标准开局：浅色方在近侧，底线车马象后王象马车、次底线 8 兵；深色方在远侧同样 16 枚。`realism` 校验 32 子、16+16、两侧底线顺序、兵线、方格唯一性和 standing 形态。新 chess 12 件按 `1mm=8px` 取元素自身像素尺寸；王/兵实际比例 2.12×（不是 1.7×，以素材为准）。

## 缺图降级

元素可能还没生成齐。缺 `elements/<el>@2x.png` 时：

- **不报错、不中断**，在该位置画一个**同尺寸**方块占位：虚线边框 + 元素名文字。
- 跑完在 stdout 打印 `MISSING ELEMENTS` 清单，列出文件名和用它的场景。
- 退出码仍是 0（这是可预期的降级，不是失败）。

所以可以先用占位图把版面搭好，等元素图到位后重跑同一条命令即可，`scenes.json` 不用改。

## Chrome 路径与版本

默认路径：

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

本机验证版本：**Google Chrome 156.0.8078.80**（macOS）。需要支持 `--headless=new` 和 `--screenshot`，Chrome 109+ 即可。

找不到时会直接报错并列出查找过的路径，不会静默生成空图。也可：

```bash
CHROME_PATH="/path/to/Google Chrome" node scripts/art/compose.js --all
```

调用参数：`--headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files --virtual-time-budget=1500`，每次渲染用独立的临时 `--user-data-dir`，结束后删除。

## 输出与确定性

| 输出 | 尺寸 | 用途 |
|---|---|---|
| `composed/<slug>-og.png` | 1200×630 | Open Graph / 社交分享大图 |
| `composed/<slug>-card.png` | 480×320 | 大厅卡片缩略图 |
| `composed/_sheet.png` | 2400×动态高度 | 总览拼图：3 列，每格 OG 图 + 下方 slug 标签，格间距 24px |

`--sheet` 会先重渲染全部场景（等于 `--all`），再把每款游戏的 OG 图按 3 列排进一张 2400px 宽的深灰底拼图，每格下方用 30px 字号标注 slug。12 款场景时输出 2400×1980；行数随场景数自动增加。

- 截图后会用 PNG IHDR 校验实际像素，尺寸不符直接报错。
- 同一输入重复跑，输出 PNG 的 md5 必须一致。管线里没有时间戳、随机数或远程请求；Chrome 用固定窗口、固定 DPR、固定临时 profile。
- 若 md5 变了，先查 Chrome 版本 / 字体 / 元素图是否被改动，而不是改代码。

验证尺寸：

```bash
sips -g pixelWidth -g pixelHeight games/assets/art/composed/chess-og.png
md5 games/assets/art/composed/*.png
```

## 为什么不用整张 AI 生成图

1. **可复用**：一颗棋子、一枚筹码只生成一次，之后可以出现在任意场景、任意大小和角度。整张图每次都要重出，且每次细节不一致。
2. **风格统一**：所有游戏共用同一套元素、同一束左上光、同一组背景。整张图各自生成，光向、材质和暗角很难对齐。
3. **改配色/构图不用重出**：换背景、挪位置、加一件元素，只是改 JSON 再截图（秒级）。整张图要重新写提示词、重新抽卡、重新人工挑图。
4. **可控与可测**：位置、缩放、旋转、阴影都是数字，能 diff、能批量、能回归。生成式场景图只能靠眼看。
5. **可降级**：缺一件元素时仍能出版面正确的占位图，不会阻塞页面接线。

代价是：单个元素必须抠干净、带透明通道，且不同元素的透视/光照要接近——这是这条管线最脆弱的一环。

## 文件

| 文件 | 作用 |
|---|---|
| `scripts/art/compose.js` | 读场景、拼 HTML（含棋盘 SVG/投影/重叠检查）、调 Chrome、校验 PNG、打印缺失与重叠清单 |
| `scripts/art/scenes.json` | 每款游戏的版面：背景 + 棋盘 + 元素 + 位置 + 缩放 + 旋转 + 阴影 |
| `scripts/art/template.html` | 渲染模板：相机（perspective + 桌面倾斜）、3 种背景、桌面点阵、平面/广告牌布局、统一阴影、暗角、占位块，全部内联 CSS |
| `games/assets/art/composed/` | 生成物，可随时整目录重生成 |
| `games/assets/art/elements/` | 输入元素图（由另一条生成/抠图流程维护） |
