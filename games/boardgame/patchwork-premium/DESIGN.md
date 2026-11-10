# 拼布艺术 · Patchwork Premium — 设计说明

## 1. 产品定位

双人拼布经济桌游。主题是亚麻、棉布、毛毡与黄铜扣子：玩家在 9×9 个人拼布板上竞争，沿 1–53 时间轴抢布，用扣子支付、用空格换分数。单人模式对战 AI，联机模式为 2 人房间、空位 AI 补位。封面、OG 与详情图全部由代码合成真实局面；AI 只生成单物件材质。

## 2. 规则口径

- 33 块拼布随机排布在 1–53 时间轴上；当前玩家只看到自己时间标记前方最近 3 块。
- 每回合二选一：购买一块前方拼布（支付扣子、旋转/翻转放置、时间前进）或跳过（移动到对手前方一格并获得同等扣子）。
- 时间标记较后者行动；同格时由上一回合未行动者行动。
- 经过/停在 5、11、17、23、29、35、41、47、53 时，按自己棋盘上的扣子图标总数收入。
- 第一位拼出完整 7×7 区域者 +7 分，整局一次。
- 终局：33 块全部买走 / 双方到 53 / 双方都无法购买且无法前进。
- `得分 = 剩余扣子 + 7×7 奖励 − 2 × 空格`。

旧版 `games/boardgame/patchwork/engine.js` 作为结构参考；本实现保留其 33 块基础数据、时间轴与 7×7 校验，并重新实现页面、联机、美术与测试。

## 3. 引擎结构

`engine.js` 为 UMD，浏览器挂 `PatchworkEngine`，Node 直接 `require`。`data.js` 只含 33 块拼布、棋盘与时间轴常量。`applyMove` 不修改入参；`getLegalMoves` 返回全部购买与跳过动作；`chooseAIMove` 用面积、收益、时间成本、贴边与 7×7 前瞻打分。

状态核心：`players[2].board/placed/buttons/time/bonus`、`pieces[{id,slot,owner}]`、`current/lastPlayer/turn/zeroSkips/bonusAwardedTo/over/result/log`。

## 4. 页面与测试 API

`index.html` 使用原生 `<button>`/`<a>`；棋盘格子是 `role=gridcell` 的可点击 div，按钮全部 ≥44×44。布局：比分 → 9×9 棋盘 + 市场/行动/时间轴 → 对局记录。`window.__patchwork` 暴露 `newGame/getState/summary/legalMoves/playMove/setState/isBusy/winner/result/autoPlayToEnd/reducedMotion`。

移动端：`100dvh`、`env(safe-area-inset-*)`、`overflow-x:hidden`；320px 单列、时间轴内部横向滚动；`prefers-reduced-motion` 关闭动画。390×844 与 320×568 均无横向溢出、触控 ≥44、字号 ≥12。

## 5. 联机

`online-server.mjs` 复用 `../app/rooms.js` 的房间码、密码房、单次邀请、TTL、host/join/leave/close。服务端在 `engine.js` 上权威判定；Patchwork 的双方棋盘、拼布队列与时间轴都是公开信息，因此 `publicState` 显式白名单序列化，不返回 seed/rng。支持 2 人房、1 人开局 AI 补位、断线重连、超时托管、结果榜、重赛、离座转 AI 与关房。`test-online.js` 用两个独立 session 跑完整对局。

## 6. 美术

单物件 img-gen 材质（1024×1024，白底，无文字）：`quilt-tile`、`button`、`leather-patch`、`felt`、`button-tray`、`time-strip`。PNG 母版与 WebP 在 `games/assets/art/premium/patchwork/`。`art-render.html` 用代码合成 9×9 真实拼布局面、3 块市场、时间轴与扣子；`render-art.mjs` 输出 1200×1200 cover、1200×630 OG、1200×800 detail-1/2。

## 7. 离线与性能

页面零外链、无 CDN/字体/追踪；注册全局 `/games/sw.js`（v22 shell/lazy/runtime 方案），资源由 `scripts/gen-precache.js` 写入 `games/precache-manifest.js`。`perf.json` 记录 FCP 56ms、DCL 25ms、414 DOM、61fps、新局 1.4ms、单步 0.3ms、材质 257,096B。

## 8. 规则来源

- B 站 BV1dE411n7uD《【勃根地桌遊】拼布藝術 Patch Work 桌遊教學影片》
- B 站 BV1Tr4y1i7qe《patchwork 正经教学》
- B 站 BV1LjpJzXESU《拼布艺术 桌游规则》

## 9. 关键文件

`index.html`、`engine.js`、`data.js`、`rules.html`、`online.html`、`online-server.mjs`、`test.js`、`test-online.js`、`e2e.mjs`、`art-render.html`、`render-art.mjs`、`assets/*`。
