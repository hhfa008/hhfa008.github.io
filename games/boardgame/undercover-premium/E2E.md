# Undercover Premium — E2E

> 4 个独立客户端 + 真实 HTTP 房间服务器
> 命令：`node games/boardgame/undercover-premium/test-online.js`
> 实测：`120 passed, 0 failed`，exit 0

## 1. 拓扑

```
client A ─┐
client B ─┼── HTTP/JSON ──▶ online-server.mjs ──▶ ../app/online-game.mjs
client C ─┤                  (engine.js 权威判定)      (房间/座位/托管/榜单)
client D ─┘
```

两个服务器实例：

1. 主实例：`idleTimeoutMs = 15000`，用于房间生命周期、4 人完整对局、重连、重赛、离开、关房。
2. 短超时实例：`idleTimeoutMs = 250`，用于空闲托管与重连清除。

`aiDelayMs = 0`，AI 座位由 `/tick {force:true}` 或共享 server 的 200ms 定时器推进；不会使用真实网络或外部服务。

## 2. 覆盖链路

### 房间与授权

- `GET /health` → 200，`game=undercover`。
- 创建 6 座房：座位 0 为房主，1–5 为 AI，`maxPlayers=6`。
- 单人房主启动 → 409 `E_PLAYERS`。
- 单次邀请码加入 → 200；重复使用同一邀请码 → 403 `E_INVITE`。
- 公开房间码加入第 3 人 → 200。
- 非房主启动 → 403 `E_HOST`。
- 密码房：不带密码 → 403 `E_PASSWORD`；正确密码 → 200。
- 2 座房第 3 人 → 409 `E_FULL`；4 座房第 5 人 → 409 `E_FULL`。

### 隐藏信息

- 房主视角收到 `privateWord` / `privateRole`；其他存活座位在 `publicState.players` 中没有 `role` / `word`。
- `publicState` 不包含词对 `pair`。
- 终局后所有玩家的 `role` / `word` 才公开。

### AI 补位

- 2 名真人 + 3 个 AI 座位开始对局；AI 自动完成看词、发言开始与投票。
- 由两个真人 session 驱动到终局；每轮触发 `lastElim`。
- 终局公开全部角色与词。

### 4 人完整对局

- 创建 4 座房，p0/p1/p2/p3 四个独立 session 加入并全部开局。
- 开局后逐个读取私有角色：恰好 1 名卧底、0 名白板。
- 按座位顺序完成 `reveal` → `speak` → `vote`。
- 投票策略：存活平民集中投卧底；卧底投平民。最终卧底被淘汰，平民胜。
- 每次行动后交叉读取 p0 与当前行动者的视角，`phase` / `round` / `current` 一致。
- 终局后四个客户端读取的 `winnerSide`、`eliminated`、`result.players`（角色与词）逐项一致。
- 榜单出现该房间条目（4 个座位、房间码）。

### 重连 / 托管 / 重赛 / 离开

- 坏 token 重连 → 403 `E_TOKEN`。
- 正确 session 重连 → 200，`reconnected=true`，清除该座位 takeover 标记。
- 非房主重赛 → 403；房主重赛 → 200，回到 `reveal`、4 人保留。
- p3 离开 → 座位 3 变 AI。
- 非房主关房 → 403；房主关房 → 200；随后 GET → 404。
- 短超时实例：两名真人空闲 700ms 后 `/tick` → `takeoverSeats` 至少 1 个；guest 重连后其座位 takeover 清除。

## 3. 输出契约

```
ONLINE_E2E_JSON: {"game":"undercover","clients":4,"sameGame":true,
"settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,
"leaderboard":true,"runAll":true,...}
RESULT: 120 passed, 0 failed
```

`online-e2e.json` 与上述字段一致；`test-online.js --control` 故意失败并 exit 1。

## 4. 浏览器冒烟

390×844 与 320×568 的真实 Chrome 冒烟由集成方串行执行（避免并发抢占 CDP / 写共享 audit）。检查项包括：无横向滚动、主触控 ≥44px、字号 ≥12px、无外部请求、无 console error、点击冒烟。本文件不预填未运行的结果。
