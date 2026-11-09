# 游戏机器对局协议：抽取指南与后续任务清单

本文给后续「让更多游戏接入 `window.GameAgent`」的任务使用。协议核心在
`games/shared/agent-api.js`，首批适配器在 `games/ai-play/adapters/`，自检在
`games/ai-play/test.js`（`node games/ai-play/test.js`，也可被
`games/tests/run-all.js` 自动发现）。

## 协议速查

```js
GameAgent.register(slug, factory)       // factory({seed}) -> session
GameAgent.list()                        // [{slug, players, moves, source}]
GameAgent.create(slug, {seed})          // session；未知游戏抛 {code:'unknown_game'}
GameAgent.playout(slug, agents, {seed, maxMoves})
                                        // -> {winner, moves, hash, log}
```

`session` 的成员（不得改名）：`slug`、`version`、`seats`、`state()`、
`legalActions()`、`apply(id)`、`status()`、`player()`、`hash()`。

约定：

- `state()` 只能是纯 JSON（无函数 / Map / Set / DOM 引用），可 `structuredClone`。
- `legalActions()` 返回 `{id,type,payload,desc}`，`id` 在本次状态内唯一，且必须
  可跨状态重放（`playout` 的 `log` 只存 `id`，重放时按顺序 `apply`）。
- `apply` 对非法动作返回 `{ok:false,error:'illegal_action'}`；对已结束局返回
  `{ok:false,error:'game_over'}`。校验必须全部发生在改状态之前——测试会逐字节
  比较非法动作前后的 `state()` 与 `hash()`。
- `session.seats` 是座位 id 数组，例如 `['p1','p2']` 或
  `['p1','p2','p3','p4']`；2 人局保持旧行为。
- `player()` 返回 `session.seats` 中的当前座位；在声明/应对阶段返回「该谁作答」
  的座位。
- `status().winner` 为 `null`、某个座位 id（`'p1'`/`'p2'`/`'p3'`/…）或
  `'draw'`。
- `list()` 每项包含 `players`（座位数）与 `seats`（座位 id 数组）；`moves` 是
  动作模型短标签（如 `'drop'`、`'draw/discard/claim'`）。
- `playout` 的 `agents` 可以是单个函数、按座位顺序的数组，或按座位 id 取值的
  对象；2 人局仍然沿用「数组第 0 项对 p1」。

新增一款游戏的步骤：

1. 建 `games/ai-play/adapters/<slug>.js`，UMD 写法：Node 分支
   `require('../../shared/agent-api.js')` 与共享引擎；浏览器分支读
   `root.GameAgent` / `root.<Engine>`。
2. 写 `create({seed})`，给 factory 挂 `players` / `moves` / `source` 三个属性，
   然后 `GameAgent.register('<slug>', create)`。
3. 状态机优先复用 `games/shared/`；页面内联逻辑先抽到 shared（见下表），不要在
   适配器里复制第二份规则。
4. 在 `games/ai-play/test.js` 的 `ADAPTERS` 与 `GAMES` 里加一行，跑通全部断言。
5. 更新 `games/registry.json` 无需改动——`GameAgent` 只认注册表，不读站点清单。

## 已接入（5 款）

| slug | 复用方式 | 适配器自行实现的部分 |
| --- | --- | --- |
| `gomoku` | `games/shared/rules.js` 的 `GameRules.gomoku.checkWinAt/lineAt` | 扁平 15×15 数组状态、落子 id、终局/平局判定 |
| `connect4` | `games/shared/rules.js` 的 `GameRules.connect4.setup/applyMove/status` | Int8Array↔纯数组快照、列 id |
| `tcg` | `games/shared/tcg.js` 的 `createMatch/legalActions/apply` | 内置 6 种卡 / 40 张牌池、动作 id、0/1→p1/p2 |
| `mahjong` | `games/shared/hand-eval.js`（`checkWinningHand/tileName`）+ `shuffle.js`（种子洗牌） | 2 人最小状态机：摸、打、胡、碰、杠、过 |
| `mahjong4` | 同上 | 同一状态机的 4 座位模式（`seats:['p1','p2','p3','p4']`） |
| `reversi` | 页面 `__TEST_CORE` 的四个原语 | 在适配器内重写 `flipsAt/legalMoves/apply/count`（约 40 行） |

### mahjong 适配器与页面的差异（必须知道）

页面实现在 `games/mahjong/index.html` 的 `<script id="engine">`（`Mahjong`），
适配器**没有读取/修改该文件**，只复用 `hand-eval.js` 与 `shuffle.js`：

| 项目 | 页面 | 适配器 |
| --- | --- | --- |
| 座位数 | 4 | `mahjong` 2 座位；`mahjong4` 4 座位（协议 `seats` 数组） |
| 牌墙 | 136 张，庄家 14 张起手 | 相同 |
| 回合 | 摸→打→（三家）声明 | 摸→打→（其他座位）声明 |
| 声明 | 胡/碰/杠/过，按优先级+距离排序 | 胡/碰/杠/过；4 座位模式按优先级+距离排序，2 座位模式无竞争 |
| 杠 | 明杠、暗杠（`ankong`）、加杠（`addkong`） | 只有明杠；杠后补摸 |
| 计分/圈风/庄家轮转 | 页面本身也只做单局，无计分 | 无 |
| 和牌判定 | `HandEval.checkWinningHand`；副露后只允许「基本胡」 | 完全一致 |
| 物理张数校验（`physicalUsed`） | 用于听牌/AI | 未实现；当前合法动作不依赖它 |

`mahjong4` 是同一适配器的 4 座位注册项，用于验证多座位协议；它的声明优先级、
补摸和过牌顺序与页面一致。页面同款还需要暗杠/加杠与计分，见下方 M 组。

后续若要做「页面同款 4 人麻将」，把 `<script id="engine">` 整体抽到
`games/shared/mahjong.js`（它已经几乎无 DOM，只依赖 `globalThis.HandEval/Shuffle`），
在 `mahjong4` 座位上补齐暗杠/加杠与计分；工作量 M。协议座位层已经就绪
（`seats` 数组、`winner` 可为任意座位 id）。

## 剩余游戏清单

工作量口径：**S** = 引擎已独立/纯净，只写适配器；**M** = 需先把函数从页面
IIFE 中抠出来，或需补种子/座位/动作模型；**L** = 不是回合制规则游戏，或需
新增信息集/实时时钟等协议外概念。

### S（6 款）

| slug | 现状 | 具体做法 |
| --- | --- | --- |
| `chess` | `games/chess/index.html` 的 `<script id="engine">`，UMD，无 DOM；导出 `initialPosition/legalMoves/makeMove/unmakeMove/gameStatus/chooseMove`（约 251–781 行） | 把该 script 原样复制为 `games/shared/chess.js`；适配器 state 存 `positionKey`/FEN+走子历史，`legalMoves`→id `move:<from><to><promo>`，`gameStatus`→胜负/和棋。注意 `gameStatus` 依赖历史做三次重复判定，state 里要保存 `positionKey` 序列。 |
| `xiangqi` | `games/xiangqi/index.html` 的 `<script id="engine">`，UMD，注释明确「Pure JS, no DOM」；导出 `initialBoard/legalMoves/applyMove/gameState`（186–584 行） | 抽到 `games/shared/xiangqi.js`；`applyMove(board,m)` 已返回 `{board,captured}`，直接做不可变状态；`gameState(board,turn,history)` 给终局。 |
| `go9` | `games/go9/index.html` 的 `__TEST_CORE_START__`..`__TEST_CORE_END__` 混有 UI 变量，但纯函数 `groupAt/tryMove/legalMoves/scoreArea/chooseMove` 集中在 230–515 行，且 949 行已有 `module.exports` | 只抠纯函数到 `games/shared/go9.js`（别整段搬，区间里有 `$`/`I18N`/canvas）；适配器补 `pass`（连续两次 pass 终局）、`ko`、`passes`、按 `scoreArea` 判胜负。 |
| `freecell` | `games/freecell/index.html` 的 `<script id="freecell-core">`，UMD，导出 `newState/applyMove/isWon/Game`（242–480 行） | 单人局，`players:1`。适配器把 `Game` 或 `newState+applyMove` 包成 session；`legalActions` 生成「牌→列/空位/基础堆」动作；`isWon`→winner `'p1'`，无路可走→`'draw'`。种子已支持 `newState(seed)`。 |
| `solitaire` | `games/solitaire/index.html` 的 `<script id="solitaire-core">`，UMD，导出 `newState/legalMoves/applyMove/drawAction/isWon/Game`（286–609 行） | 同上，单人局；`drawAction` 也是合法动作一种。 |
| `spider` | `games/spider/index.html` 的 `<script id="spider-core">`，UMD，导出 `newState/applyMove/canDeal/dealStock/isWon/Game`（268–545 行） | 同上；`dealStock` 作为 `deal` 动作；`players:1`。 |

### M（9 款 + mahjong 4 人升级 1 项）

| slug | 卡在哪 | 具体做法 |
| --- | --- | --- |
| `aeroplane` | 引擎与 UI 在同一个 IIFE；骰子用 `Math.random` | 从 `games/aeroplane/index.html` 抽出 `setup(n)`（234）、`legalMoves(s,p,roll)`（255）、`applyAction(p,roll,action)`（784）到 `games/shared/aeroplane.js`；把 `startRoll`（697）里的随机源换成 `Shuffle.createRng(seed)`；适配器把 roll 放进 state。 |
| `backgammon` | 同上，另有骰子序列与 `applySequence` | 抽 `setup`（241）、`legalMoves`（387）、`applyMove`（331）、`applySequence`（349）；骰子初始化和每回合掷骰都改为注入 seeded RNG；`list().players=2`（页面 2 人）。 |
| `banqi` | 引擎与 UI 同 IIFE，但 `setup(rng)` 已接受 RNG | 抽 `setup`（249）、`legalActions`（342）、`applyAction`（364）、`status`（379）到 `games/shared/banqi.js`；适配器直接复用这些名字，`status` 已返回终局。 |
| `checkers-jump` | 引擎与 UI 同 IIFE；无随机 | 抽 `setup(n)`（264）、`legalMoves`（302）、`applyMove`（315）；注册时先支持 2 人，多座位用 `seats` 数组扩展。 |
| `draughts` | 引擎与 UI 同 IIFE；强制吃子逻辑在 `legalMoves`/`applyMove` | 抽 `setup`（233）、`legalMoves`（276）、`applyMove`（316）；棋子/王标记直接转纯 JSON。 |
| `24game` | `__CORE_START__` 的 `CORE` 已可导出，但这是单人解谜；`legalActions` 无法枚举所有表达式 | 抽 `CORE`（234–495）到 `games/shared/24game.js`；动作模型需要定夺：推荐 `legalActions` 只给 `{type:'submit'}` 提示，`apply('submit:<base64表达式>')` 里调 `CORE.validate`；或增加协议外「表达式动作」约定。先和需求方确认，别自行拍板。 |
| `doudizhu` | `__CORE_START__` 里只有发牌/牌型/跟牌 AI（`deal/detect/canBeat/findAllPlays/aiLead/aiFollow/autoPlay`，326–1021 行），完整 3 人流程在 UI | 先把牌型与出牌合法性抽到 `games/shared/doudizhu.js`；用 `seats:['p1','p2','p3']` 注册 3 座位，`winner` 可为 `'p3'`。地主/农民是否按队计分需先定。 |
| `texas-holdem` | `<script id="engine">` 的 `Poker` 已 UMD 且导出 `createTable/startHand/legalActions/applyAction/buildPots/payout`（310–1007 行），是 4 人桌 | 抽 `Poker` 到 `games/shared/texas-holdem.js`；用 `seats:['p1','p2','p3','p4']` 注册 4 座位（也可先接 2 人 heads-up）。下注动作（fold/check/call/raise amount）需要稳定 id。 |
| `pioneers` | `games/pioneers/engine.js` 已经是独立 UMD 纯引擎，但 2–4 人、有开局摆放/掷骰/回合阶段 | 直接 require 引擎；适配器映射 `createGame/roll/placeSetupSettlement/placeSetupRoad/buildRoad/buildSettlement/upgradeCity/exchange/endTurn/legal*`；可先接 2 人，4 人用 `seats` 扩展；骰子必须走引擎种子（检查 `createGame` 的 seed 参数）。 |
| `mahjong`（页面同款 4 人） | 见上一节；页面 engine 已是纯函数形态，但暗杠/加杠与计分未进适配器 | 抽 `<script id="engine">` 到 `games/shared/mahjong.js`；升级现有 `mahjong4` 的暗杠/加杠与计分；保留 2 人 `mahjong` 作为快速对局入口，不要改它的调用方式。 |

### L（3 款）

| slug | 卡在哪 | 说明 |
| --- | --- | --- |
| `tap-match` | 实时反应游戏（`games/tap-match/index.html` 的 `newBoard/startGame/tick/tapTile`，381–464 行），没有回合与离散终局 | 需要给协议加「时钟/tick」概念并把计时变成确定性动作；否则 `playout` 无法重放。改动面涉及协议本身。 |
| `undercover` | 社交推理：隐藏身份、自由发言、投票（`startGame/renderSpeak/renderVote/renderElim/renderOver`，714–1002 行），没有可枚举的合法动作 | 机器对局需要信息集与语言动作；不适合当前确定性哈希协议。 |
| `voice-room` | 不是规则游戏，是 WebRTC/信令房间（`games/voice-room/` 与 worker） | 不接入 `GameAgent`；如需房间状态，另定协议。 |

### 非对局（1 款，不建议接入）

| slug | 原因 |
| --- | --- |
| `tcg-deck` | `games/tcg-deck/index.html` 是卡组编辑器（`<script id="deck-core">`，389 行起），没有对手、回合或终局。若一定要机器评测，应另定「卡组合法性 / 期望值」目标，而不是套对局协议。 |

### 数量汇总

按站点注册表剩余 19 款计：**S 6 款、M 9 款、L 3 款、非对局 1 款**。
另有 `mahjong` 4 人页面同款升级 1 项（M，不算新 slug）。
适配器注册表当前有 6 个 slug：5 款基础游戏 + `mahjong4`（多座位验证）。

## 复用到共享模块的优先级建议

1. 先做 S 组（chess / xiangqi / go9 / 三款纸牌），验收标准只有一条：加入
   `GAMES` 后 `node games/ai-play/test.js` 全绿。
2. 再做 M 组的双人棋盘（banqi / checkers-jump / draughts / backgammon /
   aeroplane），它们只差「把函数从 UI IIFE 里搬到 shared」。
3. 最后处理多人/实时/社交（doudizhu / texas-holdem / mahjong 4 人 / tap-match /
   undercover）。多人座位层已经由 `seats` 数组支持，剩余工作是各游戏的动作模型、
   骰子种子与计分；`tap-match`/`undercover` 还需要实时时钟或信息集，属于协议外。
