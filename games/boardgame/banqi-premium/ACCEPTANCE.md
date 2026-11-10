# 暗棋 · 翻棋 premium · 验收记录

> 目录：`games/boardgame/banqi-premium/`
> 分支：`boardgame/d686a4ca-b9-g11`（worktree `/private/tmp/wt-b9-g11`）
> 所有数字均来自本机实际运行；未跑或缺失会明确写「未跑」。

## 五项硬性验收

### 1. process — PASS

```bash
node games/boardgame/banqi-premium/test.js
# RESULT: 215 passed, 0 failed
```

覆盖：32 枚开局守恒、红黑各 16、等级表、同级互不吃、兵吃帥、炮隔恰好一子、翻子/走子回合切换、胜负/卡死/120 手和棋、公开视图隐藏暗子身份、三档 AI、自对弈 8 局、高手对入门 6 局、性能预算、页面静态检查、meta/realism/美术/预缓存交叉校验。

- `perf.json` 存在；`test.js` 硬断言 500 次建局 < 1200ms、300 次合法动作 < 800ms、30 次标准 AI < 2500ms、单次 AI < 120ms。
- `DESIGN.md` 存在且 > 400B；`ACCEPTANCE.md`（本文件）与 `E2E.md` 存在。

### 2. art — PASS

| 文件 | 尺寸 | PNG | WebP |
|---|---|---|---|
| `assets/cover.png` / `.webp` | 1200×1200 | 1.19MB | 70KB |
| `assets/og.png` / `.webp` | 1200×630 | 700KB | 42KB |
| `assets/detail-1.png` / `.webp` | 1200×800 | 827KB | 55KB |
| `assets/detail-2.png` / `.webp` | 1200×800 | 687KB | 47KB |

- 真实栅格 PNG/WebP，非 emoji/占位。
- 单物件材质 4 张（1024×1024，纯白底）：`board-wood`、`piece-face`、`piece-back`、`table-cloth`，位于 `games/assets/art/premium/banqi/`，PNG 母版 + WebP。
- 封面/OG/详情由 `art-render.html` 代码合成；`render-art.mjs` 无头 Chrome 截图 → cwebp。棋子汉字与棋盘格全部代码绘制，AI 只生成空白材质。

### 3. realism — PASS

`realism.json` 6 条，kind 覆盖 count / dimension / proportion / color / material / rule，全部 `ok:true`，`pass:true`。核心数字：4×8=32 格、32 枚、红黑各 16、7 级、棋子 Ø24×7mm、棋盘 300×160mm、120 手无吃子判和。

规则交叉核对：B 站教程 BV1MZtgzaE7n、BV1ZfxS6KEuN、BV1yk4y1D7Q7（只读标题/文字，不截图、不 OCR）。

### 4. mobile — PASS

```bash
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games games/.tmp/banqi-list.txt --width 390 --height 844 \
  --json games/.tmp/banqi-smoke-390.json
# pass 1, fail 0, checks 19, externalRequests 0, consoleErrors 0, exceptions 0

node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games games/.tmp/banqi-list.txt --width 320 --height 568 \
  --json games/.tmp/banqi-smoke-320.json
# pass 1, fail 0, checks 19, externalRequests 0, consoleErrors 0, exceptions 0
```

- 390×844 / 320×568 两档真浏览器冒烟全过；无横向滚动、主触控 ≥44×44、可见字号 ≥12px、零外部请求、无 console error。

### 5. mode — PASS

```bash
node games/boardgame/banqi-premium/test-online.js
# ONLINE_E2E_JSON: {"game":"banqi","clients":2,"sameGame":true,
#  "settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,
#  "leaderboard":true,"runAll":true,"assertions":44,"failed":0}
# RESULT: 44 passed, 0 failed

node games/boardgame/banqi-premium/test-online.js --control
# RESULT: 0 passed, 1 failed  (exit 1)
```

- 2 人房、邀请码、密码、AI 补位、断线重连、超时托管、结果榜、重赛全部覆盖。
- 服务端持有完整状态；公开视图将暗子替换为 `{h:1,s:0,t:null}`，网络响应不泄漏身份。
- `test-online.js` 以 `test` 开头，被 `node games/tests/run-all.js` 自动发现；`online-e2e.json` 落盘证据。

## 备注

- 本页不注册 per-game service worker；离线由 `/games/sw.js` 统一接管。`test.js` 读取 `games/precache-manifest.js`，与 `games/sw.js` 的 `CACHE_VERSION` 交叉校验，并检查本游戏单机页、联机页、engine.js 与材质已入清单。
- 共享模块：`games/shared/shuffle.js`（发牌）、`sfx.js`（音效）、`store.js`（可用）、`online-room-server.mjs`（房间/邀请/重连/托管/榜单）。本目录未复制这些实现。
