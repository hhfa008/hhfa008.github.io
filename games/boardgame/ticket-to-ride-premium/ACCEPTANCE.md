# 车票之旅 · Ticket to Ride Premium — 验收记录

日期：2026-11-10 · 分支：`boardgame/d686a4ca-b5-g6` · 工作区：`/private/tmp/wt-b5-g6`

状态：**shipped 候选，等待 lead 运行官方 verify-shipped 门禁**。

## Gate 0 · 全量回归

`node games/tests/run-all.js --json`：567 个测试文件，93,641 断言通过，0 失败。

## Gate 1 · process

| 项 | 命令 | 真实输出 |
|---|---|---|
| 规则单测 | `node games/boardgame/ticket-to-ride-premium/test.js` | `RESULT: 98 passed, 0 failed` |
| 联机双客户端 | `node .../test-online.js` | `RESULT: 42 passed, 0 failed` |
| 浏览器 E2E | `node .../e2e.mjs` | `RESULT: 77 passed, 0 failed` |
| E2E 对照 | `node .../e2e.mjs --control` | `RESULT: 0 passed, 1 failed`，exit 1 |
| 联机对照 | `node .../test-online.js --control` | `RESULT: 0 passed, 1 failed`，exit 1 |
| 性能 | `perf.json` | DCL 10ms / load 25ms / 400 DOM / 61fps / 新局 0.6ms / 单步 0.2ms / 材质 569,054B / 外链 0 |

单测覆盖：20 城 / 40 路线 / 24 任务 / 110 张卡、开局 4+3+5、抽 2 张、明牌机车独占行动、占路支付、弃牌洗回、任务抽 3 保 1、完成/未完成计分、最长路线按车厢节数、≤2 节终局与最后一轮、20 局自对弈与卡牌守恒。

## Gate 2 · art

| 文件 | 尺寸 | PNG 字节 | WebP 字节 |
|---|---|---|---|
| cover | 1200×1200 | 1,494,388 | 137,220 |
| og | 1200×630 | 822,845 | 86,078 |
| detail-1 | 1200×800 | 894,164 | 81,884 |
| detail-2 | 1200×800 | 899,533 | 81,626 |

材质：`train-car`、`card-stock`、`board`、`ticket`、`brass-marker`、`wood-train`。`art-render.html` 经 E2E 断言 40 条路线、20 城、5 张明牌、6 张材质加载。

## Gate 3 · realism

`realism.json` 6 条检查全过：110 张卡 = 96 + 14、45 节车厢、卡面 63×88mm、路线分 1/2/4/7/10/15、最长 +10、≤2 节终局、弃牌洗回、明牌机车规则。

## Gate 4 · mobile

390×844 **PASS**（19 checks，0 failedChecks，0 externalRequests，0 consoleErrors）；320×568 **PASS**。E2E 另测 390/320/844×390/568×320：无横向滚动、触控 ≥44、文字 ≥12。

## Gate 5 · mode

```
ONLINE_E2E_JSON: {"game":"ticket-to-ride","clients":2,"sameGame":true,"settlementConsistent":true,
"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"rematch":true,"runAll":true,
"result":"42 passed, 0 failed","exitCode":0}
```

覆盖：邀请/密码、PII 拒绝、1 人开局 AI 补位、服务端权威、对手手牌与任务隐藏、断线重连、超时托管、完整对局双端结算一致、结果榜、重赛、离座转 AI、关房 404。

## 缺口与说明

- 官方门禁由 lead 运行。
- 地图为 20 城 / 40 路线的实现子集，卡牌经济与规则按官方口径；未实现双线路线（2 人规则不需要）。
- FCP 在 headless 偶发不上报，perf.json 以 DCL 为可靠信号。
