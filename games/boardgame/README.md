# 桌游目录（games/boardgame）

一个纯静态、零外部请求的桌游目录：列表页支持品类 / 人数 / 时长筛选与搜索，详情页展示完整字段、来源链接和 3 条同类推荐。所有页面由 `build.mjs` 从 `data/boardgames.json` 生成并直接提交。

## 数据来源

- **站点**：集石桌游（<https://www.gstonegames.com/>）公开页面。
- **可抓范围**：首页与 `/game/info-<id>.html` 详情页是服务端渲染的公开 HTML，可直接解析。
- **登录墙**：`/game/` 列表接口返回 `{"code":1,"msg":"未登录，请登录后操作"}`，`/game/rank/` 不是有效 action。因此没有批量列表 API 可用；条目 id 从公开首页发现，再由人工精选 43 款，逐条抓详情页。
- **未采用 BGG**：`https://boardgamegeek.com/xmlapi2/thing?...` 在本机（直连与 `127.0.0.1:7899` 代理均试过）返回 `401 Unauthorized`，没有可用凭据，故未混用 BGG 数据。
- **礼貌采集**：串行请求、默认间隔 1000ms、固定 UA `hhfa008.github.io boardgames importer (+https://hhfa008.github.io)`、单次超时 15s、失败最多重试 3 次。没有登录、Cookie、验证码绕过或高频抓取。
- **快照**：`fixtures/gstone-2026-11-10.json` 保存 43 条详情页的原始字段（含每页 HTML 的 SHA-256），可离线重放。评分、人数、时长、设计师、出版社、年份均来自详情页，没有手填。

## 更新方法

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd games/boardgame

# 1) 从快照离线重建数据（幂等，推荐）
node scripts/fetch-gstone.mjs \
  --fixture fixtures/gstone-2026-11-10.json \
  --out data/boardgames.json

# 2) 实时重抓（串行、1s 间隔；会写当天 fixtures/gstone-YYYY-MM-DD.json）
node scripts/fetch-gstone.mjs --live --delay 1000 --retry 3 --out data/boardgames.json

# 可选：--limit N 限制条数、--proxy http://127.0.0.1:7899 走代理、--ids 550,4320 指定条目

# 3) 重新生成页面
node build.mjs

# 4) 测试
node test-data.js
node test-build.js
```

`--live` 只抓 `EDITORIAL` 中已策展的 43 个 id；新增条目需要同时在脚本里补 `slug` 与英文名（见下）。

## 字段含义

| 字段 | 含义 |
|---|---|
| `id` | 稳定 id，当前全部为 `gstone-<原始 id>` |
| `slug` | URL 用 kebab-case，全局唯一 |
| `name.zh` / `name.en` | 中文名 / 原名。中文原创游戏若无官方英文名，`name.en` 为本目录使用的英文译名 |
| `category` | 6 分类之一：`euro` `party` `ameritrash` `card` `two-player` `family` |
| `players.min/max` | 集石「支持人数」标记的最小 / 最大人数 |
| `bestPlayers` | 集石「推荐人数」标记为推荐的档位，可为空数组 |
| `playTime.min/max` | 单局总时长（分钟），换算见下 |
| `weight` | 重度 1–5，一位小数，换算见下 |
| `rating` | 集石用户评分 0–10，一位小数 |
| `designers` / `publishers` | 详情页列出的设计师 / 出版社（原始为「未知」的已剔除） |
| `year` | 出版年份 |
| `coverUrl` | 集石图床地址，**仅存数据，页面不加载** |
| `source` | `site` / 原始详情页 `url` / 抓取时间 `fetchedAt` |
| `tags` | 集石原始「游戏类别」「游戏模式」，如 `["德式","竞争"]` |

### 换算规则（非集石原字段）

- **单局时长**：集石只给「人均时长 X 分钟/人」。本项目按 `X × 人数` 换算为整局范围：`min = X × players.min`，`max = X × players.max`。多人长局会得到较大的上限（如 18xx、战棋），这是按人均时长外推的结果，不是实测总时长。
- **重度**：集石给「上手难度 N 级」。本项目按 `weight = clamp(N / 2, 1, 5)` 保留一位小数，仅作跨游戏比较的近似值，不等同于 BGG weight。
- **品类映射**：集石原始类别 → 契约分类：德式→`euro`，聚会→`party`，美式→`ameritrash`，卡牌→`card`，亲子/抽象/解谜→`family`，战棋→`two-player`，扮演→`ameritrash`。少量游戏按玩法覆盖：冷战热斗、国际象棋、拼布艺术、战争之匣 → `two-player`；日本麻将 → `family`。

## 已知限制

- 集石没有公开列表 API，新增条目只能人工发现 id 并补英文名 / slug，不能做到全站自动增量。
- 评分是集石社区评分，会随时间变化；快照只代表抓取当天。
- `bestPlayers` 只反映集石的推荐人数标记，不包含 BGG 的投票分布。
- 重度与总时长是换算值，详见上方规则。
- 封面仅保存 URL，页面用「品类渐变 + 中文首字」占位，避免任何外链图片请求。
- 语言：目前只有中文完整版；未实现 en / id 切换。页面的英文名与英文品类名作为辅助信息展示。
- 页面无追踪、无 cookie、无 localStorage、无外部字体 / CDN / 图标；详情页唯一的外链是用户点击才跳转的集石来源页（`rel="noopener noreferrer"`）。

## 文件

```
games/boardgame/
  README.md
  data/categories.json         6 个品类
  data/boardgames.json         43 条目录数据
  data/boardgames.schema.json  JSON Schema
  types.ts                     TS 类型
  fixtures/gstone-2026-11-10.json  原始字段快照
  scripts/fetch-gstone.mjs     采集 / 重放
  lib.mjs                      纯函数：筛选、排序、推荐、格式化
  build.mjs                    静态生成
  index.html                   列表页（生成物）
  board/<slug>.html            详情页（生成物）
  test-data.js                 数据层单测
  test-build.js                构建冒烟测试
```

测试入口：`node games/tests/run-all.js`（自动发现本目录的 `test*.js`）。

## 对局留存（play/）

`play/card-battle.html` 与 `play/mahjong.html` 的结果页接入同一套本机留存层：

- **积分**：卡牌胜 100 + 剩余奖赏×10 + 速胜（每少 1 回合 +2，最多 +40），负 20，平 50；麻将胜 100 + 番数×10（最多 60）+ 余牌/5（最多 40）+ 自摸 20，负 20，流局 50。公式同时写在 `play/retention-result.mjs` 注释与结果页文案里。
- **等级/奖杯/连胜/每日奖励**：状态键为 `boardgame.play-progress.v1`、`boardgame.retention.v1`，达到 `LEVELS` 阈值时结果页显示晋级；奖杯按 id 幂等。
- **排行榜**：匿名设备 id（`dev_` + 32 hex，不含个人信息）经 `validateScore` 校验分数范围、对局时长下限、回合/动作数和设备 id 格式后，才写入 `createLeaderboard`。同一对局 id 只记一次。
- **分享**：优先 `navigator.share`，不支持时复制 `buildSharePayload` 文本；链接只有 `share.html?match=<对局 id>`，无个人信息与追踪参数。
- **边界**：没有服务器，榜单与进度都在本机 localStorage；**本地排行榜，清除浏览器缓存即重置**。页面与 `play/smoke.mjs` 均验证 390/320px 无横向溢出、按钮 ≥44px、零外部请求。

测试：`node games/boardgame/tests/run-all.mjs`（含 `tests/retention-integration.test.mjs`）与 `node games/boardgame/play/smoke.mjs`。

## 麻将单机（demo/mahjong.html）

四人单机麻将样板：玩家 1 号位，另外三家 AI。页面在 390×844 下无横向溢出，手牌/操作按钮触控高度 ≥44px，支持点按、方向键 + 回车出牌，以及 C/P/G/H/Esc 鸣牌快捷键。

**已实现**

- 136 张牌（万/筒/索 1–9 各 4 张，东南西北中发白各 4 张），庄家 14 张、其余 13 张，发牌后牌山 83 张；摸打循环，牌山耗尽流局。
- 吃（仅上家）、碰、明杠；鸣牌优先级为 和牌 > 碰/杠 > 吃；明杠后从普通牌山补 1 张。
- 和牌：4 面子 + 1 将、七对、十三幺；支持自摸与点炮，副露参与面子拆分。
- 番种：平和 1、碰碰和 2、清一色 2、字一色 4、七对 2、门清 1、底和 1（标准型混合顺子/刻子时的底和，可叠加）、十三幺 5；番数可叠加。
- 简化计分：`总分 = 100 + 番数 × 100`，只记录和牌者分数，不做四家点数收支。
- AI：优先打孤张/边张，保留对子、刻子、相邻搭子；能和则和，能杠则杠，字牌对子或副露少于 2 组时碰，副露少于 2 组时吃。
- 页面：34 张本地 PNG 牌面、手牌排序与摸牌位、弃牌河、副露区、吃/碰/杠/和/过按钮、发牌/摸牌动效、结果页（和牌/流局、番数、分数、再来一局）。
- 音效复用 `app/audio.js`：发牌、摸牌、出牌、鸣牌、和牌、错误；首次手势解锁，静音状态持久化。

**未实现（如实注明）**

- 暗杠、加杠、抢杠；杠后补牌直接从普通牌山顺序取，不设王牌区/岭上牌。
- 立直、振听、听牌提示、一发、海底/河底/岭上开花。
- 符数、包牌、多家和牌分摊、连庄/场风轮换、宝牌/花牌。
- 混一色、断幺、一杯口、二杯口、役牌/箭刻/门风/圈风等番种均不计。
- 单局制：不累计跨局积分，也没有四家点数转移。

**文件与测试**

- 引擎：`app/mahjong.js`（纯逻辑，无 DOM）
- 牌桌：`demo/mahjong.html`
- 规则页：`demo/mahjong-rules.html`（Article + FAQPage JSON-LD）
- 测试：`node games/boardgame/tests/run-all.mjs`；本游戏专项为 `tests/gameplay-mahjong.test.mjs`（覆盖起手、摸打、吃/碰/杠合法与非法、副露和牌、七对、自摸/点炮、流局、AI 决策、34 张牌图映射）。
