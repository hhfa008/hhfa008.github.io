# 五子棋 · 精美版 Gomoku Premium — E2E

> 本文件记录本目录已实际执行的端到端验证；浏览器 390/320 冒烟由集成方串行执行，此处标为待跑。

## 1. 双客户端联机 E2E

命令：

```
node games/boardgame/gomoku-premium/test-online.js
```

实现：

- 导入 `online-server.mjs` 的 `createServer()`，在 `127.0.0.1:0` 启动真实 HTTP 服务；
- 两个进程内客户端（`p1` 房主、`p2` 客人）各自持有独立 session，通过 `fetch` 调用房间 API；
- 另起一个短 idle 超时服务器（300ms）专门验证托管；
- 不 mock 引擎、不 mock 房间服务；规则由服务器 `engine.js` 判定。

覆盖的场景：

1. `/health` 返回 `game=gomoku`。
2. 创建 2 人房，返回 roomId / session / invite。
3. 邀请码加入；第三人加入返回 `E_FULL`。
4. 单人房主开局返回 `E_PLAYERS`（共享服务器语义：至少 2 名真人，空位才 AI）。
5. 密码房：错误密码 `E_PASSWORD`，正确密码成功。
6. 非房主开局 `E_HOST`；房主开局成功，黑先、棋盘为空、2 个真人座位。
7. 房主落子后客人看到同一棋盘、同一手数、轮到客人；客人落子后房主同步。
8. 越权落子 `E_TURN`，重复落子 `E_ACTION`。
9. 坏 token `E_TOKEN`，正确 token 重连保留座位与同一局。
10. 完整下到黑棋五连：双方终局一致（棋盘、胜者、比分、手数）。
11. 榜单写入 `game=gomoku` 与当前 roomId。
12. 非房主重赛 403；房主重赛清空棋盘、黑先、保留 2 人。
13. 客人离开后座位转 AI；房主落子后 AI 实际落子。
14. idle 超时座位进入 `takeoverSeats`；重连清除该座位托管。
15. 非房主关房 403；房主关房后 GET 404。

结果：

```
HTTP 请求数: 60+
ONLINE_E2E_JSON: {"game":"gomoku","clients":2,"sameGame":true,"settlementConsistent":true,
"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"runAll":true,
"result":"90 passed, 0 failed","exitCode":0}
RESULT: 90 passed, 0 failed
```

对照：

```
node games/boardgame/gomoku-premium/test-online.js --control
# RESULT: 0 passed, 1 failed
# exit 1
```

## 2. 单机 / 双人浏览器冒烟

页面已实现：

- 390×844 与 320×568 单列布局，无横向滚动；
- 主要按钮 / 链接 `min-height:44px`；
- 可见字号 ≥12px；
- `viewport-fit=cover`、`100dvh`、安全区；
- Canvas 触屏「预览 + 同点确认」，鼠标单击直接落子；
- 无外部请求、无 console 错误目标。

待集成方执行（本目录不并发跑 Chrome，避免抢 CDP）：

```
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games .tmp/gomoku-games.txt \
  --width 390 --height 844 --json .tmp/gomoku-smoke-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games .tmp/gomoku-games.txt \
  --width 320 --height 568 --json .tmp/gomoku-smoke-320.json
```

## 3. 离线 / SW

- 页面与材质全部本地；`index.html` 不加载远程脚本。
- 全局 `games/sw.js` + `games/precache-manifest.js`；`test.js` 校验两者版本一致且 ≥v20。
- 集成方运行 `node scripts/gen-precache.js` 后，manifest 应包含：
  `/games/boardgame/gomoku-premium/index.html`、`engine.js`、`data.js`、
  `/games/assets/art/premium/gomoku/cover.webp` 等。`test.js` 在检测到入口后会自动升级为强制断言。
