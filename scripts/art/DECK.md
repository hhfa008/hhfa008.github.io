# 代码生成牌组（deck）

用**摄影级载体 + 代码绘制的油墨/雕刻层 + 12 张 AI 木刻花牌像**生成三套完整牌组。
字符与点数是字体和 SVG 排出来的，不交给图像模型；只有 J/Q/K 的半身像使用 AI 生成。

```
elements/*.png + court/*.png + deck.css + deck.js
        └────────────── Chrome headless (CDP) ──────────────┐
                                                             ├─► decks/<set>/png/<name>.png   (母版)
                                                             ├─► decks/<set>/webp/<name>.webp (站点产物)
                                                             └─► decks/_preview/*             (对照图)
```

## 命令

```bash
node scripts/art/deck.js --all                     # 102 张 + 三张对照图
node scripts/art/deck.js --set poker               # 只渲染扑克 54 张
node scripts/art/deck.js --set mahjong,xiangqi     # 可逗号分隔/重复 --set
node scripts/art/deck.js --preview                 # 用已有 WebP 重拼三张对照图
node scripts/art/deck.js --all --no-preview        # 只要牌，不要对照图
node scripts/art/deck.js --list                    # 102 张 + 载体 bbox + 花牌像齐缺
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--elements <dir>` | `games/assets/art/elements` | 载体目录，只读 |
| `--out <dir>` | `games/assets/art/decks` | 输出根目录 |
| `--quality <0-100>` | `90` | WebP 质量 |
| `--preview` / `--no-preview` | 关 / — | 对照图开关 |

`--list` 每次都会先跑 `assertPipSymmetry()`，并打印 `pip symmetry OK (2–10, 180° rotational)`；
如果 2–10 的某个点阵不是 180° 对称，脚本直接报错退出。

## 输出：源与产物

| 路径 | 角色 | 格式 |
|---|---|---|
| `decks/<set>/png/<name>.png` | 牌面母版，重新压/改色都靠它 | 无损 PNG RGBA |
| `decks/<set>/webp/<name>.webp` | 站点实际引用 | WebP q0.9 RGBA |
| `decks/_preview/*.png` | 三张对照图 | PNG |
| `decks/_preview/compare-*.webp` | 改前/改后局部放大 | WebP |
| `games/assets/art/court/<rank>-<suit>.png` | 12 张花牌半身像源图 | 透明 PNG，512px |

`.gitattributes` 已把 `*.png` / `*.webp` 路由到 Git LFS。

### 当前基线（2026-11-10，最终版）

| 套 | 张数 | WebP 总量 | 平均 | 最大单张 | PNG 母版总量 |
|---|---:|---:|---:|---:|---:|
| poker | 54 | 751,536 B | 13,917 B | 22,132 B (JH) | 7,926,659 B |
| mahjong | 34 | 315,640 B | 9,283 B | 14,350 B (9t) | 2,759,700 B |
| xiangqi | 14 | 183,824 B | 13,130 B | 14,732 B (black-xiang) | 1,143,725 B |
| **合计** | **102** | **1,251,000 B** | **12,265 B** | **22,132 B** | **11,830,084 B** |

- WebP 总量 **1.19 MiB**，单张最大 **22,132 B**，都低于 3MB / 30KB。
- 花牌像源图 12 张，共 **6,658,533 B（6.35 MiB）**。
- 三张对照图 2,025,595 B；六张对比图 209,930 B。
- `decks/` 全目录 15,316,609 B（14.61 MiB）；加花牌像源图后约 21.98 MB（20.96 MiB），全部走 LFS。
- 102 张 WebP 全部 `RGBA`、尺寸正确、四角 `alpha=0`；PNG 母版 `sips` 验过 54×256×358、34×256×340、14×256×300，0 个 0 字节。

## 扑克：真花牌、真点阵、标准花色

### J/Q/K：12 张 AI 半身像，代码做双头

- 源图：`games/assets/art/court/<rank>-<suit>.png`（K-Q-J × S-H-D-C，12 张）。
- 风格：gpt-image-2 木刻版画 / 维多利亚印刷；半身、朝右、纯白底；后处理白底转 alpha、
  裁 alpha bbox、缩到 512px。提示词见 `games/assets/art/PROMPTS.md`。
- 合成：`court-panel` 作为红/金外框；框内是一块象牙色 `.court-portrait`，放大前后各一张
  `<img>` —— 上半部正常，下半部同一张图旋转 180°，各自 `clip-path: inset(0 0 50% 0)`。
  这是标准扑克的双头点对称；中央不再放字母，J/Q/K 字母只保留在左上/右下角标。
- 12 张源图：K 戴冠持剑、Q 戴冠持花、J 戴羽帽持戟；S/C 单色黑墨，H/D 加深红袍饰。
- 缺任何一张花牌像时，回退为原来的「象牙奖章 + 大字母」，不会崩。

### A：一枚 120px 大花色 + 装饰环/放射线

`aceMarkup()` 画一个 200×200 的装饰层：2px 外环、2px 内环、12 根 2px 短线；
中心是 120px 的标准 SVG 花色。A 不再是「角标放大」。

### 2–10：严格 180° 旋转对称

`PIP_LAYOUT` 里每个点 `(x,y)` 必须存在 `(1-x,1-y)`；`assertPipSymmetry()` 每次运行都检查。

| 点数 | 排布 |
|---|---|
| 2 | 上 1 / 下 1（中列） |
| 3 | 上 1 / 正中 1 / 下 1 |
| 4 | 四角 |
| 5 | 四角 + 正中 |
| 6 | 两列各 3（0 / 0.5 / 1） |
| 7 | 两列各 3 + 正中 1（2–3–2） |
| 8 | 两列各 3 + 上中 1 + 下中 1（0.25 / 0.75） |
| 9 | 两列各 4 + 正中 1 |
| 10 | 两列各 4 + 上中 1 + 下中 1（1/3 / 2/3，2–3–3–2） |

注：7 的「上中 1」会破坏 180° 对称，因此采用同样传统、且严格对称的 **2–3–2（正中 1）**。
6/7/8 的列位从旧的 1/3 改为 0/0.5/1，才是真正的上下旋转对称。

### 花色：标准 SVG，不用 AI 图

- 黑桃：尖顶 + 双肩 + 短柄；红心对称；方片菱形；梅花三瓣 + 柄。
- 角标花色 **12px**；中央点数按枚数 32–46px 自适应；A 中央 **120px**。
- 红桃/方片用 `--red`，黑桃/梅花用 `--black`；所有 SVG 走 2px 压线和 `#ink-rough` 油墨 filter。
- 牌面是均匀米白：`.poker-paper` 纯色 + 2.5% 纸纤维，没有渐变底色。

## 麻将：蓝/绿/红传统配色

```css
.mahjong {
  --mj-green: #1e6b47;
  --mj-blue: #1b4f8a;
  --mj-teal: color-mix(in srgb, var(--mj-blue) 55%, var(--mj-green));
}
```

- 筒子：1 筒外红内绿；2–9 每个点按序号在 **红/绿/蓝** 三色里轮换外/中/内三圈。
  环色深 35%，每环上亮/下暗，读成凹刻。
- 条子：绿/红交替（序号 0 起绿，绿为主），条身深 35%，左亮/右暗；1 条是绿身红翅鸟。
- 發 → 绿；中 → 红；**白板外框改蓝绿色 `--mj-teal`**；万子保持黑数字 + 红萬。
- 所有汉字 Songti SC Bold，深 35% + 上 1px 亮边 + 下 1px 暗边。

## 象棋：两边同一副浅木

- 双方统一用 `xiangqi-blank@2x.png` 浅木底（alpha bbox 234×238 @395,393，均值 `#e0b671`）；
  外圈木色 = 均值 ×0.88（`#c5a063`），不再用红/黑。
- 红方 `帥仕相馬車炮兵` 暗红刻字；黑方 `將士象馬車砲卒` 近黑刻字。
- 刻字：主体深 35%，上 1px 亮边、下 1px 暗边；材质/底色/外环完全一致。
- 红黑一致性实测：alpha diff 0；RGB diff 只落在字区；字区外逐像素相同。

## 载体裁切：包围盒 → contain

载体按真实尺寸归一化（1mm=8px），1024 画布里只有中间一小块实体。脚本用自带 PNG 解码器
算 alpha bbox，裁掉透明留白，再按真实比例 contain：

| 载体 | bbox | 裁后 contain | 若整张 1024 直接缩 |
|---|---|---|---|
| card-face-frame | 498×698 @263,163 | 255.4×358.0 / 256×358 | 124.5×174.5 |
| mahjong-blank | 150×206 @437,409 | 247.6×340.0 / 256×340 | 37.5×51.5 |
| xiangqi-blank | 234×238 @395,393 | 251.7×256.0 / 256×300（y=22） | 58.5×59.5 |

麻将 `.tile-edge`、象棋 `.xq-rule/.xq-edge` 跟随裁后可见矩形，不会画进透明留白。

## 降级

只依赖 4 个载体：`card-face-frame`、`court-panel`、`mahjong-blank`、`xiangqi-blank`。
花色是 SVG，旧 `pip-*` 不再读取；象棋红/黑底色不再用旧 red/black 载体。缺载体时：

- `card-face-frame` → `--paper` 平涂 + 2px `--paper-line`
- `court-panel` → 象牙奖章 + 大字母
- `mahjong-blank` → `--ivory` 平涂 + 2px 内凹线
- `xiangqi-blank` → 浅木 `#e0b671` 圆盘 + 2px 木色环

```bash
mkdir -p /tmp/deck-empty-elements
node scripts/art/deck.js --all --no-preview \
  --elements /tmp/deck-empty-elements --out /tmp/deck-fallback
# 102 张照常生成，退出码 0，列出 4 个 MISSING ELEMENTS
```

花牌像缺失时回退为奖章+字母；`--list` 会打印 `court dir: ... 12/12 portraits present`。

## 字体与压线

- 拉丁/点数/JOKER：`Helvetica Neue` 700，紧排；汉字：`Songti SC` 700（Black 缺繁体字）。
- 代码绘制的边框/环/内凹一律 2px，线色 = 基色 ×0.88。
- 高光统一左上；`.card-edge`、`.tile-edge`、`.xq-edge` 上/左亮、下/右暗；对照图 drop-shadow 向右下。

## 确定性与实际路径

两次全量 `--all`（2026-11-10）共 **212 个文件**（102 WebP + 102 PNG + 3 对照图 + 5 对比图）
md5 全部一致，`diff` 退出码 0；排序清单指纹 `b5dd95b156d21c0b4804554c0352332b`。
最终运行期间载体签名 `461f82f3773d23ed8064875535c0c1a3` 不变。

| 牌 | WebP | PNG 母版 |
|---|---|---|
| AS | `decks/poker/webp/AS.webp` | `decks/poker/png/AS.png` |
| 10H | `decks/poker/webp/10H.webp` | `decks/poker/png/10H.png` |
| KH | `decks/poker/webp/KH.webp` | `decks/poker/png/KH.png` |
| QC | `decks/poker/webp/QC.webp` | `decks/poker/png/QC.png` |
| 5筒 | `decks/mahjong/webp/5t.webp` | `decks/mahjong/png/5t.png` |
| 1筒 | `decks/mahjong/webp/1t.webp` | `decks/mahjong/png/1t.png` |

对照图：`decks/_preview/poker-fan.png`、`mahjong-row.png`、`xiangqi-row.png`；
局部改前/改后：`compare-AS.webp`、`compare-10H.webp`、`compare-5t.webp`、`compare-red-shuai.webp`；
红帥/黑將材质对照：`xiangqi-red-black.webp`。

## 改哪里

| 想改 | 改哪里 |
|---|---|
| 点数阵列 / 对称检查 | `PIP_LAYOUT`、`PIP_SIZE`、`assertPipSymmetry` |
| 花色 SVG | `SUIT_SVG` |
| A 装饰 | `aceMarkup` + `.ace` / `.ace-rays` |
| 花牌像 | `games/assets/art/court/`；`courtMarkup` / `.court-figure` |
| 油墨/纸纤维 | `INK_FILTER_SVG`、`.paper-grain` |
| 麻将蓝/绿/红 | `.mahjong` 的 `--mj-blue/--mj-green`；`MJ_RINGS`、`ringVarsFor` |
| 白板蓝绿框 | `.mj-white` / `.mj-white-inner` 的 `--mj-teal` |
| 象棋双方字色 | `.xiangqi.red` / `.xiangqi.black` 的 `--char-*` |
| 载体裁切 | `carrierBg()` / `carrierRect()`，模式 `contain` |
| WebP 质量 | `--quality`（默认 90） |
