# 拼布艺术 · Patchwork Premium — 验收记录

日期：2026-11-10 · 分支：`boardgame/d686a4ca-b5-g6` · 工作区：`/private/tmp/wt-b5-g6`

状态：**shipped 候选，等待 lead 运行官方 verify-shipped 门禁**。本文件只记录本地真实执行结果，不代表官方门禁已批准。

## Gate 0 · 全量回归

`node games/tests/run-all.js --json`：

```
游戏测试: 466 个 · 覆盖游戏: 122/123 · 断言: 32899 passed · 失败文件: 0
工具测试: 101 个 · 断言: 60742 passed · 失败文件: 0
合计: 567 个测试文件 · 断言: 93641 passed · 失败文件: 0
```

## Gate 1 · process

| 项 | 命令 | 真实输出 |
|---|---|---|
| 规则单测 | `node games/boardgame/patchwork-premium/test.js` | `RESULT: 700 passed, 0 failed` |
| 联机双客户端 | `node games/boardgame/patchwork-premium/test-online.js` | `RESULT: 48 passed, 0 failed` |
| 浏览器 E2E | `node games/boardgame/patchwork-premium/e2e.mjs` | `RESULT: 80 passed, 0 failed` |
| E2E 对照 | `node .../e2e.mjs --control` | `RESULT: 0 passed, 1 failed`，exit 1 |
| 联机对照 | `node .../test-online.js --control` | `RESULT: 0 passed, 1 failed`，exit 1 |
| 性能 | `perf.json` | FCP 56ms / DCL 25ms / load 26ms / 414 DOM / 61fps / 新局 1.4ms / 单步 0.3ms / 材质 257,096B / 外链 0 |

`DESIGN.md` 6.4KB；`ACCEPTANCE.md` 本文件；`E2E.md` 记录浏览器验证。

单测覆盖：33 块数据、166 格覆盖、朝向唯一性、市场顺位、边界/重叠/扣子不足、时间推进、9 个扣子格收入、7×7 只发一次、终局三种条件、计分公式、50 局 AI 自对弈、随机动作守恒、premium 页面/联机/预缓存契约。

## Gate 2 · art

| 文件 | 尺寸 | PNG 字节 | WebP 字节 |
|---|---|---|---|
| cover | 1200×1200 | 1,292,653 | 78,684 |
| og | 1200×630 | 680,441 | 48,992 |
| detail-1 | 1200×800 | 902,651 | 51,820 |
| detail-2 | 1200×800 | 920,610 | 54,818 |

单物件材质在 `games/assets/art/premium/patchwork/`：`quilt-tile`、`button`、`leather-patch`、`felt`、`button-tray`、`time-strip`（PNG 母版 + WebP）。`art-render.html` 的 cover 经 E2E 断言：81 格棋盘、16 个扣子、时间轴、6 张材质全部加载。

## Gate 3 · realism

`realism.json`：6 条检查，`kind` = count / dimension / proportion / color / material / rule，全部 `ok:true`、`pass:true`。关键值：33 块、9×9、5 起始扣子、9 个收入格、7×7 奖励 +7、空格 −2、拼布 40×40mm、棋盘 230mm、扣子 Ø12mm。

## Gate 4 · mobile

```
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /tmp/pw-smoke-list.txt --width 390 --height 844 --json /tmp/pw-smoke-390.json
```

结果：390 **PASS**（19 checks，0 failedChecks，0 externalRequests，0 consoleErrors）；320×568 同一行程内 **PASS**。E2E 另测 390×844、320×568、844×390、568×320：无横向滚动、所有主触控 ≥44×44、可见文字 ≥12px。

## Gate 5 · mode

`test-online.js` 输出契约：

```
ONLINE_E2E_JSON: {"game":"patchwork","clients":2,"sameGame":true,"settlementConsistent":true,
"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"rematch":true,"runAll":true,
"result":"48 passed, 0 failed","exitCode":0}
```

覆盖：邀请单次、密码房、PII 拒绝、2 人房、1 人开局 AI 补位、服务端权威、显式公共状态白名单、断线重连、超时托管、完整对局双端结算一致、结果榜、重赛、离座转 AI、关房 404。

## 缺口与说明

- 官方 `verify-shipped.mjs` 由 lead 运行；本文件不声称官方门禁已批准。
- 移动验证为真实 Chrome 设备模拟 + DOM 尺寸断言，不是真实 iOS/Android 设备。
- FCP 在部分 headless 运行不上报时，以 DCL 作为可靠性能信号。
- 美术只做技术元数据与 DOM 件数校验，未做截屏内容识别。
