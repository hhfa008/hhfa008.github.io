# Undercover Premium — DESIGN

> 谁是卧底 · 精美版
> 分支：`boardgame/d686a4ca-b6-g7`
> 日期：2026-11-10

## 1. 目标

把 `games/undercover/` 的 40 组词、单机传递看词版本，升级为一款可独立交付的 premium 桌游：

- 本地模式：4–12 人共用一台手机，全屏保密卡逐人看词，随机发言顺序，逐位秘密投票，淘汰公开身份，完整结算。
- 联机模式：4–6 人房间，空位 AI 补位，断线重连、超时托管、结果榜与重赛。
- 规则与隐藏信息由同一份 `engine.js` 在本地和服务器执行，不做简化。
- 美术按 `games/ART-GUIDE.md`：img-gen 生成卡纸、卡背、胡桃木桌面材质；中文词、标题、票数、局面全部由代码用 Songti SC 700 渲染。

## 2. 规则来源与还原

B站参考（只读文字，未截图 / 未 OCR）：

- BV1Qi4y1r7CD 《谁是卧底—规则介绍》：身份、描述、投票流程。
- BV19ixy62EHN 《谁是卧底》桌游规则：卧底必须描述自己的词，不能撒谎；白板可以撒谎。
- BV1tW4y1T7Pe 《谁是卧底》游戏技巧（基础介绍篇）：发言与听感策略。

规则落地：

| 项 | 实现 |
|---|---|
| 人数 | 本地 4–12；联机 4–6（共享 server 座位上限 6） |
| 卧底 | 1–3，推荐 4–6 人 1、7–9 人 2、10–12 人 3 |
| 白板 | 0–1，与卧底同阵营，无词 |
| 平民下限 | 至少 2；且卧底 + 白板必须少于平民，否则非法 |
| 发词 | 221 组中文词对；平民同一词，卧底同一相近词；每局 seeded 随机交换 a/b |
| 看词 | 座位顺序，一人一张全屏保密卡 |
| 发言 | 随机顺序，每人一句话；不能报词、字数、笔画、首字 |
| 投票 | 存活者逐位秘密投票，不能投自己；每轮 seeded 随机投票顺序 |
| 淘汰 | 唯一最高票出局并公开身份与词；最高票并列无人出局，进入下一轮 |
| 胜利 | 卧底方存活 = 0 → 平民胜；卧底方存活 ≥ 平民存活 → 卧底方胜 |

## 3. 引擎与状态机

`engine.js` 是 UMD 纯函数引擎：浏览器 `globalThis.UndercoverEngine`，Node `require('./engine.js')`。

```
reveal ──每人 reveal──▶ speak ──beginVote──▶ vote
   ▲                                            │
   │                                   全部存活者投完
   │                                            ▼
   └──────── next round ◀── 未结束 ── elimination
                                            │
                                         结束 ▼
                                          over
```

- `applyMove` 不修改入参，返回深拷贝后的新 state。
- 所有随机来自 `games/shared/shuffle.js` 的 seeded sfc32：发角色、选词对、交换 a/b、投票顺序、AI 决策都可复现。
- 非法动作抛错：错误阶段、投自己、投已出局、越界目标、游戏结束后继续行动。
- `viewFor(state, viewer)` / 服务器 `publicState` 只下发生存者公开信息；仅本人收到自己的词与身份。
- 淘汰者与终局后公开角色和词；`lastElim` 含本轮票数与身份。

## 4. 数据

`data.js` 共 221 组词对、135 个类别，字段 `a/b/cat/difficulty`。保留简版前 40 组，扩展覆盖饮食、日用、职业、动物、交通、学科、影视、应用、运动、户外等。校验：两词不同、词对不重复、全部纯中文、难度属于 `easy/normal/hard`。

## 5. 本地 UI

- 设置：人数步进、卧底 1–3、白板开关、类别提示开关；实时显示推荐卧底数；非法配置禁用开始并给出原因。
- 看词：`pass` 屏 → 全屏保密卡 → 点击翻牌 → 词 / 身份 / 类别 → “记住了” → 交接确认 → 下一位。
- 发言：随机顺序列表、60 秒讨论倒计时、“开始投票”。
- 投票：玩家逐个投票；候选按钮 → 二次确认 → 交接确认 → 下一位。
- 淘汰：身份与词公开、票数条形图、剩余卧底方 / 平民数、继续或查看结果。
- 结算：胜方、全员身份与词、存活 / 出局、再来一局、分享。

视觉 token：深酒红与炭黑底、brass 金 `#d8b06b`、象牙卡纸 `#f4ead5`、Songti SC 700 标题与词、胡桃木桌面材质。所有按钮 ≥44×44，正文 ≥12px，`100dvh`，`env(safe-area-inset-*)`，无横向滚动，纯前端零外部请求。

## 6. 联机

`online-server.mjs` 只是薄适配器，复用 `../app/online-game.mjs`：

- 授权、房间码、单次邀请、密码房、座位、AI 补位、重连、超时托管、重赛、榜单都在共享 server。
- `publicState` 隐藏存活者 `role/word`；`viewExtras` 仅向当前 session 下发本人 `privateWord/privateRole/privateHint`。
- `currentSeat` 为 `state.current`；AI 座位由共享 server 的 `tick` 自动执行 `chooseAIMove`。
- `resultRows` 按胜方给 1/0，终局写入 leaderboard。
- 客户端 `online.html` 用共享 `online-lobby.js/css`；游戏页在 `?online=` 模式用 `online-bridge.js` 轮询、提交 `reveal` / `beginVote` / `vote`，并展示房间码、座位、当前行动者、托管状态和结算。

## 7. 美术

| 资产 | 做法 | 尺寸 |
|---|---|---|
| `card-face.webp` | img-gen 300gsm 象牙棉纸纹理，代码叠加词与身份 | 1024 长边 |
| `card-back.webp` | img-gen 深酒红 + 炭黑锦纹 + 金线卡背 | 1024 长边 |
| `table-wood.webp` | img-gen 深胡桃木桌面 | 1024 长边 |
| `cover.webp` | `art-render.html?shot=cover` 代码合成扇形卡牌 + 投票面板 | 1200×1200 |
| `og.webp` | 同上 `?shot=og` | 1200×630 |
| `detail.webp` | 同上 `?shot=detail` | 1536×1024 |

卡牌真实比例 63×88mm、300gsm；文字全部代码渲染，避免模型画中文乱码。封面局面是一局真实发词：平民两枚「可乐」、卧底「雪碧」、白板「无词」、一张机密卡背，票数面板为第 2 轮 3/2/1/0。

## 8. 性能与测试

- `test.js`：词库、配置、角色、胜负、状态机、平票、AI、隐藏信息、静态契约、SW 清单交叉校验、性能预算。
- `test-online.js`：4 个独立客户端完整对局，覆盖创建/邀请/密码/满房、AI 补位、隐藏信息、同局一致、结算一致、重连、超时托管、榜单、重赛、离开变 AI、关房。
- `perf.json`：创建 500 局、2000 次合法动作、1000 次 AI、300 局看词的阈值与实测。
- 浏览器 390×844 / 320×568 冒烟由集成方串行执行并写 `audit/`。

## 9. 文件

```
undercover-premium/
  index.html          本地 4–12 人 + 联机牌桌
  engine.js           UMD 规则引擎
  data.js             221 组词对
  rules.html          规则与主持技巧
  online.html         4–6 人联机大厅
  online-server.mjs   共享 server 薄适配器
  test.js             单测 + 性能
  test-online.js      4 客户端联机 E2E
  online-e2e.json     联机证据
  realism.json        真实性检查
  perf.json           性能阈值与实测
  meta.json           元数据
  art-render.html     封面 / OG / 详情合成
  DESIGN.md / ACCEPTANCE.md / E2E.md
```
