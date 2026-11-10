# 政变 · COUP PREMIUM — 验收记录

- 工作区：`/private/tmp/wt-b2-g2`，分支 `boardgame/d686a4ca-b2-g2`
- Node：`v24.12.0`（`export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"`）
- 日期：2026-11-10
- 状态：**shipped 候选**。五项本地验收实际跑通；官方 `verify-shipped` 门禁由 lead 运行，本文件不声称官方 gate 已通过。

## 1. process

```bash
node games/boardgame/coup-premium/test.js
# RESULT: 450 passed, 0 failed

node games/boardgame/coup-premium/e2e.mjs
# RESULT: 183 passed, 0 failed
# PERF {"fcp":72,"domContentLoaded":22,"loadEventEnd":26,"domNodes":266,"materialBytes":496920,"externalRequests":0,"fps":60,"newGameRenderMs":1.8,"pureMoveMs":1}

node games/boardgame/coup-premium/e2e.mjs --control
# RESULT: 0 passed, 1 failed   (exit 1，故意失败对照)
```

- `perf.json` 存在，预算与实测齐全。
- `DESIGN.md` 4,097B（≥400B）。
- `ACCEPTANCE.md` 为本文件。
- 单测覆盖 2/3/4/5/6 人、15 张牌守恒、七行动、挑战真假、暗杀费用不退、阻挡/阻挡挑战、交换洗回、淘汰、牌堆耗尽重洗、胜负、非法动作、三档 AI 与 30 局 AI 自对弈。

## 2. art

| 文件 | 像素 | 体积 | 门槛 |
|---|---|---|---|
| `assets/cover.png` | 1200×1200 | 1,555,819 B | ≥600×400 / ≥8KB |
| `assets/cover.webp` | 1200×1200 | 196,308 B | 同上 |
| `assets/og.png` | 1200×630 | 852,133 B | ≥1000×500 / ≥15KB |
| `assets/og.webp` | 1200×630 | 122,762 B | 同上 |
| `assets/detail-1.png` | 1200×800 | 982,407 B | ≥600×400 / ≥8KB |
| `assets/detail-1.webp` | 1200×800 | 108,580 B | 同上 |
| `assets/detail-2.png` | 1200×800 | 1,024,461 B | ≥600×400 / ≥8KB |
| `assets/detail-2.webp` | 1200×800 | 96,232 B | 同上 |

- 8 个单物件材质在 `games/assets/art/premium/coup/`，均为 1024×1024 PNG 母版 + WebP（`cwebp -q 86`）：`card-back`、`coin`、`velvet`、`dagger`、`crown`、`mask`、`scroll`、`table-wood`。
- 角色图案、文字、局面、封面排版全部由 `art-render.html` 代码合成；封面/OG/详情均固定展示 **15 张身份牌、6 个席位、每席 2 枚金币**（e2e 实测 counts）。
- 复现命令：`node games/boardgame/coup-premium/render-art.mjs`。

## 3. realism

```bash
node -e "const r=require('./games/boardgame/coup-premium/realism.json'); console.log(r.checks.length, r.checks.map(c=>c.kind))"
# 6 [ 'count', 'dimension', 'proportion', 'color', 'material', 'rule' ]
```

`realism.json`：6 条检查、6 种 `kind`，全部 `ok:true`；覆盖 15 张牌/五角色×3、63×88mm 卡牌与 Ø39mm 金币、2–6 人牌堆张数、暗红/黄铜色板、官方卡纸与高级版黄铜/丝绒材质、完整规则。

## 4. mobile

```bash
printf 'coup-premium\n' > /tmp/coup-premium-list.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/coup-premium-list.txt --width 390 --height 844 --json /tmp/coup-premium-smoke-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/coup-premium-list.txt --width 320 --height 568 --json /tmp/coup-premium-smoke-320.json
```

真实结果（两份 JSON 的 `summary`）：

- 390×844：`pass:1, fail:0, checks:19, failedChecks:0, externalRequests:0, consoleErrors:0, exceptions:0` → **PASS**
- 320×568：同上 → **PASS**

`e2e.mjs` 另在 390×844、320×568、844×390、568×320 四个视口断言：无横向滚动、所有可见 `button/a` ≥44×44、所有可见文字 ≥12px、六席不重叠且不出屏、行动可达、`100dvh` 生效、触屏/窄屏关闭 `backdrop-filter`。

## 5. mode（联机）

```bash
node games/boardgame/coup-premium/test-online.js
# ONLINE_E2E_JSON: {"game":"coup","clients":3,"sameGame":true,"settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"runAll":true,...,"result":"117 passed, 0 failed","exitCode":0}
# RESULT: 117 passed, 0 failed

node games/boardgame/coup-premium/test-online.js --control
# RESULT: 0 passed, 1 failed   (exit 1)
```

- 三客户端同局（clients=3），服务端权威判定；`online-server.mjs` 复用 `../app/rooms.js`，未修改共享文件。
- 覆盖：邀请、密码房、AI 补位、越回合/非法动作拒绝、私有视图、断线重连、超时托管、完整对局至结算、结果榜、重赛、离座转 AI、关房。
- `online-e2e.json` 已写入相同字段与证据。
- `index.html` 支持 `?room=&session=&player=` 进入联机牌桌；`online.html` 为创建/加入大厅。

## 缺口 / 说明

- 官方 `verify-shipped` 未在本轮运行，状态为候选；未 commit / 未 push。
- 浏览器验证为桌面 Chrome 设备模拟（CDP 9222），未在真实 iOS/Android 设备上跑触摸。
- `online.html` 是建房/加入大厅；实际联机牌桌复用 `index.html` 的在线模式（同一 engine 与私有视图），双/三客户端同局由 `test-online.js` 验证。
- `perf.json` 的 `materialBytes` 是首屏实际解码的三张材质（card-back/coin/velvet）大小；八张材质均由 SW 预缓存。
