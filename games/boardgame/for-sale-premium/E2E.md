# 房地产拍卖 FOR SALE · PREMIUM — E2E 记录

> 脚本：`games/boardgame/for-sale-premium/e2e.mjs`
> 环境：常驻 audit Chrome，CDP `127.0.0.1:9222`；新开一个标签，结束时关闭。
> 结果：`RESULT: 68 passed, 0 failed`

## 步骤

1. 本地 HTTP 服务随机端口，SW scope 指向 `boardgame/for-sale-premium/`。
2. 复用常驻 Chrome，新开测试标签，清理该 origin 的 SW/cache。
3. 打开 `index.html`，等待 `window.__FS_READY__` 与出价按钮。
4. 初始渲染：4 人桌、拍卖阶段、第 1 场、1–30 的拍品、4 个玩家盒、18 金币、无横向滚动、reduced-motion、100dvh、safe-area。
5. 真实交互循环（fast AI，最多 2600 次尝试 / 2 次出售）：
   - 拍卖轮到人类：点最高的快捷出价按钮；必要时点「放弃」；
   - 出售轮到人类：点一张房产 → 点「确认出售」；
   - 出售结算弹窗点「继续」；
   - AI 由 10ms fast AI 自动加价、放弃、选牌。
6. 断言至少一次真实出价、进入出售阶段、至少一次真实出售、日志可读、游戏推进。
7. seed 复现：同 seed 两副牌一致；5 人桌 5 个玩家盒；金币公开、其他玩家支票隐藏；首张拍品在 1–30。
8. SW：注册、`for-sale-premium-v1` 存在、缓存含 index 且 ≥5 项。
9. 规则页：FAQPage JSON-LD ≥4 问、回游戏链接、拍卖/支票覆盖。
10. 本地美术：cover / og / detail-1 / detail-2 >12KB；og:image 本地；5 个材质与 2 个 shared 脚本存在。
11. 390×844 / 320×568：无横向滚动、控件 ≥43.5px、可见文字 ≥12px。
12. 零外部请求、零 console error、零未捕获异常。
13. 写 `perf.json`（FCP 72ms / DCL 29ms / load 31ms / DOM 184 / 材质 711KB / 外链 0）。

## 故意失败对照

```bash
node games/boardgame/for-sale-premium/e2e.mjs --control
# FAIL intentional failure control (expected)
# RESULT: 0 passed, 1 failed   → exit 1
```

## 复跑

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/for-sale-premium/e2e.mjs
```
