# Codenames Premium — E2E / 验收记录

> 记录日期：2026-11-10
> 分支：`boardgame/d686a4ca-codenames-premium`
> 状态：**shipped 候选（五项全过）**
> 浏览器规则：先 `~/.local/bin/chrome-ensure`；不新建临时 Chrome/profile；不 killall Chrome；只关闭自己的 tab/target。

## 1. 单测（引擎 / 页面 / 性能 / 美术 / 手机 / 交付物）

命令：

```
node games/boardgame/codenames-premium/test.js
```

退出码：**0**

原始输出尾部：

```
[PASS] 性能预算: 4 项断言, 0 失败 — create500=11.2ms, view2000=1.2ms, ai30=4.0ms
[PASS] 共享模块复用与交付物: 53 项断言, 0 失败
[PASS] 本地美术与材质技术校验: 31 项断言, 0 失败
[PASS] 移动端与 iOS 静态约束: 10 项断言, 0 失败
[PASS] 规则页内容与 SEO: 18 项断言, 0 失败

总计: 350 通过, 0 失败
RESULT: 350 passed, 0 failed
```

覆盖：275 词库、5×5/9/8/7/1、线索 N+1、刺客、胜负、30 局 AI 自对弈、隐藏信息、性能预算、ART-GUIDE §1/§2/§5/§6、共享 shuffle/sfx 复用、本地 img-gen 材质、移动端静态约束、联机交付物、SW 预缓存。

## 2. 故意失败对照（--control）

命令：

```
node games/boardgame/codenames-premium/test.js --control
```

退出码：**1**

原始输出尾部：

```
  FAIL: 故意失败对照项（--control） — 这是验收对照，正常运行时不会加 --control
总计: 350 通过, 1 失败
RESULT: 350 passed, 1 failed
```

说明：同一套断言、同一进程；只多一个故意为假的对照项。正常运行时退出 0，加 `--control` 时退出 1，证明测试失败会真正阻断。

## 3. 双客户端联机 E2E（run-all 自动发现）

命令：

```
node games/boardgame/codenames-premium/test-online.js
```

退出码：**0**

原始输出尾部：

```
[PASS] finish + leaderboard + restart: 14 项, 0 失败
[PASS] leave -> AI fill: 4 项, 0 失败

HTTP 请求数: 38
RESULT: 89 passed, 0 failed
```

覆盖：房间创建、邀请 token 单次使用、密码房错误/正确密码、私有房鉴权、开始对局、4 座位、空位 AI 补足、真实 9/8/7/1、队长可见颜色、队员隐藏颜色/标签、线索→猜词→停止、蓝色 AI 队长/队员自动行动、回合同步、断线重连、无效 token、超时接管与恢复、结果榜（同局只入榜一次）、房主重开、离开转 AI。

## 4. 浏览器冒烟（常驻 Chrome）

命令：

```
node games/boardgame/codenames-premium/e2e.mjs
```

退出码：**0**

- 先 `chrome-ensure`，复用正在运行的 Chrome；不创建临时 profile，不 kill Chrome。
- 默认主链路：复用已常驻 Chrome 的 DevTools 实例（默认 `127.0.0.1:9222`），只 `Target.createTarget` 自己的 target，结束 `Target.closeTarget`；没有新开 Chrome/profile，没有关闭其他 tab。整条主链路是 Node/shell，不拉起 Python 服务。
- `urlrun tab` 为可选路径：设置 `USE_URLRUN=1` 时先探测；当前 Chrome 的「查看 → 开发者 → 允许 Apple 事件中的 JavaScript」关闭，探测失败会自动回到 Node CDP。
- harness `smoke.html` 用 iframe 加载真实页面，尺寸 390×844、320×568、844×390、1024×768；全部基于 DOM/尺寸/计算样式/事件/performance 断言，不做截图、OCR 或图像识别。

原始输出（摘要）：

```
smoke mode: persistent-cdp-node · elapsed: 7.94s
E2E RESULT: 80 passed, 0 failed
```

### 390×844 实测

```
PASS 390×844 innerWidth≈目标 — 390 vs 390×844
PASS 390×844 无横向滚动 — {"doc":390,"body":390,"inner":390}
PASS 390×844 25 张词卡 — 25
PASS 390×844 词卡 ≥44px — 65.59375
PASS 390×844 按钮 ≥44px — []
PASS 390×844 词卡字号 ≥11px — 11.52
PASS 390×844 100dvh — {"minHeight":844,"inner":844}
PASS 390×844 真实件数 9/8/7/1 — 25:9:8:7:1
PASS 390×844 页面无错误 — []
PASS 390×844 零外部资源 — []
PASS 390×844 UI 性能预算 — {"newGame":15.5,"board":0.3,"renderMax":0.4}
PASS 390×844 触屏切换队员模式 — operative
PASS 390×844 触屏解锁 WebAudio — none -> suspended
PASS 390×844 AI 队长已给线索 — {"phase":"guess","clue":{"text":"城市","count":4,"team":"red"}}
PASS 390×844 触屏可翻牌 — 0
PASS 390×844 触屏推进回合 — {"before":1,"after":2,"phase":"clue"}
```

### 320×568 实测

```
PASS 320×568 innerWidth≈目标 — 320 vs 320×568
PASS 320×568 无横向滚动 — {"doc":320,"body":320,"inner":320}
PASS 320×568 25 张词卡 — 25
PASS 320×568 词卡 ≥44px — 54.796875
PASS 320×568 按钮 ≥44px — []
PASS 320×568 词卡字号 ≥11px — 11.2
PASS 320×568 100dvh — {"minHeight":568,"inner":568}
PASS 320×568 真实件数 9/8/7/1 — 25:9:8:7:1
PASS 320×568 页面无错误 — []
PASS 320×568 零外部资源 — []
PASS 320×568 UI 性能预算 — {"newGame":2.8,"board":0.2,"renderMax":0.4}
PASS 320×568 320 断点生效 — true
PASS 320×568 触屏切换队员模式 — operative
PASS 320×568 触屏解锁 WebAudio — none -> suspended
PASS 320×568 AI 队长已给线索 — {"phase":"guess","clue":{"text":"动物","count":4,"team":"red"}}
PASS 320×568 触屏可翻牌 — 0
PASS 320×568 触屏推进回合 — {"before":1,"after":2,"phase":"clue"}
```

### 横屏 / 平板 / 其他页面

- 844×390、1024×768：25 卡、无横向滚动、无页面错误、按钮/词卡 ≥44px、未崩溃。
- `online.html`：大厅渲染、无横向滚动、按钮 ≥44px、浏览器内创建房间、4 座位、3 个 AI 空位。
- `detail.html`：4 张本地配图全部加载（cover/detail-board/detail-cards/og），无横向滚动，标注单人/联机。
- `rules.html`：JSON-LD ≥2、B 站来源 ≥5、无横向滚动。

## 5. SW 预缓存

`games/sw.js` 已升级 **v10**，`PRECACHE_URLS` 现包含：

```
/games/boardgame/codenames-premium/
/games/boardgame/codenames-premium/index.html
/games/boardgame/codenames-premium/online.html
/games/boardgame/codenames-premium/rules.html
/games/boardgame/codenames-premium/detail.html
/games/boardgame/codenames-premium/engine.js
/games/boardgame/codenames-premium/words.js
/games/boardgame/codenames-premium/meta.json
/games/assets/art/premium/codenames/card-paper.webp
/games/assets/art/premium/codenames/card-back.webp
/games/assets/art/premium/codenames/table-felt.webp
/games/assets/art/premium/codenames/cover.webp
/games/assets/art/premium/codenames/og.webp
/games/assets/art/premium/codenames/detail-board.webp
/games/assets/art/premium/codenames/detail-cards.webp
```

共享 `shuffle.js` / `sfx.js` 原本已在预缓存中。单测断言通过。

## 6. 全仓门禁（改 shared 后必须跑）

命令：

```
node games/tests/run-all.js
```

退出码：**0**（约 29.6s）

原始输出尾部：

```
游戏测试: 416 个 · 覆盖游戏: 122/123 · 断言: 14696 passed · 失败文件: 0
工具测试: 101 个 · 断言: 60742 passed · 失败文件: 0
合计: 517 个测试文件 · 断言: 87249 passed · 失败文件: 0
尚无自动化测试: voice-room
```

其中：

```
boardgame/test.js        350 passed   0.06s  PASS
boardgame/test-online.js  89 passed   0.88s  PASS
```

## 7. 批处理资源观测

验证批次：`test.js` → `test-online.js` → `e2e.mjs`。快照为 `ps` 聚合（Chrome 含常驻实例与其他 agent 的 tab；Node 含本机其他进程，故 RSS 为环境总量而非单进程）。

| 时点 | Chrome 进程数 | Chrome RSS | Chrome CPU% | Node 进程数 | Node RSS |
|---|---:|---:|---:|---:|---:|
| 批量前 | 42 | 5739.8 MB | 116.7% | 10 | 870.0 MB |
| 批量后 | 49 | 5626.4 MB | 121.5% | 8 | 561.7 MB |

单次耗时：

- `test.js`：0.06s，退出 0
- `test-online.js`：0.87s，退出 0
- `e2e.mjs`：脚本内 7.94s，进程 wall time 7.96s（含 4 档 iframe + 触屏流程）
- `run-all.js`：37.41s，退出 0

## 8. 共享模块复用

- `games/shared/shuffle.js`：引擎通过 `require('../../shared/shuffle.js')` / `window.Shuffle` 使用 `createRng` + `shuffleInPlace`；未复制 Fisher-Yates 或 PRNG。
- `games/shared/sfx.js`：单人页只调用 `Sfx.play/mute/isMuted/stats`；未复制振荡器/增益/音效判断。
- `games/shared/rules.js`：其导出为 gomoku/connect4 规则；Codenames 规则唯一实现在 `engine.js`，没有第二份复制。
- `physics.js`：Codenames 无物理，N/A。
- `rewards/leaderboard`：`games/shared` 无这两个模块；联机结果榜是服务器多客户端场景的内存榜，未复制客户端 localStorage 榜单逻辑。
- 改 shared（sw.js v10）后已跑 `run-all`，0 failed。
