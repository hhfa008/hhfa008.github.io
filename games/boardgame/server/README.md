# 桌游 HTTP/JSON API（机器可调用）

`app/server.mjs` 是零第三方依赖的 Node HTTP 服务，给本地 AI agent、dsh 插件和自动化测试用，
同时也能在局域网内提供跨设备房间页（`/play/online.html`）。内存态，不写盘、不发外网请求、
不收集个人信息。**仅限内网自用，不要直接暴露公网。**

## 启动

```bash
cd games/boardgame
export PATH=$HOME/.local/node/bin:$PATH

# 默认 127.0.0.1:8787
node app/server.mjs

# 指定端口（优先级：--port > BOARDGAME_AI_PORT > 8787）
node app/server.mjs --port 8787
BOARDGAME_AI_PORT=8788 node app/server.mjs

# 跨设备联机：监听所有网卡；邀请 URL 用请求 Host
node app/server.mjs --host 0.0.0.0 --port 8787
BOARDGAME_HOST=0.0.0.0 node app/server.mjs
```

环境变量：

| 变量 | 作用 |
|---|---|
| `BOARDGAME_HOST` | 监听地址，默认 `127.0.0.1`；`0.0.0.0` 允许局域网访问 |
| `BOARDGAME_AI_PORT` | `app/server.mjs` 未带 `--port` 时的监听端口，默认 `8787` |
| `BOARDGAME_API_TOKEN` | 可选。设置后 `/api/*` 要求 `Authorization: Bearer <token>`；`/health` 与静态页保持可读 |
| `BOARDGAME_AI_FILL_MS` | 创建房间后多久无人加入就 AI 补位，默认 `3000` |
| `BOARDGAME_AI_MOVE_MIN_MS` / `BOARDGAME_AI_MOVE_MAX_MS` | AI / 托管行动节奏，默认 `600` / `1200` |
| `BOARDGAME_DISCONNECT_MS` | 断线多久后托管，默认 `15000` |
| `BOARDGAME_TICK_MS` | 托管检查间隔，默认 `120` |
| `BOARDGAME_AI_BASE_URL` | `server/ai-eval.mjs` 的默认 `--base-url`，默认 `http://127.0.0.1:8787` |

> **部署边界**：这套服务是 loopback / 内网自用接口。`--host 0.0.0.0` 只用于同一局域网内
> 的设备联机，CORS 只回显同源 / 回环 / 局域网 Origin，绝不使用 `*`。若要对内网其他机器开放，
> 建议同时设置 Bearer token；**不要直接暴露公网**。生产化路径见 `../DEPLOYMENT.md`
> （Cloudflare Workers / Durable Objects）。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` `/health` `/api/health` | 健康检查与服务能力 |
| POST | `/api/matches` | 直接开一局（匿名 or `ai`），返回 `matchId` |
| GET | `/api/matches/:id` | 读对局状态 |
| GET | `/api/matches/:id/actions` | 当前合法动作 |
| POST | `/api/matches/:id/actions` | 提交动作（支持 `idempotencyKey`） |
| POST | `/api/ai/evaluate` | 对给定动作列表给出推荐动作/分值 |
| POST | `/api/rooms` | 创建房间（可选密码/可见性/seed；`autoFill:true` 3 秒后 AI 补位） |
| POST | `/api/rooms/:id/join` | 加入房间（密码或邀请码） |
| GET | `/api/rooms/:id` | 查询房间状态、zones、合法动作、`stateVersion`、`autoPlayed`（客户端 500–1000ms 轮询） |
| POST | `/api/rooms/:id/actions` | 在房间内落子/执行动作（复用引擎动作；`idempotencyKey` 幂等） |
| POST | `/api/rooms/:id/start` | 房主开始对局（卡牌 2 人，麻将 4 人） |
| POST | `/api/rooms/:id/reconnect` | 用 `playerSession` 重连（恢复被托管的玩家） |
| POST | `/api/rooms/:id/leave` | 离开房间 |
| DELETE | `/api/rooms/:id` | 房主关闭房间 |
| POST | `/api/rooms/:id/voice/token` | 语音接口位，只做成员鉴权，不做媒体传输 |
| GET | `/api/leaderboard?game=<id>` | 服务端内存排行榜（匿名 hash，无个人信息；AI 结果同样有效） |

游戏类型：`card-battle`（默认，宝可梦式 2 人卡牌）和 `mahjong`（4 人麻将）。
动作形状沿用引擎：

- 卡牌：`endTurn` / `play`（`cardId`）/ `attach`（`cardId`, `target`）/ `attack` / `draw` / `prize`
- 麻将：`discard`（`tile`）/ `tsumo` / `claim`（`playerIndex`）/ `pass` / `draw`

## curl 示例

```bash
BASE=http://127.0.0.1:8787

# 1) 健康检查
curl -s $BASE/health

# 2) 创建带密码的房间（返回 roomId / inviteCode / playerSession / legalActions）
curl -s -X POST $BASE/api/rooms \
  -H 'content-type: application/json' \
  -d '{"gameType":"card-battle","playerId":"p1","seed":42,"password":"secret-1"}'

# 3) 加入房间（密码错误返回 403 E_PASSWORD）
curl -s -X POST $BASE/api/rooms/<roomId>/join \
  -H 'content-type: application/json' \
  -d '{"playerId":"p2","password":"secret-1"}'

# 4) 查状态（私密房必须带成员 playerId + session）
curl -s "$BASE/api/rooms/<roomId>?playerId=p1&session=<playerSession>"

# 5) 落子/执行动作（必须是当前玩家）
curl -s -X POST $BASE/api/rooms/<roomId>/actions \
  -H 'content-type: application/json' \
  -d '{"type":"endTurn","playerId":"p1","session":"<playerSession>"}'

# 6) 旧的 matches 接口仍然可用
curl -s -X POST $BASE/api/matches -H 'content-type: application/json' \
  -d '{"game":"pokemon","seed":42,"ai":true}'
curl -s $BASE/api/matches/<matchId>/actions

# 7) AI 评估
curl -s -X POST $BASE/api/ai/evaluate -H 'content-type: application/json' \
  -d '{"game":"pokemon","state":{"turn":1,"handSize":7,"prizesRemaining":6},"actions":["attack","end-turn"]}'

# 8) 关闭房间
curl -s -X DELETE "$BASE/api/rooms/<roomId>?playerId=p1&session=<playerSession>"
```

带 token 时给所有请求加：`-H "Authorization: Bearer $BOARDGAME_API_TOKEN"`。

## 房间、密码、邀请码与 session

- 房间创建后返回：
  - `roomId`：路径里用的稳定 id；
  - `inviteCode`：6 位房间码，大小写不敏感；
  - `inviteToken`：单次邀请 token（1 小时过期，用后失效）；
  - `playerSession`：该玩家的会话 token，用于查询、动作和重连。
- 密码只存加盐摘要；响应里只有 `hasPassword`，不会出现明文。连续 5 次错误锁定 60 秒。
- `join` 可传 `inviteCode`（房间码或邀请 token）或 `password`。密码错误返回 **403**。
- `visibility=private` 的房间，读状态和动作都必须带成员 `playerId` + `session`。
- 所有状态都在内存里；进程重启即清空，没有数据库、没有上传、没有个人信息字段。
  创建房间时传 `email`/`phone` 会被 **422 E_PII** 拒绝。

## 跨设备、AI 补位、重连与托管

- **邀请 URL**：创建/读取房间时返回 `inviteUrl`，由请求的 `Host`（或 `x-forwarded-host`）
  生成，例如 `http://192.168.1.8:8787/play/online.html?room=...&code=...`。服务同时提供
  静态页，所以另一台设备打开链接即可加入；不需要单独再起 `play/serve.mjs`。
- **状态同步**：`GET /api/rooms/:id` 返回 `stateVersion`（每次 join/start/动作/托管自增）
  和 `lastAction`；客户端按 500–1000ms 轮询即可。动作响应同样带版本，提交时传
  `idempotencyKey`，重复请求返回同一份缓存响应，不会重复落子。
- **AI 补位**：`POST /api/rooms` 传 `autoFill:true`；超过 `BOARDGAME_AI_FILL_MS`（默认 3s）
  仍缺人时，用 `ai_<n>` 补到 2 人（卡牌）或 4 人（麻将）并自动开局。AI 与服务器托管都从
  `cardgame.js` / `mahjong.js` 的 `legalActions` 里选动作，按 `BOARDGAME_AI_MOVE_*` 的节奏
  （默认 600–1200ms）执行，不简化规则。
- **断线重连**：`POST /api/rooms/:id/reconnect` 带 `{token, playerId}` 恢复；成功后清除该玩家的
  托管状态，并在响应里带回当前 `autoPlayed`。
- **超时托管**：某玩家超过 `BOARDGAME_DISCONNECT_MS`（默认 15s）没有任何带 session 的请求，
  服务器代打合法动作；房间视图的 `autoPlayed` 数组返回
  `{playerId,type,reason:'timeout',at}`，`autoPlay.players` 列出当前托管玩家。
- **排行榜**：终局自动写内存榜单，`GET /api/leaderboard?game=card-battle` 读取。条目只含
  `sha256(playerId)`、座位、分数、回合、时长与 `ai` 标记；AI 参与的结果同样计入。
- **隐私**：昵称/玩家 ID 由用户自填，榜单不落原文；不接收姓名、邮箱、手机号。

## 错误码

统一错误体：`{"error":{"code":"E_...","message":"..."}}`

| 状态 | code | 场景 |
|---|---|---|
| 400 | `E_JSON` | 请求体不是合法 JSON |
| 401 | `E_AUTH` | 设置了 token 但缺失/错误 |
| 401 | `E_PLAYER` | 动作为空且没有 playerId/session |
| 403 | `E_PASSWORD` | 房间密码错误 |
| 403 | `E_INVITE` | 邀请码无效/过期/已用 |
| 403 | `E_SESSION` `E_TOKEN` | session 无效或不属于该房间 |
| 403 | `E_PLAYER` | 不是房间成员 |
| 403 | `E_PRIVATE` | 未带成员身份读私密房 |
| 403 | `E_HOST` | 非房主执行 start/close |
| 403 | `E_VOICE` | 非成员申请语音 token |
| 404 | `E_NOT_FOUND` | 房间/对局不存在或已关闭 |
| 405 | `E_METHOD` | 路径存在但方法不支持 |
| 409 | `E_TURN` | 不是当前玩家回合 |
| 409 | `E_ACTION` `E_PHASE` `E_STATE` `E_FULL` | 引擎拒绝动作 / 房间满 |
| 413 | `E_BODY` | 请求体超过 64 KiB |
| 422 | `E_INVALID_ARGS` `E_INVALID_ACTION` `E_PII` | 参数缺失、未知动作、含个人信息 |
| 423 | `E_LOCKED` | 密码错误次数过多被锁 |

## AI 自动对局评测

`server/ai-eval.mjs` 只走 HTTP（创建房间 → 加入 → 轮询状态 → 提交动作），
不 import 引擎，因此它同时是 API 的黑盒验收工具。bot 策略是确定性的：
`attack > play > attach > draw > prize > endTurn`（麻将：`tsumo > claim > discard > draw > pass`）。

```bash
cd games/boardgame
export PATH=$HOME/.local/node/bin:$PATH

node server/ai-eval.mjs \
  --base-url http://127.0.0.1:8787 \
  --game card-battle \
  --seed 42 \
  --max-turns 200 \
  --out /tmp/ai-result.json
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--base-url` | `BOARDGAME_AI_BASE_URL` 或 `http://127.0.0.1:8787` | 服务地址 |
| `--game` | `card-battle` | `card-battle` 或 `mahjong` |
| `--seed` | `42` | 对局种子，同 seed 可复现 |
| `--max-turns` | `200` | 最多提交的动作数 |
| `--out` | 无 | 额外把结果 JSON 写入文件 |
| `--timeout` | `10000` | 单请求超时（毫秒） |
| `--token` | `BOARDGAME_API_TOKEN` | Bearer token |

stdout 只输出一份 JSON（进度写 stderr）。退出码：
`0` 完成（含 max-turns 截断）、`2` 连接失败、`3` 非法响应、`4` 请求超时。

结果 JSON 字段：

| 字段 | 含义 |
|---|---|
| `schemaVersion` | 固定 `1` |
| `baseUrl` / `game` / `seed` | 本次评测配置 |
| `startedAt` / `finishedAt` | ISO 时间戳 |
| `turns` | 实际提交的动作数 |
| `finalTurn` | 终局时引擎回合数 |
| `maxTurns` | 动作上限 |
| `roomId` | 本次评测创建的房间 |
| `moves[]` | 每条动作：`{turn, resultTurn, playerId, action, result}` |
| `result` | `{winner, winnerIndex, score, reason}`；卡牌 `score` 为双方 HP，麻将含番数/牌型 |
| `finalState` | 终局 `status/phase/turn/currentPlayerId/summary` |
| `errors[]` | 非致命错误（非法动作、无合法动作等） |

## 测试

```bash
cd games/boardgame
export PATH=$HOME/.local/node/bin:$PATH

node tests/run-all.mjs                 # 全部 boardgame 契约
node tests/run-all.mjs --filter=ai     # ai-api + ai-e2e + ai-errors
node test-ai.js                        # 根级 wrapper：自起服务 + 房间/AI eval/错误路径断言
node ../../games/tests/run-all.js      # 全站测试（会自动发现 test-ai.js）
```

`tests/ai-e2e.test.mjs` 与 `tests/ai-errors.test.mjs` 会在空闲端口自起 `app/server.mjs`，
跑完房间/动作/AI eval 与错误路径后杀掉服务，不依赖开发者手动开服务。
`test-ai.js` 直接复用 `tests/ai-errors.test.mjs` 的断言，保证两个入口覆盖同一份错误契约。

Note: the unrelated `tests/network-rooms.test.mjs` share the same service discovery.
When `BOARDGAME_AI_BASE_URL` points at this service, that contract will also probe it
and expect `/api/rooms`. Use `run-all.mjs --filter=ai` / `--filter=dsh` as the gate for
this module, or run the full suite without the env var.
