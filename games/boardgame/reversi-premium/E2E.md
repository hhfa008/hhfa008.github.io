# 黑白棋 · Reversi Premium — E2E 与联机证据

## 单机/页面 E2E

- `node games/boardgame/reversi-premium/test.js`：182 断言，规则、AI、完整对局、页面契约与性能预算；`--control` exit 1（预期）。
- 浏览器冒烟由集成方统一串行执行 `game-smoke.mjs`：
  - 390×844 与 320×568 无横向滚动；
  - 主按钮/链接 ≥44×44；
  - 可见字号 ≥12px；
  - 零外部请求、零 console error、零未捕获异常；
  - 点击冒烟不意外跳转。
- 棋盘格为 `div[role=gridcell]`，避免 8×8 小屏格位被当成主触控目标；所有操作按钮与导航链接满足 44px。

## 双客户端联机 E2E

`node games/boardgame/reversi-premium/test-online.js`（102/0）：

- 房间：创建 2 人房 / 邀请加入 / 邀请单次使用 / 第三人 `E_FULL` / 密码房 / 私密房 / PII 拒绝。
- 开局：非房主 403 `E_HOST`；房主开始后双方看到同一棋盘与同一回合。
- 同步：黑方合法落子后双方看到同一落子与翻面，比分同步；越权 `E_TURN`、非法 `E_ACTION`、坏 session `E_SESSION`。
- 重连：同房间 session 重连 200；坏 token 403 `E_TOKEN`。
- 托管：短超时服务器上闲置后 `/tick` 记录 `takeoverSeats`；重连清除该座位托管。
- 完整对局：两个客户端交替落子/跳过直到终局；双方棋盘、黑白比分、`result` 完全一致。
- 榜单：`/api/leaderboard` 返回 `game=reversi` 与当前房间条目。
- 重赛：非房主 403；房主重开回到初始 2:2、手数 0。
- 离开/关房：离开座位变 AI；非房主关房 403；房主关房后房间 404。

机器可读契约写在 `online-e2e.json`，测试末尾打印 `ONLINE_E2E_JSON` 与 `RESULT`。

## 联机实现

- 服务器：`online-server.mjs` → 共享 `../app/online-game.mjs` → `../app/rooms.js`。
- 座位映射：共享服务器座位 0/1 ↔ 引擎黑/白（1/2）；`currentSeat` 只做映射，不改引擎回合。
- 规则权威：服务器只接受 `engine.js` 的合法动作；AI 补位/接管也走同一引擎。
- 公共状态：64 格棋盘、回合、比分、`passed`、`lastMove`、`lastFlips`、玩家名/AI 标记与结果；不下发完整内部历史与 RNG。

## 性能

`perf.json`：纯引擎 500 局创建 0ms、2000 次合法点 6ms、30 步普通 AI 7ms、5 步困难 AI 6ms、500 次 publicState 1ms（node 24.12.0）。浏览器首屏/材质预算由集成方的 perf/smoke 统一测量。

## 复跑命令

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/reversi-premium/test.js
node games/boardgame/reversi-premium/test.js --control           # 预期 exit 1
node games/boardgame/reversi-premium/test-online.js
node games/boardgame/reversi-premium/test-online.js --control    # 预期 exit 1
```
