# 领土 · Dominion — E2E 与联机证据

## 单机/页面 E2E

- `node games/boardgame/dominion-premium/test.js`：150 断言，覆盖数据、开局确定性、阶段/合法动作、8 张行动牌、购买、终局条件、AI 30 局、完整一局、页面静态契约。
- `game-smoke.mjs` 390×844 与 320×568：19 checks PASS；0 外部请求、0 console error、0 异常；字号 ≥12px；主触控 ≥44px；无横向滚动。

## 双客户端联机 E2E

`node games/boardgame/dominion-premium/test-online.js`（63/0）：

- 房间：创建 / 邀请加入 / 邀请单次使用 / 密码房 / 私密房 / PII 拒绝 / 人数钳制。
- 房主开局；非房主开局 403；越权行动 409 `E_TURN`；非法动作 422。
- 双客户端同局：交替行动、工坊 `gainChoice` 待选择、行省堆空或三堆空终局，双方结算一致。
- 断线重连 `E_TOKEN` 对照；闲置超时 `takeoverSeats` 记录并可由重连清除。
- 终局榜单 `game=dominion`、房主重赛、离开转 AI、房主关闭房间。

## 联机实现

- 服务器：`online-server.mjs` → 共享 `../app/online-game.mjs` → `../app/rooms.js`。
- 公共状态：公共牌堆、弃牌区、打出区、手牌数量；自己的手牌仅通过 session 返回。
- 规则权威：服务器只接受 `engine.js` 的合法动作；AI 补位与接管也走同一引擎。

## 性能

`perf.json`：FCP 24ms、DOMContentLoaded 13ms、load 13ms、DOM 433 节点、材质 228,842B、外部请求 0（resident Chrome CDP 9222）。

## 复跑命令

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/dominion-premium/test.js
node games/boardgame/dominion-premium/test-online.js
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/dom-list.txt --width 390 --height 844
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/dom-list.txt --width 320 --height 568
node games/boardgame/dominion-premium/test-online.js --control   # 预期 exit 1
```
