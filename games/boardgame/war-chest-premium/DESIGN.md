# 战争宝箱 · War Chest Premium — 设计说明

## 1. 产品定位

双人抽币式抽象战棋。主题是旧金属单位币、亚麻抽袋与胡桃木据点：玩家从单位袋抽币，部署、行军、攻击，争夺 7×7 战场上的 6 个据点。单人模式对战 AI，联机 2 人房、空位 AI 补位。

## 2. 规则口径

- 7×7 棋盘、6 个据点；双方各从 2 个据点起步，中间 2 个中立；先控制 4 个据点获胜。
- 双方各 4 种单位，每种 4 枚单位币，共 16 枚：剑士（2 步 / 1 射 / 2 耐久）、弓箭手（1 步 / 3 射 / 1 耐久）、骑兵（3 步 / 1 射 / 1 耐久）、斥候（3 步 / 不能攻击 / 1 耐久）。
- 每回合补到手牌 3 枚；每枚币执行 1 个行动（部署/移动/攻击），最多 3 个；回合结束弃掉剩余手牌。
- 部署：己方据点相邻空格，不能直接放在据点上。
- 移动：上下左右、不能穿单位；攻击：按射程曼哈顿距离，必要时先接近；每次 1 点伤害，0 耐久被击破并回到预备队。
- 单位停在非己方据点上即夺取控制权，控制保留到被对手再次夺取。
- 120 个玩家回合未分胜负时，依次比较据点数和场上单位数。

旧版 `games/boardgame/war-chest/engine.js` 提供结构参考；本实现修正为 6 据点/4 胜利、4 种单位 ×4 枚、移除大本营、加入耐久与真实部署限制，并重做页面、联机与美术。

## 3. 引擎结构

`engine.js` 为 UMD，依赖 `data.js`。核心 API：`createGame/legalActions/applyAction/chooseAIAction/controlCount/unitsOf/coinTotal/handCounts`。状态含 `players[2].bag/hand/discard/reserves`、`units[{id,owner,type,r,c,hp,maxHp}]`、`strongholds[{id,r,c,owner}]`、`current/turn/over/result/log`。

## 4. 页面与测试 API

`index.html` 用 7×7 网格与 6 个据点的真实布局；选择单位币高亮可部署格，选择己方单位高亮可移动格与可攻击敌人。`window.__war` 暴露 `newGame/getState/legalActions/applyAction/setState/isBusy/winner/result/autoPlayToEnd/reducedMotion`。

移动端 `100dvh`、`env(safe-area-inset-*)`、无横向滚动；390×844 与 320×568 均通过触控/字号/溢出检查。

## 5. 联机

`online-server.mjs` 复用 `../app/rooms.js`。服务端权威 `applyAction`；每个视角只返回自己的手牌，袋/弃币/预备队/据点/单位公开。支持邀请、密码房、1 人开局 AI 补位、断线重连、超时托管、结果榜、重赛、离座转 AI、关房。`test-online.js` 双客户端跑完整对局并校验结算一致。

## 6. 美术

材质：`silver-coin`、`bronze-coin`、`canvas-bag`、`stronghold`、`playmat`、`command-token`（1024×1024 白底无文字）。`art-render.html` 合成 49 格战场、6 据点、12 个单位和 4 枚单位币；`render-art.mjs` 输出 cover/OG/detail。

## 7. 离线与性能

零外链；注册全局 `/games/sw.js`（v22），`scripts/gen-precache.js` 生成清单。`perf.json`：FCP 0ms（headless 未上报）、DCL 11ms、237 DOM、61fps、新局 0.6ms、单步 0.1ms、材质 636,450B。

## 8. 规则来源

- B 站 BV1AK411L7jz《战争宝盒 规则介绍》
- B 站 BV1aJ411G7eR《【六土桌游讲解】War Chest 战争宝盒》
- B 站 BV1RP4y1w7BS《War Chest 战争宝盒 第一期精彩对决》

## 9. 关键文件

`index.html`、`engine.js`、`data.js`、`rules.html`、`online.html`、`online-server.mjs`、`test.js`、`test-online.js`、`e2e.mjs`、`art-render.html`、`render-art.mjs`、`assets/*`。
