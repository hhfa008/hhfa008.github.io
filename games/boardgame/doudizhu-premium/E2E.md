# 斗地主 · 精品版 — 联机 E2E 记录

日期：2026-11-10

## 命令

```bash
node games/boardgame/doudizhu-premium/test-online.js
node games/boardgame/doudizhu-premium/test-online.js --control   # 故意失败，exit 1
```

`game` 名：`doudizhu-premium`。服务端默认端口 8787；测试使用 `port: 0` 随机端口。

## 拓扑

```
client A (HTTP) ─┐
                 ├─ shared online-room-server.mjs ─ adapter ─ engine.js
client B (HTTP) ─┘                    │
                              seat 2: AI 补位
```

- 座位 0/1：两个独立 HTTP client，各自 session。
- 座位 2：空位由共享房间服务标记为 AI，`adapter.aiAction` 驱动。
- 视图：`adapter.view` 调用 `E.publicView(state, seatIndex)`；其他两家手牌只给 `handCount`，底牌结束前 `{count:3, revealed:false}`。

## 覆盖步骤

1. 建房（密码 `abcd`）→ 201，3 座，返回 session 与单次邀请 token。
2. 错误密码加入 → 4xx；邀请码加入 → 200 落座 1；邀请重放 → 4xx。
3. 房主开始 → 200；第 3 座 AI；自己 17 张；无 `hands` 字段；底牌未揭示。
4. A/B 两个 GET：同一 `stateVersion`、同一 `turnSeat`、同一底牌数量。
5. 非当前玩家动作 → 409；当前玩家合法动作 → 200；同 `idempotencyKey` 重放 → 同一 `stateVersion`。
6. 自动对局至结算：双方 winner / scores / multiplier / points / details 完全一致；分值和 0；结束后底牌揭示。
7. 排行榜：>=3 条、含 AI、`playerId` 为 `sha256:` 前缀。
8. 重赛：回到 bid、17 张、底牌遮罩；重连成功。
9. 1400ms 空闲 → 托管列表含座位 0；重连后座位恢复人类、托管清除。
10. 关房 200；再查 404。

## 实测输出（摘要）

```
RESULT: 57 passed, 0 failed
ONLINE_E2E_JSON: {"game":"doudizhu","clients":2,"seats":3,"aiFill":true,"sameGame":true,"settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"rematch":true,"runAll":true,"assertions":57,"failed":0}
```

对照：

```
node .../test-online.js --control
RESULT: 0 passed, 1 failed
exit code 1
```

## 备注

- 服务端权威：规则在服务端跑，客户端只渲染 view；底牌与对手手牌身份从不下发。
- AI 补位与超时托管使用同一个 `aiChoose`，不会读取对手手牌。
- 幂等缓存在回合校验之前命中，重放不会二次推进状态。
