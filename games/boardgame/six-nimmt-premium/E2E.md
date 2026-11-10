# 6 Nimmt! 谁是牛头王 · E2E 记录

`e2e.mjs` 使用常驻审计 Chrome（CDP 9333，专用常驻实例、持久 profile、跨运行复用；`chrome-ensure` 复用），只开一个标签页，结束后只关这个标签，不杀浏览器、不建临时 profile。

## 单人浏览器链路

1. 打开 `index.html?fast=1`，等待 `window.__premium.state()`。
2. 校验标题、meta description、viewport、OG 图片、第 1 轮、四行、三人、每人 10 张、阶段 `pick`。
3. 校验 `window.Shuffle`、`window.Sfx` 已从 `games/shared` 加载，牌桌与手牌引用本地毛毡/卡纸材质。
4. 真实点击完成一局：每轮点一张手牌；若出现「低于所有行尾」则点选一行；AI 暗牌由页面自动补齐。
5. 校验十轮结束、手牌打光、`taken + rows = 30`、公开 70 张未使用牌、结算浮层三名玩家、日志增长。
6. 点「再来一局」，校验回到第 1 轮、手牌 10 张、无吃牌。
7. 人数选择器切到 4 人，校验四名玩家各 10 张；切回 3 人。
8. 数字键 1 出牌，校验 `turnCount` 前进。
9. 切换主题与静音；请求共享 `/games/sw.js`；校验手牌/导航触控高度。
10. 390×844 / 320×568 / 844×390 / 568×320 四档：`scrollWidth`、按钮/链接高度、可见字号、元素越界、四行牌桌宽度。
11. 规则页：Article + FAQPage JSON-LD、两张详情图（detail-1/2.webp）、≥1200 汉字、≥3 个 BV 号与 3 条 B 站链接、计分表。
12. 美术合成页：4 行、18 张牌（15 张明牌 + 3 张暗牌）、危险牌高亮、≥5 枚牛头 token、标题「六张就爆」、本地毛毡/卡纸/牌背。
13. 四张产物 WebP 的真实宽高、11 个交付文件、6 件本地材质存在且非空。
14. 性能：FCP、loadEventEnd、DOM 节点、FPS、新局渲染耗时；写回 `perf.json`。
15. 零外部请求、零 console error、零页面异常。

## 联机链路

1. 启动 `online-server.mjs`（随机端口，`idleTimeoutMs: 8000`，`aiDelayMs: 0`）。
2. HTTP 客户端 A 创建房间并取得 session 与单次邀请 token；客户端 B 用邀请加入。
3. 房主开始，空位补 AI 到 3 人。
4. 浏览器打开 `online.html?room=&session=&player=`，校验 3 个座位、四行、10 张手牌、房间号、手牌触控高度。
5. 浏览器点击一张手牌暗出；读取两个 HTTP 客户端：`stateVersion` 前进、四行一致、出牌者 `myPick` 正确、对手只看到 `picked: true` 且 `pickedCard: null`、对手手牌为 `null`。
6. 调用 reconnect，校验 `reconnected: true`；读取排行榜接口。
7. 打开无参数大厅，校验创建/加入/排行榜控件；随后离开轮询页面再关闭房间服务，避免残留轮询污染 console。
8. 最终统一检查零外部请求、零 console error、零页面异常。

实际结果：`RESULT: 126 passed, 0 failed`（含 390×844 / 320×568 两档手机布局、规则页、美术合成与浏览器联机段）。

## 控制组

```bash
node games/boardgame/six-nimmt-premium/e2e.mjs --control
```

输出 `RESULT: 0 passed, 1 failed` 并以 exit 1 结束，用于证明断言不是恒真。
