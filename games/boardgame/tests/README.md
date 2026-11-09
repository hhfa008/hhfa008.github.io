# 桌游板块 · 测试契约（C · tests）

本目录只做三件事：**回归现有数据/页面、锁定未来引擎/接口契约、记录可验收的评测标准**。
不实现游戏业务代码，不改 `data/`、`app/`、`collector/`、`build.mjs`、`lib.mjs`。

## 1. 分层

| 层 | 文件 | 现在是否真实跑 | 说明 |
|---|---|---|---|
| L0 基线门禁（A 移交） | `run.js`、`test-data.js`、`test-build.js` | 是 | 数据契约、fixture 重放、构建字节稳定性；`run-all.mjs` 默认把它作为额外套件执行 |
| L1 数据/构建回归 | `data-build.test.mjs` | 是 | 43 条目录数据 + 44 页产物（1 列表 + 43 详情），schema、唯一性、范围、页面内容、零外链 |
| L1 采集回归 | `collector.test.mjs` | 是 | gstone fixture 重放与 `data/boardgames.json` 字节一致；BGG 5 条样例离线导入稳定 |
| L1 页面契约 | `pages-static.test.mjs` | 是 | 校验已提交的 `index.html` + `board/<slug>.html`（43 详情页）：筛选元数据、详情字段、JSON-LD（列表 `CollectionPage`/`ItemList`，详情 `Article`/`BreadcrumbList`）、390/320、深色、零外请求/console error，并与 `build.mjs` 重新构建结果做 md5 比对。原 `pages/` 是 `board/` 的重复副本，已删除 |
| L2 引擎契约 | `engine-audio.test.mjs`、`engine-physics.test.mjs`、`gameplay-mahjong.test.mjs`、`gameplay-card-battle.test.mjs`、`retention-rewards.test.mjs` | 模块存在时跑，否则 SKIP | 探测 `app/` 下的未来模块，验证导出名、状态机语义与错误处理 |
| L3 服务契约 | `network-rooms.test.mjs`、`ai-api.test.mjs`、`ai-e2e.test.mjs`、`ai-errors.test.mjs` | 本地模块/HTTP 服务存在时跑，否则 SKIP | 房间密码、断线重连、语音接口预留；HTTP/JSON 对局与 AI 评估接口；错误路径状态码 + code + 状态不变 |
| L4 宿主插件 | `dsh-plugin.test.mjs` | 插件目录存在时跑，否则 SKIP | manifest、入口、调用协议、错误码 |
| 规格文档 | `DEPLOYMENT.md`（指针 → 根 `../DEPLOYMENT.md`）、`RETENTION.md` | 文档 | 部署取舍结论、留存机制与验收信号 |

## 2. 运行

```bash
export PATH=$HOME/.local/node/bin:$PATH

# 全部契约 + A 基线门禁（缺失模块 SKIP，退出码 0）
node games/boardgame/tests/run-all.mjs

# 只跑新契约，不带 A 基线
node games/boardgame/tests/run-all.mjs --no-baseline

# 严格模式：任何 SKIP 都视为失败（CI 用来防止模块被悄悄漏掉）
node games/boardgame/tests/run-all.mjs --strict

# 只跑某一层/某个文件
node games/boardgame/tests/run-all.mjs --filter=engine
node games/boardgame/tests/data-build.test.mjs

# A 移交的基线门禁（可在不跑新契约时单独使用）
node games/boardgame/tests/run.js
```

输出约定：

- 每个测试文件最后一行是 `RESULT: N passed, M failed, K skipped`。
- runner 汇总后再输出同名格式的一行，`K` 是所有测试文件中被跳过的契约数量。
- 断言失败、子进程崩溃、超时、没有 `RESULT` 行 → exit 1。
- `--strict` 时 `K > 0` 也 exit 1。

零外部依赖、零外网：只用 Node 24 内置模块与 `fetch`（仅 loopback）。
`pages-static.test.mjs` 的浏览器部分用本机 Chrome headless + CDP（`lib/browser.mjs`，
唯一允许的“外部”工具）；未安装 Chrome 时该组 SKIP，不影响其余断言。

## 3. missing-module 策略（重要）

1. **模块不存在** → `SKIP`，并在输出中列出探测过的路径：`SKIP: ... — none of app/audio.mjs, ... exist yet`。
   默认 SKIP 不算失败，`--strict` 才失败。
2. **模块存在但导出不匹配** → `FAIL`。模块已经落地却不满足契约，属于合并阻塞，不允许静默跳过。
3. **模块存在但 import 抛错** → `FAIL`，错误信息带堆栈。

模块探测路径（相对 `games/boardgame/`）：

| 契约 | 探测顺序 |
|---|---|
| audio | `app/audio.mjs` `app/audio.js` `app/engine/audio.mjs` `app/engine/audio.js` `app/sound.mjs` `app/lib/audio.mjs` |
| physics | `app/physics.mjs` `app/physics.js` `app/engine/physics.mjs` `app/engine/physics.js` `app/game/physics.mjs` |
| card battle | `app/card-battle.mjs` `app/card-battle.js` `app/cardBattle.mjs` `app/games/card-battle.mjs` `app/games/pokemon.mjs` |
| mahjong | `app/mahjong.mjs` `app/mahjong.js` `app/games/mahjong.mjs` `app/games/mahjong.js` |
| rooms | `app/rooms.mjs` `app/net/rooms.mjs` `app/network/rooms.mjs` `app/multiplayer/rooms.mjs` `worker/rooms.mjs` `server/rooms.mjs` |
| retention | `app/retention.mjs` `app/rewards.mjs` `app/retention/rewards.mjs` `app/lib/retention.mjs` |
| 页面产物 | `index.html` + `board/<slug>.html`（`build.mjs` 生成，缺失时 FAIL） |
| dsh plugin | `plugin/manifest.json` `plugin/dsh-plugin.json` `dsh/manifest.json` `plugin.json` `dsh-plugin.json` `dsh.plugin.json` |
| AI HTTP | `BOARDGAME_AI_BASE_URL` / `BOARDGAME_API_BASE_URL` / `BOARDGAME_SERVER_URL`，否则 loopback 8787/8788/3000 的 `/health`、`/api/health`、`/`（必须返回 JSON） |

## 4. 未来模块的契约摘要

测试会优先使用首选导出名，同时接受一组别名（见 `lib/contracts.mjs`）。当前已兼容两种实现形态：

- **audio**：工厂 `createAudioManager(options)` 或 `class AudioManager`。实例方法 `play`、`mute`、`setVolume`、`isMuted`、`enable/disable`；`init` 可用 `_ensureContext`。没有显式 `unlock` 时，要求 `play()` 自行 resume（已用假 `AudioContext` 验证）。导入/构造不得自动发声。
- **physics**：纯函数 `aabbOverlap`/`aabbIntersects`、`circleAabbCircle`、`pointInAabb`；移动支持两种模型：`moveCharacter(state,input,dt,bounds)`，或 `createWorld({bounds})` + `createBody({vx,vy})` + `world.step(dt)`；发牌支持状态机 `createDealAnimation`，或 `dealPlan({count,...})` + `createTween`。
- **card battle**：以 C 的 `engine/card-battle.js` 为准：**20 张牌库 / 起手 5 / 先到 3 分获胜**。`createGame`、`playCard`、`attachEnergy`、`attack`、`useItem`、`endTurn`、`legalActions`、`aiAction`、`applyAction`、`winner`；弱点双倍伤害、击倒得 1 分。《宝可梦 TCG 60 张 / 起手 7 / 6 奖赏卡》fixture 仅作历史样例，不再作为卡牌契约；`gameplay-card-battle.test.mjs` 已改写为 20/5/3。
- **mahjong**：`buildWall()`（136 张 = 34 种 × 4）、`createGame({seed})` 或 `dealHands`、`draw`、`discard`、`canWin(tiles)`、`evaluateHand(tiles)`；牌面统一用 `1m`–`9m` / `1p`–`9p` / `1s`–`9s` / `1z`–`7z`。
- **rooms**：支持模块级 `createRoom`/`joinRoom`/…，也支持 `createRoomStore({now,rng})` 返回 `create/join/invite/verifyInvite/consumeInvite/kick/close/get`。密码只验证哈希、不落明文；邀请 token 验证；`store.voice` 为空时语音子契约 SKIP。
- **retention**：拆成三个独立模块探测——`app/retention.*`（daily/streak/lossAversion 状态机）、`app/rewards.*`（积分/等级/奖杯）、`app/leaderboard.*`（榜单/匿名设备 id/防作弊）。没有 share 导出时分享子契约 SKIP。
- **AI API**：`POST /api/matches`、`GET /api/matches/:id`、`GET /api/matches/:id/actions`、`POST /api/matches/:id/actions`、`POST /api/ai/evaluate`，全部 JSON。仅对 loopback 服务或显式 `BOARDGAME_AI_BASE_URL` 运行。
- **dsh plugin**：manifest 含 `id`、`version`（semver）、`main`、`capabilities`、`errorCodes`；入口导出 `activate`/`deactivate`/`invoke`，未知工具返回 `E_UNKNOWN_TOOL`。
- **页面产物**：`build.mjs` 生成 `index.html` + `board/<slug>.html`；除 44 页/筛选/详情/零外链外，还硬性要求 JSON-LD（列表 `CollectionPage` + `ItemList`、详情 `Article` + `BreadcrumbList`）与 390/320 无溢出、深色模式、零外部请求、零 console error。

## 5. 角色边界（CONTRACT.md）

- **A 数据**：`data/`、`schema/`。本目录只读其产物，不写。
- **B 页面**：`app/`（`app/build-pages.mjs` 生成的 `pages/` 副本已删除，页面真源是 `build.mjs` 的 `index.html` + `board/`）。本目录只探测 `app/`，不写；模块契约通过 `lib/contracts.mjs` 与本文档沟通。
- **C 采集与测试**：`collector/`、`tests/`。本会话负责两者；测试只读 `collector/fixtures` 与
  `collector/out`，不在测试里写采集产物。`collector/README.md` 记录 gstone 主数据源与 BGG 补充管线。
- 共享文件 `README.md`、`package.json` 不改；需要改时按 CONTRACT 在 `LOCK.md` 登记。

## 6. fixtures

- `fixtures/pokemon-sample.json`：13 张样板卡（12 张宝可梦 + 1 张基本能量），保留自 50bdc849 的历史 60/7/6 契约样例。当前卡牌契约已改为 C 的 20/5/3（`data/cards.json` + `engine/card-battle.js`），该 fixture 不再用于卡牌规则断言。
- `fixtures/ai-scenarios.json`：创建对局、读状态、读合法动作、提交动作、AI 评估五个 HTTP 场景及期望状态码/字段。

fixtures 是**输入数据**，不是游戏实现。
