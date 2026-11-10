# 斋普尔 Jaipur premium · 浏览器 E2E 记录

## 运行方式

```bash
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
cd /private/tmp/wt-b2-g2

node games/boardgame/jaipur-premium/e2e.mjs
# RESULT: 176 passed, 0 failed

node games/boardgame/jaipur-premium/e2e.mjs --control
# RESULT: 0 passed, 1 failed   (exit 1)
```

环境：macOS，常驻审计 Chrome（CDP `127.0.0.1:9222`），`chrome-ensure` 复用，不新建临时 Chrome/profile、不 kill Chrome；E2E 只开一个 tab，结束只关该 tab。Node v24.12.0。

## 覆盖与实测

### 1. 加载与性能（1440×1000）

- FCP 80ms、DOMContentLoaded 30ms、loadEventEnd 30ms、DOM 节点 419、rAF 62fps。
- 新局同步渲染 0.7ms；纯动作延迟 0.8ms。
- 8 张本地材质 WebP 全部加载，material bytes 1,091,308（预算 2,097,152）。
- 外部资源 0、外部网络请求 0、console error 0、page exception 0。

### 2. 真实点击一手 → AI

- 首屏市场 5 张、牌堆 40、6 个代币行、38 枚货物代币、18 枚背面奖励代币、4 个 Seal 槽。
- 点击市场货物 → `__jaipur.selection().takeIndex >= 0` → dock 确认按钮启用 → 点击确认。
- 断言 `turn >= 1`、`lastAction.player === 0`；等待 AI 行动到 `turn >= 2`。
- 取牌动画计数 `anim.take >= 1`；两步后牌池仍为 55。

### 3. 手工构造卖牌 → 代币 → 奖励

- 构造：玩家 0 手中 3 张钻石，钻石代币堆 `[7,7,5,5,5]`，奖励三档满。
- 切「卖牌」→ 点钻石手牌 → dock 显示卖 3 张 → 确认。
- 断言获得 `[7,7,5]`、钻石堆剩 `[5,5]`、获得 1 枚 3 张档奖励、卖牌动画计数 +1、弃牌堆 +3。

### 4. 终局 → 结果 → 重开

- `__jaipur.autoPlayToEnd(1500)` 到 `over:true`，Seal 数组长度 2，胜者达到 2 Seal。
- 结果弹窗显示、标题可读、轮次表 ≥1 行、备注含 Seal。
- 点「再来一局」后 round=1、seals=[0,0]、弹窗隐藏。

### 5. 移动端矩阵

| 视口 | 横向溢出 | 触控 ≥44 | body 字号 | dock/日志/代币字号 | 100dvh | backdrop-filter |
|---|---|---|---|---|---|---|
| 390×844 | 无 | 全过 | 16px | ≥12px | 生效 | 关闭 |
| 320×568 | 无 | 全过 | 16px | ≥12px | 生效 | 关闭 |
| 844×390 | 无 | 全过 | 16px | ≥12px | 生效 | 关闭 |
| 568×320 | 无 | 全过 | 16px | ≥12px | 生效 | 关闭 |

每个视口还断言：5 张市场牌、6 个代币行、Seal 槽存在、主控件可滚动到达、所有可见文本 ≥12px、无 `.market-card` 触控小于 44。

### 6. 安全区 / 100dvh

- CDP `setSafeAreaInsetsOverride` 设置 top 44 / bottom 34 后刷新：topbar paddingTop ≥44、dock paddingBottom ≥34。
- CSS 中声明 `100dvh` 与 `env(safe-area-inset-*)`。

### 7. Service Worker 离线

- `navigator.serviceWorker.ready`，缓存键包含 `jaipur-premium-v1`。
- 8 张材质、`shared/shuffle.js`、`shared/sfx.js`、`index.html`、`rules.html`、`cover.webp` 全部命中缓存。
- 断网后重新导航 index.html：市场 5 张、38 枚代币正常渲染；恢复网络后再次加载正常。

### 8. Reduced motion

- 模拟 `prefers-reduced-motion: reduce` 后 `__jaipur.reducedMotion() === true`。
- 新局并执行一步：take/sell 动画计数不增加。

### 9. 联机大厅 + 联机对局

- `online.html` 在 320×568 下可打开：标题、创建/加入/结果榜表单存在、无横向滚动。
- 启动真实 `online-server.mjs`：创建 2 人房、第二客户端邀请加入、房主开始。
- 浏览器打开 `index.html?online=...&session=...&player=...`：2 人状态、房间 chip 可见、`.rival` 1 个、难度选择器隐藏、新局按钮显示「返回房间」。
- 浏览器点确认发送一手；第二 HTTP 客户端 GET 看到同一 turn；`/reconnect` 返回 `reconnected:true`。

### 10. 规则页

- 标题含「斋普尔」；正文中文 1714 字（≥1200）。
- JSON-LD 两块均可解析：`Article` + `FAQPage`（8 问）。
- B 站来源 2 个（BV1V44y1f7SJ、BV17t411K79L）；正文含 55 张 / 38 枚 / 18 枚 / 11 只 / 3 只骆驼；平局按奖励代币数 → 货物代币数；含「单人」说明。
- OG `assets/og.webp`；封面 + 2 张详情图均解码（1200×1200 / 1200×800 / 1200×800）；320px 无横向滚动。

### 11. 美术合成源

- `art-render.html?shot=cover`：`__artReady`、5 张市场牌、38 枚货物代币、18 枚奖励代币、9 张骆驼图（市场 3 + 骆驼群 4+2）、Seal 5 个（3 个已盖）、牌堆 40、8 张材质全部加载、stage 1200×1200。
- `?shot=detail1`：1200×800、5 张市场牌、9 张骆驼图。
- `?shot=detail2`：1200×800、38 枚货物代币、18 枚奖励代币。

## 控制失败

`e2e.mjs --control` 与 `test-online.js --control` 均打印 `RESULT: 0 passed, 1 failed` 并以 exit 1 退出，证明失败会被真实上报。

## 缺口

- 未做截图/OCR 内容识别；所有断言来自 DOM 文本、几何、网络与缓存等可复现技术信号。
- 联机为 HTTP 轮询，不是 WebSocket；仅本地 Node 服务器。
- 交换的移动端多选手感比取牌多一步，属于规则所需。
