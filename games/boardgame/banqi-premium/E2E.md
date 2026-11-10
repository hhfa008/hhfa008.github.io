# 暗棋 · 双客户端联机 E2E 记录

> 脚本：`test-online.js`（run-all 自动发现，因为文件名以 `test` 开头）
> 服务：`online-server.mjs`（复用 `games/shared/online-room-server.mjs`）

## 运行

```bash
node games/boardgame/banqi-premium/test-online.js
# ONLINE_E2E_JSON: {"game":"banqi","clients":2,"sameGame":true,
#   "settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,
#   "leaderboard":true,"runAll":true,...}
# RESULT: N passed, 0 failed

node games/boardgame/banqi-premium/test-online.js --control
# RESULT: 0 passed, 1 failed  (exit 1，故意的失败对照)
```

## 覆盖

| 环节 | 断言 |
|---|---|
| 建房 | 201、房主 session、单次邀请 token、2 个座位 |
| 加入 | 错误密码拒绝、邀请码加入、第二人落座 1、邀请重放拒绝 |
| 开局 | 房主开始、保持 2 人、32 格全暗、服务端不下发暗子身份 |
| 同步 | 双方同一回合、同一暗子数、同一 stateVersion、红方先手 |
| 约束 | 非当前玩家无合法动作；越权动作 409 |
| 幂等 | 同一 idempotencyKey 重放返回同一 stateVersion |
| 完整对局 | 420 步内结束；全程 stateVersion 一致；至少一次翻子 |
| 结算 | 同一赢家、同一分数、同一原因、双方 over=true、2 名玩家、赢家剩余棋子不少于对手 |
| 榜单 | 至少 2 条、原始 playerId 不外泄 |
| 重赛 | over=false、暗子回到 32、红方先手 |
| 重连 | `reconnected=true` |
| 托管 | 无请求超时后 takeover 含座位 0；重连后清除 |
| 关房 | 200 `closed=true`；随后 GET 404 |

## 契约字段

`ONLINE_E2E_JSON` 同时输出 `clients=2`、`sameGame`、`settlementConsistent`、`reconnect`、`timeoutTakeover`、`leaderboard`、`runAll`，供 `games/boardgame/scripts/gate-online.js` 识别。`online-e2e.json` 是该次运行的落盘证据。

## 环境

- 只监听 127.0.0.1 的随机端口；无外部网络。
- 服务端 `idleTimeoutMs=700`、`aiDelayMs=0`，用于在秒级内验证托管与 AI 落子。
- 不启动浏览器；纯 HTTP 双客户端。
