# 黑白棋 · Reversi Premium — 验收清单

## 五项硬性要求

| 项 | 命令 / 证据 | 结果 |
|---|---|---|
| 流程 | `node games/boardgame/reversi-premium/test.js`；`node games/tests/run-all.js` | 单测 182/0；`--control` exit 1（预期） |
| 精美 | `art` gate 行；`cover.webp` / `og.webp` / `detail.webp` | 本地真实 raster，代码合成局面，Songti SC 700 |
| 真实 | `realism.json` | 6 类检查全部 ok；8×8 / 30mm 双面棋子 / 8 方向夹击 |
| 手机 | `game-smoke.mjs` 390×844 与 320×568 | 由集成方统一串行复跑；棋盘格用 gridcell，主按钮 ≥44px |
| 联机 | `node games/boardgame/reversi-premium/test-online.js` | 102/0；双客户端同局、落子翻面同步、结算一致、重连、托管、榜单、重赛 |

## 故意失败对照

- `node games/boardgame/reversi-premium/test.js --control` → exit 1（预期）。
- `node games/boardgame/reversi-premium/test-online.js --control` → exit 1（预期）。

## 单测覆盖

- 开局四子位置、黑先、4 个合法首着。
- 四方向与多方向同时翻面、贴边/角位、断开线、越界与已占格。
- 落子后比分/回合/历史/最后一手更新；`applyMove` 不修改入参；`undo` 还原。
- 无合法点 pass、双方无合法点终局、满盘平局。
- AI 三档合法性、确定性、抢角、无子可下返回 pass。
- 完整自对弈终局、历史重放一致、`publicState` 可序列化。
- 页面/规则/联机文件契约、meta/realism/perf/online-e2e JSON、UMD 与零外链。
- `PERF_BUDGET`：500 局创建、2000 次合法点、30 步普通 AI、5 步困难 AI、500 次 publicState。

## 联机 E2E 覆盖

- 创建 2 人房、邀请加入、邀请单次使用、第三人 `E_FULL`。
- 密码房错误/正确密码、私密房非成员 `E_PRIVATE`、PII `E_PII`。
- 非房主开局 `E_HOST`；双客户端同棋盘/同回合。
- 合法落子与翻面同步；越权 `E_TURN`、非法 `E_ACTION`、坏 session `E_SESSION`。
- 重连与坏 token；闲置超时 `takeoverSeats` 与重连清除。
- 完整对局到终局，双方棋盘/比分/结果一致；榜单、房主重赛、离开转 AI、房主关房。

## 证据文件

- `DESIGN.md`、`E2E.md`、`realism.json`、`perf.json`、`meta.json`、`online-e2e.json`
- `online-server.mjs`、`online.html`、`test-online.js`
- 美术：`games/assets/art/premium/reversi/{disc-black,disc-white,table-felt,table-wood,cover,og,detail}.webp`

## 状态

五项全部通过后由集成方把 `meta.json.status` 改为 `shipped`；任一缺失保持 `draft`。

## 三行 HANDOFF

- 状态：draft；单测 182/0、联机 102/0 已实跑；390/320 冒烟由集成方串行复跑。
- 关键：`engine.js` 为规则单一来源，联机薄封装共享 `../app/online-game.mjs`；2 人房、翻面/跳过/终局、重连/托管/榜单/重赛。
- 待办：gen-precache 后确认 `precache-manifest.js` 含 reversi-premium 入口与材质；五项全过后把 `meta.json.status` 改为 shipped。

## 集成方复跑（2026-11-10）

五项门禁全部通过，`verify-shipped` 行为 `status=shipped`，`gates` 五项均为 true。

| 门禁 | 结果 | 证据 |
|---|---|---|
| 流程 | PASS | `test.js` 185/0；`test-online.js` 102/0；两个 `--control` 均 exit 1；run-all 568 文件 / 93917 断言 / 0 失败 |
| 精美 | PASS | art gate 本行 `ok:true`；cover 1200×1200、OG 1200×630、detail 1536×1024；材质 WebP 本地引用 |
| 真实 | PASS | realism gate 本行 `ok:true`；`realism.json` 6 项 checks，覆盖 count/dimension/proportion/color/material/rule |
| 手机 | PASS | `game-smoke.mjs` 390×844 PASS 19 checks / 0 failures；320×568 PASS 19 checks / 0 failures；无横向滚动、外部请求 0、console error 0、异常 0 |
| 联机 | PASS | online gate 本行 `ok:true`；双客户端/4 客户端 E2E 纳入 run-all；断线重连、超时托管、榜单、重赛均覆盖 |

预缓存清单：`games/sw.js` 保持 `CACHE_VERSION = v22`；`node scripts/gen-precache.js` 后，`games/precache-manifest.js` 含 `reversi-premium/` 入口、`online.html`、`rules.html`、`engine.js`、`data.js`、`meta.json`，以及 cover.webp、og.webp、detail.webp、disc-black.webp、disc-white.webp、table-felt.webp、table-wood.webp。`test.js` 的 SW 交叉校验已由 PENDING 转为强制断言并通过。

集成后 `meta.json.status` 已改为 `shipped`；未推 main，仅推分支 `boardgame/d686a4ca-b6-g7`。
