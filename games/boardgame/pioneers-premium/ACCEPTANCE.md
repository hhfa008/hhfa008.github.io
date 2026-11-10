# 拓荒者 · 九岛 premium · 验收记录

> 目录：`games/boardgame/pioneers-premium/`
> 分支：`boardgame/d686a4ca-b9-g11`（worktree `/private/tmp/wt-b9-g11`）
> 所有数字均来自本机实际运行；未跑或缺失会明确写「未跑」。

## 五项硬性验收

### 1. process — PASS

```bash
node games/boardgame/pioneers-premium/test.js
# RESULT: 428 passed, 0 failed
```

覆盖：19 六边形（pointy-top，3-4-5-4-3）、地形 6/6/6/1、18 点位无 7、pip 分布、54 交点/72 边/30 海岸边/42 内部边、4 港口、顶点与边拓扑、2/3/4 人蛇形顺序、第二村庄按相邻产出地给资源、3/5 产出、7 不产且无强盗、村庄/城市/道路费用与 5/3/10 上限、距离规则、道路网络、城市升级、港口 2:1 与基础 3:1、8 分即时胜负、12 回合封顶、同分并列、三档 AI 与自对弈、publicView 不泄漏 `rngState`、性能预算、页面静态、meta/realism/美术尺寸/预缓存版本交叉校验。

- `perf.json` 存在；`test.js` 硬断言 200 次建局 < 3000ms、200 次合法动作 < 1500ms、20 次启发 AI < 4000ms、10 次高手 AI < 4000ms、单次 AI < 250ms、200 次 publicView < 1000ms、1000 次 clone < 1000ms、engine.js < 60KB。
- `DESIGN.md`、`ACCEPTANCE.md`（本文件）与 `E2E.md` 存在。

### 2. art — PASS

| 文件 | 尺寸 | PNG | WebP |
|---|---|---|---|
| `assets/cover.png` / `.webp` | 1200×1200 | 1052KB | 72KB |
| `assets/og.png` / `.webp` | 1200×630 | 637KB | 55KB |
| `assets/detail-1.png` / `.webp` | 1200×800 | 710KB | 68KB |
| `assets/detail-2.png` / `.webp` | 1200×800 | 726KB | 61KB |

- 真实栅格 PNG/WebP，非 emoji/占位。
- 单物件材质 7 张（1024×1024，纯白底/单物件）：`hex-tile`、`resource-wheat`、`resource-stone`、`resource-wood`、`table-felt`、`road-stick`、`settlement-house`，位于 `games/assets/art/premium/pioneers/`，PNG 母版 + WebP。
- 封面/OG/详情由 `art-render.html` 代码合成；地图来自真实引擎局面：
  - 封面为完整 2 人蛇形开局：**4 村庄 + 4 道路**（`window.__artStats.setupSettlements=4`、`setupRoads=4`）。
  - `window.__artStats.orientation === 'pointy-top'`；每块六边形只有一个最高顶点且位于中心正上方。
  - 详情 1 为真实合法中盘（引擎 AI 对局到第 6 回合），不是摆拍。
- 汉字、数字、地形图标、点数、道路、村庄、城市全部代码绘制；AI 只生成空白材质。
- detail-1 右侧面板与左侧图数一致：赤帆 6 分 / 村 0 / 城 3，蓝港 2 分 / 村 2 / 城 0；3 个红建筑均为城墙双塔城市造型，2 个蓝建筑为小屋。
- detail-2 版式：内容框 46–754，标题区底 125，资源卡顶 135，规格表底 736；3 张资源卡、4 栋染色房屋、7 行规格全部在安全边距内。

### 3. realism — PASS

`realism.json` 6 条，kind 覆盖 count / dimension / proportion / color / material / rule，全部 `ok:true`，`pass:true`。核心数字：19 六边形、3-4-5-4-3、6/6/6/1、18 点位（2–12 无 7）、54 交点、72 边、4 港口、57mm 边长/2.4mm 厚、道路 40×8×6mm、村庄 20mm、5 村/3 城/10 路、8 分/12 回合。

规则交叉核对：B 站教程 BV18J4P6FEEt、BV1JzgtzdESt、BV1Rb411679e、BV1pDsszQEL1（只读标题/文字，不截图、不 OCR）。本作为原创三资源变体；7 点明确写「简化霜洞，不设强盗」，不假装有强盗或发展卡。

### 4. mobile — PASS

```bash
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games games/.tmp/pioneers-list.txt --width 390 --height 844 \
  --json games/.tmp/pioneers-smoke-390.json --resources games/.tmp/pioneers-resources.json --throttle 0
# pass 1, fail 0, checks 19, externalRequests 0, consoleErrors 0, exceptions 0
# click smoke: 「放村庄」, no navigation

node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games games/.tmp/pioneers-list.txt --width 320 --height 568 \
  --json games/.tmp/pioneers-smoke-320.json --resources games/.tmp/pioneers-resources.json --throttle 0
# pass 1, fail 0, checks 19, externalRequests 0, consoleErrors 0, exceptions 0
# click smoke: 「放村庄」, no navigation
```

- 390×844 / 320×568 两档真浏览器冒烟全过；无横向滚动、主触控 ≥44×44、可见字号 ≥12px、零外部请求、无 console error、无未捕获异常。
- 额外 320px 交互探针：地图 76 个 polygon、54 个 div+tabindex 顶点；点击「放村庄」打开 54 项选择器（按钮高度 55/55/48）；放村庄后自动打开 3 项道路选择器；AI 完成两轮摆放后人类继续第二轮；进入 play 后掷骰得到 `[1,6]`，手牌与资源条同步更新，全程无异常。
- 320px 下 5 列六边形地图会自动缩小；顶点/边不作为 button，主要操作走「建造选择器」的 ≥48px 列表按钮，地图上另有 30px 的 div+tabindex 顶点热区作为直接入口。
- 美术自查：封面 `window.__artStats` 实测 `setupSettlements=4`、`setupRoads=4`、2 红 2 蓝各 2 道路 + 2 村庄；`orientation='pointy-top'`。detail-2 的 3 张资源卡、4 栋染色房屋与 7 行规格全部落在 46px 安全边距内（内容框 46–754，规格表底 732）。

### 5. mode — PASS

```bash
node games/boardgame/pioneers-premium/test-online.js
# ONLINE_E2E_JSON: {"game":"pioneers-premium","clients":2,"sameGame":true,
#  "settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,
#  "leaderboard":true,"aiFill":true,"runAll":true,"assertions":70,"failed":0}
# RESULT: 71 passed, 0 failed

node games/boardgame/pioneers-premium/test-online.js --control
# RESULT: 0 passed, 1 failed  (exit 1)
```

- 双客户端完整对局 56 步结算；双方赢家、分数、原因、明细完全一致。
- AI 补位房：单人开局补成 2 座，AI 完整打完（25 步），结算 2 人一致，AI 入榜。
- 断线重连、超时托管、排行榜、重赛、关房全部覆盖。
- 服务端持有完整状态；骰子由服务器生成，`publicView()` 不含 `rngState`/`seed`，未来随机数不下发。
- `test-online.js` 以 `test` 开头，被 `node games/tests/run-all.js` 自动发现；`online-e2e.json` 落盘证据。

## 备注

- 本页不注册 per-game service worker；离线由 `/games/sw.js` 统一接管。`test.js` 读取 `games/precache-manifest.js`，与 `games/sw.js` 的 `CACHE_VERSION` 交叉校验，并确认本游戏 slug 已入 v22 清单（`scripts/gen-precache.js` 已运行）。
- 共享模块：`games/shared/shuffle.js`（地形/点数洗牌）、`sfx.js`（音效）、`store.js`（可用）、`online-room-server.mjs`（房间/邀请/重连/托管/榜单）。本目录未复制这些实现。
- 美术材质由 `img-gen` 生成单物件；地图、字符与全部图标由代码绘制。
