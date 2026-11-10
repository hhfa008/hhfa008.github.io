# 卡卡颂 · Carcassonne — E2E 与联机证据

## 单机/页面 E2E

- `node games/boardgame/carcassonne-premium/test.js`：120 断言，覆盖 72 张瓦片数据、开局确定性、放置合法性、城市/道路/修道院/农田计分、多数并列、终局补算、AI 30 局、完整一局、页面契约。
- `game-smoke.mjs` 390×844 与 320×568：19 checks PASS；0 外部请求、0 console error、0 异常；字号 ≥12px；主触控 ≥44px；无横向滚动。

## 双客户端联机 E2E

`node games/boardgame/carcassonne-premium/test-online.js`（50/0）：

- 房间：创建 / 邀请加入 / 邀请单次使用 / 密码房 / 私密房 / PII 拒绝。
- 房主开局；非房主开局 403；越权行动 409；非法放置 422；缺少 session 403。
- 双客户端同局：多步回合（放瓦片 → 米宝/跳过）交替同步；至少一次真实米宝放置；牌堆耗尽终局；双方结算一致。
- 断线重连 `E_TOKEN` 对照；闲置超时 `takeoverSeats` 记录并可由重连清除。
- 终局榜单 `game=carcassonne`、房主重赛、离开转 AI、房主关闭房间。

## 联机实现

- 服务器：`online-server.mjs` → 共享 `../app/online-game.mjs` → `../app/rooms.js`。
- 公共状态：棋盘、玩家分数/米宝、当前瓦片、阶段、牌堆数量；牌堆顺序不下发。
- 规则权威：服务器只接受 `engine.js` 的合法动作；AI 补位与接管也走同一引擎。

## 性能

`perf.json`：FCP 28ms、DOMContentLoaded 10ms、load 10ms、DOM 196 节点、材质 401,998B、外部请求 0（resident Chrome CDP 9222）。

## 复跑命令

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/carcassonne-premium/test.js
node games/boardgame/carcassonne-premium/test-online.js
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/carc-list.txt --width 390 --height 844
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/carc-list.txt --width 320 --height 568
node games/boardgame/carcassonne-premium/test-online.js --control   # 预期 exit 1
```
