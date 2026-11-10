# No Thanks! 不谢 · E2E 记录

`e2e.mjs` 使用常驻审计 Chrome（CDP 9333（专用常驻实例，持久 profile，跨运行复用），`chrome-ensure` 复用），只开一个标签页，结束后只关这个标签，不杀浏览器、不建临时 profile。

## 单人浏览器链路

1. 打开 `index.html?fast=1`，等待 `window.__premium.state()`。
2. 校验标题、meta description、viewport、OG 图片、初始牌堆 23 张、首张翻牌、3 名玩家。
3. 校验 `window.Shuffle`、`window.Sfx` 已从 `games/shared` 加载，牌桌与牌面引用本地材质。
4. 真实点击：轮到自己时按 1/4 概率点「跳过」、其余点「收下」，直到 24 张牌全部收走。
5. 校验结算浮层显示、3 行结算、公开 9 张移除牌、三人分数、日志增长。
6. 点「再来一局」，校验回到 playing、牌堆 23、手牌清空。
7. 切换主题与静音；等待 service worker 注册。
8. 390×844 / 320×568 / 844×390 / 568×320 四档：scrollWidth、按钮高度、可见字号、元素越界、牌面尺寸。
9. 规则页：Article + FAQPage JSON-LD、两张详情图、≥1200 汉字、≥3 条 B 站来源。
10. 美术合成页：5 张牌、7 枚筹码、标题与本地材质引用。
11. 性能：FCP、loadEventEnd、DOM 节点、FPS、新局渲染耗时。
12. 零外部请求、零 console error、零页面异常。

## 联机链路

1. 启动 `online-server.mjs`（随机端口）。
2. HTTP 客户端 A 创建房间并取得 session 与单次邀请 token。
3. HTTP 客户端 B 用邀请 token 加入；房主开始，空位补 AI 到 3 人。
4. 浏览器打开 `online.html?room=&session=&player=`，校验 3 个座位、当前牌、房间号、按钮触控高度。
5. 浏览器点击合法动作；随后两个 HTTP 客户端读取同一房间，校验 `stateVersion` 前进、双方看到同一张牌。
6. 调用 reconnect，校验 `reconnected: true`；读取排行榜接口。
7. 打开无参数大厅，校验创建/加入/排行榜控件。

## 控制组

```bash
node games/boardgame/no-thanks-premium/e2e.mjs --control
```

输出 `RESULT: 0 passed, 1 failed` 并以 exit 1 结束，用于证明断言不是恒真。
