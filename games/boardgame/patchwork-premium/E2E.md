# Patchwork Premium — 浏览器 E2E 记录

命令：`node games/boardgame/patchwork-premium/e2e.mjs`（常驻 Chrome CDP 9222，复用 chrome-ensure，只开一个标签并在结束时关闭）。

结果：**80 passed, 0 failed**。对照 `--control`：**0 passed, 1 failed**，exit 1。

覆盖：

- 首屏 81 格、3 块市场、53 格时间轴、33 块拼布、双方 5 扣子；FCP/DCL/load/DOM 预算；零外部请求、零 console error。
- 真实点击：选市场卡 → 旋转 → 点棋盘格 → 确认放置 → AI 行动；记录买布日志与时间推进。
- `autoPlayToEnd` 到终局 → 结果弹层 2 行分数 → 重开回到 5 扣子。
- 390×844 / 320×568 / 844×390 / 568×320：无横向滚动、触控 ≥44、文字 ≥12。
- 规则页 3 条 B 站来源、7×7、收入格、终局公式。
- `art-render.html?shot=cover`：1200 宽、81 格、16 扣子、6 材质加载。
- 全局 v22 `sw.js` 与 `precache-manifest.js` 版本一致，收录本作与材质。
- 联机页真实创建房间、2 座位、开局后 81 格 + 3 市场 + 双方棋盘。
