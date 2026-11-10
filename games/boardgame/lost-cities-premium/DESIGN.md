# 失落之城 · Lost Cities Premium — 设计说明

## 1. 产品定位

双人三局制探险卡牌。主题为失落雨林中的羊皮纸地图、苔藓绿绒布、石灰岩遗迹与黄铜罗盘。单人模式对战三档 AI，联机模式为 2 人房间、空位 AI 补位。页面全部中文，标题使用 `Songti SC 700`，字符、数字、五色牌面、局面与封面排版全部由代码合成；AI 只生成 7 个单物件材质。

## 2. 规则口径（实现以这里为准）

- 60 张 = 5 色 ×（数字 2–10 九张 + 赌注三张）；每色恰 12 张。
- 双方各 8 张手牌，牌堆 44 张；五色弃牌堆共享，按颜色分开。
- 一个回合严格两步：先打出一张牌（放入自己同色探险列或弃到同色弃牌堆顶），再抽一张牌（牌堆顶或任一弃牌堆顶）。
- **不能抽自己本回合刚弃出的那张牌**；其他弃牌堆顶、自己以前弃的牌均可抽。
- 数字牌必须严格递增；赌注牌只能在该列还没有数字牌时打出，可连续 1–3 张；有数字后永久不能再押。
- 任一玩家从牌堆抽走最后一张的瞬间本局立即结束；对手不再补回合。
- 每色计分：
  - 无任何牌：0。
  - 只有赌注：每张 -20。
  - 有数字：(数字和 - 20) × (1 + 赌注数)。
  - 该列数字 + 赌注总张数 ≥ 8：额外 +20。
- 共 3 局，累计总分；每局由上一局高分者先手，局分相同沿用上一局先手；总分相同共享胜利。

旧版 `games/boardgame/lost-cities/engine.js` 只作为结构参考。旧实现缺少弃牌堆抽牌、8 张奖励，且终局用“对手再走一手”；本实现没有沿用这些错误口径。

## 3. 引擎结构

`engine.js` 为 UMD，浏览器挂 `LostCitiesEngine`，Node 可直接 `require`。洗牌复用 `games/shared/shuffle.js` 的 seeded Fisher-Yates，同一 seed 与动作序列可复现。

状态核心：

```
phase: 'play' | 'draw' | 'over'
current / starter / round / rounds=3
deck[] / discards{color:[card]}
players[2] = { hand[], exp{color:{wagers[],nums[]}}, roundScores[], totalScore }
pendingDiscard  // 本回合刚弃的牌 id
lastAction / lastRound / roundResults / result / log
```

`applyMove` 不修改入参，非法动作抛 `Error`。每局结束会立即结算、记录 `roundResults`，若未满三局则重置手牌/探险列、重新用 seed+局号洗牌并自动进入下一局，`lastRound` 保留供 UI 展示局间结果。第三局结束进入 `over`，`result` 包含三局局分与累计总分。

`getLegalMoves` 在 `play` 阶段给出全部“打出/弃掉”动作，在 `draw` 阶段给出牌堆和可用弃牌堆顶，并排除 `pendingDiscard`。

## 4. AI

三档 AI 只从合法动作中选择，不读取暗牌身份：

- `easy`：基于 seed/回合哈希的确定性随机，覆盖出牌与抽牌。
- `normal`：出牌用“开列风险、递增收益、赌注放大、弃牌保留价值”启发式；抽牌在已知弃牌与未知牌堆之间选择，并限制连续拿弃牌造成停滞。
- `hard`：对前 9 个出牌候选做完整回合前瞻，结合局势估值和启发式分；能主动利用高价值弃牌堆，也保留进取性，避免把牌全部弃光。

为防止 AI 自对弈卡在弃牌循环，连续两次抽弃牌后强制转向牌堆；回合上限作为最后保险。测试用 30 局（三档轮换）验证全部结束且牌张守恒。

## 5. 单人页面

`index.html` 使用原生 `<button>`/`<a>`，所有主触控目标 ≥44×44。布局：顶部品牌与规则/联机入口 → 比分（本局/累计/三局 pips）→ 双方面板各 5 条探险列 → 共享 5 色弃牌堆 → 牌堆与局数 → 手牌 → 抽牌 dock → 日志。

操作流：点手牌 → 高亮同色且合法的探险列/弃牌堆 → 点目标 → 进入抽牌阶段 → 点牌堆或弃牌堆顶 → 若对手为 AI 自动行动。Escape 清除选择；提示按钮给出合法建议；音效由点击手势解锁。

测试 API：`window.__lostcities` 暴露 `newGame/getState/legalMoves/playMove/isBusy/winner/result/score/selection/reducedMotion/audioUnlocked/animationCounts/autoPlayToEnd/setState/engine`。

移动端：`100dvh`、`env(safe-area-inset-*)`、`overflow-x:hidden`、`prefers-reduced-motion` 关闭动画、触屏禁用 backdrop-filter。320px 用 4 列手牌和 5 列窄探险列，无横向滚动。

## 6. 联机

`online-server.mjs` 复用 `../app/rooms.js`：房间码、密码房、单次邀请、TTL、host/join/leave/close。服务端在 `engine.js` 上权威判定，支持：

- 2 人房间，1 人也能开局，空座 AI 补位；
- 邀请 token、密码房、PII 拒绝；
- 每个视角只返回自己的手牌，对手只暴露手牌数量；永不序列化牌堆顺序；
- 断线重连、300ms 级测试可调的 idle takeover；
- 结果榜、重赛、离座转 AI、关房；
- HTTP 轮询同步，AI tick 由服务端推进。

`online.html` 是独立大厅 + 对局页，可从 URL `?room=&session=&player=` 恢复会话。`test-online.js` 启真实 HTTP 服务并用两个独立 session 跑同局、结算、重连、托管、换榜、重赛与关房。

## 7. 美术

单物件 img-gen 材质（1024×1024，白底，无文字）：`card-paper`、`compass`、`stone-tablet`、`jungle-felt`、`wood-chest`、`wager-seal`、`map-scroll`。PNG 母版与 WebP 均在 `games/assets/art/premium/lost-cities/`。

`art-render.html` 用 HTML/CSS 合成真实局面：10 条探险列（双方各 5）、**5 个共享弃牌堆**、8 张手牌、牌堆、赌注与比分。`render-art.mjs` 用 headless Chrome 截 1200×1200 cover、1200×630 OG、1200×800 detail-1/2，再 `cwebp` 输出 WebP。封面/OG/详情都含真实件数，不是氛围图。

## 8. 性能与约束

首页零外链、无 CDN/字体/追踪；只加载本地 engine、shared shuffle/sfx、7 个 WebP 材质。SW 预缓存页面 shell、联机页、规则页、engine、shared、材质与 cover/OG/details。实测见 `perf.json`。

## 9. 规则来源

- B 站 BV1bt411K79U《【汤米酱】桌游教学085 Lost Cities 失落之城》
- B 站 BV197411N7nn《【勃根地桌遊】失落的城市 Lost Cities 桌遊教學影片》
- UltraBoardGames — Lost Cities Game Rules: https://ultraboardgames.com/lost-cities/game-rules.php

## 10. 关键文件

`index.html`、`engine.js`、`rules.html`、`online.html`、`online-server.mjs`、`test.js`、`test-online.js`、`e2e.mjs`、`art-render.html`、`render-art.mjs`、`sw.js`、`assets/*`。
