# 五子棋 · 精美版 Gomoku Premium — ACCEPTANCE

> 目录：`games/boardgame/gomoku-premium/`
> 分支：`boardgame/d686a4ca-b6-g7`
> 日期：2026-11-10

## 0. 结论

本目录实现与本地测试已完成。按集成方要求，**390×844 / 320×568 浏览器冒烟、art gate、realism gate、run-all、gen-precache 由集成方最后串行统一执行**；本文件只记录本目录实际跑过的命令与结果，不把待跑项写成已通过。

| 门禁 | 本目录结果 | 证据 |
|---|---|---|
| 流程 | 本地通过 | DESIGN.md、engine.js、test.js、test-online.js、`--control` |
| 精美 | 本地产物完成，待 art gate | cover/OG/detail、材质 webp、art-render.html |
| 真实 | 本地通过 | `realism.json` 6 项 checks，覆盖 count/dimension/proportion/color/material/rule |
| 手机 | 待集成方统一冒烟 | 页面已按 390/320、44px、12px、100dvh 实现 |
| 联机 | 本地通过 | `test-online.js` 90 passed / 0 failed；双客户端真实 HTTP |

## 1. 单元测试

```
node games/boardgame/gomoku-premium/test.js
```

结果：

```
总计: 137 通过, 0 失败
RESULT: 137 passed, 0 failed
```

覆盖：15×15 / 225 交点、黑先、四方向五连、贴边长连、断线不算、满盘平局、applyMove 不可变、非法动作、AI 三档合法性与确定性、静态契约、SW 版本交叉校验、性能预算。

性能实测（`PERF_BUDGET`）：

```
create500=0.259ms apply10=0.035ms legal1000=14.846ms
ai={"easy":1.878,"normal":23.576,"hard":25.845}
```

（数值随机器浮动，来源为 test.js 本次实际输出；`perf.json` 记录同一次运行。）

## 2. 对照失败

```
node games/boardgame/gomoku-premium/test.js --control
```

退出码 **1**，比正常运行多 1 条故意失败：

```
RESULT: 137 passed, 1 failed
```

## 3. 双客户端联机 E2E

```
node games/boardgame/gomoku-premium/test-online.js
```

结果：

```
HTTP 请求数: 60+
RESULT: 90 passed, 0 failed
ONLINE_E2E_JSON: {"game":"gomoku","clients":2,"sameGame":true,"settlementConsistent":true,
"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"runAll":true, ...}
```

覆盖：health、创建/邀请加入、第三人 `E_FULL`、密码房错误/正确密码、单人房主不能开局 `E_PLAYERS`、房主开局、双方同局同手数、落子同步、越权/重复落子拒绝、重连、坏 token、完整五连终局、双方结算一致、榜单、重赛、离开转 AI 且 AI 落子、idle 超时托管与重连清除、关闭房间。

对照：

```
node games/boardgame/gomoku-premium/test-online.js --control
```

退出码 **1**。

## 4. 美术产物

| 文件 | 尺寸 | 字节 |
|---|---|---|
| `cover.webp` | 1200×1200 | ~158KB |
| `og.webp` | 1200×630 | ~92KB |
| `detail.webp` | 1536×1024 | ~171KB |
| `stone-black.webp` | 512×512 | ~25KB |
| `stone-white.webp` | 512×512 | ~15KB |
| `goban-wood.webp` | 1024×1024 | ~182KB |
| `walnut-wood.webp` | 1024×1024 | ~139KB |

`index.html` 通过 `og:image`、`twitter:image` 与隐藏 `asset-refs` 引用 cover/detail；CSS 使用木纹与棋子材质。art gate 由集成方统一跑。

## 5. 真实性与规则

- 15×15、225 交点、5 个星位；黑先；自由规则无禁手；连续五子或更多胜；满盘平局。
- 棋子 Ø22mm、厚 10mm；盘面网格 22mm；材质为榧木、那智黑石、蛤碁石。
- 规则页明确写出自由规则与竞技禁手/交换开局的差异，不把自由规则误写成竞技规则。
- B 站来源：BV1wS4y1D7uT、BV1q54y1o7HQ、BV1dmxX63ETv、BV1Qt411n7Y4。

## 6. 待集成方执行

1. `node games/tests/run-all.js` — 本目录两个 test 文件纳入且 0 失败。
2. `node games/boardgame/scripts/game-smoke.mjs` 390×844 与 320×568 — 本页串行跑。
3. `verify-shipped` 的 art / realism / mobile / online 四项 — 本目录行 `ok:true`。
4. `node scripts/gen-precache.js` — 把本目录页面、engine/data、封面/OG/材质写入 manifest；test.js 的 SW 交叉校验会由 PENDING 转为强制断言。
5. 集成完成后把 `meta.json.status` 从 `draft` 改为 `shipped`。

## 集成方复跑（2026-11-10）

五项门禁全部通过，`verify-shipped` 行为 `status=shipped`，`gates` 五项均为 true。

| 门禁 | 结果 | 证据 |
|---|---|---|
| 流程 | PASS | `test.js` 138/0；`test-online.js` 90/0；两个 `--control` 均 exit 1；run-all 568 文件 / 93917 断言 / 0 失败 |
| 精美 | PASS | art gate 本行 `ok:true`；cover 1200×1200、OG 1200×630、detail 1536×1024；材质 WebP 本地引用 |
| 真实 | PASS | realism gate 本行 `ok:true`；`realism.json` 6 项 checks，覆盖 count/dimension/proportion/color/material/rule |
| 手机 | PASS | `game-smoke.mjs` 390×844 PASS 19 checks / 0 failures；320×568 PASS 19 checks / 0 failures；无横向滚动、外部请求 0、console error 0、异常 0 |
| 联机 | PASS | online gate 本行 `ok:true`；双客户端/4 客户端 E2E 纳入 run-all；断线重连、超时托管、榜单、重赛均覆盖 |

预缓存清单：`games/sw.js` 保持 `CACHE_VERSION = v22`；`node scripts/gen-precache.js` 后，`games/precache-manifest.js` 含 `gomoku-premium/` 入口、`online.html`、`rules.html`、`engine.js`、`data.js`、`meta.json`，以及 cover.webp、og.webp、detail.webp、stone-black.webp、stone-white.webp、goban-wood.webp、walnut-wood.webp。`test.js` 的 SW 交叉校验已由 PENDING 转为强制断言并通过。

集成后 `meta.json.status` 已改为 `shipped`；未推 main，仅推分支 `boardgame/d686a4ca-b6-g7`。
