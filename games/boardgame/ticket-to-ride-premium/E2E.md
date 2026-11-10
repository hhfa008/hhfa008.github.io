# Ticket to Ride Premium — 浏览器 E2E 记录

命令：`node games/boardgame/ticket-to-ride-premium/e2e.mjs`（常驻 Chrome CDP 9222）。

结果：**77 passed, 0 failed**。对照 `--control`：**0 passed, 1 failed**，exit 1。

覆盖：

- 首屏 40 条路线、20 城、5 张明牌、9 个手牌计数、3 张任务、双方 45 车厢。
- 真实点击：摸 2 张 → AI 回合；抽 3 张任务 → 只保留 1 张 → 4 张任务；给手牌后点地图路线占领。
- `autoPlayToEnd` 到终局 → 结果弹层 2 行 → 重开恢复 45 车厢。
- 390/320/横屏：无横向滚动、触控 ≥44、文字 ≥12。
- 规则页 3 条 B 站来源、110 张卡、最长 +10、≤2 节终局。
- 艺术页 40 路线、20 城、5 明牌、6 材质。
- v22 `sw.js` / `precache-manifest.js` 版本一致并收录本作。
- 联机页真实建房、开局后 40 路线 + 5 明牌 + 双方比分。
