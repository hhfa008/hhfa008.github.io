# E2E — 中国跳棋 · 星阵连跳

```bash
node games/boardgame/checkers-jump-premium/e2e.mjs
node games/boardgame/checkers-jump-premium/e2e.mjs --control   # exit 1
```

独立 headless Chrome（项目 `.tmp/e2e-profile-checkers-jump`，结束删除），CDP 驱动真实页面；只读 DOM、控件尺寸、引擎状态与网络事件，不截图、不做 OCR。

## 覆盖

| 分组 | 断言 |
|---|---|
| 初始加载 | 标题、meta、viewport、20 枚弹珠（2 人局）、121 个孔位热区、引擎局面 |
| 390×844 | 无横向滚动、字号 ≥12px、主控件 ≥44px、DOM 预算 |
| 走子 / 悔棋 | 合法开局着法、H 编号棋谱、AI 执琥珀应手、人机悔棋回退 |
| 同屏多人 | 下一位颜色不自动走子 |
| 终局 | 填满目标区 → `target`、结果层显示“朱红获胜” |
| 320×568 | 无横向滚动、字号与控件达标、棋盘仍 20 枚 |
| 844×390 | 无横向滚动、20 枚弹珠 |
| 规则页 | Article + FAQPage JSON-LD、角区/走法表、320px 无溢出 |
| 联机 | 真实房间服务器：创建 / 邀请 / 开始 / 浏览器走子 / 第二客户端同局面 / 重连 |
| 网络与控制台 | 0 外部请求、0 console error、0 未捕获异常 |
| 性能 | FCP、DCL、load、DOM、新局渲染、纯着法、材质字节 |

## 实测（最近一次）

- 390×844 / 320×568：无横向滚动，最小可见字号 12px，按钮最小 44px。
- 844×390：无横向滚动。
- 0 console error，0 未捕获异常，0 外部请求。
- 性能：FCP 32ms、DCL 25.3ms、load 26.2ms、DOM 638 节点、新局渲染 77.5ms、纯着法 0.035ms、材质 392,842 bytes（见 `perf.json`）。
- 联机：浏览器页与第二 HTTP 客户端看到同一棋盘；重连 `reconnected: true`。
- 总数：**50 passed, 0 failed**；`--control` 退出码 1。

## 触屏

点选弹珠、点落点、人数/难度、悔棋、新局、结果层按钮均通过真实 DOM 点击/调用；输入框 16px 避免 iOS 聚焦缩放。
