# 英雄领域 Hero Realms · E2E 记录

`e2e.mjs` 使用常驻审计 Chrome（CDP 9335，专用持久 profile，`chrome-ensure` 复用），只开一个标签页，结束后只关这个标签，不杀浏览器、不建临时 profile。

## 单人浏览器链路

1. 打开 `index.html?fast=1`，等待 `window.__premium.state()`。
2. 校验标题、meta description、viewport、OG 图片、初始 5 张手牌、5 张牌库、5 张市场、双方 50 HP、玩家先手。
3. 校验 `window.Shuffle`、`window.Sfx` 已从 `games/shared` 加载，牌桌/卡面引用本地皮革与羊皮纸材质。
4. 真实点击完整一局：
   - 有战斗时点击「攻击对手英雄」；
   - 否则点击手牌出牌；
   - 手牌空且金币足够时点击市场购买；
   - 否则点击「结束回合」。
5. 校验终局：胜者存在、一方生命归零、结算浮层显示、两行结算、出牌/购买/攻击次数均大于 0。
6. 点「再来一局」，校验回到 playing、手牌 5、牌库 5、市场 5、双方 50 HP。
7. 切换主题与静音；校验共享 `/games/sw.js` 可访问且页面不注册 service worker。
8. 390×844 / 320×568 两档：scrollWidth、按钮高度、可见字号、元素越界、手牌尺寸、市场 5 张。
9. 规则页：Article + FAQPage JSON-LD、两张详情图、≥1200 汉字、≥3 条 B 站来源。
10. 美术合成页：5 张市场牌、7 枚金币、1 颗生命水晶、标题与本地材质引用。
11. 四张成品图实际尺寸：cover 1200×1200、og 1200×630、detail 1200×800。
12. 性能：FCP、loadEventEnd、DOM 节点、FPS、新局渲染耗时。
13. 零外部请求、零 console error、零页面异常。

## 联机链路

1. 启动 `online-server.mjs`（随机端口）。
2. HTTP 客户端 A 创建房间并取得 session 与单次邀请 token；客户端 B 用邀请 token 加入座位 1。
3. 房主开始；校验恰好 2 个座位。
4. 浏览器打开 `online.html?room=&session=&player=`，校验 2 个座位、5 张市场、自己的 5 张手牌、房间号、按钮触控高度。
5. 浏览器点击一张合法手牌；随后 HTTP 客户端读取房间，校验 `stateVersion` 前进。
6. 校验座位 1 的视图看不到座位 0 的手牌，且两客户端看到同一市场。
7. 调用 reconnect，校验 `reconnected: true`；读取排行榜接口。
8. 打开无参数大厅，校验创建/加入/排行榜控件。

## 控制组

```bash
node games/boardgame/hero-realms-premium/e2e.mjs --control
```

输出 `RESULT: 0 passed, 1 failed` 并以 exit 1 结束，用于证明断言不是恒真。
