# 代码组装配图（compose）

用透明元素图 + 固定版面配置，在 Chrome headless 里拼出一张配图并截图。
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

### 1. 元素从哪来

`games/assets/art/elements/` 下的透明 PNG，**不是**本管线生成的：

- AI 图像模型（gpt-image-2 系列）按统一提示词逐件生成：深炭背景、左上暖光、30° 桌面视角、无文字。
- 再用 ffmpeg / 像素级 floodfill 抠成透明背景，按 `@2x` 导出（2 倍尺寸，供视网膜屏）。
- 每件元素是**单个物体**，构图留白、朝向稳定；不要带场景、地面或文字。

命名规则：`<name>@2x.png`，`<name>` 与 `scenes.json` 里的 `el` 完全一致。`--list` 会按场景逐项标出哪些元素还缺图。

`chess-queen-light`、`chess-knight-dark` 这类后缀（light/dark、red/black、face/back）表示**同一物体的不同面或阵营**，不是滤镜。

### 2. 怎么加一款新游戏

1. 在 `scenes.json` 里加一个以游戏 slug 命名的键（slug 必须和 `games/<slug>/` 一致）。
2. 选背景：`charcoal-warm` / `charcoal-cool` / `felt-green`，只能三选一。
3. 往 `items` 里放元素，先摆 2–5 件，跑 `node scripts/art/compose.js --game <slug>` 看效果。
4. 输出自动落到 `games/assets/art/composed/<slug>-og.png` 与 `<slug>-card.png`。

场景格式：

```json
{
  "chess": {
    "background": "charcoal-warm",
    "items": [
      { "el": "chess-queen-light", "x": 0.58, "y": 0.44, "scale": 0.44, "rot": -4, "shadow": true },
      { "el": "chess-knight-dark", "x": 0.32, "y": 0.60, "scale": 0.30, "rot": 8,  "shadow": true }
    ]
  }
}
```

| 字段 | 含义 |
|---|---|
| `el` | 元素名，对应 `elements/<el>@2x.png` |
| `x`,`y` | 元素中心点，画布归一化坐标 0–1（含端点） |
| `scale` | 边长占**画布短边**的比例。1200×630 的短边是 630，480×320 的短边是 320 |
| `rot` | 顺时针旋转角度，可正可负 |
| `shadow` | 是否画接触阴影 + 方向投影，缺省 `true` |

数组顺序就是叠放顺序：后面的元素压在前面的上面。

同一件元素可以在一个场景里出现多次（例如多颗棋子、多张牌），只要重复写 `item`。

### 3. 怎么调位置

只改 `scenes.json`，不碰模板：

- **左右挪**：改 `x`，0 是左边缘、1 是右边缘。
- **上下挪**：改 `y`，0 是上边缘、1 是下边缘。
- **大小**：改 `scale`。0.44 在 OG 上约 277px，在 card 上约 141px。
- **转一下**：改 `rot`。牌、棋子轻微 3–8° 就够，别超过 20°。
- **叠压**：调数组顺序，或让两个中心点靠近。
- **避免出框**：`x ± scale × (短边/宽) / 2` 和 `y ± scale/2` 要留在 0–1 内。

OG 与 card 共用同一套归一化坐标。两档短边不同，card 更窄，同一场景在 card 上元素相对更大、横向更挤。所以摆位时把关键元素放在 `x` 0.25–0.75、`y` 0.25–0.75，并两档都跑一遍看。

## 光影约定

- 唯一光源在**左上**：背景左上角有暖光晕，所有元素加 `drop-shadow`，偏移方向固定为**右下**。
- `shadow: true` 还会在元素底部画一个椭圆接触阴影（落在右下），营造「放在桌面」的感觉。
- 旋转只作用于元素图本身，不作用于投影方向：投影在屏幕坐标系里始终朝右下。
- 背景自带左上斜向光带与四周暗角，元素自然落在中间的光池里。

不要手动给单个元素加滤镜或改阴影方向；要改就统一改 `template.html` 的 `.bg::before` 和 `compose.js` 里的 `drop-shadow` 偏移。

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
| `scripts/art/compose.js` | 读场景、拼 HTML、调 Chrome、校验 PNG、打印缺失清单 |
| `scripts/art/scenes.json` | 每款游戏的版面：背景 + 元素 + 位置 + 缩放 + 旋转 + 阴影 |
| `scripts/art/template.html` | 渲染模板：背景预设、暗角、元素定位、投影、占位块，全部内联 CSS |
| `games/assets/art/composed/` | 生成物，可随时整目录重生成 |
| `games/assets/art/elements/` | 输入元素图（由另一条生成/抠图流程维护） |
