# 东京妖都 · E2E 记录

> 日期：2026-11-10。状态：**shipped**（五项门禁通过；联机服务由 online-server.mjs 提供）。
>
> 本记录只使用 DOM/尺寸/事件/网络/耗时断言，没有截图分析、OCR 或图像内容识别。

## 1. 浏览器环境与合规说明

- 浏览器：用户常驻 Google Chrome 156，`~/.local/bin/chrome-ensure` 确认「already running，复用，不新开」。
- 驱动：`~/.local/bin/urlrun` **非隔离模式**，复用现有 Chrome 活动标签，不创建临时 profile、不新开窗口、不 kill Chrome。
- 限制：Chrome 的「允许 Apple 事件中的 JavaScript」处于关闭状态，菜单项不可用，因此 `urlrun tab js/text/click` 无法执行。为了仍复用同一个常驻 Chrome，使用同源本地 HTTP harness（`e2e-harness.html`）在常驻标签内创建精确尺寸 iframe，并在 iframe 内派发 `TouchEvent + PointerEvent + click`。所有页面交互仍发生在同一个 Chrome 标签/进程内，没有另起 Chrome。
- 网络：页面通过游戏目录内的 **Node 静态服务** `serve.mjs`（127.0.0.1:8765）本地提供；`urlrun` 报告 `hosts = [["127.0.0.1:8765", N]]`，外部请求 0。主链路不使用 Python HTTP 服务。
- 未使用截图判读；素材验收只用 WebP/PNG 尺寸、字节数与 alpha 统计。

## 2. 运行命令

```bash
~/.local/bin/chrome-ensure
cd <repo-root> && nohup node games/boardgame/kot-premium/serve.mjs 8765 > /tmp/kot-serve.log 2>&1 &

# 桌面：390×844、320×568 全流程，844×390 / 768×1024 / 1024×768 冒烟，reduce=1
/usr/bin/time -l ~/.local/bin/urlrun \
  "http://127.0.0.1:8765/games/boardgame/kot-premium/e2e-harness.html?mode=desktop" \
  --seconds 30 --json /tmp/kot-e2e-desktop.json   # server: Node 内联静态服务 127.0.0.1:8765

# iOS Safari UA + 触屏 + simple-dice + AudioContext 解锁
~/.local/bin/urlrun \
  "http://127.0.0.1:8765/games/boardgame/kot-premium/e2e-harness.html?mode=ios" \
  --mobile --seconds 35 --json /tmp/kot-e2e-ios.json
```

## 3. 结果

| 套件 | 通过 | 失败 | 说明 |
|---|---:|---:|---|
| 桌面 harness | **79** | **0** | 390×844 与 320×568 全流程；横屏与平板冒烟；forced reduce；全文字 ≥12px |
| iOS harness | **32** | **0** | iPhone UA、simple-dice、2D 翻滚、触摸解锁音频、shared 模块、全流程 |
| 官方 game-smoke | **19** | **0** | 390/320 同一页面；无溢出、触控 ≥44px、字号 ≥12px、输入框 ≥16px、0 外部/console |
| 双客户端联机 | **79** | **0** | 房间/邀请/密码/权威同步/AI 补位/重连/托管/榜单/重开 |
| `test.js` | 见文件尾 RESULT | 0 | 规则、realism、性能、页面契约 |
| `run-all.js` | 见文件尾 | 0 failed | 全仓回归 |

### 3.1 390×844 与 320×568 全流程

两档均完成：触屏掷骰 → 触屏锁定 → 再掷 → 结算 → 进入东京 → 出现爪击伤害 → 触屏购卡 → 终局 → 触屏重开。

| 指标 | 390×844 | 320×568 |
|---|---|---|
| 内宽 / scrollWidth | 390 / 390 | 320 / 320 |
| 横向溢出元素 | 0 | 0 |
| body min-height | 844px（100dvh） | 568px（100dvh） |
| body padding-bottom | 92px（含 safe-area） | 92px（含 safe-area） |
| 触控目标 <44px | 0 | 0 |
| 单手 dock | fixed，top 781 / bottom 844，按钮 48px | fixed，top 505 / bottom 568，按钮 48px |
| 字号 | body 16 / status 15 / btn 12 / power 12 / log 12 / 最小 12 | body 16 / status 13 / btn 12 / power 12 / log 12 / 最小 12 |
| 全流程 elapsed | 148ms | 28ms |
| boot | 1.6ms | 1.9ms |
| 单次掷骰渲染 | 0.3ms | 0.2ms |
| DOM 节点 | 538 | 499 |
| 最小可见字号 | 12px | 12px |
| 输入框字号 | 16px | 16px |
| 音效首次触摸解锁 | true | true |
| shared shuffle/sfx/rewards/leaderboard | true | true |
| Rewards XP / Leaderboard 挑战码 | true | true |
| 攻击/购卡/进入东京 | true / true / true | true / true / true |

### 3.2 横屏与平板

- 844×390：scrollWidth 844，横向溢出 0，触控目标 <44px 为 0，主按钮 44px+，触屏掷骰成功。
- 768×1024：scrollWidth 768，横向溢出 0，触控目标 <44px 为 0。
- 1024×768：scrollWidth 1024，横向溢出 0，触控目标 <44px 为 0。

### 3.3 iOS Safari 降级

- `navigator.userAgent` = iPhone Safari；`KOT_PREMIUM.isIOS() = true`。
- `<html class="simple-dice">` 生效；`.die .cube` 的 WAAPI 动画数 = 0；`.die.rolling-flat` 2D 翻滚类存在。
- 首次 `touchstart` 后 `AudioFX.isUnlocked() = true`，AudioContext 已创建/恢复。
- 390×844 全流程 32 项断言全部通过，含攻击、购卡、终局、重开、shared 模块、XP 与挑战码；iOS 全流程 32/0。

### 3.3b 联机页面浏览器冒烟

- 命令：`node games/boardgame/kot-premium/online-server.mjs 8788`，然后 `urlrun http://127.0.0.1:8788/online.html --seconds 4`。
- 技术信号：桌面标题 `东京妖都 · 联机房间 · ONLINE`；`--mobile` 390px 标题 `… ONLINE · NOOVERFLOW · FONTOK`；`exceptions=[]`、console error=0、外部请求=0；`hosts` 仅 `127.0.0.1:8788`。
- 证据：`evidence/online-smoke.json`、`evidence/online-smoke-mobile.json`。

### 3.4 reduced-motion

- 通过 `?reduce=1` 强制关闭动效：`isSimpleDice() = true`，掷骰后 `.cube` WAAPI 动画数 = 0，平面骰子仍可操作。
- CSS 同时含 `@media (prefers-reduced-motion: reduce)` 全局降级。

## 4. 网络 / console

- 桌面 `urlrun`：`exceptions = []`，console error = 0，外部请求 = 0；`hosts = [["127.0.0.1:8765", N]]`。
- iOS `urlrun`：`exceptions = []`，console error = 0，外部请求 = 0；`hosts = [["127.0.0.1:8765", N]]`。
- 11 个本地 WebP（6 怪兽 + 骰面 + 夜景 + 封面 + OG + 详情）全部 `naturalWidth > 0`。
- 页面引用美术资源总量：**1,590,736 bytes（约 1.59MB）**，低于 3MB 预算。

## 5. 性能 / 资源占用

- `urlrun` 桌面 harness：`31.23s real / 1.17s user / 0.73s sys`，peak memory footprint **36.95MB**（urlrun 进程）。
- `urlrun` iOS harness：`35.87s real / 1.01s user / 0.70s sys`，peak memory footprint **22.23MB**。
- 常驻 Chrome 全进程 RSS 快照：约 **4.58–5.90GB**（包含用户所有窗口/标签，非本游戏单独占用；仅作环境记录）。
- 页面 boot 1.5–1.9ms、单次掷骰渲染 0.2–1.1ms、DOM 499–538 节点。
- 引擎 30 局自对弈与 200 次开局性能断言见 `test.js` 的「性能断言」组。

## 6. Realism 校验

- 6 颗骰、6 个面：数字 1/2/3、爪、心、能量；3 次掷骰；初始 10 生命；20 分胜利；3 张明牌；14 张能力卡；4 人局东京湾。
- 怪兽立绘 768×768 页面 WebP、1024×1024 母版；骰面 512×512；夜景 1536×1024；封面 1024×1024；OG 1200×630；详情 1536×1024。
- Alpha：6 只怪兽覆盖率 0.217–0.522，中心像素 alpha=255；骰面覆盖率 0.785，中心 alpha=255。白底按 ART-GUIDE §4 连通 flood fill + 1px 腐蚀，未使用 colorkey。
- 所有怪兽名称、血量、分数、骰面数字/图案仍由代码渲染；生成图只提供无字符材质/立绘。
- 中文标题 Songti SC **Bold(700)**；无 Black(900)。
- shared 模块：`shuffle.js` 驱动牌库；`sfx.js` 提供全部 WebAudio 合成音效；`rewards.js` 记录本局 XP/等级；`leaderboard.js` 只调用纯 `buildChallenge/parseChallenge`，不发网络请求。`rules.js`/`physics.js` 无 Kot 对应 API，未复制、未强行调用。

## 7. 联机实现
- `online-server.mjs` 复用 `games/boardgame/app/rooms.js` 与 Codenames 的 Node HTTP 样板，提供房间/邀请/密码房/权威状态同步/空位 AI/重连/超时托管/榜单/重开。
- `online.html` 为联机客户端；浏览器冒烟标题为 `东京妖都 · 联机房间 · ONLINE`，0 console error、0 外部请求、hosts 仅 127.0.0.1。
- `test-online.js` 双客户端 79/0，run-all 自动识别；证据 `online-e2e.json` / `evidence/online-e2e.json`。
- `meta.json` 已标 `status: shipped`，`acceptance.multiplayer=true`。

## 8. 复现与证据

- harness 源码：`games/boardgame/kot-premium/e2e-harness.html`；Node 服务：`serve.mjs`；联机服务：`online-server.mjs`。
- 原始 JSON：`/tmp/kot-e2e-desktop.json`、`/tmp/kot-e2e-ios.json`。
- 可复跑：`e2e-report.json` 保存通过数、耗时、viewport 与网络摘要；原始报告在 `evidence/`。
