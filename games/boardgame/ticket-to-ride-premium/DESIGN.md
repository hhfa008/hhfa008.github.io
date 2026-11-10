# 车票之旅 · Ticket to Ride Premium — 设计说明

## 1. 产品定位

双人美国铁路网桌游。主题是黄铜、亚麻地图与复古车厢卡：玩家摸车厢卡、占领城市间路线、完成目的地任务，并在终局争夺最长连续路线。单人模式对战 AI，联机 2 人房、空位 AI 补位。页面、地图与局面由代码合成；AI 只生成单物件材质。

## 2. 规则口径

- 110 张车厢卡 = 8 色 × 12 + 14 张机车；每人 45 节车厢。
- 开局 4 张手牌、3 张任务；明牌区 5 张。
- 回合三选一：摸 2 张卡（明牌区机车独占整个摸牌行动）、占领 1 条路线、抽 3 张任务并至少保留 1 张。
- 路线支付同色卡，灰色路线任意单一颜色，机车可替代任意颜色。
- 路线分：1/2/3/4/5/6 段 = 1/2/4/7/10/15 分。
- 任务完成 +分值，未完成 −分值；最长连续路线（按车厢节数）额外 +10，并列都加。
- 任意玩家剩余车厢 ≤2 时触发最后一轮，每人再行动一次后结算。
- 牌堆耗尽时洗回弃牌堆，不是终局条件。

旧版 `games/boardgame/ticket-to-ride/engine.js` 提供结构参考；本实现把地图扩到 20 城/40 路线、卡牌经济修正为 110 张、最长路线改为按车厢长度加权重、补上弃牌洗回与明牌机车规则。

## 3. 引擎结构

`engine.js` 为单文件 UMD，浏览器挂 `TicketToRideEngine`，Node 直接 `require`。状态包含 `deck/market/discard/ticketDeck/routes/players/turn/phase/drawsLeft/finalTurnPlayer/over/log`。`legalMoves` 给出摸牌、占路、抽任务与任务保留子集；`applyMove` 不修改入参；`aiMove` 只从合法动作中选择。

## 4. 页面与测试 API

`index.html` 用内联 SVG 画 20 城 40 路线；城市标签 12px、路线有 13px 透明点击热区。右侧是明牌区、手牌计数、任务与战报。`window.__ttr` 暴露 `newGame/getState/legalMoves/playMove/setState/isBusy/winner/result/autoPlayToEnd/reducedMotion`。

移动端 `100dvh`、`env(safe-area-inset-*)`、无横向滚动；390×844 与 320×568 均通过触控/字号/溢出检查。

## 5. 联机

`online-server.mjs` 复用 `../app/rooms.js`。服务端权威 `applyMove`；每个视角只返回自己的手牌与已保留任务，对手只暴露数量；不序列化牌堆顺序。支持邀请、密码房、1 人开局 AI 补位、断线重连、超时托管、结果榜、重赛、离座转 AI、关房。`test-online.js` 双客户端跑完整对局并校验结算一致。

## 6. 美术

材质：`train-car`、`card-stock`、`board`、`ticket`、`brass-marker`、`wood-train`（1024×1024 白底无文字）。`art-render.html` 合成 20 城地图、40 条路线、5 张明牌与任务卡；`render-art.mjs` 输出 cover/OG/detail-1/detail-2（1200×1200 / 1200×630 / 1200×800）。

## 7. 离线与性能

零外链；注册全局 `/games/sw.js`（v22），`scripts/gen-precache.js` 生成清单。`perf.json`：DCL 10ms、load 25ms、400 DOM、61fps、新局 0.6ms、单步 0.2ms、材质 569,054B；FCP 在某些 headless 运行不上报，以 DCL 为可靠信号。

## 8. 规则来源

- B 站 BV14J411H7fL《【汤米酱】桌游教学123 Ticket to Ride Europe 铁路环游 欧洲篇》
- B 站 BV1R3411b7Rt《【规则教学】Ticket to Ride: Europe》
- B 站 BV12d4y1L7NZ《[桌游教学] 车票之旅美国篇 完整规则》

## 9. 关键文件

`index.html`、`engine.js`、`rules.html`、`online.html`、`online-server.mjs`、`test.js`、`test-online.js`、`e2e.mjs`、`art-render.html`、`render-art.mjs`、`assets/*`。
