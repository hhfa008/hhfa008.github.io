# 情书 LOVE LETTER · PREMIUM — 设计

> 版本 1.0.0 · 2026-11-10 · `games/boardgame/love-letter-premium/`

## 1. 目标

把 2019 版《情书》的 16 张基础牌做成一个可在手机竖屏一局到底的精品网页：真实牌库、真实角色效果、真实情书标记赛制；单人可和 2–4 人桌的 AI 对战，联机房间可跨设备同局。

## 2. 规则口径（官方基础版）

- 牌库 16 张：卫兵 ×5、神父 ×2、男爵 ×2、侍女 ×2、王子 ×2、国王 ×1、女伯爵 ×1、公主 ×1。
- 点数 1–8；抽 1 打 1；目标为仍在场的其他玩家（王子可指定自己）。
- 开牌暗置：2 人 3 张，3 人 1 张，4 人 0 张。
- 一轮结束：只剩一名玩家；或轮到某人抽牌时牌堆为空，亮牌比点数，平手比弃牌点数和，仍平则并列获胜。
- 情书标记：2 / 3 / 4 人分别先得 7 / 5 / 4 枚。上一轮赢家下一轮先行动。
- 特殊约束：同时持有女伯爵与国王/王子时必须打女伯爵；卫兵不能猜卫兵；侍女保护持续到自己的下个回合开始；王子/弃牌效果弃掉公主立即出局。

## 3. 引擎

`engine.js` 是纯函数 UMD 引擎：

- `createGame({seed, playerCount, names, isAI})`：2–4 人，发牌、暗置、首位回合。
- `getLegalMoves(state)`：完整枚举目标与卫兵猜测（2–8）。
- `applyMove(state, move)`：深拷贝后结算，非法动作抛 `Error`，绝不修改入参。
- `chooseAIMove(state)`：确定性启发式 AI，优先使用神父信息、强牌男爵、低牌换国王、危险时侍女。
- `getView(state, seat)`：按座位过滤手牌；神父知识只对获得信息的座位可见；对局结束后公开。
- 洗牌复用 `games/shared/shuffle.js` 的 seeded Fisher-Yates；`seed` 相同则整局可复现。

## 4. 界面

- 单页 `index.html`：桌布、对手座位、牌堆、日志、手牌、猜测条、结算/比赛弹窗。
- 交互：点牌 → 需要时点目标/猜点数 → 按「打出」。所有按钮 ≥44px；320px 下两列手牌仍完整可见。
- 视觉：深酒红丝绒、羊皮纸牌面、火漆与玻璃情书标记；标题 Songti SC 700。牌面字符与局面由代码合成，AI 只负责单物件材质。
- 无障碍：`aria-label`、`aria-live` 日志、焦点环、`prefers-reduced-motion`。
- 主题：深色为默认，可切浅色；主题写入 localStorage（try/catch）。

## 5. 美术资产

单物件素材（`games/assets/art/premium/love-letter/`，img-gen + WebP）：

| 文件 | 内容 | 真实规格 |
|---|---|---|
| `card-back.webp` | 酒红/古金牌背 | 63×88mm，300gsm |
| `wax-seal.webp` | 红色火漆印 | Ø30mm |
| `token.webp` | 红玻璃情书标记 | Ø30mm |
| `table-crimson.webp` | 深红丝绒桌布 | 无缝纹理 |
| `envelope.webp` | 羊皮纸信封 | 110×220mm |

本地封面 / OG / 详情由 `art-render.html` + `render-art.mjs` 代码合成：

- `assets/cover.webp` 1200×1200：3 张真实角色牌、16 张牌堆、7 枚标记、火漆、信封。
- `assets/og.webp` 1200×630：标题 + 3 张牌 + 7 枚标记。
- `assets/detail-1.webp` 1200×800：8 位角色 × 真实张数（5/2/2/2/2/1/1/1 = 16）。
- `assets/detail-2.webp` 1200×800：火漆、7 枚标记、信封、3 张牌、牌堆。

## 6. 联机

`online-server.mjs` 复用 `../app/rooms.js` 的房间/密码/邀请/TTL；`online.html` 提供创建、加入、邀请码、密码房、开始、出牌、重连、托管与重赛。服务端以 `engine.js` 为权威判定；空位 AI；超时托管；结果榜与双客户端 E2E 在 `test-online.js`。

## 7. 性能预算

| 项 | 预算 | 实测 |
|---|---|---|
| FCP | ≤2500ms | 76ms |
| DOMContentLoaded | ≤4000ms | 10ms |
| loadEventEnd | ≤4000ms | 32ms |
| DOM 节点 | <2500 | 204 |
| 单次纯规则移动 | ≤500ms | 0.3ms |
| 素材总量 | ≤1.5MB | 623KB |
| 外部请求 | 0 | 0 |

## 8. 测试

- `test.js`：143 条断言，覆盖牌库、人数、隐藏信息、女伯爵、卫兵/神父/男爵/侍女/王子/国王/公主、牌堆耗尽、并列、比赛结束、AI 三档人数自对弈、不可变性、性能与静态资产。
- `test-online.js`：51 条断言，双客户端创建/邀请/密码/开始/整局/结算一致/重连/托管/重赛/榜单/离开/关闭。
- `e2e.mjs`：62 条断言，真实 Chrome CDP 点击出牌、AI 回应、390×844 与 320×568、字号/触控/无横向滚动、SW 预缓存、性能、零外链、规则 JSON-LD。
- `--control`：`e2e.mjs --control` 与 `test-online.js --control` 均 exit 1。

## 9. 风险与边界

- 自动进入下一轮：为联机轮询简单，引擎在结算后立即发下一轮；UI 用 `lastRound` 弹窗展示上一轮结果。物理桌游的「看完再洗牌」节奏由弹窗模拟。
- 神父知识：目标抽牌后仍保留「其中一张已知」，目标打出已知牌后信息失效；这是对隐藏信息的保守近似。
- 4 人局使用同一副 16 张基础牌，不引入 Premium 版新增角色。

## 10. 目录

```
index.html  data.js  engine.js  rules.html
online.html  online-server.mjs  test.js  test-online.js  e2e.mjs
art-render.html  render-art.mjs  sw.js
assets/cover|og|detail-1|detail-2.(png|webp)
DESIGN.md  ACCEPTANCE.md  E2E.md  meta.json  realism.json  perf.json
```
