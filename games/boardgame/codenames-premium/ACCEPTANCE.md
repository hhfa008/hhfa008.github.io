# Codenames Premium — ACCEPTANCE

> 游戏：行动代号 Codenames · 豪华单机版 / 联机房间
> 分支：`boardgame/d686a4ca-codenames-premium`
> 状态：**shipped 候选（五项门禁全过；meta.json 最终标 shipped）**
> 日期：2026-11-10

## 0. 结论

| 门禁 | 结果 | 证据 |
|---|---|---|
| 1. 流程 | PASS | DESIGN.md、进度文件、test.js、--control、run-all |
| 2. 精美 | PASS | ART-GUIDE §1/§2/§5/§6、本地 img-gen 材质、封面/OG/详情配图、SW v10 |
| 3. 真实 | PASS | `realism.json` 6 项可验检查；引擎/联机/官方 smoke 交叉验证 |
| 4. 手机 | PASS | 官方 `game-smoke.mjs` 390×844 与 320×568：PASS / 19 checks / 0 failures；e2e 80/0 |
| 5. 联机 | PASS | `online-e2e.test.js`（真实套件 `test-online.js`）89 passed；run-all 已纳入 |

当前状态为 **shipped 候选**；按 HANDOFF 要求，五项全过后才报 shipped。

## 0.1 main c5c583b 合并后复跑

- `git merge origin/main`（c5c583b1）clean；diff vs main 仅 codenames-premium、assets、progress、sw.js。
- art：codenames-premium.ok=true；control ok=true。
- realism：codenames-premium.ok=true；6 checks / 6 kinds。
- mobile：codenames-premium.ok=true；390/320 官方 smoke 各 PASS 19 checks / 0 failures。
- online：codenames-premium.ok=true；control ok=true；双客户端 89/0。
- process：test.js 350/0；--control 350/1（exit 1）；run-all 517 files / 87249 passed / 0 failed。
- catalog-status：codenames-premium.status=shipped，五 gates 全 true。
- build：44 pages / 43 games；`node scripts/check-registry.js --boardgame-only` exit 0。
- main push：按全局规则需用户逐次明确授权，分支已合并就绪。

## 1. 官方手机门禁（game-smoke.mjs）

命令（官方脚本，来自 `games/boardgame/scripts/game-smoke.mjs`）：

```
node games/boardgame/scripts/game-smoke.mjs \
  --root games/boardgame \
  --games /tmp/codenames-games.txt \
  --width 390 --height 844 \
  --json games/boardgame/codenames-premium/audit/game-smoke-390.json
# /tmp/codenames-games.txt: codenames-premium
```

320×568 同命令，`--width 320 --height 568 --json .../game-smoke-320.json`。

结果：

```
390 exit=0
codenames-premium PASS failures=0 duration=990ms
click {"clicked":true,"label":"主题：浅色","navigated":false}

320 exit=0
codenames-premium PASS failures=0 duration=1000ms
click {"clicked":true,"label":"主题：浅色","navigated":false}
```

每次运行 19 项检查，包含：

- 390×844 / 320×568 无横向滚动（doc 390/390、320/320）
- 主触控目标 ≥44px（390、320）
- 主控件横向可达（390、320）
- 字号可读 ≥12px（390、320）——已把所有可见文字提升到 ≥12px
- 输入框字号 ≥16px（iOS 不缩放）
- 无外部请求、无 console error、无未捕获异常、无 Log error
- 点击冒烟：点击「主题：浅色」，未意外跳转
- 性能/资源快照写入 JSON

JSON 证据：

- `audit/game-smoke-390.json`
- `audit/game-smoke-320.json`

## 2. 单测与对照

```
node games/boardgame/codenames-premium/test.js
```

退出码 0：

```
总计: 350 通过, 0 失败
RESULT: 350 passed, 0 failed
```

对照（故意失败）：

```
node games/boardgame/codenames-premium/test.js --control
```

退出码 1：

```
  FAIL: 故意失败对照项（--control） — 这是验收对照，正常运行时不会加 --control
总计: 350 通过, 1 失败
RESULT: 350 passed, 1 failed
```

## 3. 双客户端联机 E2E

门禁命名：

- 真实套件：`test-online.js`（run-all 自动发现；gate/main 20baecb 已识别）
- 门禁别名：`online-e2e.test.js`（`require('./test-online.js')`）
- 机器可读证据：`online-e2e.json`

命令：

```
node games/boardgame/codenames-premium/online-e2e.test.js
```

退出码 0：

```
HTTP 请求数: 38
RESULT: 89 passed, 0 failed
```

覆盖：创建房间、单次邀请 token、密码房、私有房鉴权、开始对局、4 座位、空位 AI 补足、真实 9/8/7/1、队长/队员隐藏信息、线索→猜词→停止、蓝色 AI 自动行动、双客户端同状态、重连、无效 token、超时接管与恢复、结果榜（同局一次）、重开、离开转 AI。

## 4. 全仓门禁

```
node games/tests/run-all.js
```

退出码 0（37.41s）：

```
游戏测试: 416 个 · 覆盖游戏: 122/123 · 断言: 14703 passed · 失败文件: 0
工具测试: 101 个 · 断言: 60742 passed · 失败文件: 0
合计: 517 个测试文件 · 断言: 87249 passed · 失败文件: 0
```

其中：

```
boardgame/test.js        350 passed   PASS
boardgame/test-online.js  89 passed   PASS
```

改 shared（`sw.js` v22）后跑过同一门禁，0 failed。

## 5. SW 预缓存

`games/sw.js` `CACHE_VERSION = 'v22'`；预缓存清单由 `scripts/gen-precache.js` 生成到 `games/precache-manifest.js`，已包含：

- `/games/boardgame/codenames-premium/`、`index.html`、`online.html`、`rules.html`、`detail.html`
- `engine.js`、`words.js`、`meta.json`
- 7 个 WebP：`card-paper`、`card-back`、`table-felt`、`cover`、`og`、`detail-board`、`detail-cards`

`test.js` 断言 sw 与清单版本一致（v22）且上述 URL 全部存在；shared `shuffle.js`/`sfx.js` 原本已缓存。

## 6. 真实性与美术

- `realism.json`：顶层 `pass:true`，6 项 `ok:true` 检查，`kind` 覆盖 count / dimension / proportion / color / material / rule（≥3 类互异）。
- 门禁复核：`node games/boardgame/scripts/verify-shipped.mjs --gate realism` → `codenames-premium.ok=true`，`reasons: []`（其余 draft 条目仍缺 realism，故门禁整体 allPass=false；未修改门禁）。原始报告：`audit/gate-realism-codenames.json`。
- 本地材质：`card-paper` / `card-back` / `table-felt` 1024 PNG 母版 + 512 WebP；纯白背景、单物件居中、左上主光、纸纤维/亚麻压纹/羊毛毡。
- 封面/OG/详情配图：`art/render.html` 用真实 5×5 局面 + 本地材质代码合成；`cover.webp` 1024²、`og.webp` 1200×630、两张详情图 1200×800。
- 词卡文字 Songti SC Bold(700)；图标为内联标准 SVG；未用占位图/emoji。
- `detail.html` 同时标注「单人可用 / 多人联机」。

## 7. 手机与 iOS

- 官方 game-smoke 390×844、320×568 均 PASS；所有可见文字 ≥12px，主触控目标 ≥44px，无横向滚动。
- `100dvh`、四边 safe-area、`viewport-fit=cover`、`overflow-x:hidden`。
- iOS Safari：共享 `sfx.js` 支持 `webkitAudioContext`；页面在 `touchstart`/`pointerdown`/`touchend`/`keydown` 首次手势解锁。
- 无 hover 依赖：关键操作均走 click；`touch-action:manipulation`。
- 横屏 844×390、平板 1024×768 由 `e2e.mjs` 冒烟覆盖，不崩、无横向滚动。

## 8. 浏览器执行方式

- 先 `chrome-ensure` 复用常驻 Chrome；不新建临时 Chrome/profile，不 kill Chrome。
- 默认 Node CDP（常驻 Chrome，`127.0.0.1:9222`），只创建/关闭自己的 target；主链路 Node/shell，不拉起 Python 服务。
- `urlrun tab` 为可选路径（`USE_URLRUN=1`）；当前 Chrome 的 Apple Events JavaScript 关闭，自动走 Node CDP。
- `e2e.mjs`：80 passed, 0 failed，exit 0；只做 DOM/尺寸/计算样式/事件断言，不做截图/OCR/图像识别。

## 9. 资源观测

验证批次：`test.js` → `test-online.js` → `e2e.mjs`。

| 时点 | Chrome 进程数 | Chrome RSS | Chrome CPU% | Node 进程数 | Node RSS |
|---|---:|---:|---:|---:|---:|
| 批量前 | 42 | 5739.8 MB | 116.7% | 10 | 870.0 MB |
| 批量后 | 49 | 5626.4 MB | 121.5% | 8 | 561.7 MB |

单次耗时：test.js 0.06s；test-online.js 0.87s；e2e.mjs 7.94s（wall 7.96s）；run-all.js 37.41s。

## 10. 已知限制

- 联机服务器为本地内存实现；重启清空房间与结果榜。
- 固定 4 座位（红/蓝 × 队长/队员），不是 2–8 人自由分队。
- AI 线索偏主题化、强度中等。
- Songti SC 依赖 macOS，其他平台回退 STSong/SimSun。
- `players` 元数据写 2–8 人；联机当前实际 4 座位 + AI 补位。
