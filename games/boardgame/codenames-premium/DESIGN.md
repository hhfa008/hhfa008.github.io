# 行动代号 Codenames · 设计说明（DESIGN）

> 版本 1.2.0 · 唯一样本 · 单人与联机双入口
> 入口：`index.html`（单人）、`online.html`（联机）、`rules.html`（规则）、`detail.html`（详情）
> 机器可读状态：`meta.json`；进度：`../progress/sample-codenames.md`；E2E 记录：`E2E.md`

## 1. 目标与范围

本作同时提供两种可玩形态：

- **单人**：玩家当红队队长 + AI 队员，或玩家当红队队员 + AI 队长。红蓝 AI 均使用同一套引擎规则。
- **联机**：4 个固定座位（红队队长 / 红队队员 / 蓝队队长 / 蓝队队员）；空位由 AI 补足；支持邀请码、密码房、状态同步、断线重连、超时托管和结果榜。

单人页不需要服务器；联机页由 `online-server.mjs` 通过本地 HTTP 提供页面、静态资源与房间 API。两者共享 `engine.js`、`words.js` 和本地美术资产。

## 2. 规则与 realism 清单

| 项目 | 真实值 | 校验 |
|---|---|---|
| 棋盘 | 5×5，25 张词卡 | 引擎 + 单测 + 浏览器冒烟 |
| 红队 | 9 张 | `createGame` 计数、`data-realism`、meta |
| 蓝队 | 8 张 | 同上 |
| 中立 | 7 张 | 同上 |
| 刺客 | 1 张 | 同上 |
| 先手 | 红队 | `turn === 'red'` |
| 线索 | 一个词 + 数字 1–9；不能是场上词 | `validClue` |
| 猜词 | 最多「数字 + 1」次；至少猜一次 | `guessesLeft = count + 1`；`pass` 前检查 `guessesMade >= 1` |
| 错牌 | 对方词给对方加分并立即换边；中立立即换边 | `reveal()` |
| 刺客 | 立即结束，对方获胜 | `finish('assassin')` |
| 胜利 | 先找齐己方 9/8 张；或对方翻出最后一张己方词 | `checkWin()` |
| 词库 | 275 个唯一中文词，20 个主题 | `words.js` + 单测 |
| 字体 | Songti SC Bold(700) | CSS + 单测 + 冒烟计算样式 |
| 材质/光照 | 纸纤维卡面、亚麻压纹卡背、羊毛毡桌面；左上主光 | 本地 img-gen 资产 + CSS 混合 |
| 文字/图标 | 词卡文字与 5×5 局面由代码合成；图标为内联标准 SVG | 不使用 AI 生成文字 |

`meta.json.realism.status = "pass"`。任何件数、颜色、规则或材质校验失败时，状态必须改为 `draft`，不得进大厅。

## 3. 架构

```
engine.js        UMD 纯规则引擎（无 DOM / 定时器 / 网络）
words.js         275 词、20 主题、解码别名
index.html       单人 UI（离线）
online-server.mjs 联机 HTTP API + 静态服务（复用 ../app/rooms.js）
online.html      联机大厅/房间/对局 UI（HTTP 轮询）
test.js          引擎、页面契约、性能、美术、移动端断言
test-online.js   双客户端 HTTP 联机 E2E（run-all 自动发现）
e2e.mjs          常驻 Chrome 冒烟驱动（Node CDP；urlrun 可选）
smoke.html       冒烟 harness（iframe 390/320/横屏/平板）
```

### 3.1 联机座位与状态

- 座位：`red-captain`、`red-operative`、`blue-captain`、`blue-operative`，固定 4 个。
- 房主 = 第一个座位（红队队长）。加入顺序填座；空位在开局时标记为 AI。
- 队长视角可以看颜色；队员视图未翻开颜色为 `hidden`，主题标签也不下发。
- 当前行动座位由 `state.turn + phase` 决定：线索阶段看队长，猜词阶段看队员。
- 人类动作必须来自当前座位；AI 座位由服务器调用 `E.aiClue` / `E.aiAction`，与人类使用同一引擎校验。

### 3.2 联机 API（与 `app/server.mjs` 同形）

```
POST /api/rooms                      创建（playerId, password?, visibility）
POST /api/rooms/:id/join             加入（playerId, password? / inviteCode?）
GET  /api/rooms/:id                  房间 + 按玩家隐藏信息的视图
POST /api/rooms/:id/start            房主开始；空位 AI 补足
POST /api/rooms/:id/actions          clue / guess / pass
POST /api/rooms/:id/reconnect        断线重连，清除托管
POST /api/rooms/:id/leave            离开；座位转 AI 托管
POST /api/rooms/:id/invite           房主生成新邀请 token
POST /api/rooms/:id/tick             强制推进 AI（E2E/手动同步）
POST /api/rooms/:id/restart          房主重开
DELETE /api/rooms/:id                房主关闭
GET  /api/leaderboard                结果榜
```

- 房间生命周期（邀请、密码、TTL、房主、离开）复用 `games/boardgame/app/rooms.js` 的 `createRoomStoreInternal()`。
- 轮询周期 650ms；GET/动作/reconnect 都会刷新 `lastSeen`。
- 超过 `idleTimeoutMs`（默认 15s）未活动的当前座位进入 AI 托管；玩家下一次 GET/动作/reconnect 自动解除。
- 对局结束后写入服务器内存结果榜（roomId、胜者、比分、回合数、时长、4 个座位），同一局只写一次。

## 4. 美术与材质（ART-GUIDE §1/§2/§5/§6）

### 4.1 分工

- **AI 只画单物件**：卡纸、卡背、绒布。纯白背景、居中、左上柔光、真实材质、无文字。
- **字符/局面/图标由代码**：25 张词卡、5×5 布局、红 9 / 蓝 8 / 中立 7 / 刺客 1 全部由引擎状态生成；词卡文字 Songti SC Bold(700)；图标为内联标准 SVG。
- **封面/OG/详情配图**：`art/render.html` 用本地 img-gen 材质 + 真实 5×5 局面代码合成，再用无头 Chrome 渲染成 PNG 母版；不是占位图或 emoji。

### 4.2 本地材质资产

目录：`games/assets/art/premium/codenames/`

| 资产 | 规格 | 用途 |
|---|---|---|
| `card-paper.png/.webp` | 1024 PNG 母版 / 512 WebP | 卡面纸纤维；CSS multiply |
| `card-back.png/.webp` | 1024 / 512 | 卡背亚麻压纹；CSS soft-light |
| `table-felt.png/.webp` | 1024 / 512 | 桌面羊毛毡；CSS multiply |
| `cover.png/.webp` | 1024×1024 | 封面 |
| `og.png/.webp` | 1200×630 | OG / 分享图 |
| `detail-board.png/.webp` | 1200×800 | 详情页完整局面 |
| `detail-cards.png/.webp` | 1200×800 | 详情页材质特写 |

img-gen 提示词核心：单物件、纯白无缝背景、居中、左上大面积柔光箱 + 右侧补光、真实纸纤维/亚麻压纹/羊毛毡、100mm macro f/11、无文字/字母/数字/logo/水印。完整命令与产物同一次提交，见 `art/render.html` 与本节。

### 4.3 页面材质

- `.face.front::before` 用纸纤维 WebP + `mix-blend-mode:multiply`；`.face.back::before` 用卡背 WebP + `soft-light`。
- `.board-wrap::before` 用绒布 WebP + `multiply`；桌面另有左上主光渐变。
- 翻牌：3D `rotateY(180deg)` + `tileLift` 抬升 + `back-sheen` 高光扫过；`prefers-reduced-motion` 全部关闭。
- 卡面/按钮内阴影与左上高光统一光源；暗色/浅色主题均可读。

## 5. 手机适配

- 冒烟矩阵：390×844、320×568、844×390（横屏）、1024×768（平板）。
- 触控目标 ≥44px（词卡在 320px 下约 55×59px，按钮最小 44px）。
- `viewport-fit=cover`、`100dvh`、四边 `env(safe-area-inset-*)`、`overflow-x:hidden`。
- 无 hover 依赖：所有关键操作走 `click`（触屏生成 click）；`touch-action:manipulation`。
- iOS Safari：`window.webkitAudioContext` 回退；`touchstart`/`pointerdown`/`touchend`/`keydown` 首次手势创建/恢复 AudioContext。
- 横屏短高度（`max-height:520px` + `orientation:landscape`）缩小棋盘与控制区，避免崩溃/横向滚动。
- 键盘：方向键在 5×5 网格移动焦点。

## 6. 性能预算

| 指标 | 预算 | 断言位置 |
|---|---|---|
| 500 局发牌 | < 1000ms | `test.js` |
| 2000 次 `viewFor` | < 500ms | `test.js` |
| 30 局 AI 自对弈 | < 1000ms | `test.js` |
| 单次 `buildBoard` | < 150ms | `index.html` `getPerf` + `e2e.mjs` |
| 单次 `newGame` | < 350ms | 同上 |
| 单次 `render` 最大 | < 120ms | 同上 |
| 浏览器冒烟总耗时 | < 4000ms（实际约 8s 含 4 档 iframe） | `e2e.mjs` |

实测（本机）：500 局发牌 11.6ms；2000 次 `viewFor` 1.5ms；30 局 AI 自对弈 5.1ms；UI `buildBoard` 0.3ms、`newGame` 15.5ms、`renderMax` 0.4ms；浏览器冒烟 7.94s。

实测值在每次验证后写入 `meta.json.performance.measured`、`E2E.md` 与进度文件。

## 7. 验证

- `node games/boardgame/codenames-premium/test.js`：引擎/页面/性能/美术/移动/联机交付物断言。
- `node games/boardgame/codenames-premium/test-online.js`：双客户端 HTTP E2E（房间、邀请、密码、隐藏信息、线索→猜词→停止、AI 补位、重连、超时托管、结果榜、重开、离开转 AI）。
- `node games/boardgame/codenames-premium/e2e.mjs`：先 `chrome-ensure`；默认复用已常驻的 Chrome DevTools 实例（默认 9222），只创建/关闭自己的 target；主链路 Node/shell，不拉起 Python 服务。`USE_URLRUN=1` 时可选探测 `urlrun tab`。
- `node games/tests/run-all.js`：应包含 `codenames-premium/test.js` 与 `codenames-premium/test-online.js`，整体 0 failed。

## 8. 共享模块与 SW 预缓存

- `games/shared/shuffle.js`：引擎在 Node 用 `require('../../shared/shuffle.js')`，浏览器用 `window.Shuffle`；只调用 `createRng` / `shuffleInPlace`，没有复制 Fisher-Yates 或 PRNG。
- `games/shared/sfx.js`：单人页只调用 `Sfx.play/mute/isMuted/stats`；没有本地振荡器/增益/音效判断。
- `games/shared/rules.js` 只导出 gomoku/connect4 规则；Codenames 规则唯一实现在 `engine.js`，没有第二份。
- `physics.js`：Codenames 无物理，N/A。
- `rewards/leaderboard`：shared 无这两个模块；联机结果榜是服务器多客户端内存榜，未复制客户端 localStorage 榜单逻辑。
- `games/sw.js` 升级 **v10**，预缓存 codenames 的入口/引擎/词库/meta 与 7 个 WebP（纸面、卡背、绒布、封面、OG、两张详情图）；shared shuffle/sfx 原本已缓存。改 shared 后已跑 `run-all`（37.41s，0 failed）作为门禁。

## 9. 已知限制

- 联机服务器是本地内存实现；重启服务器会清空房间与结果榜。
- 结果榜是服务器内存榜，不是跨设备持久榜。
- 座位固定 4 个（不是 2–8 人的自由分队）；实体版 6–8 人需要多队员/观战，当前未实现。
- AI 线索偏主题化，强度中等；AI 队员只读公开线索与标签，不读隐藏颜色。
- `urlrun tab` 依赖 Chrome「允许 Apple 事件中的 JavaScript」；默认不走该路径，设置 `USE_URLRUN=1` 才探测。
- 未做截图/OCR/图像识别；美术质量按文件尺寸、材质资产、DOM/计算样式与事件断言验证。
