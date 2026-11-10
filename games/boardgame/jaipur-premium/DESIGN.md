# 斋普尔 Jaipur premium · 设计说明

> 目录：`games/boardgame/jaipur-premium/` · 美术母版：`games/assets/art/premium/jaipur/`
> 主题：拉贾斯坦粉城集市 / 藏红花与靛蓝 / 象牙卡纸 / 黄铜 / 丝绸

## 1. 规则来源与口径

以 user 给定的 Jaipur 官方规则为准，明确修正旧实现 `games/boardgame/jaipur/engine.js` 的四处错误：

1. **牌组是 55 张**：钻石 6、黄金 6、白银 6、丝绸 8、香料 8、皮革 10、骆驼 11。旧实现只有 44 张货物牌，少了一整套骆驼分布。
2. **开局不是双方固定 3 只骆驼**：市场先放 3 只骆驼；剩余 52 张洗牌，双方各发 5 张；双方把手中骆驼移入骆驼群；再从牌堆翻 2 张补到市场。剩余牌堆 40 张。玩家开局可能 0 只骆驼（200 个 seed 中 90 个 seed 的玩家 0 有骆驼）。
3. **奖励代币是 18 枚、三档各 6 枚（3 种面值、每种 2 枚）**：卖 3 张档 `{1,2,3}`、卖 4 张档 `{4,5,6}`、卖 5+ 张档 `{8,9,10}`，每档先洗混背面朝上，卖到才翻，双方分别可拿，拿完为止。规格写「18 枚、三档各 3 枚」在算术上互相矛盾；按 18 枚总数组件数实现为每档 6 枚（1/2/3 各两枚）。旧实现的固定 5/4/3 且全场只能拿一次是错的。
4. **卖牌张数受剩余代币限制**：钻石/黄金/白银至少 2 张，丝绸/香料/皮革至少 1 张；按代币从高到低取同张数，因此卖出张数不能超过该种货物剩余代币数。旧实现允许超出，按 0 分处理。

其它口径：

- 回合四选一：取 1 张货物（取之前手牌 < 7）／收走市场全部骆驼／交换 N≥2 张／卖一种货物。
- 交换：从市场取 N≥2 张货物，同时返还 N 张手牌或骆驼；市场保持 5 张，不从牌堆补牌；交换结束时手牌 ≤ 7（骆驼群不计）。
- 轮结束：3 种货物代币耗尽，或需要补市场时牌堆已空；当前动作完成后结算。
- 计分：货物代币 + 奖励代币；骆驼多的一方 +5（相同则无人得）。同分依次比奖励代币数量、货物代币数量，仍平则该轮无人得 Seal。
- 整场：先拿 2 个 Seal 获胜；上一轮输家下一轮先手；平局则上一轮非先手方先手。
- AI：轻松（简单贪心 + 28% 随机、不主动交换）、标准（完整启发式）、老练（强化启发式：封锁、奖励档、手牌上限、收官判断）。30 局自对弈全部结束、无死循环。

来源：B 站 `BV1V44y1f7SJ`《双人经典桌游--斋普尔教学》、`BV17t411K79L`《【汤米酱】桌游教学057 Jaipur 斋普尔》；UltraBoardGames / gamerules.com 文本规则。

## 2. 引擎结构

`engine.js` 是 UMD 纯规则引擎，Node `require` 与浏览器 `window.JaipurEngine` 均可运行：

- `createGame({seed, first, difficulty, aiDifficulty})`：seed 可复现；每轮洗牌与奖励档都从 `seed + round + label` 派生。
- `getLegalMoves(state)`：卖牌、收骆驼、取牌 + 抽样的交换候选；`isLegalMove` / `validateMove` 对任意交换做完整校验。
- `applyMove(state, move)`：不修改入参，返回全新 state，自动补市场、结算轮末与整场。
- `chooseAIMove(state, difficulty)`：三档 AI。
- `publicState(state, viewerIndex)`：联机视图，隐藏对手手牌、牌堆内容与未翻开的奖励档，只暴露 `handCount` / `deckCount` / `bonusCounts`。
- `computeRoundScores(state)`：货物 + 奖励 + 骆驼 +5 + 三段平局判定。

## 3. 页面与交互

`index.html` 单文件、零外链，复用 `../../shared/shuffle.js` 与 `../../shared/sfx.js`。

- 主界面：对手条、市场 5 张牌 + 牌堆 + 骆驼操作、6 种货物代币行、3 档奖励代币、双方 Seal、商队日志、底部固定操作 dock。
- 操作模式：取牌（点市场牌 → dock 确认）、交换（多选市场牌 + 点手牌/骆驼返还，张数相等才可确认）、卖牌（点手中货物 → ± 张数 → 确认）、收骆驼。
- 移动端：390×844 与 320×568 均无横向滚动；所有主控件 ≥44×44；可见文字 ≥12px；`100dvh`、`env(safe-area-inset-*)`、`prefers-reduced-motion`、触屏关闭 `backdrop-filter`。
- 测试 API：`window.__jaipur` 暴露 `newGame / getState / legalMoves / playMove / isBusy / winner / setState / autoPlayToEnd / animationCounts / reducedMotion / audioUnlocked` 等。

## 4. 联机

- `online-server.mjs` 复用 `../app/rooms.js` 的房间码、单次邀请、密码房、TTL、host/join/leave/start/close。
- 严格 2 人房；房主可带一个空位直接开始，空位 AI 补位。
- 服务端 `engine.js` 权威判定；GET 轮询同步；断线会话重连；空闲超时 AI 临时托管，回来自动清除。
- 结果榜记录 winner / seals / rounds / 最后轮分数；房主可重赛；离座转 AI；关房。
- `online.html` 是房间大厅；对局本体在 `index.html?online=...`，与单人版共用渲染与测试 API。

## 5. 美术

单物件材质（1024×1024、纯白底、左上主光、100mm macro f/11）：

`card-paper`（象牙卡纸）、`camel`（黄铜骆驼摆件）、`token-gold`（黄铜代币）、`token-silver`（银代币）、`silk`（丝绸卷）、`spice`（陶碗香料）、`leather`（皮革卷）、`table-sand`（粉砂岩桌面）。

牌面字符、货物图案（钻石/金锭/银币/绸带/香料碗/皮革）、完整局面、封面/OG/详情排版全部由 `art-render.html` 的 HTML/CSS/SVG 代码合成，不使用 AI 生成文字。封面与详情图展示真实件数：市场 5 张（3 骆驼 + 2 货牌）、55 张牌堆、6 种货物代币、3 档奖励代币、双方骆驼群与 Seal。

## 6. 测试与验收

- `test.js`：333 条断言，覆盖件数守恒、开局、取牌/收骆驼/交换/卖牌、手牌上限、卖牌下限、代币上限、奖励档随机与耗尽、轮结束、Seal、三段平局、非法动作、公开视图遮罩、三档 AI、30 局自对弈与性能预算。
- `test-online.js`：87 条断言，双客户端同局、邀请/密码、AI 补位、重连、超时托管、结算一致、结果榜、重赛、离座、关房。
- `e2e.mjs`：真实 Chrome CDP 无头交互，覆盖加载性能、真实点击一手→AI→终局/重开、390/320/横屏、44px、字号、零外链、SW 离线、规则页 JSON-LD、art-render。
