# ACCEPTANCE — 中国象棋 · 楚河汉界

五项硬性要求逐条对应：

## 1. 流程测试

- 单测：`node games/boardgame/xiangqi-premium/test.js` → **87 passed, 0 failed**
- 双客户端联机：`node games/boardgame/xiangqi-premium/test-online.js` → **79 passed, 0 failed**
- 浏览器 E2E：`node games/boardgame/xiangqi-premium/e2e.mjs` → **49 passed, 0 failed**
- 故意失败对照：`e2e.mjs --control` 与 `test-online.js --control` 均 exit 1
- `node games/tests/run-all.js` 自动发现 `test.js` / `test-online.js`。

## 2. 封面 + OG + 详情

- 本地真实位图：`assets/cover.webp`（1200×1200）、`assets/og.webp`（1200×630）、`assets/detail-1.webp` / `detail-2.webp`（1200×800）。
- 母版 PNG 同目录保留；`render-art.mjs` 可重跑。
- 单物件材质：`games/assets/art/premium/xiangqi/{piece-wood,board-wood,table-walnut}.webp`。
- 棋盘、32 枚棋子、字符、局面全部由代码合成；无 emoji、无占位图。

## 3. realism

`realism.json`：6 类检查（count / dimension / proportion / color / material / rule）全部 `ok: true`，`pass: true`。覆盖 32 子、9×10、Ø30mm×10mm、红字/黑字同木载体、马腿象眼炮架、将帅照面、120 半回合与三次重复判和。

## 4. 手机两档

- 390×844：无横向滚动、最小可见字号 12px、主控件 ≥44px（19 项 smoke PASS）。
- 320×568：同上，棋盘仍完整显示 32 枚棋子。
- 844×390 横屏：无横向滚动。
- E2E 同时验证触屏点击走子、结果层按钮与联机页。

## 5. 联机

- `online.html` 大厅 + `online-server.mjs` 房间服务；共享 `games/shared/boardgame-room-server.mjs`，底层复用 `app/rooms.js`。
- 2 人房、邀请 token 单次使用、密码房、空位 AI 补位、断线重连、约 15 秒超时托管、结果榜、房主重开。
- `online-e2e.json` 记录双客户端契约；`test-online.js` 由 run-all 自动执行。

## 结论

五项全部通过，`meta.json` 标记 `shipped`。任何一项回退（例如 smoke 失败、联机契约缺失）都应把状态改回 `draft`。
