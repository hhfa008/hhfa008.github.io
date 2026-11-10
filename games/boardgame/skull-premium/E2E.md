# 骷髅牌 SKULL · PREMIUM — E2E 记录

> 脚本：`games/boardgame/skull-premium/e2e.mjs`
> 环境：常驻 audit Chrome，CDP `127.0.0.1:9222`；新开一个标签，结束时关闭。
> 结果：`RESULT: 61 passed, 0 failed`

## 步骤

1. 本地 HTTP 服务随机端口，SW scope 指向 `boardgame/skull-premium/`。
2. 复用常驻 Chrome，新开测试标签，清理该 origin 的 SW/cache。
3. 打开 `index.html`，等待 `window.__SK_READY__`。
4. 初始渲染：4 人桌、放置阶段、2 分目标、4 个玩家盒、手牌玫瑰 3 + 骷髅 1、牌堆、无横向滚动、reduced-motion、100dvh、safe-area。
5. 真实交互循环（最多 7 个人类行动 / 120 次尝试）：
   - 放置：点对应杯垫两次；
   - 叫价：点数字再点「确认叫价」；
   - 翻牌：点高亮牌堆；
   - 回合结算弹窗点「继续」；
   - AI 座位由 10ms fast AI 自动行动。
6. 断言至少 3 个 UI 行动、回合推进、日志可读。
7. seed 复现：同 seed 两次新局手牌构成一致；5 人桌 5 个玩家盒；对手手牌在视图中为 null。
8. SW：注册、`skull-premium-v1` 存在、缓存含 index 且 ≥5 项。
9. 规则页：FAQPage JSON-LD ≥4 问、回游戏链接、玫瑰/骷髅覆盖。
10. 本地美术：cover / og / detail-1 / detail-2 >12KB；og:image 本地；3 个材质与 2 个 shared 脚本存在。
11. 390×844 / 320×568：无横向滚动、控件 ≥43.5px、可见文字 ≥12px。
12. 零外部请求、零 console error、零未捕获异常。
13. 写 `perf.json`（FCP 88ms / DCL 30ms / load 33ms / DOM 194 / 材质 397KB / 外链 0）。

## 故意失败对照

```bash
node games/boardgame/skull-premium/e2e.mjs --control
# FAIL intentional failure control (expected)
# RESULT: 0 passed, 1 failed   → exit 1
```

## 复跑

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/skull-premium/e2e.mjs
```
