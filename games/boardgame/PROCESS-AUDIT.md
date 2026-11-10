# 桌游流程审计报告（284 款）

> 生成时间：2026/11/10 03:36:48（Asia/Shanghai）
> 分支：`boardgame/d686a4ca-audit`（基于 `origin/main`）
> 策略来源：AGENTS.md 2026-11-10 五项硬性质量要求。

## 1. 结论

- 审计范围：**284** 款（31 款经典可玩 + 250 款 mini + 3 款 premium），另有 1 个大厅额外入口 `card-battle` 单独门禁。
- **shipped：0 款**；**draft：284 款**。
- 没有任何游戏同时集齐五项证据。按门禁规则，draft 不进入大厅 / mini 库，也不参与统计。
- 250 款 mini 按批次策略一律保持 draft；3 款 premium 未修改，仅检查。

## 2. 测试基线

入口：`node games/tests/run-all.js`。尾部实际输出：

```
游戏测试: 414 个 · 覆盖游戏: 122/123 · 断言: 26112 passed · 失败文件: 0
工具测试: 101 个 · 断言: 60742 passed · 失败文件: 0
合计: 515 个测试文件 · 断言: 86854 passed · 失败文件: 0
尚无自动化测试: voice-room
```

退出码：**0**。

> 基线口径：协调方转述的 games-79 读数为 272 个测试文件 / 79,704 断言 / 0 失败 / 33.8s；本 worktree 的实际 run-all 输出为 515 个测试文件 / 86,854 断言 / 0 失败 / 43s。两者口径不同（本 worktree 同时包含 games 与 tools），报告以本机实测输出为准，不写未实测数字。

## 3. 浏览器工具与真实冒烟

库存 `games/tests/browser-check.js` 是 tools 契约工具：它只发现包含 `<script id="engine">` 的页面，并要求 `data-i` / `data-lang` 三语控件。284 个游戏页均无该标记，因此按任务给定命令运行时：

```
没有找到含 <script id="engine"> 的工具，且未显式指定 slug。
```

结果为 **0 页被检查**，也不会写出 JSON。为得到游戏页的真实证据，本次新增 `games/boardgame/scripts/game-smoke.mjs`：复用常驻 CDP Chrome，只建/关一个标签，逐页检查 title、meta description、viewport、console/异常、外部请求、390×844 与 320×568 横向滚动、主触控目标 ≥44px、字号 ≥12px、输入框 ≥16px、点击冒烟。

冒烟汇总（每次运行内同时测量两档宽度）：

| 批次 | 页面 | PASS | FAIL | 检查项 | 失败项 | 外部请求 | console error | 异常 |
|---|---|---|---|---|---|---|---|---|
| 390×844（修复后） | 284 | 281 | 3 | 5313 | 7 | 0 | 0 | 0 |
| 320×568（独立批次） | 284 | 281 | 3 | 5313 | 7 | 0 | 0 | 0 |

## 4. 已修复项

- 缺 `meta description`：**133** 个页面，从 `rules.html` 首段生成并写入。
- 小字号：**208** 个页面、**1176** 处 `font-size` 低于 12px（含 rem 换算）统一提升到 12px；表单控件强制 16px，避免 iOS 聚焦缩放。
- 单人标注：**25** 个单人解谜页加入可见「单人」徽章。
- 触控 <44px：dominion / patchwork / splendor / stone-age / ticket-to-ride / war-chest 六款修正按钮或棋盘格尺寸；7×7、9×9 棋盘改为棋盘容器内横向滚动，页面本身不横向滚动。
- 320 横向溢出：mini-abstract-a-05 / mini-abstract-a-17（7×7 棋盘最小宽度超出）改为棋盘容器横向滚动。
- 输入框 <16px：azul / century-spice-road / dixit / kingdomino / splendor 五款；kot-premium 未改动（见未解决项）。

## 4.1 五项门禁脚本（机器判定）

每项一个脚本，退出码 0 表示该门禁 284 款全过，1 表示存在 draft；JSON 报告写在 `games/boardgame/audit/gate-*.json`。

| 门禁脚本 | 退出码 | 通过 | 未通过 | JSON |
|---|---|---|---|---|
| `scripts/gates/process.mjs` | 1 | 0 | 284 | `audit/gate-process.json` |
| `scripts/gates/art.mjs` | 1 | 0 | 284 | `audit/gate-art.json` |
| `scripts/gates/realism.mjs` | 1 | 0 | 284 | `audit/gate-realism.json` |
| `scripts/gates/mobile.mjs` | 1 | 281 | 3 | `audit/gate-mobile.json` |
| `scripts/gates/online.mjs` | 1 | 25 | 259 | `audit/gate-online.json` |

聚合：`scripts/gates/all.mjs` → `audit/gates-all.json`；当前 allPass = **false**。

必然失败对照：`verify-shipped.mjs --gate mobile --smoke /tmp/does-not-exist-smoke.json` 实测 **exit 1**、pass 0/284，说明缺证据不会被误判为通过。

## 4.2 registry / 大厅渲染断言

`scripts/check-registry.js --boardgame-only` 实测：**exit 0**，285 个 draft（284 款 + card-battle）与 0 个 shipped 均未被 `games/boardgame/index.html` 或 `mini/index.html` 渲染，draft 也未写入 `games/registry.json`；3 个合成对照（`./fake-draft/`、`../mini-fake-01/`、不存在的 slug）全部按预期工作。

完整 `node scripts/check-registry.js` 仍有 **102 项既有失败**（大量顶层游戏目录没有 registry 条目，含 `games/boardgame/` 本身），与本次 draft 门禁无关，列为未解决项。

## 4.3 sw.js 预缓存

- `games/sw.js` 的 `PRECACHE_URLS` 共 **82** 条，含 `/games/boardgame` 的条目 **0** 条。
- 本次新增文件均为脚本、审计 JSON 或教程关键帧（非页面运行时资源），未修改 `sw.js`，也未 bump `CACHE_VERSION`。
- 对照：合成的 `/games/boardgame/__new-runtime-control__/` 不在预缓存中（检测器有效，命中预期）。
- 未解决：boardgame 大厅 / mini 库 / 284 个游戏页本身从未进入 `PRECACHE_URLS`，属既有离线缺口。

## 4.4 SHARED-DRIFT

- 284 款中引用 `games/shared/` 的：**0** 款；自带 `shuffle` 实现的：**170** 款。
- 本次审计未改任何 `games/shared/*`，也未重构游戏引擎（只改页面与门禁）；新桌游应引用 shared 而不是复制，该收敛项列为未解决。

## 5. 五项门禁结果

| 门禁 | 通过款数 | 说明 |
|---|---|---|
| 流程（设计/单测/性能/E2E/验收） | 0 | 需 DESIGN.md + 单测 + 性能断言 + E2E + ACCEPTANCE.md |
| 美术（封面/OG/详情图） | 0 | 本地封面 + OG + 详情配图 |
| 真实性校验 | 0 | realism.json ≥3 类通过项 |
| 移动端 390/320 | 281 | 390×844 与 320×568 冒烟全过 |
| 单人标注 / 多人在线 E2E | 25 | 单人看可见「单人」；多人看联机双客户端 E2E |

缺口计数：

| 缺口 | 款数 |
|---|---|
| DESIGN.md 缺失 | 284 |
| 性能断言缺失 | 284 |
| 验收记录缺失 | 284 |
| 封面缺失 | 284 |
| OG 图缺失 | 284 |
| 详情配图缺失 | 284 |
| realism 证据缺失/未通过 | 284 |
| 多人联机 E2E 缺失 | 259 |
| 单人标注缺失 | 0 |
| 移动端冒烟未通过 | 3 |

## 6. 未解决项

1. **美术资产为零**：284 个游戏目录内没有本地封面 / OG / 详情配图。现大厅仍用 CSS 渐变 + 首字占位（`build.mjs` 注释明确写了占位），不符合「非占位/emoji」。
2. **设计与性能证据为零**：没有 `DESIGN.md`、没有逐款性能断言、没有 `ACCEPTANCE.md`。
3. **真实性校验为零**：没有 `realism.json`；规则/尺寸/比例/颜色/材质未被机器校验。
4. **多人在线缺失**：259 款多人游戏没有房间/邀请/状态同步/断线重连/超时托管/入榜，也没有双客户端同局结算 E2E。
5. **3 款 premium 未修改**（azul-premium / codenames-premium / kot-premium）：它们的升级在其它分支进行，本分支只记录现状为 draft。
6. **mini 批次按策略保持 draft**：即使机械检查通过，也不进入大厅/统计。
7. **冒烟范围**：只覆盖 284 个 `index.html`；`rules.html` 未纳入逐页冒烟。触控检查只覆盖主控件选择器（button/input/select/链接按钮），纯文本行内链接按可达性而非 44px 判定。
8. **浏览器工具局限**：库存 browser-check 无法检查游戏页；本次用独立 CDP 脚本补位。该脚本依赖常驻 Chrome 的 9222 端口，未在 CI 中运行。
9. **43 个目录详情页**（`board/*.html`，来自 `data/boardgames.json`）仍用 CSS 渐变 + 首字占位；它们不属于 284 款可玩游戏，但同样不满足新美术要求。

## 7. 关键帧

- 已 `--no-ff` 合并 `origin/boardgame/d686a4ca-tutorial-frames`：**80 帧** B 站 Azul 教程关键帧 + manifest。
- 路径：`games/boardgame/tutorial-frames/azul/`（`manifest.tsv`、`frames/BV1aPxx6dEHL/`、`frames/BV1fK9zYSEo6/`）。

## 8. 批次资源记录

| 项 | 值 |
|---|---|
| 最近一次冒烟耗时 | 296819 ms |
| 并发 | 1（单进程顺序执行，满足 ≤4） |
| 节流 | 80 ms/页 |
| Chrome 峰值 CPU | 38.7%（上限 60%，未超限） |
| Chrome 峰值 RSS | 2279 MB |
| Node RSS 起/止 | 55 / 87 MB |
| 系统 loadavg 起/止 | 6.41 9.59 12.33 / 7.71 8.59 11.08 |

完整记录：`games/boardgame/audit/resources.json`。冒烟进度可续跑：`node games/boardgame/scripts/game-smoke.mjs ... --resume`，断点文件 `games/boardgame/audit/progress-390.json`。

## 9. 284 款清单

完整逐款状态见下表；`failed gates` 为该款未通过的门禁。

| slug | kind | mode | status | failed gates |
|---|---|---|---|---|
| splendor | classic | multi | draft | process, art, realism, mode |
| azul | classic | multi | draft | process, art, realism, mode |
| kingdomino | classic | multi | draft | process, art, realism, mode |
| century-spice-road | classic | multi | draft | process, art, realism, mode |
| jaipur | classic | multi | draft | process, art, realism, mode |
| lost-cities | classic | multi | draft | process, art, realism, mode |
| ticket-to-ride | classic | multi | draft | process, art, realism, mode |
| stone-age | classic | multi | draft | process, art, realism, mode |
| dominion | classic | multi | draft | process, art, realism, mode |
| carcassonne | classic | multi | draft | process, art, realism, mode |
| patchwork | classic | multi | draft | process, art, realism, mode |
| codenames | classic | multi | draft | process, art, realism, mode |
| coup | classic | multi | draft | process, art, realism, mode |
| love-letter | classic | multi | draft | process, art, realism, mode |
| skull | classic | multi | draft | process, art, realism, mode |
| dixit | classic | multi | draft | process, art, realism, mode |
| for-sale | classic | multi | draft | process, art, realism, mode |
| no-thanks | classic | multi | draft | process, art, realism, mode |
| six-nimmt | classic | multi | draft | process, art, realism, mode |
| avalon | classic | multi | draft | process, art, realism, mode |
| hero-realms | classic | multi | draft | process, art, realism, mode |
| war-chest | classic | multi | draft | process, art, realism, mode |
| blackjack | classic | multi | draft | process, art, realism, mode |
| old-maid | classic | multi | draft | process, art, realism, mode |
| crazy-eights | classic | multi | draft | process, art, realism, mode |
| go-fish | classic | multi | draft | process, art, realism, mode |
| snakes-and-ladders | classic | multi | draft | process, art, realism, mode |
| mancala | classic | multi | draft | process, art, realism, mode |
| guess-who | classic | multi | draft | process, art, realism, mode |
| battleship | classic | multi | draft | process, art, realism, mode |
| mastermind | classic | multi | draft | process, art, realism, mode |
| mini-abstract-a-01 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-02 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-03 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-04 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-05 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-06 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-07 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-08 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-09 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-10 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-11 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-12 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-13 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-14 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-15 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-16 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-17 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-18 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-19 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-20 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-21 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-22 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-23 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-24 | mini | multi | draft | process, art, realism, mode |
| mini-abstract-a-25 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-01 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-02 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-03 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-04 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-05 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-06 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-07 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-08 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-09 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-10 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-11 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-12 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-13 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-14 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-15 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-16 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-17 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-18 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-19 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-20 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-21 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-22 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-23 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-24 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-a-25 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-01 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-02 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-03 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-04 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-05 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-06 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-07 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-08 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-09 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-10 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-11 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-12 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-13 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-14 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-15 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-16 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-17 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-18 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-19 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-20 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-21 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-22 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-23 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-24 | mini | multi | draft | process, art, realism, mode |
| mini-ameri-b-25 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-01 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-02 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-03 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-04 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-05 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-06 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-07 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-08 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-09 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-10 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-11 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-12 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-13 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-14 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-15 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-16 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-17 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-18 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-19 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-20 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-21 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-22 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-23 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-24 | mini | multi | draft | process, art, realism, mode |
| mini-card-a-25 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-01 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-02 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-03 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-04 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-05 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-06 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-07 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-08 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-09 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-10 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-11 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-12 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-13 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-14 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-15 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-16 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-17 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-18 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-19 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-20 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-21 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-22 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-23 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-24 | mini | multi | draft | process, art, realism, mode |
| mini-dice-a-25 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-01 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-02 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-03 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-04 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-05 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-06 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-07 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-08 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-09 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-10 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-11 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-12 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-13 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-14 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-15 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-16 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-17 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-18 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-19 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-20 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-21 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-22 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-23 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-24 | mini | multi | draft | process, art, realism, mode |
| mini-euro-a-25 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-01 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-02 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-03 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-04 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-05 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-06 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-07 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-08 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-09 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-10 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-11 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-12 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-13 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-14 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-15 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-16 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-17 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-18 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-19 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-20 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-21 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-22 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-23 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-24 | mini | multi | draft | process, art, realism, mode |
| mini-euro-b-25 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-01 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-02 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-03 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-04 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-05 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-06 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-07 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-08 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-09 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-10 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-11 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-12 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-13 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-14 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-15 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-16 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-17 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-18 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-19 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-20 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-21 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-22 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-23 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-24 | mini | multi | draft | process, art, realism, mode |
| mini-party-a-25 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-01 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-02 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-03 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-04 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-05 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-06 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-07 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-08 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-09 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-10 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-11 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-12 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-13 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-14 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-15 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-16 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-17 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-18 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-19 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-20 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-21 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-22 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-23 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-24 | mini | multi | draft | process, art, realism, mode |
| mini-party-b-25 | mini | multi | draft | process, art, realism, mode |
| mini-puzzle-a-01 | mini | single | draft | process, art, realism |
| mini-puzzle-a-02 | mini | single | draft | process, art, realism |
| mini-puzzle-a-03 | mini | single | draft | process, art, realism |
| mini-puzzle-a-04 | mini | single | draft | process, art, realism |
| mini-puzzle-a-05 | mini | single | draft | process, art, realism |
| mini-puzzle-a-06 | mini | single | draft | process, art, realism |
| mini-puzzle-a-07 | mini | single | draft | process, art, realism |
| mini-puzzle-a-08 | mini | single | draft | process, art, realism |
| mini-puzzle-a-09 | mini | single | draft | process, art, realism |
| mini-puzzle-a-10 | mini | single | draft | process, art, realism |
| mini-puzzle-a-11 | mini | single | draft | process, art, realism |
| mini-puzzle-a-12 | mini | single | draft | process, art, realism |
| mini-puzzle-a-13 | mini | single | draft | process, art, realism |
| mini-puzzle-a-14 | mini | single | draft | process, art, realism |
| mini-puzzle-a-15 | mini | single | draft | process, art, realism |
| mini-puzzle-a-16 | mini | single | draft | process, art, realism |
| mini-puzzle-a-17 | mini | single | draft | process, art, realism |
| mini-puzzle-a-18 | mini | single | draft | process, art, realism |
| mini-puzzle-a-19 | mini | single | draft | process, art, realism |
| mini-puzzle-a-20 | mini | single | draft | process, art, realism |
| mini-puzzle-a-21 | mini | single | draft | process, art, realism |
| mini-puzzle-a-22 | mini | single | draft | process, art, realism |
| mini-puzzle-a-23 | mini | single | draft | process, art, realism |
| mini-puzzle-a-24 | mini | single | draft | process, art, realism |
| mini-puzzle-a-25 | mini | single | draft | process, art, realism |
| codenames-premium | premium | multi | draft | process, art, realism, mobile, mode |
| azul-premium | premium | multi | draft | process, art, realism, mobile, mode |
| kot-premium | premium | multi | draft | process, art, realism, mobile, mode |
| card-battle | extra | multi | draft | process, art, realism, mobile, mode |

## 10. 复现命令

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd games/boardgame
# 1) 真实浏览器冒烟（复用常驻 Chrome，只建/关标签，可 --resume）
node scripts/game-smoke.mjs --root . --games /tmp/audit-games.txt \
  --width 390 --height 844 --json audit/smoke-390.json \
  --progress audit/progress-390.json --resources audit/resources.json --resume
# 2) 五项门禁
node scripts/verify-shipped.mjs
# 3) 按 shipped 重建大厅/mini（draft 自动隐藏）
node build.mjs
# 4) 全量单测
node ../../games/tests/run-all.js
```

## 11. 推送记录

- 审计内容提交：`f074846dd9afd1ff48ad19578bb1d4df0f3b0f89`
- `git push origin HEAD:main`：`3cabdde..f074846`，**未使用 force / rebase**。
- 本记录提交后 `origin/main` 会前进到新的记录提交；被审计的最终内容仍以 `f074846` 为准。
- 工作区：`/private/tmp/wt-audit`（基于 `origin/main` 的独立 worktree）。

## 12. 门禁修复（2026-11-10）

- **美术门禁**：`gate-artifacts.js` 现在解析页面内 `<meta og:image/twitter:image>`、`<img src>`、内联/外链 CSS `url(...)`，支持游戏相对路径、`../../assets/...` 与站点绝对路径 `/games/assets/...`；缺失文件、`data:`、`http(s)` 引用不计为证据。用 `origin/boardgame/d686a4ca-azul-premium` 的真实资产验证：16 张图（8 张外部 `../../assets/art/premium/azul/*`），cover/og/detail 三类均识别。
- **联机门禁**：`gate-online.js` 同时识别 `test-online.js` 与 `online-e2e.test.js`；接受 `online-e2e.json` 完整契约、`ONLINE_E2E_JSON: {...}` 标准化输出、`ONLINE_E2E_OK` 标记，以及旧式 `RESULT: N passed, 0 failed` + 源码 ≥4 个契约维度（双客户端/同局/结算/重连/托管/榜单）。用 `origin/boardgame/d686a4ca-codenames-premium` 的真实 `test-online.js` 验证：89 passed / 0 failed，门禁 ok=true。
- **失败对照**：art 门禁内置 3 个对照（外部引用正向、缺失文件负向、远程引用负向）；online 门禁内置 3 个对照（test-online.js 正例、exit 1 负例、不完整载荷负例）。两个对照均 ok=true，且缺证据时门禁 exit 1。
- **测试**：新增 `games/boardgame/tests/test-gate-artifacts.js`（14 断言）与 `test-gate-online.js`（17 断言），run-all 已发现并通过。
- run-all 基线更新为 **515 文件 / 86,854 断言 / 0 失败 / 43s**。
