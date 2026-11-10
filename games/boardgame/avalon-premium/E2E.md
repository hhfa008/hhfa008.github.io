# Avalon 阿瓦隆 · E2E 记录

`e2e.mjs` 使用常驻审计 Chrome（CDP 9333，专用常驻实例、持久 profile、跨运行复用；`chrome-ensure` 优先复用），只开一个标签页，结束后只关这个标签，不杀浏览器、不建临时 profile。

## 单人浏览器链路

1. 打开 `index.html?fast=1`，等待 `window.__premium.state()`。
2. 校验标题、meta description、viewport、OG 图片、5 名玩家、任务表 2/3/2/3/3、五个任务卡槽与五个座位。
3. 校验 `window.Shuffle` 与 `window.Sfx` 来自 `games/shared`；圆桌引用本地毛毡，身份卡引用本地羊皮纸。
4. 隐藏信息：进行中 `players[].revealedRole` 全为 null、`reveal` 为 null、玩家对象不含 `role` 字段；按本人角色校验知识矩阵（梅林 2 个 `evil`、派西维尔 2 个 `magic`、邪恶 1 个 `evil-ally`、忠臣 0 个额外情报）。
5. 真实点击：提名阶段逐个点击座位并确认；投票阶段点赞成；任务阶段（若在队伍中）点任务成功；暗杀阶段（若本人是刺客）点目标。循环直到结算。
6. 校验结算浮层、5 行身份翻牌、任务轨道、日志、赢家与胜负原因。
7. 点「再来一局」回到第一次任务；切换主题与静音；键盘数字键选中座位。
8. 390×844 / 320×568 / 844×390 / 568×320 四档：scrollWidth、按钮高度、可见字号、元素越界、五个座位与任务轨道可见。
9. 规则页：Article + FAQPage JSON-LD、两张详情图、≥1200 汉字、≥3 条 B 站来源、官方任务表。
10. 美术合成页：5 张任务卡、封面标题、圆桌毛毡与任务石板材质引用。
11. 性能：FCP、loadEventEnd、DOM 节点、FPS、新局渲染耗时。
12. 零外部请求、零 console error、零页面异常。

## 联机链路

1. 启动 `online-server.mjs`（随机端口，超时 8 秒）。
2. HTTP 客户端 A 创建房间并取得 session 与单次邀请 token；客户端 B 用邀请 token 加入。
3. 房主开始，空位 AI 补齐到恰好 5 人；两个 HTTP 客户端确认各自角色不同、他人角色不可见。
4. 浏览器打开 `online.html?room=&session=&player=`，校验 5 个座位、5 个任务卡槽、身份卡、房间号、按钮触控高度。
5. 浏览器作为队长选人并提交；随后两个 HTTP 客户端读取同一房间，校验 `stateVersion` 前进、双方看到同一任务序号与同一份隐藏视图投影。
6. 调用 reconnect，校验 `reconnected: true`；读取排行榜接口。
7. 打开无参数大厅，校验创建/加入/排行榜控件。

## 控制组

```bash
node games/boardgame/avalon-premium/e2e.mjs --control
```

输出 `RESULT: 0 passed, 1 failed` 并以 exit 1 结束，用于证明断言不是恒真。

联机测试也有独立控制组：

```bash
node games/boardgame/avalon-premium/test-online.js --control   # 期望 exit 1
```
