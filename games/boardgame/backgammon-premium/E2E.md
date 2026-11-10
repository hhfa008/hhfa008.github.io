# 双陆棋 Backgammon · E2E 记录

`e2e.mjs` 使用常驻审计 Chrome（CDP 9333，`chrome-ensure` 复用；只开一个标签页，结束后只关这个标签，不杀浏览器、不建临时 profile）。

## 单人浏览器链路

1. 打开 `index.html?fast=1`，等待 `window.__premium.state()`。
2. 校验标题、meta description、viewport、OG 图片、24 点、30 枚棋子、双方 pip 167、开局摆法、倍数方块 1、白方先手。
3. 校验共享音效、`ui.js` 棋盘渲染、材质引用与主题/静音/AI 难度控件。
4. 真实点击完成一局已知残局：载入 `backgammonFinish` 场景（白方 14 枚离盘、1 点在 1 点；黑方有 1 枚留在白方 home），设置骰子 1+1，点击 1 点的棋子，再点击白方 OFF 区；校验 backgammon ×3、得 3 分、结算浮层。
5. 新局校验 pip 167、30 枚、off 0、cube 1；掷骰后走一步再撤销，校验棋子回到原位。
6. AI 回合一节：新局后掷骰/结束回合，等待黑方自动掷骰并走子，校验回合推进。
7. 校验 AI 难度选择器、键盘 R/U/N、ARIA 标签。
8. 390×844 与 320×568 两档：`scrollWidth`、按钮/链接/选择器高度、可见字号、元素越界。
9. 规则页：Article + FAQPage JSON-LD、两张详情图、≥1200 汉字、≥2 个 BV 号与 B 站链接、尺寸表。
10. 美术合成页：24 点、30 枚棋子、15/15、标题与本地材质。
11. 四张产物 WebP 宽高、交付文件、四件本地材质存在且非空。
12. 性能：FCP、loadEventEnd、DOM 节点、FPS、新局渲染耗时，写回 `perf.json`。
13. 零外部请求、零 console error、零页面异常。

## 联机链路

1. 启动 `online-server.mjs`（随机端口，`idleTimeoutMs: 8000`，`aiDelayMs: 0`）。
2. HTTP 客户端 A 创建房间并取得 session 与邀请 token；客户端 B 用邀请加入。
3. 房主开始，确认 2 个座位；若只开 1 人则空位由 AI 补齐。
4. 浏览器打开 `online.html?room=&session=&player=`，校验 2 个座位、24 点棋盘、30 枚棋子、骰子/倍数方块/操作按钮。
5. 浏览器点击掷骰或走子；读取两个 HTTP 客户端：`stateVersion` 前进、棋盘一致、合法动作只返回给本人。
6. 调用 reconnect，校验 `reconnected: true`；读取排行榜接口；打开无参数大厅校验创建/加入/排行榜控件。
7. 最终统一检查零外部请求、零 console error、零页面异常。

实际结果：`RESULT: 142 passed, 0 failed`（含 390×844 / 320×568 两档手机布局、规则页、美术合成与浏览器联机段）。控制组 `RESULT: 0 passed, 1 failed`，exit 1。

## 控制组

```bash
node games/boardgame/backgammon-premium/e2e.mjs --control
```

输出 `RESULT: 0 passed, 1 failed` 并以 exit 1 结束，证明断言不是恒真。
