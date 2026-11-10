# 失落之城 · Lost Cities Premium — 验收记录

日期：2026-11-10 · 工作区：`/private/tmp/wt-b2-g2`
状态：**shipped 候选，等待 lead 运行官方 verify-shipped 门禁**。本文件只记录本地真实执行结果，不代表官方门禁已批准。

## Gate 1 · process

| 项 | 命令 | 真实输出 |
|---|---|---|
| 规则单测 | `node games/boardgame/lost-cities-premium/test.js` | `RESULT: 180 passed, 0 failed` |
| 联机双客户端 | `node games/boardgame/lost-cities-premium/test-online.js` | `RESULT: 99 passed, 0 failed` |
| 浏览器 E2E | `node games/boardgame/lost-cities-premium/e2e.mjs` | `RESULT: 200 passed, 0 failed` |
| E2E 对照 | `node .../e2e.mjs --control` | `RESULT: 0 passed, 1 failed`，exit 1 |
| 联机对照 | `node .../test-online.js --control` | `RESULT: 0 passed, 1 failed`，exit 1 |
| 性能记录 | `perf.json` | FCP 44ms / DCL 10ms / load 27ms / 253 DOM / 62fps / 新局 0.5ms / 单步 5.6ms / 材质 1,059,838B / 外链 0（其中一次 E2E 运行的实测） |

`DESIGN.md` 6.5KB（≥400B）；`ACCEPTANCE.md` 本文件。

单测覆盖：60 张守恒、五色构成、8+8 发牌、44 牌堆、递增、赌注时机、连续赌注、弃牌堆抽牌、不能抽刚弃的牌、最后一张立即结束、只有赌注 -20/张、8 张 +20（含赌注）、三局累计、局间先手、平局共享、非法动作、三档 AI 决策差异、30 局 AI 自对弈、随机 200 动作守恒。

## Gate 2 · art

真实 PNG 母版与 WebP 均在 `games/boardgame/lost-cities-premium/assets/`：

| 文件 | 尺寸 | PNG 字节 | WebP 字节 |
|---|---|---|---|
| cover | 1200×1200 | 971,336 | 75,980 |
| og | 1200×630 | 613,642 | 53,920 |
| detail-1 | 1200×800 | 746,910 | 57,104 |
| detail-2 | 1200×800 | 771,355 | 58,842 |

7 个单物件材质在 `games/assets/art/premium/lost-cities/`：`card-paper`、`compass`、`stone-tablet`、`jungle-felt`、`wood-chest`、`wager-seal`、`map-scroll`；PNG 母版 + WebP 均存在。材质为 1024×1024 白底、无文字单物件；字符/牌面/局面由代码合成。

`art-render.html` 的每个 shot 经 E2E 断言：10 条探险列（双方各 5）、**5 个共享弃牌堆**、8 张手牌、1 个牌堆、1 个罗盘、≥1 个赌注封蜡；7 个材质全部加载；stage 尺寸分别为 1200×1200 / 1200×630 / 1200×800 / 1200×800。`render-art.mjs` 可复现重建整套图。

## Gate 3 · realism

`realism.json`：6 条检查，`kind` 为 count / dimension / proportion / color / material / rule，全部 `ok:true`，`pass:true`。关键值：60 张、5 色、每色 12 张（9 数字 + 3 赌注）、手牌 8、牌堆 44、共享弃牌堆 5、三局；卡面 63×88mm；8 张奖励；最后一张立即结束；不能抽刚弃牌。

## Gate 4 · mobile

命令（真实执行）：

```
printf 'lost-cities-premium\n' > /tmp/lost-cities-premium-list.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/lost-cities-premium-list.txt --width 390 --height 844 --json /tmp/lost-cities-premium-smoke-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/lost-cities-premium-list.txt --width 320 --height 568 --json /tmp/lost-cities-premium-smoke-320.json
```

结果：390 **PASS**（19 checks，0 failedChecks，0 externalRequests，0 consoleErrors）；320 **PASS**（19 checks，0 failedChecks，0 externalRequests，0 consoleErrors）。

E2E 额外实测 390×844、320×568、844×390、568×320：无横向滚动；所有主触控 ≥44×44；可见文字 ≥12px；10 条探险列与 8 张手牌保持；`100dvh` 生效；触屏无 backdrop-filter。

## Gate 5 · mode

`node games/boardgame/lost-cities-premium/test-online.js` 输出：

```
ONLINE_E2E_JSON: {"game":"lost-cities","clients":2,"sameGame":true,"settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"rematch":true,"runAll":true,"result":"99 passed, 0 failed","exitCode":0}
RESULT: 99 passed, 0 failed
```

`online-e2e.json` 已写入同字段。联机覆盖：邀请单次、密码房、maxPlayers 2、PII 拒绝、1 人开局 AI 补位、仅房主开始/重赛/关房、服务端权威、每视角隐藏对手手牌且不暴露牌堆顺序、断线重连、超时托管、三局完整结算双端一致、结果榜、离座转 AI、关房 404。

## 缺口与说明

- 本 agent 未运行全量 `games/tests/run-all.js`；本作 `test-online.js` 命名符合 run-all 发现规则，但全量结果应以 lead 的运行输出为准。
- 未在真实 iOS/Android 设备浏览器跑；移动验证为 Chrome 设备模拟 + 真实触控尺寸/DOM 断言。
- FCP/loadEventEnd 在常驻 headless Chrome 上偶发为 0（PerformancePaintTiming 未上报）；`perf.json` 采用一次有效实测 FCP 44ms，并同时保留 DCL 10ms 作为可靠性能信号。
- 美术图片只做技术元数据与页内 DOM 件数校验，未做截屏内容识别。
