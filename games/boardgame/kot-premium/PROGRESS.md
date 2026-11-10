# 东京妖都 · 进度与续跑（PROGRESS）

> 2026-11-10。状态：**shipped**。本轮只补齐 Kot 这一个备选样本；未扩展新游戏、未与 Codenames 样本并行铺量。

## 1. 进度清单

| 步骤 | 状态 | 证据 / 备注 |
|---|---|---|
| B 站教程检索（3 组关键词） | done | `rules.html` §十；6 条视频；无公开字幕，改用公开文字规则页 |
| 规则引擎 + 原创数据 | done | `engine.js`、`data.js` |
| 30 局 AI 自对弈 | done | `test.js`，212 断言 |
| img-gen 素材（6 怪兽 + 骰面 + 夜景） | done | `/tmp/kot-art` 原始 PNG；本地 WebP/母版在 `games/assets/art/premium/kot/` |
| 白底抠图 / alpha 腐蚀 / 裁切 | done | ART-GUIDE §4；`art-manifest.json` 记录覆盖率与中心 alpha |
| 封面 / OG / 详情图合成 | done | 代码合成：夜景 + cutout + Songti SC Bold(700) |
| UI / 3D 骰 / 动效 / 音效 | done | `index.html`；shared `sfx.js` |
| 手机适配 390×844 + 320×568 | done | 固定底部 dock、safe-area、100dvh、iOS simple-dice |
| shared 模块复用 | done | shuffle/sfx/rewards/leaderboard；rules/physics 不适用 |
| sw.js 预缓存 | done | v10，19 个 Kot/shared 资源，检查 PASS |
| 单测 + 全仓回归 | done | test 537/0 exit 0；run-all 75584/0 exit 0 |
| 桌面/iOS E2E | done | 79/0、32/0；0 外部请求、0 console error |
| 验收报告 | done | `ACCEPTANCE.md`、`E2E.md`、`e2e-report.json`、`evidence/` |
| 联机（房间/邀请/同步/重连/榜单） | done | `online-server.mjs` + `online.html`，复用 app/rooms.js；`test-online.js` 79/0 |
| 官方 game-smoke 390/320 | done | 19/19 PASS，字号 ≥12px，输入框 ≥16px |
| realism.json | done | 10 项全过 |
| commit / push | pending | 见最终分支与提交记录 |

## 2. 可中断续跑

```bash
# 1) 只看/继续单测
node games/boardgame/kot-premium/test.js

# 2) 全仓门禁
node games/tests/run-all.js

# 3) 浏览器主链路（Node 静态服务 + 常驻 Chrome，不用 Python 起服务）
~/.local/bin/chrome-ensure
cd <repo-root>
nohup node games/boardgame/kot-premium/serve.mjs 8765 > /tmp/kot-serve.log 2>&1 &
/usr/bin/time -l ~/.local/bin/urlrun "http://127.0.0.1:8765/games/boardgame/kot-premium/e2e-harness.html?mode=desktop" --seconds 30 --json /tmp/kot-e2e-desktop.json
/usr/bin/time -l ~/.local/bin/urlrun "http://127.0.0.1:8765/games/boardgame/kot-premium/e2e-harness.html?mode=ios" --mobile --seconds 35 --json /tmp/kot-e2e-ios.json

# 4) sw 预缓存
node -e '<读取 games/sw.js，检查 19 个 Kot/shared 资源>'

# 5) 故意失败对照（期望 exit 1）
node -e "var E=require('./games/boardgame/kot-premium/engine.js'); E.applyMove(E.createGame({seed:1}),{type:'toggleLock',index:0});"
```

- E2E harness 在 `games/boardgame/kot-premium/e2e-harness.html`；Node 服务在 `serve.mjs`。
- Node 静态服务退出：`kill $(cat /tmp/kot-serve.pid)`。常驻 Chrome 不 kill；测试标签保留或只关标签。

## 3. 实测 CPU / 内存 / 耗时

| 项 | 数值 |
|---|---|
| `node test.js` | 566 assertions，exit 0；<2s |
| `node run-all.js` | 87258 assertions，0 failed；含 test-online.js；exit 0 |
| `urlrun` desktop | 31.23s real / 1.17s user / 0.73s sys；peak 36.95MB |
| `urlrun` iOS | 35.87s real / 1.01s user / 0.70s sys；peak 22.23MB |
| 常驻 Chrome RSS | 约 4.58–5.90GB（所有窗口/标签合计，非本游戏单占） |
| 页面 boot / 掷骰渲染 / DOM | 1.6–3.2ms / 0.2–0.3ms / 499–538 |
| 页面美术资源 | 1,590,736 bytes（≤3MB） |

## 4. 联机实现与已解决项

1. `online-server.mjs` 复用 `app/rooms.js` 与 Codenames Node HTTP 样板：房间/邀请/密码房/权威状态同步/空位 AI/重连/超时托管/榜单/重开。
2. `online.html` 联机客户端；浏览器冒烟标题 `东京妖都 · 联机房间 · ONLINE`，0 console error、0 外部请求。
3. `test-online.js` 双客户端 79/0，run-all 自动识别（`/^test.*\.js$/`）。
4. `meta.json` 已标 `status: "shipped"`，`acceptance.multiplayer=true`。
5. 官方 game-smoke 19/19；art/online 门禁采集器与控制项通过；realism.json 10/10。
6. 已 merge origin/main c5c583b（含 Azul）；若 Codenames 后续合入，按窗口再 merge 一次。`games/sw.js` 基于 v9 升到 v10，并入更高版本主线时需合并 Kot 资源块。

## 5. 环境与口径

- 主链路 Node/JS；Python 只用于一次性离线素材处理与数据分析（按用户澄清，可作为被调用工具，不用于起服务/守护进程/包装主链路）。
- 浏览器：`chrome-ensure` 复用常驻 Chrome；`urlrun` 非隔离、复用现有标签；未自建临时 Chrome/profile，未新开窗口，未 kill Chrome。
- 素材：`img-gen gpt-image-2.5-flare --quality high`；纯白背景、单物件、左上主光、真实材质、无文字；没有截图分析/OCR。
