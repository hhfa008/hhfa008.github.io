# War Chest Premium — 浏览器 E2E 记录

命令：`node games/boardgame/war-chest-premium/e2e.mjs`（常驻 Chrome CDP 9222）。

结果：**76 passed, 0 failed**。对照 `--control`：**0 passed, 1 failed**，exit 1。

覆盖：

- 首屏 49 格、6 据点、4 枚单位币按钮、4 行预备队、双方 2/4 据点、16 枚币。
- 真实点击：选手牌单位币 → 点高亮格部署 → 点己方单位 → 点高亮格移动 → 结束回合等 AI 完成。
- `autoPlayToEnd` 到终局 → 结果弹层 → 重开恢复 16 枚币。
- 390/320/横屏：无横向滚动、触控 ≥44、文字 ≥12。
- 规则页 3 条 B 站来源、4 据点胜利、16 枚币、3 行动、2 耐久。
- 艺术页 49 格、6 据点、12 单位、4 枚单位币、6 材质。
- v22 `sw.js` / `precache-manifest.js` 版本一致并收录本作。
- 联机页真实建房、开局后 49 格 + 6 据点 + 4 单位币 + 双方比分。
