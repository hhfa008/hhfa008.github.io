# 四子棋 CONNECT 4 PREMIUM — 设计说明

## 规则模型

`engine.js` 是唯一规则实现，UMD 同时供 Node、单机页与联机服务端使用。状态为
`{ b: Int8Array(42), turn, last, plies, first }`，行优先、第 0 行为顶部。规则严格按官方
Connect Four：7 列 × 6 行、红方先手、轮流落子、圆片落到该列最低空位、四方向任意连续
四子获胜、42 格填满无四连判平局、终局后 `isLegal`/`legalMoves`/`applyMove` 全部封死。
`status()` 返回 `{ over, winner, line, draw }`，`scanWinner()` 返回胜者与完整连线；
`wouldWin()`、`oneMove()` 级别的判定是纯函数。全部 124 条单测覆盖上述规则与 21+21 枚
圆片守恒。

## AI

`aiMove(state, level, budget)` 是纯函数，不修改传入局面，不返回非法列。三档：
简单（立即取胜 → 立即封堵 → 中心优先）、普通（4 层迭代加深 + alpha-beta）、困难
（8 层迭代加深，默认 400ms deadline，每 512 节点检查一次时钟）。评估函数使用 69 个
四格窗口、三连/二连权重、中心列奖励；只有完整跑完的深度才会替换最佳列，因此超时也
不会返回半途的非法结果。终局或满列时返回 `null`。

## 视觉

蓝色注塑 ABS 棋框与红/黄塑料圆片由 `img-gen` 生成单材质特写，代码用
`background-blend-mode: multiply` 把白底材质并入目标色，圆片保留真实塑料高光与模具
纹理。棋盘为 7×6 网格、42 个圆形孔位；落子有重力下落动画（`prefers-reduced-motion`
下关闭）、列悬停预览、最后一手白色内圈、胜利连线金色描边、结果面板与本机比分。
封面 / OG / 两张详情图由 `art-render.html` 用同一套材质合成真实局面：24 手、12 红
12 黄、每列底部连续、无四连。

## 手机适配

390×844 与 320×568 两档：无横向滚动；按钮、下拉与链接触控高度 ≥44px；320px 下图
棋盘每列触控宽度按 `(320 − 页边距 − 边框) / 7` 精确留到 44px；所有可见文字 ≥12px；
`viewport-fit=cover`、`dvh` 与安全区变量；不用 hover 才能完成的操作，点击/键盘都能
完整对局。

## 联机

`online-server.mjs` 只是 `games/shared/online-room-server.mjs` 的适配器，不复制房间
逻辑。`createMatch/view/legalActions/applyAction/aiAction/isOver/result/restart` 将
座位映射为颜色：默认座位 0 = 红、座位 1 = 黄；`restart` 交换 `firstSeat`，因此再来
一局先手方互换。服务端权威执行规则，客户端只渲染公开视图（Connect 4 本身没有隐藏
信息，仍以副本形式公开）。空位由服务端困难 AI 补齐，断线 15 秒后托管，重连恢复；
排行榜记录座位、AI 标记与哈希后的 playerId。

## 取舍

- 单人模式固定玩家执红先手，未做本地双人热座；联机页承担双人跨设备对局。
- 传输采用 HTTP/JSON + 700ms 轮询，复用共享服务端，不引入第二套 WebSocket 协议。
- AI 不使用随机数，同一局面返回同一列，便于测试与复现。
