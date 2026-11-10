# ACCEPTANCE — 国际跳棋 · 十路飞王

## 1. 流程测试

- 单测：`node games/boardgame/draughts-premium/test.js` → **86 passed, 0 failed**
- 双客户端联机：`node games/boardgame/draughts-premium/test-online.js` → **76 passed, 0 failed**
- 浏览器 E2E：`node games/boardgame/draughts-premium/e2e.mjs` → **50 passed, 0 failed**
- 故意失败对照：`e2e.mjs --control`、`test-online.js --control` 均 exit 1
- `node games/tests/run-all.js` 自动发现 `test.js` / `test-online.js`。

## 2. 封面 + OG + 详情

- `assets/cover.webp`（1200×1200）、`assets/og.webp`（1200×630）、`assets/detail-1.webp` / `detail-2.webp`（1200×800）；PNG 母版保留。
- 材质：`games/assets/art/premium/draughts/{man-light,man-dark,board-walnut}.webp`、共享绒桌 `shared/table-felt.webp`。
- 40 枚开局棋子、10×10 棋盘、同心车削环与王冠全部代码合成；无 emoji / 占位图。

## 3. realism

`realism.json`：6 类检查全部 `ok: true`，`pass: true`。覆盖 100 格 / 50 深色格 / 每方 20 子、32mm 棋子与 50mm 格、最大吃子、兵四向吃、飞王、连吃升王时机、25 回合判和与三次重复。

## 4. 手机两档

- 390×844：无横向滚动、字号 ≥12px、主控件 ≥44px（19 项 smoke PASS）。
- 320×568：同上，棋盘仍完整显示 40 枚棋子。
- 844×390 横屏：无横向滚动。
- E2E 验证触屏点选、AI 应手、悔棋、终局结果层与联机。

## 5. 联机

- `online.html` 复用共享大厅脚本；`online-server.mjs` 复用共享房间服务器与 `app/rooms.js`。
- 2 人房、邀请单次使用、密码房、空位 AI 补位、断线重连、超时托管、结果榜、房主重开、认输结算。
- `online-e2e.json` 记录双客户端契约；run-all 自动执行 `test-online.js`。

## 结论

五项全部通过，`meta.json` 标记 `shipped`。
