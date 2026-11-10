# 石器时代 · Stone Age — E2E 与联机证据

## 单机/页面 E2E

- `node games/boardgame/stone-age-premium/test.js`：93 断言，覆盖数据、开局确定性、放置限制、采集/工具/成长/农业、文明卡/建筑、喂食、终局计分、AI 30 局、完整一局、页面契约。
- `game-smoke.mjs` 390×844 与 320×568：19 checks PASS；0 外部请求、0 console error、0 异常；字号 ≥12px；主触控 ≥44px；无横向滚动。

## 双客户端联机 E2E

`node games/boardgame/stone-age-premium/test-online.js`（53/0）：

- 房间：创建 / 邀请加入 / 邀请单次使用 / 密码房 / 私密房 / PII 拒绝。
- 房主开局；非房主开局 403；越权行动 409；非法放置 422；错误 session 403。
- 双客户端同局：放置 → 结算 → 喂食全流程同步；资源/食物/工人面板一致；建筑叠耗尽或文明卡不足终局；双方结算一致。
- 断线重连 `E_TOKEN` 对照；闲置超时 `takeoverSeats` 记录并可由重连清除。
- 终局榜单 `game=stoneage`、房主重赛、离开转 AI、房主关闭房间。

## 联机实现

- 服务器：`online-server.mjs` → 共享 `../app/online-game.mjs` → `../app/rooms.js`。
- 公共状态：地点占用、建筑叠顶部/数量、文明卡展示位、玩家公开面板（资源/食物/工具/工人/建筑/文明卡）；文明卡牌库与建筑背面不下发。
- 规则权威：服务器只接受 `engine.js` 的合法动作；AI 补位与接管也走同一引擎。

## 性能

`perf.json`：FCP 56ms、DOMContentLoaded 14ms、load 14ms、DOM 233 节点、材质 2,054,604B、外部请求 0（resident Chrome CDP 9222）。

## 复跑命令

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/stone-age-premium/test.js
node games/boardgame/stone-age-premium/test-online.js
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/sa-list.txt --width 390 --height 844
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/sa-list.txt --width 320 --height 568
node games/boardgame/stone-age-premium/test-online.js --control   # 预期 exit 1
```
