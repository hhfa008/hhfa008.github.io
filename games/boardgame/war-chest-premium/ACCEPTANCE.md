# 战争宝箱 · War Chest Premium — 验收记录

日期：2026-11-10 · 分支：`boardgame/d686a4ca-b5-g6` · 工作区：`/private/tmp/wt-b5-g6`

状态：**shipped 候选，等待 lead 运行官方 verify-shipped 门禁**。

## Gate 0 · 全量回归

`node games/tests/run-all.js --json`：567 个测试文件，93,641 断言通过，0 失败。

## Gate 1 · process

| 项 | 命令 | 真实输出 |
|---|---|---|
| 规则单测 | `node games/boardgame/war-chest-premium/test.js` | `RESULT: 94 passed, 0 failed` |
| 联机双客户端 | `node .../test-online.js` | `RESULT: 42 passed, 0 failed` |
| 浏览器 E2E | `node .../e2e.mjs` | `RESULT: 76 passed, 0 failed` |
| E2E 对照 | `node .../e2e.mjs --control` | `RESULT: 0 passed, 1 failed`，exit 1 |
| 联机对照 | `node .../test-online.js --control` | `RESULT: 0 passed, 1 failed`，exit 1 |
| 性能 | `perf.json` | FCP 0ms（headless 未上报）/ DCL 11ms / load 26ms / 237 DOM / 61fps / 新局 0.6ms / 单步 0.1ms / 材质 636,450B / 外链 0 |

单测覆盖：7×7 / 6 据点 / 4 胜利、4 单位 ×4 币、部署邻接、移动阻挡、射程与接近、剑士 2 耐久、斥候不能攻击、据点永久控制、120 回合平局判定、20 局自对弈与币/单位守恒、premium 页面/联机/预缓存契约。

## Gate 2 · art

| 文件 | 尺寸 | PNG 字节 | WebP 字节 |
|---|---|---|---|
| cover | 1200×1200 | 1,271,564 | 93,912 |
| og | 1200×630 | 666,509 | 56,718 |
| detail-1 | 1200×800 | 837,605 | 57,472 |
| detail-2 | 1200×800 | 844,978 | 59,032 |

材质：`silver-coin`、`bronze-coin`、`canvas-bag`、`stronghold`、`playmat`、`command-token`。`art-render.html` 经 E2E 断言 49 格、6 据点、12 单位、4 枚单位币、6 张材质加载。

## Gate 3 · realism

`realism.json` 6 条检查全过：7×7、6 据点、4 胜利、16 币、抽 3、最多 3 行动、据点相邻部署、剑士 2 耐久、控制权保留、120 回合平局。

## Gate 4 · mobile

390×844 **PASS**（19 checks，0 failedChecks，0 externalRequests，0 consoleErrors）；320×568 **PASS**。E2E 另测 390/320/844×390/568×320：无横向滚动、触控 ≥44、文字 ≥12。

## Gate 5 · mode

```
ONLINE_E2E_JSON: {"game":"war-chest","clients":2,"sameGame":true,"settlementConsistent":true,
"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"rematch":true,"runAll":true,
"result":"42 passed, 0 failed","exitCode":0}
```

覆盖：邀请/密码、PII 拒绝、1 人开局 AI 补位、服务端权威、对手手牌隐藏、断线重连、超时托管、完整对局双端结算一致、结果榜、重赛、离座转 AI、关房 404。

## 缺口与说明

- 官方门禁由 lead 运行。
- 战斗实现为「每次攻击 1 点伤害 + 单位耐久」，未实现扩展单位的特殊能力；基础 4 单位的移动/射程/耐久按真实口径。
- 移动验证为真实 Chrome 设备模拟 + DOM 尺寸断言。
