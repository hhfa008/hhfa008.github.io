# AZUL 花砖物语 · 进度与续跑

- 日期：2026-11-10
- 分支：`boardgame/d686a4ca-azul-premium` → 联机实现分支 `feature/azul-online`
- 状态：**shipped**（单机、美术、性能、移动端、E2E、联机五项全部通过）
- 批量策略：暂停扩展新游戏；本期只把 Azul 作为备选样本补齐，不与 Codenames 样本并行铺量，等样本验收通过后再放量。

## 五项硬性验收

| # | 要求 | 状态 | 证据 |
|---|---|---|---|
| 1 | 设计 + 性能断言 + 封面/OG/详情配图 + realism + E2E 记录 | ✅ | `DESIGN.md`、`meta.json`、`assets/`、`E2E.md`、`e2e.mjs` |
| 2 | 手机适配（390×844 / 320×568、横竖屏、44px、safe-area、100dvh、iOS、断网） | ✅ | `E2E.md` 设备矩阵 + 断网/安全区断言 |
| 3 | 联机（房间+邀请+同步+断线重连+超时托管+入榜+双端 E2E） | ✅ | `online.html`、`app/server.mjs`、`tests/azul-online.test.mjs`（290）、`online-e2e.mjs`（42） |
| 4 | 单人 / 联机入口清晰 | ✅ | `index.html` 顶部「联机」入口 + `online.html` + `rules.html` chip + `meta.modeLabel` |
| 5 | 五项全过才 shipped | ✅ | `meta.status = "shipped"`，`online.status = "ready"` |

## 已完成

- 复用 `games/shared/shuffle.js`（引擎洗牌）与 `games/shared/sfx.js`（音效），未复制；`rules.js` / `physics.js` 对 Azul 不适用；联机排行榜复用 `app/leaderboard.js` 的 sha256Hex（服务端内存，仅匿名摘要）。
- 规则引擎：2–4 人、5/7/9 圆盘、100 枚砖、模式线、墙面、地板、终局奖励、30 局 AI 自对弈。
- 单机 UI：取砖→模式线→上墙→计分闭环；AI 连续行动；终局结算/重开。
- 联机：`app/server.mjs` 新增 Azul adapter（`makeGameState` / `matchView` / `matchLegalActions` / `applyAzulAction` / AI / 托管），
  `online.html` 负责房间、邀请链接、700ms 轮询、按视角轮转状态、会话重连、AI 补位与结算展示；
  服务端动作带 `stateVersion`/`lastAction`/幂等键，终局写匿名排行榜。
- 美术：img-gen 单物件材质（5 砖/木盘/绒布/木纹）+ 代码合成封面/OG/详情；`art-render.html` + `render-art.mjs` 可复现。
- 移动端：390/320/横屏冒烟全过；44px 热区、safe-area、100dvh、iOS WebAudio 解锁、触控下关闭 backdrop-filter。
- 离线：`sw.js` v3 缓存 shell + 8 材质 + 封面/OG/详情；CDP 离线重载通过。
- E2E：149 断言，0 失败；规则页、美术合成页、性能、断网、shared 缓存均覆盖；`--control` 故意失败退出码 1。
- 单测：235 断言，0 失败；`run-all` 75,282 断言，0 失败。

## 资源与耗时（本机实测）

| 命令 | 耗时 | 最大 RSS | CPU user/sys |
|---|---:|---:|---:|
| `node games/boardgame/azul-premium/test.js` | 0.52s | 71.5 MB | 0.55 / 0.01s |
| `node games/boardgame/azul-premium/e2e.mjs` | 37.46s | 96.4 MB | 0.15 / 0.04s |
| `node games/tests/run-all.js` | 28.82s | 270.3 MB | 21.22 / 2.27s |

页面侧：FCP 80ms、DCL 12ms、DOM 329 节点、rAF FPS 61、材质 350,494B、纯落子 0.7ms。

## 续跑命令（可中断）

```bash
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
cd /Users/fa/games-worktrees/azul-online

# 1) 只跑规则引擎
node games/boardgame/azul-premium/test.js

# 2) 浏览器 E2E：先 chrome-ensure，复用常驻审计 Chrome 9222；只开/关一个标签
node games/boardgame/azul-premium/e2e.mjs

# 2b) 联机契约 + 双客户端浏览器 E2E
node games/boardgame/tests/azul-online.test.mjs
node games/boardgame/azul-premium/online-e2e.mjs

# 3) 全量回归（会自动发现 azul-premium/test-online.js）
node games/tests/run-all.js

# 4) 重渲染封面/OG/详情（需要 cwebp）
node games/boardgame/azul-premium/render-art.mjs
```

浏览器规则备注：GUI Chrome 的「允许 Apple 事件中的 JavaScript」当前关闭，`urlrun tab js` 不可用；脚本改为复用常驻审计 Chrome 的 CDP（9222），不新建临时 Chrome/profile、不 kill Chrome。若用户手动开启该设置，可改用 `urlrun tab` 驱动同一页面。

## 联机接入（已完成）

- **服务端权威**：`app/server.mjs` 识别 `azul`，复用 `azul-premium/engine.js` 的 `createGame/applyMove/getLegalMoves/chooseAIMove`；
  房间 2–4 座、`stateVersion`、`lastAction`、按玩家幂等的动作 id。
- **跨设备同步**：`GET /api/rooms/:id` 700ms 轮询；每个 viewer 的 `players` 轮转为「自己在座位 0」，
  `current/firstPlayer/result.winner` 同步重映射，双端看到同一局。
- **邀请**：`inviteUrl` 由请求 Host 生成，指向 `/boardgame/azul-premium/online.html?room=&code=`。
- **AI 补位**：默认 3 秒（可配），补到所选 2/3/4 人；AI 只从合法动作里选，行动间隔 600–1200ms。
- **断线/托管**：session token 重连；超过 `BOARDGAME_DISCONNECT_MS`（默认 15s）无带 session 请求则服务端代打，
  `autoPlayed` 记录 `{reason:"timeout"}`；重连后自动退出托管名单。
- **排行榜**：`GET /api/leaderboard?game=azul`；只存 `sha256(playerId)`，AI 参与者同样有效。
- **双客户端 E2E**：`online-e2e.mjs` 用 chrome-ensure + Playwright connectOverCDP 开两个独立 context，
  同一房间走完整局并断言两端 `stateVersion/status/比分/获胜者` 一致；`test-online.js` 纳入 `games/tests/run-all.js`。

### 联机验证命令

```bash
cd /Users/fa/games-worktrees/azul-online
node games/boardgame/tests/azul-online.test.mjs      # 290 assertions
node games/boardgame/azul-premium/online-e2e.mjs     # 42 assertions
node games/boardgame/azul-premium/test-online.js     # run-all wrapper
```

## 下一步

1. 服务端目前是内存态、内网自用；公网部署前需持久化房间/排行榜并加鉴权与 TLS。
2. 若用户开启 AppleScript JS：可把 `e2e.mjs` / `online-e2e.mjs` 的 CDP 入口替换为 `urlrun tab` 轮询，断言不变。
