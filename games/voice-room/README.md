# 语音房 · 井字棋 / 五子棋 / 四子棋（MVP）

4 位房号进房、最多 4 人、互相能听见，然后由房主选一款棋一起玩。

- 页面：<https://hhfa008.github.io/games/voice-room/>
- 信令 Worker：<https://voice-room.superapp-devin.workers.dev>
- 前端单文件：`index.html`（无第三方 SDK）
- Worker 源码：`worker/`（`wrangler.toml` + `src/`）
- 共享规则：`../shared/rules.js`（五子棋、四子棋，单机版与服务端同源）

## 架构（文字版）

```
         浏览器 A / B / C / D（iOS Safari、Android Chrome、桌面）
                    │
       ┌────────────┼─────────────────────────────┐
       │            │                             │
 HTTPS 静态页   WSS 信令/房间状态/棋局        GET /api/ice
 (GitHub Pages)      │                             │
                     ▼                             ▼
          Worker: voice-room            Worker → Cloudflare TURN API
                     │                    （生成 1 小时短期凭据）
                     ▼
          RoomDO（每个 4 位房号一个）
          ├─ WebSocket Hibernation API
          ├─ DO storage: members / game
          └─ 校验 room、转发 SDP/ICE、落子、房主移交

  A ◀──────── WebRTC 纯音频 mesh（P2P，最多 6 条流）────────▶ B/C/D
                host / srflx 优先；打洞失败自动使用 TURN relay
```

### 信令与状态

- `GET /ws?room=1234&name=...&pid=...` 升级为 WebSocket；Worker 校验 4 位房号后转发给对应 `RoomDO`。
- `RoomDO` 使用 `state.acceptWebSocket()` / `webSocketMessage()` / `webSocketClose()`，成员与棋局均在 DO storage。
- 每条客户端消息都带 `type` 与 `room`；服务端校验 `room === 本房间`，跨房间消息直接拒绝。
- 成员上限 4；第 5 个连接收到 `room_full` 并关闭。
- 房主 = 最早进房者；房主离开后自动移交给下一位。
- 断线重连：客户端在 sessionStorage 里保存 `pid`，重连时带回；服务端在 60 秒宽限期内保留该成员的座位和棋局，重连后接回原 id、原座位与原棋盘。宽限期结束后才清理座位并重置。
- 游戏由房主选择（`game_select`）：`ttt` 井字棋 / `gomoku` 五子棋 / `connect4` 四子棋；换游戏会重置棋盘与比分。
- **服务端权威**：客户端只发 `game_move` 的 `(x, y)`（四子棋 x 为列）；DO 校验轮次、边界、占位、满列、是否终局，再广播 `game_state`。五连/四连与胜负判定也在 DO 侧完成。

### 共享规则

- `games/shared/rules.js` 是五子棋与四子棋规则的单一实现：
  - 单机版 `games/gomoku/index.html`、`games/connect4/index.html` 通过 `<script src="../shared/rules.js">` 加载；
  - Worker 通过 ESM import 同一文件，在 DO 里读取 `globalThis.GameRules`。
- 五子棋使用 `checkWinAt` / `lineAt`，四子棋直接复用完整引擎（含重力、`applyMove`、`status` 和 AI）。
- 改规则只改这一处。

### 语音

- 默认静音，不请求麦克风；点「开麦」才 `getUserMedia`。
- 每两位成员之间一个 `RTCPeerConnection`（纯音频 mesh，2–4 人）。
- 进房时先放一条静音音轨，之后开/关麦用 `replaceTrack()`，避免反复重协商。
- 双方同时协商时用 perfect negotiation（polite/impolite + rollback）解决 glare。
- `iceServers` 由 Worker 调 Cloudflare TURN API 生成，TTL 3600 秒；客户端在到期前约 10 分钟刷新并 `setConfiguration` / `restartIce`。
- host / srflx 可用时优先直连；失败时浏览器自动选择 TURN relay。TURN 接口不可用时降级为纯直连，不再阻塞建连。
- 音量点由 `AnalyserNode` 的 RMS 驱动；不录音、不上传音频到服务器。

## 部署

### 1. Worker

前置：Cloudflare 账号已开通 Workers、Durable Objects、Realtime TURN；本机 wrangler OAuth 具备 `Workers Scripts:Edit` 与 `Durable Objects:Edit`。

```bash
cd worker
wrangler deploy
# 把 TURN Key 的 API Token 存成 Worker secret（不要写进仓库）
wrangler secret put TURN_KEY_API_TOKEN
```

`wrangler.toml` 中的 `TURN_KEY_ID` 是 TURN Key 的公开 ID；`TURN_KEY_API_TOKEN` 只存在于 Worker secret。  
`/api/ice` 仅允许 `hhfa008.github.io` 与 localhost 来源调用，避免被其他站点白嫖 TURN 流量。

部署后健康检查：

```bash
curl https://voice-room.superapp-devin.workers.dev/health
curl -H 'Origin: https://hhfa008.github.io' \
  https://voice-room.superapp-devin.workers.dev/api/ice
```

### 2. 前端

`index.html` 顶部 `API_BASE` 指向 Worker。若改了 Worker 名称或子域，改这一行后重新发布：

```bash
git add games/voice-room games/shared
git commit -m "feat: 语音房多游戏（井字棋/五子棋/四子棋）"
git push origin master
```

GitHub Pages 会自动从 `master` 发布 `games/voice-room/index.html` 与 `games/shared/rules.js`。

### 3. 本地调试

```bash
cd games/voice-room && python3 -m http.server 8788
# 打开 http://127.0.0.1:8788/?api=http://127.0.0.1:8787
# 先在本机跑 wrangler dev --local --port 8787
```

`?relay=1` 会强制 `iceTransportPolicy: 'relay'`，用于只验证 TURN 通路的测试。

## 端到端验证结果

用 Node WebSocket 客户端 + Playwright 系统 Chrome 两个独立 context（假麦克风 + 假音频文件，真实 WebRTC）：

| 项目 | 结果 |
| --- | --- |
| 两人进同一房号、成员列表互见 | 通过 |
| 服务端拒绝「不该你下」 | 通过（井字棋/五子棋/四子棋各 1 例） |
| 服务端拒绝非法落子 | 通过（占位、越界、非整数、满列共 8 例） |
| 五子棋五连广播 | 通过（横/竖/斜 3 例） |
| 四子棋四连广播 | 通过（横/竖/斜 3 例，重力落子） |
| 断线重连一致性 | 通过（三款棋棋盘一致、id 不变、可继续落子） |
| 房主离开移交 / 重连拿回房主 | 通过 |
| 井字棋回归 | 通过（默认游戏、三连判定、新一局、非房主被拒） |
| 语音 `connectionState` | 两端均 `connected`，candidate `host → host` |
| 语音收流（getStats） | 两端 `bytesReceived` / `packetsReceived` 持续增长 |
| 4 人上限 | 前 4 人正常；第 5 人收到 `room_full` |

## 成本估算

以 4 人房、每人每 20 秒一次心跳计算：

- **Durable Object 请求**：约 `4 × 3 × 60 = 720` 条/小时（广播/落子另计，量级仍 < 1,500/小时）。DO WebSocket 消息按请求计费；免费额度 100,000 请求/天。
- **DO 时长**：使用 Hibernation，空闲时不收时长费；只有消息处理时短暂计费。
- **Worker 请求**：仅进房/ICE 拉取，忽略不计。
- **TURN**：`$0.05/GB` 出向流量，每月前 1,000 GB 免费。4 人全走 relay、约 40 kbps/流时约 216 MB/小时；1,000 GB 免费额度约等于 4,600 小时/月。
- 结论：MVP/小规模使用落在免费额度内，边际成本接近 0。

## 已知限制

- 纯 mesh，4 人时每人最多 3 条上行音频；人越多带宽/CPU/混音压力越大，不适合扩到 5 人以上。
- 没有账号体系；4 位房号就是唯一凭证，可被枚举/碰撞，当前没有限流或密码。
- 房间状态在单个 DO；多区域容灾、跨房间大规模调度未做。
- 固定两位玩家对局（X/O），第三人起为观战；换人或座位宽限期结束会重置棋盘与比分。
- 优雅关闭 WebSocket 时浏览器可能先停在 CLOSING 数秒；网络掉线靠心跳在 ~45 秒内发现并重连。
- 未做录音、服务端音频处理、音频存储；没有文字聊天、屏幕共享、战绩持久化。
- iOS Safari 首次播放远端音频需要一次页面点击解锁；麦克风要求 HTTPS。
- TURN 凭据刷新时会触发一次 ICE restart，长通话在该时刻可能有短暂抖动。

## 文件

```
games/
├── shared/
│   └── rules.js        # 五子棋/四子棋规则，单机版与服务端同源
└── voice-room/
    ├── index.html      # 单文件前端（内联 CSS/JS）
    ├── guide.html      # 开房教程
    ├── README.md
    └── worker/
        ├── wrangler.toml
        └── src/
            ├── index.js  # 路由 / ICE / WebSocket 转发 / CORS
            └── room.js   # RoomDO：成员、信令、三款棋局、房主移交、重连
```
