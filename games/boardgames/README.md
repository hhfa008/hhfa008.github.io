# 桌游资料库（Board Games Catalog）

`games/boardgames/` 是一个静态桌游资料库：40 条样例游戏、6 个品类、列表筛选与每款游戏的详情页。构建与测试都只读本地数据，不访问外网。

- 列表页：`/games/boardgames/`
- 详情页：`/games/boardgames/<slug>/`
- 数据：`data/categories.json`、`data/games.json`
- 文件来源：`fixtures/games-snapshot.json`（快照日期 **2026-11-10**）
- 生成器：`scripts/build.js`；导入器：`scripts/fetch-games.js`

## 更新命令

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd /Users/fa/games

# 1. 从离线 fixture 重建 data/games.json（默认，不联网）
node games/boardgames/scripts/fetch-games.js

# 2. 生成列表页与全部详情页
node games/boardgames/scripts/build.js

# 3. 只校验、不写文件
node games/boardgames/scripts/build.js --check

# 4. 跑统一测试入口（boardgames/test.js 会被自动发现）
node games/tests/run-all.js
```

`build.js` 只替换 `index.html` 里的 `CHIPS` / `CARDS` / `STATS` / `JSONLD` 标记块，页面骨架、CSS 与筛选脚本保持手写。输出是确定性的，重复构建字节一致。

## 数据来源

- 样例数据来自公开桌游常识与公开资料整理，快照日期 **2026-11-10**。
- 评分（0–10）与重度（1–5，BGG weight 口径）是**约值**，会随评价样本和时间变化；README 与详情页都按约值标注。
- 设计师、出版社不确定时留空数组；年份不确定时留 `null`；详情页显示「暂无资料」，不做猜测。当前 `狼人杀`、`骨牌` 属于传统/公有领域游戏，按此规则处理。
- 封面是本地渐变占位（`cover.gradient` + `cover.label`），不外链图片、不加载外部字体或 CDN。

### GStone 采集尝试（真实结果）

2026-11-10 用正常桌面浏览器 UA、20 秒超时、无登录态探测：

| URL | 结果 |
|---|---|
| `https://gstonegames.com/` | TLS 握手失败（curl 35，HTTP 000） |
| `https://www.gstonegames.com/` | HTTP 200，`text/html`，114694 字节 |
| `https://www.gstonegames.com/robots.txt` | `User-agent:*` / `Disallow:/` |

robots.txt 禁止所有爬取，因此**立即停止在线抓取**：没有请求列表页/详情页，没有尝试登录、验证码或反爬绕过。`--online` 模式会先读 robots.txt，命中 `Disallow: /` 就退出并保持 `data/games.json` 不变。完整记录见 `fixtures/gstone-attempt.json` 和 `fixtures/README.md`。

`fetch-games.js` 的采集体质仍然可用：请求间隔 ≥1.5s、15s 超时、最多 3 次重试、失败不写数据；只有全部记录解析并校验通过后才原子替换输出文件。

## 字段含义

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定标识，与 `slug` 一致 |
| `slug` | string | 详情页路径 `/games/boardgames/<slug>/` |
| `name` | string | 中文名 |
| `nameOriginal` | string | 原名 |
| `description` | string | 一句话简介（站内撰写） |
| `categories` | string[] | 6 个品类 id 的多选：`euro` / `party` / `ameritrash` / `card` / `two-player` / `family` |
| `playersMin` / `playersMax` | integer | 支持人数区间 |
| `bestPlayers` | string 或 [number, number] | 最佳人数，如 `"3-4"` 或 `[3,4]` |
| `playTimeMin` / `playTimeMax` | integer | 单局时长区间（分钟） |
| `weight` | number | 重度 1–5，约值 |
| `rating` | number \| null | 评分 0–10，约值 |
| `designers` | string[] | 设计师；未知为空数组 |
| `publishers` | string[] | 出版社；未知为空数组 |
| `year` | integer \| null | 出版年份；未知为 `null` |
| `cover` | object | `gradient`（本地 CSS 渐变）+ `label`（占位文字） |
| `source` | object | `type`（fixture/bgg/gstone/manual）、`name`、`url`、`fetchedAt` |

JSON Schema（2020-12）见 `schema/game.schema.json`。测试用零依赖的子集校验器 `scripts/lib/schema-lite.js` 校验全部记录。

## 页面与筛选

- 列表页：6 个品类 chip（多选）、人数下拉、时长下拉、关键词搜索、结果计数、空状态、重置按钮；原生 JS，无框架。
- 详情页：名称、原名、品类、人数、最佳人数、时长、重度、评分、设计师、出版社、年份、封面占位、返回列表；带 `title`、`description`、`canonical` 与 `BoardGame` JSON-LD。
- 390px 无横向溢出；深色模式跟随 `prefers-color-scheme`；触控目标 ≥44px；无外部请求。

## 目录

```text
games/boardgames/
├── index.html                  # 列表页骨架 + 生成块
├── <slug>/index.html           # 由 build.js 生成
├── data/categories.json        # 6 个品类
├── data/games.json             # 由 fetch-games.js 从 fixture 生成
├── fixtures/games-snapshot.json
├── fixtures/gstone-attempt.json
├── fixtures/README.md
├── schema/game.schema.json
├── scripts/fetch-games.js
├── scripts/build.js
├── scripts/lib/{data,schema-lite}.js
├── test.js
└── README.md
```

## 限制

- 评分/重度为快照约值，不是实时 BGG 数据；不提供排行榜承诺。
- 当前只有 40 条样例，品类覆盖为多标签计数，不是六等分。
- 在线采集被 GStone 的 robots.txt 明确禁止，未做任何绕过；如需扩充数据，应优先引入有明确授权的数据源或人工整理。
- 封面为渐变占位，不含真实封面图。
