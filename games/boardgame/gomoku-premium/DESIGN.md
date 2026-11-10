# 五子棋 · 精美版 Gomoku Premium — DESIGN

> 分支：`boardgame/d686a4ca-b6-g7`
> 目录：`games/boardgame/gomoku-premium/`
> 状态：实现完成，等待集成方统一跑五项门禁（run-all / art / realism / mobile / online）。

## 1. 设计目标

把简版 `games/gomoku/` 升级为可长期留存的 premium 版本：

1. **规则真实**：15×15、225 个交叉点、黑先、自由规则无禁手、连续五子或更多即胜、满盘平局。
2. **视觉精美**：榧木盘面、那智黑石、蛤碁石；棋子按真实 22mm 直径 / 10mm 厚度；局面由代码合成，不使用 AI 生成局面。
3. **手机优先**：390×844 与 320×568 竖屏可用，按钮 ≥44px，可见字号 ≥12px，无横向滚动，安全区与 100dvh。
4. **可玩性**：三档 AI、悔棋、落子预览、最后一手、胜利线、音效、人机战绩。
5. **多人联机**：2 人房间、邀请/密码房、AI 补位、断线重连、超时托管、结果榜、重赛、离开转 AI。

## 2. 文件结构

| 文件 | 职责 |
|---|---|
| `index.html` | 单机 / 双人 / 联机棋盘 UI；Canvas 棋盘、音效、分享 |
| `engine.js` | UMD 纯规则与 AI；复用 `games/shared/rules.js` 的判胜/连线 |
| `data.js` | 星位、坐标、难度、材质路径、真实尺寸、来源 |
| `rules.html` | 完整规则、自由规则 vs 禁手、AI 说明、B 站来源 |
| `online.html` | 共享联机大厅（`app/online-lobby.js`） |
| `online-server.mjs` | 共享权威服务器薄适配器（`app/online-game.mjs`） |
| `test.js` | 单元 + 静态契约 + 性能预算 + `--control` |
| `test-online.js` | 双客户端真实 HTTP E2E + `--control` |
| `art-render.html` | cover / OG / detail 三档合成源 |
| `realism.json` / `perf.json` / `meta.json` | 真实验收 / 性能 / 元数据 |
| `DESIGN.md` / `ACCEPTANCE.md` / `E2E.md` | 设计与验收记录 |

## 3. 规则引擎

- 棋盘是一维数组 `Array(225)`，索引 `row * 15 + col`。
- `createGame({names,isAI,seed,aiLevel})` 返回初始状态；`applyMove(state,move)` 不修改入参，返回全新状态。
- 非法动作抛 `Error`：越界、非整数、已占位、对局已结束、未知动作类型。
- 判胜与连线直接调用 `games/shared/rules.js` 的 `gomoku.checkWinAt` / `lineAt`，避免第二套实现。
- `getLegalMoves(state)` 返回所有空交叉点，按距天元排序；在线服务器用它生成合法动作。
- 结果包含 `winner`（1/2/0）、`winLine`、`scores`、`reason`（`five` / `full`）。

### AI

| 难度 | 策略 | 预算 |
|---|---|---|
| 入门 | 候选点（已有棋子半径 2）按攻防分排序后取前 7 随机 | <500ms / 20 步 |
| 棋士 | 攻防评分 + 对手最佳回应惩罚；先成五再堵五 | <900ms / 20 步 |
| 名人 | 候选搜索：先查必胜/必防，再做两层 negamax（alpha-beta，140ms 截止） | <900ms / 5 步，单步 <150ms |

同一 `seed` + 同一局面得到同一手；AI 只读状态，不写入。

## 4. 联机架构

- 复用 `games/boardgame/app/online-game.mjs` 的权威房间服务器：房间码、单次邀请、密码房、座位、AI 补位、重连、超时托管、结果榜、重赛、离开转 AI、关闭房间。
- `online-server.mjs` 只做三件事：映射黑白到座位 0/1、下发公开局面、注入 AI 落子。
- 引擎颜色与座位：座位 0 = 黑棋，座位 1 = 白棋；`currentSeat = current === BLACK ? 0 : 1`。
- 客户端通过 `app/online-bridge.js` 轮询 `/api/rooms/:id`，自己的回合点击棋盘发送 `{type:'place',row,col}`。
- 公开状态只含棋盘、手数、胜负、胜利线与最近事件；不包含任何隐藏信息（五子棋本身无隐藏信息）。
- 服务器在每次动作后校验：房间成员、会话、是否轮到该座位、座位是否被 AI 托管、动作是否合法。

## 5. 视觉与美术

- 盘面：榧木木纹满幅贴图 + 代码绘制的 15 路线、星位、A–O / 1–15 坐标、内框。
- 棋子：Canvas 径向渐变 + 抠图后的 slate/clamshell 材质叠层，半径按 22mm/22mm 网格比例；最后一手橙点，胜利线金色高亮。
- 封面 / OG / 详情：`art-render.html` 用同一套材质合成，包含真实成立的 20+ 手局面与即将连五的线；标题使用 Songti SC 700。
- 材质母版由 img-gen 生成：黑棋子（纯白底）、白棋子（深灰底）、榧木木纹、深胡桃木桌面；抠图用洪水填充 + 1px 腐蚀，不用 colorkey。
- 输出：cover 1200×1200、OG 1200×630、detail 1536×1024；WebP 入库，PNG 母版本地保留。

## 6. 手机与可访问性

- `viewport-fit=cover`、`100dvh`、`env(safe-area-inset-*)`。
- 所有主要按钮 / 链接 `min-height:44px`；可见字号 ≥12px；无横向滚动。
- 触屏落子采用「预览 + 同点确认」，避免误触；鼠标单击直接落子。
- `aria-live` 状态、`role="application"` 棋盘、可见焦点环、`prefers-reduced-motion` 关闭动画。
- 零外部请求；材质、脚本、规则页全部本地。

## 7. 测试与验收

- `test.js`：规则常量、四方向胜负、贴边/长连/断线、平局、不可变、非法动作、AI 三档合法性与确定性、静态契约、SW 版本交叉校验、性能预算。
- `test-online.js`：真实 HTTP 服务器 + 两个独立客户端，覆盖创建/邀请/密码/第三人拒绝/开局/同步/重连/托管/完整终局/榜单/重赛/离开/关闭。
- `--control` 故意失败，验证测试本身能红。
- 集成方统一跑 `run-all`、`verify-shipped`、`game-smoke` 390/320、`gen-precache`。

## 8. 来源

- B 站：BV1wS4y1D7uT、BV1q54y1o7HQ、BV1dmxX63ETv、BV1Qt411n7Y4（只读标题/简介）。
- `games/ART-GUIDE.md`：单物件材质、真实尺寸、抠图、合成与校验。
- 简版 `games/gomoku/` 与共享 `games/shared/rules.js`：规则原语与 AI 思路基线。
