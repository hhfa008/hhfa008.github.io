# 东京妖都 · 验收报告（ACCEPTANCE）

> 日期：2026-11-10。状态：**shipped**。五项门禁（流程/精美/真实/手机/联机）均已通过；已 merge origin/main c5c583b（含 Azul），大厅入口不在此分支修改。
>
> 主链路只使用 Node/JS：游戏、测试、Node 静态服务、Node 联机服务、常驻 Chrome + `urlrun`。Python 仅用于一次性离线素材处理（PIL 抠图/合成）与数据分析，不参与服务启动或 Node/shell 主链路。

## 1. 测试原文与退出码

### 1.1 单元 / 规则 / realism / 性能 / 页面契约

命令：

```bash
node games/boardgame/kot-premium/test.js
```

原文（`evidence/test-output.txt`）：

```text
[PASS] 原创数据完整性: 14 项断言, 0 失败
[PASS] 共享模块复用: 11 项断言, 0 失败
[PASS] 开局与 seed: 19 项断言, 0 失败
[PASS] 掷骰与锁定: 19 项断言, 0 失败
[PASS] 数字三连与能量: 7 项断言, 0 失败
[PASS] 治疗与上限: 5 项断言, 0 失败
[PASS] 爪击与目标: 10 项断言, 0 失败
[PASS] 伤害加成与护甲: 6 项断言, 0 失败
[PASS] 撤离与淘汰: 14 项断言, 0 失败
[PASS] 进入东京与驻守: 16 项断言, 0 失败
[PASS] 回合开始驻守收益: 6 项断言, 0 失败
[PASS] 能力卡市场: 20 项断言, 0 失败
[PASS] 胜利条件: 12 项断言, 0 失败
[PASS] AI 30 局自对弈: 212 项断言, 0 失败
[PASS] 美术资产与 realism: 69 项断言, 0 失败
[PASS] realism 与联机证据: 19 项断言, 0 失败
[PASS] 性能断言: 9 项断言, 0 失败
[PASS] 页面与规则契约: 98 项断言, 0 失败

总计: 566 通过, 0 失败
RESULT: 566 passed, 0 failed
```

**退出码：0**。

### 1.2 全仓回归（含双客户端联机测试）

命令：

```bash
node games/tests/run-all.js
```

原文（`evidence/run-all-output.txt`，尾部）：

```text
游戏测试: 416 个 · 覆盖游戏: 122/123 · 断言: 26516 passed · 失败文件: 0
工具测试: 101 个 · 断言: 60742 passed · 失败文件: 0
合计: 517 个测试文件 · 断言: 87258 passed · 失败文件: 0
尚无自动化测试: voice-room
```

**退出码：0**。`test-online.js` 以 `test` 开头，被 run-all 的 `/^test.*\.js$/` 自动识别并执行；416 个游戏测试文件包含它。

### 1.3 双客户端联机 E2E

命令：

```bash
node games/boardgame/kot-premium/test-online.js
```

原文（`evidence/online-test-output.txt`）：

```text
[PASS] health + create/join/invite: 15 项断言, 0 失败
[PASS] password + private + solo start: 10 项断言, 0 失败
[PASS] start + authoritative actions + state sync: 20 项断言, 0 失败
[PASS] human turns + AI fill: 11 项断言, 0 失败
[PASS] reconnect + invalid token: 5 项断言, 0 失败
[PASS] idle takeover + recovery: 3 项断言, 0 失败
[PASS] finish + leaderboard + restart + close: 14 项断言, 0 失败
总计: 79 通过, 0 失败
RESULT: 79 passed, 0 failed
```

**退出码：0**。两个独立 fetch 客户端驱动真实 HTTP 房间服务（ephemeral 127.0.0.1 端口）；证据见 `online-e2e.json` 与 `evidence/online-e2e.json`。

### 1.4 官方 game-smoke（390/320 同一页面实测）

命令：

```bash
node <main>/games/boardgame/scripts/game-smoke.mjs \
  --root <repo>/games/boardgame --games <list with kot-premium> \
  --width 390 --height 844 --throttle 0 --json /tmp/kot-game-smoke.json
```

原文（`evidence/game-smoke.json` 摘要）：

```json
{"total":1,"pass":1,"fail":0,"checks":19,"failedChecks":0,
 "externalRequests":0,"consoleErrors":0,"exceptions":0}
```

逐项：page load、title、meta description、viewport、390/320 无横向滚动、390/320 触控 ≥44px、390/320 主控件横向可达、390/320 字号 ≥12px、输入框 ≥16px、无外部请求、无 console error、无未捕获异常、无 Log error、点击冒烟无新增错误/未意外跳转——**19/19 PASS**，退出码 0。

## 2. 实测视口与手机字号

| 视口 | clientWidth | scrollWidth | 横向溢出 | body min-height | safe-area padding | 触控 <44px | 最小可见字号 | 输入框字号 | dock | boot | 掷骰渲染 | DOM |
|---|---:|---:|---:|---|---:|---:|---:|---:|---|---:|---:|---:|
| **390×844** | 390 | 390 | 0 | 844px | 92px | 0 | **12px** | 16px | fixed，按钮 48px | 1.6ms | 0.3ms | 538 |
| **320×568** | 320 | 320 | 0 | 568px | 92px | 0 | **12px** | 16px | fixed，按钮 48px | 1.9ms | 0.2ms | 499 |
| 844×390 横屏 | 844 | 844 | 0 | 390px | — | 0 | — | — | 页面内按钮 | — | — | — |
| 768×1024 平板 | 768 | 768 | 0 | 1024px | — | 0 | — | — | 页面内按钮 | — | — | — |
| 1024×768 平板 | 1024 | 1024 | 0 | 768px | — | 0 | — | — | 页面内按钮 | — | — | — |

390×844 与 320×568 均完成：触屏掷骰 → 锁定 → 再掷 → 结算 → 进入东京 → 爪击 → 购卡 → 终局 → 重开。iOS 390×844 全流程 32 项断言通过：iPhone UA、simple-dice、2D 翻滚、AudioContext 首次触摸解锁。所有直接文本节点按官方 game-smoke 口径实测 ≥12px。

## 3. sw.js 预缓存

命令：读取 `games/sw.js`，逐项检查 21 个 Kot/shared 资源。原文（`evidence/sw-precache-output.txt`）：

```text
CACHE_VERSION v10
required 21 missing 0
SW_PRECACHE PASS
```

**退出码：0**。包含 Kot 入口、`online.html`、规则页、data/engine、`realism.json`、6 张怪兽立绘、骰面、夜景、封面、OG、详情图，以及 shared rewards/leaderboard/shuffle/sfx。

## 4. 故意失败对照

命令（未先掷骰就锁定骰子，应被引擎拒绝）：

```bash
node -e "var E=require('./games/boardgame/kot-premium/engine.js'); E.applyMove(E.createGame({seed:1}),{type:'toggleLock',index:0});"
```

原文（`evidence/fail-control-output.txt`）：

```text
Error: 非法动作：toggleLock
    at Object.applyMove (.../kot-premium/engine.js:503:26)
    ...
Node.js v24.12.0
```

**退出码：1**。与 `test_exit=0` 形成对照，证明门禁不是静默通过。

## 5. 官方五门禁采集器

| 门禁 | 结果 | 证据 |
|---|---|---|
| art | cover/OG/detail 均解析为本地 `../../assets/...` 文件；控制项 positive/negative 全过 | `evidence/gate-art.json` |
| online | `online-e2e.json` full contract + `test-online.js` + `online-server.mjs`/`online.html`；控制项 positive/negative 全过 | `evidence/gate-online.json` |
| realism | `realism.json` 10 项（规则/尺寸/比例/颜色/材质/字体）全部 pass | `realism.json` |
| mobile | 官方 game-smoke 19/19 PASS | `evidence/game-smoke.json` |
| process | DESIGN/ACCEPTANCE/E2E/PROGRESS/meta/测试原文齐备 | `evidence/gate-process.json` |
| 汇总 | 五门 allPass=true | `evidence/gates-all.json` |

## 6. CPU / 内存 / 耗时

| 命令 | real | user | sys | peak memory |
|---|---:|---:|---:|---:|
| `urlrun` 桌面 harness | 31.23s | 1.17s | 0.73s | 36.95MB（urlrun 进程） |
| `urlrun` iOS harness | 35.87s | 1.01s | 0.70s | 22.23MB（urlrun 进程） |
| `node test.js` | <2s | — | — | Node 进程，未单独采样 |
| `node run-all.js` | <60s | — | — | Node 进程，未单独采样 |

常驻 Chrome 全进程 RSS 快照约 **4.58–5.90GB**（包含用户所有窗口/标签，非本游戏单独占用；仅作环境记录）。游戏本身 boot 1.5–1.9ms、单次掷骰渲染 0.2–1.1ms、DOM 499–538 节点。

## 7. shared 模块复用

| 模块 | 状态 | 用法 |
|---|---|---|
| `games/shared/shuffle.js` | 使用 | `engine.js` 牌库洗牌；测试比对 `Shuffle.shuffle(cardIds,{seed})` |
| `games/shared/sfx.js` | 使用 | `AudioFX` 包装器映射 dice/capture/notify/move/lose/win |
| `games/shared/rewards.js` | 使用 | 终局 `Rewards.record` 记录 XP/等级/连胜 |
| `games/shared/leaderboard.js` | 部分使用 | 只调用纯 `buildChallenge/parseChallenge`；联机榜单由服务器内存榜提供，不调用外部 API |
| `games/shared/rules.js` | 不适用 | 只覆盖五子棋/四子棋等，没有 Kot 规则 API；未复制 |
| `games/shared/physics.js` | 不适用 | 回合制骰子游戏没有刚体/碰撞需求；未复制 |

## 8. 联机实现

- 服务端：`online-server.mjs`，复用 `games/boardgame/app/rooms.js`（密码房、单次邀请、TTL、房主/加入/离开），并沿用 Codenames 的 Node HTTP 样板；没有从零造协议。
- 客户端：`online.html`；创建/加入/邀请链接/密码房/座位/开始/行动/重连/离开/结果榜。
- 权威状态：服务端只接受 `E.getLegalMoves(state)` 返回的动作；非法动作、非当前玩家、托管座位均被拒绝。
- AI 补位：空位与离开/超时座位由 `E.selectAIMove` 驱动，规则与本地共用 `engine.js`。
- 重连/托管：session token 重连；超过 `idleTimeoutMs` 未轮询的座位进入 AI 托管，轮询/重连后解除。
- 榜单：终局写入内存榜，`GET /api/leaderboard` 可读；`online-e2e.json` 记录胜者/4 名玩家/回合。
- 双客户端 E2E：`test-online.js`，79/0，run-all 自动识别。
- 联机页面浏览器冒烟：桌面标题 `东京妖都 · 联机房间 · ONLINE`；iPhone UA 390px 标题 `… ONLINE · NOOVERFLOW · FONTOK`；0 exception/console error/外部请求，hosts 仅 127.0.0.1；证据 `evidence/online-smoke.json`、`evidence/online-smoke-mobile.json`。

## 9. 浏览器合规说明

- 使用 `chrome-ensure` 复用常驻 Chrome；`urlrun` 非隔离模式复用现有标签；未创建临时 profile、未新开窗口、未 kill Chrome。
- Chrome 的 AppleEvents JavaScript 关闭且菜单项不可用时，`urlrun tab js` 不可用；改用同一常驻标签内的同源 iframe harness，并保留 DOM/尺寸/事件断言。未使用截图分析或 OCR。
- 交互使用 `TouchEvent + PointerEvent + click`，不依赖 hover；390×844 与 320×568 均通过固定底部 dock 完成单手操作。
- 外部请求 0，`hosts` 仅 `127.0.0.1`；console error 0，page exception 0。

## 10. 证据文件

- `evidence/test-output.txt` — test.js 完整输出（563/0）
- `evidence/run-all-output.txt` — 全仓测试完整输出（87258/0）
- `evidence/online-test-output.txt` — 双客户端联机测试（79/0）
- `evidence/online-e2e.json` — 联机 E2E 契约与分组
- `evidence/game-smoke.json` — 官方 game-smoke 原始 JSON（19/19）
- `evidence/gate-process.json`、`gate-art.json`、`gate-realism.json`、`gate-mobile.json`、`gate-online.json`、`gates-all.json` — 五项门禁报告与控制项
- `evidence/gate-art-online.json` — art/online 门禁采集器与控制项
- `evidence/fail-control-output.txt` — 故意失败对照
- `evidence/sw-precache-output.txt` — sw.js 预缓存检查
- `evidence/e2e-desktop-raw.json`、`evidence/e2e-ios-raw.json` — urlrun 原始报告
- `e2e-report.json`、`E2E.md`、`PROGRESS.md`、`DESIGN.md`、`realism.json`、`meta.json`
