# E2E — 中国象棋 · 楚河汉界

自动化入口：

```bash
node games/boardgame/xiangqi-premium/e2e.mjs
node games/boardgame/xiangqi-premium/e2e.mjs --control   # 故意失败，exit 1
```

测试使用**独立 headless Chrome**（自有 `.tmp/e2e-profile-xiangqi`，结束即删），通过 CDP 驱动真实页面；不截图、不做 OCR，只读 DOM、控件尺寸、引擎状态与网络事件。

## 覆盖

| 分组 | 断言 |
|---|---|
| 初始加载 | 标题、meta description、viewport、32 枚真实棋子、90 个交叉点热区、引擎局面 |
| 390×844 | 无横向滚动、可见字号 ≥12px、主控件 ≥44×44px、DOM < 2500 |
| 走子 / 悔棋 | 红炮合法走子、中文记谱、AI 执黑应手、人机悔棋退回双方各一步 |
| 同屏双人 | 黑方不自动走子，模式按钮 aria-pressed 正确 |
| 将死 | 载入三步杀局面，走子后 `over/checkmate`、结果层显示“红方胜” |
| 320×568 | 无横向滚动、字号 ≥12px、控件 ≥44px、棋盘仍 32 枚 |
| 844×390 | 无横向滚动、32 枚棋子 |
| 规则页 | Article + FAQPage JSON-LD 可解析、走法表存在、320px 无溢出 |
| 联机 | 真实房间服务器：创建 / 邀请加入 / 开始 / 浏览器走子 / 第二客户端同局面 / 重连 |
| 网络与控制台 | 0 外部请求、0 console error、0 未捕获异常 |
| 性能 | FCP、DCL、load、DOM 节点、新局渲染、纯着法耗时、材质字节 |

## 实测（最近一次）

- 390×844：`docScroll = clientWidth`，最小可见字号 12px，按钮最小 44px。
- 320×568：`docScroll = clientWidth`，棋盘 32 枚，字号 12px。
- 844×390：无横向滚动。
- 0 console error，0 未捕获异常，0 外部请求（`file:` / `data:` / 本地 `127.0.0.1` 除外）。
- 性能：FCP 48ms、DCL 24.8ms、load 30ms、DOM 453 节点、新局渲染 79.4ms、纯着法 0.059ms、材质 570,780 bytes（见 `perf.json`）。
- 联机：浏览器页与第二 HTTP 客户端看到同一棋盘；重连返回 `reconnected: true`。
- 总数：**49 passed, 0 failed**；`--control` 退出码 1。

## 触屏操作

棋盘点击走子、模式切换、悔棋、新局、结果层按钮均通过 CDP 的 `Runtime.evaluate` 真实点击/调用；按钮尺寸在 390 与 320 两档逐项测量。iOS 输入框字号 16px，避免聚焦缩放。

## 备注

- 本测试不启动用户常驻 Chrome；headless 实例使用独立 profile，跑完关闭。
- 页面通过 `file://` 加载；联机段启动真实 HTTP 房间服务器后改用 `http://127.0.0.1:<port>`。
