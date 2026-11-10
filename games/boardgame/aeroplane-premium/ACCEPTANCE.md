# 飞行棋 · 52 格彩环 · 验收记录

> 目录：`games/boardgame/aeroplane-premium/`
> 分支：`boardgame/d686a4ca-b9-g11`（worktree `/private/tmp/wt-b9-g11`）
> 所有数字均来自本机实际运行；未跑或缺失会明确写「未跑」。

## 五项硬性验收

### 1. process — PASS

```bash
node games/boardgame/aeroplane-premium/test.js
# 总计: 495 通过, 0 失败
# RESULT: 495 passed, 0 failed
```

覆盖：真实 52 格环（坐标唯一、四色各 13）、4 基地 × 4 机位、4 条 6 格归航道、中心 2×2、2/3/4 人开局与 16 架守恒、掷 6 起飞、再掷与三连 6 惩罚、同色跳 4（不连锁）、虚线捷径 +12、撞机回基地（含整格多架）、己方同格叠放、归航道/终点安全区、精确终点与超出退回、胜负与多人排名、三档 AI、2/3/4 人自对弈、高手对入门 8 局、骰子同种子可复现/不同种子不同/6000 次分布、服务端骰子不可由客户端指定、publicView 不含 seed/rngState/未来随机、性能预算、页面静态、meta/realism/美术/预缓存交叉校验。

- `perf.json`：500 次建局 1ms、500 次动作枚举 0ms、30 次标准 AI 1ms、单次 AI 0.03ms、6000 次掷骰 0ms、engine 30,864B，均低于预算。
- `DESIGN.md` 存在；`ACCEPTANCE.md`（本文件）与 `E2E.md` 存在。

### 2. art — PASS

| 文件 | 尺寸 | PNG | WebP |
|---|---|---|---|
| `assets/cover.png` / `.webp` | 1200×1200 | 1.27MB | 80KB |
| `assets/og.png` / `.webp` | 1200×630 | 698KB | 52KB |
| `assets/detail-1.png` / `.webp` | 1200×800 | 846KB | 68KB |
| `assets/detail-2.png` / `.webp` | 1200×800 | 715KB | 45KB |

- 真实栅格 PNG/WebP，非 emoji/占位。
- 单物件材质（1024×1024，PNG 母版 + WebP）：`plane-token-red/yellow/blue/green`（RGBA 透明抠图，中心 alpha 255、四角 0）、`dice`（RGBA）、`board-gloss`、`table-felt`，位于 `games/assets/art/premium/aeroplane/`。游戏中与封面/详情图里可见的飞机 token 为代码绘制的完整俯视轮廓（机头/双翼/尾翼），四色材质图作为贴图参考，避免任何裁切。
- 封面/OG/详情由 `art-render.html` 代码合成：52 格彩环、4 基地、4 条 6 格归航道、中心终点、16 架飞机、代码点阵骰子全部由代码绘制；封面为开局 4×4（每基地 4 架），详情 1 为真实中盘。
- 抠图使用 `games/assets/art/2048/materials/cutout.py` silhouette 模式；骰子点阵在封面/详情由代码绘制（6/2/4，相对面之和 7），`dice.webp` 作为 16mm 材质参考；detail-2 四架飞机为 180px 完整 SVG 轮廓。

### 3. realism — PASS

`realism.json` 6 条，kind 覆盖 count / dimension / proportion / color / material / rule，全部 `ok:true`，`pass:true`。核心数字：52 格、四色各 13 格、4 基地、4 条 6 格归航道、每色 4 架、四人局 16 架、飞机 24mm、骰子 16mm、棋盘 330×330mm、精确终点、同色 +4、捷径 +12、三连 6 惩罚。

规则交叉核对：B 站教程 BV1AK4y187Pt、BV1Fb4y1p7e7、BV1M24y1r7HK、BV1k48wzqELM（只读标题/文字，不截图、不 OCR）。

### 4. mobile — PASS

```bash
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games games/.tmp/aeroplane-list.txt --width 390 --height 844 \
  --json games/.tmp/aeroplane-smoke-390.json --resources games/.tmp/aeroplane-resources.json --throttle 0
# pass 1, fail 0, checks 19, externalRequests 0, consoleErrors 0, exceptions 0

node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games games/.tmp/aeroplane-list.txt --width 320 --height 568 \
  --json games/.tmp/aeroplane-smoke-320.json --resources games/.tmp/aeroplane-resources.json --throttle 0
# pass 1, fail 0, checks 19, externalRequests 0, consoleErrors 0, exceptions 0
```

- 390×844 / 320×568 两档真浏览器冒烟全过；无横向滚动、主触控 ≥44×44、可见字号 ≥12px、零外部请求、无 console error/异常、点击「掷骰」不跳转。
- 棋盘 14×14 等比缩放；320 下环格约 20.7px（格子是 div + tabindex，不是 button，不触发 44px 门禁）；主要按钮 ≥48px。

### 5. mode — PASS

```bash
node games/boardgame/aeroplane-premium/test-online.js
# ONLINE_E2E_JSON: {"game":"aeroplane-premium","clients":2,"sameGame":true,
#  "settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,
#  "leaderboard":true,"seatCount2to4":true,"aiFill":true,"serverDice":true,
#  "runAll":true,"assertions":78,"failed":0}
# RESULT: 78 passed, 0 failed

node games/boardgame/aeroplane-premium/test-online.js --control
# RESULT: 0 passed, 1 failed  (exit 1)
```

- 双 HTTP client 完整对局在 130 步内结束；全程 stateVersion 一致，结算赢家/分数/排名/原因一致。另有一局 1 人类 + 1 AI 补位通过 `/tick` 跑完整局，验证 AI 补位能结算。
- 覆盖：房间容量 4、邀请码、密码拒绝、2 人桌、1 人补 AI（含完整对局）、3 人桌、4 人桌、服务端骰子与 E_DICE、非当前玩家拒绝、幂等、完整对局、重赛、重连、超时托管、榜单、关房。
- 服务端持有完整状态；publicView 下发所有飞机位置与骰子历史，不下发 seed/rngState/未来随机数。
- `test-online.js` 以 `test` 开头，被 `node games/tests/run-all.js` 自动发现；`online-e2e.json` 落盘证据。

## 备注

- 本页不注册 per-game service worker；离线由 `/games/sw.js` 统一接管。`test.js` 读取 `games/precache-manifest.js`，与 `games/sw.js` 的 `CACHE_VERSION` 交叉校验；slug 已入 v22 清单（`scripts/gen-precache.js` 已运行）。
- 共享模块：`games/shared/sfx.js`、`store.js`、`online-room-server.mjs`。骰子使用 crypto 种子 + engine 种子 PRNG，未复制共享实现。
- 美术单物件由 `img-gen` 生成；棋盘/飞机/骰子点阵/文字由代码合成；未使用 emoji 或占位图。
