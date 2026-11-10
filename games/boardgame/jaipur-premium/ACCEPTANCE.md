# 斋普尔 Jaipur premium · 验收记录

> 目录：`games/boardgame/jaipur-premium/`
> 分支：`boardgame/d686a4ca-b2-g2`（worktree `/private/tmp/wt-b2-g2`）
> 状态：**shipped 候选，等待 lead 跑官方 verify-shipped 门禁**。
> 所有数字均来自本机实际运行，未编造。

## 五项硬性验收

### 1. process — PASS

```bash
node games/boardgame/jaipur-premium/test.js
# RESULT: 333 passed, 0 failed
```

- `test.js` 覆盖：55 张牌 / 38 枚货物代币 / 18 枚奖励代币守恒、200 个 seed 开局、三档 AI、30 局 AI 自对弈、轮结束、Seal、三段平局、非法动作、公开视图遮罩、性能预算。
- `perf.json` 存在，实测 FCP 80ms、DCL 30ms、load 30ms、DOM 419 节点、rAF 62fps、新局渲染 0.7ms、单步 0.8ms、材质 1,091,308 bytes、外部请求 0。
- `e2e.mjs`：`RESULT: 176 passed, 0 failed`。
- `DESIGN.md` 9.6KB（>400B）；`ACCEPTANCE.md` / `E2E.md` 存在。

### 2. art — PASS

| 文件 | 尺寸 | PNG 体积 | WebP 体积 |
|---|---|---|---|
| `assets/cover.png` / `.webp` | 1200×1200 | 1.49MB | 122KB |
| `assets/og.png` / `.webp` | 1200×630 | 774KB | 77KB |
| `assets/detail-1.png` / `.webp` | 1200×800 | 907KB | 54KB |
| `assets/detail-2.png` / `.webp` | 1200×800 | 922KB | 61KB |

- 真实栅格 PNG/WebP，非 emoji/占位。
- 单物件材质 8 张（1024×1024、纯白底、无文字）：`card-paper`、`camel`、`token-gold`、`token-silver`、`silk`、`spice`、`leather`、`table-sand`，位于 `games/assets/art/premium/jaipur/`，PNG 母版 + WebP。
- 封面/OG/详情由 `art-render.html` 代码合成；e2e 实测封面含 5 张市场牌、40 张牌堆、38 枚货物代币、18 枚奖励代币、9 张骆驼图（3 市场 + 6 骆驼群）、Seal。

### 3. realism — PASS

`realism.json` 6 条，`kind` 覆盖 count / dimension / proportion / color / material / rule，全部 `ok:true`，`pass:true`。核心数字：55 张牌、38 枚货物代币、18 枚奖励代币（3 档 × 6 枚）、11 只骆驼、市场 5、开局 3 骆驼 + 翻 2、手牌上限 7、牌堆 40、骆驼 +5、先拿 2 Seal。

> 规格说明：用户文字同时写了「18 枚」与「三档各 3 枚」，二者算术矛盾。本实现按 18 枚总数组件数与三档 {1,2,3}/{4,5,6}/{8,9,10} 实现为「每档 3 种面值 × 每种 2 枚 = 6 枚/档」，合计 18 枚。若必须改为每档 3 枚，只需把 `engine.js` 的 `BONUS_VALUES` 改成单份并把 `BONUS_PER_TIER` 改为 3。

### 4. mobile — PASS

```bash
printf 'jaipur-premium\n' > /tmp/jaipur-list.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/jaipur-list.txt --width 390 --height 844 --json /tmp/jaipur-smoke-390.json
# jaipur-premium PASS []  | summary: pass 1, fail 0, checks 19, externalRequests 0, consoleErrors 0, exceptions 0

node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/jaipur-list.txt --width 320 --height 568 --json /tmp/jaipur-smoke-320.json
# jaipur-premium PASS []  | summary: pass 1, fail 0, checks 19, externalRequests 0, consoleErrors 0, exceptions 0
```

- 390×844 / 320×568 真浏览器冒烟全过；无横向滚动、主触控 ≥44×44、可见字号 ≥12px、零外部请求、无 console error。
- e2e 额外覆盖 844×390 / 568×320 横屏、安全区、100dvh、触屏关闭 backdrop-filter。

### 5. mode — PASS

```bash
node games/boardgame/jaipur-premium/test-online.js
# ONLINE_E2E_JSON: {"game":"jaipur","clients":2,"sameGame":true,"settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"runAll":true,"test":"test-online.js","server":"online-server.mjs","client":"online.html","result":"87 passed, 0 failed","exitCode":0}
# RESULT: 87 passed, 0 failed

node games/boardgame/jaipur-premium/test-online.js --control
# RESULT: 0 passed, 1 failed  (exit 1)

node games/boardgame/jaipur-premium/e2e.mjs --control
# RESULT: 0 passed, 1 failed  (exit 1)
```

- 2 人房，复用 `../app/rooms.js`；邀请码单次使用、密码房、空位 AI 补位、服务端权威判定、断线重连、超时托管、结果榜、重赛、离座转 AI、关房、双客户端同局结算一致。
- `online-e2e.json` 写入完整字段。

## 已知缺口 / 说明

1. **奖励代币数量口径**：见上，规格内部矛盾；本实现按官方 18 枚、每档 6 枚（3 种面值各 2 枚）落地，并在 `realism.json` / `DESIGN.md` / `rules.html` 记录。
2. **联机同步**：HTTP 轮询（1.2s），不是 WebSocket；本地 Node 服务器、内存房间，重启即丢失。与样本 azul-premium 一致。
3. **AI 强度**：三档启发式经 40–60 局对局调参；老练档对标准档约 35:25（seed 4000–4059），对轻松档 35:5（seed 4000–4039）。不是穷举最优。
4. **货物图案**：代码合成 SVG；单物件材质来自 img-gen；未使用外部图标库。
5. **手机点击交换**：交换需先选市场 ≥2 张，再点手牌/骆驼返还同张数；比单机版取牌多一步，属于规则本身的多选操作。
6. 未 commit、未改共享文件；`games/shared/**`、`games/boardgame/app/**`、`scripts/**` 保持原样。

## 关键文件

- 规则引擎：`engine.js`（UMD，Node `require` 可跑）
- 单人 + 联机对局页：`index.html`
- 联机大厅：`online.html`
- 联机服务端：`online-server.mjs`
- 规则页：`rules.html`
- 单元测试：`test.js`（333）
- 联机 E2E：`test-online.js`（87）
- 浏览器 E2E：`e2e.mjs`（176）
- 美术合成：`art-render.html`、`render-art.mjs`
- 素材：`games/assets/art/premium/jaipur/`
- 证据：`realism.json`、`perf.json`、`meta.json`、`online-e2e.json`、`E2E.md`
