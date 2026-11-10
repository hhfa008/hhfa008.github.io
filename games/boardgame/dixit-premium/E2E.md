# 妙语说书人 DIXIT · PREMIUM — E2E 记录

> 脚本：`games/boardgame/dixit-premium/e2e.mjs`
> 环境：常驻 audit Chrome，CDP `127.0.0.1:9222`；新开一个标签，结束时关闭。
> 结果：`RESULT: 66 passed, 0 failed`

## 步骤

1. 本地 HTTP 服务随机端口，SW scope 指向 `boardgame/dixit-premium/`。
2. 复用常驻 Chrome，新开测试标签，清理该 origin 的 SW/cache。
3. 打开 `index.html`，等待 `window.__DX_READY__` 与 6 张手牌。
4. 初始渲染：4 人桌、第 1 轮、说书人阶段、30 分目标、6 张 SVG 卡、线索表单、牌堆 60、无横向滚动、reduced-motion、100dvh、safe-area。
5. 真实交互循环（最多 10 个动作 / 260 次尝试）：
   - 说书人：点手牌 + 填入「像潮汐一样退去」+ 点「说出线索」；
   - 出牌：点手牌 + 点「提交这张」；
   - 投票：点公开牌 + 点「投这一票」；
   - 结算弹窗点「继续」；
   - AI 由 10ms fast AI 自动完成其余回合。
6. 断言至少 3 个 UI 动作、回合推进、分数变化、日志可读。
7. seed 复现：同 seed 两次新局手牌一致；5 人桌 6 张手牌；对手手牌隐藏；说书人的牌在出线索前为 null。
8. SW：注册、`dixit-premium-v1` 存在、缓存含 index 且 ≥5 项。
9. 规则页：FAQPage JSON-LD ≥4 问、回游戏链接、线索/投票覆盖。
10. 本地美术：cover / og / detail-1 / detail-2 >12KB；og:image 本地；4 个材质与 2 个 shared 脚本存在。
11. 390×844 / 320×568：无横向滚动、控件 ≥43.5px、可见文字 ≥12px。
12. 零外部请求、零 console error、零未捕获异常。
13. 写 `perf.json`（FCP 68ms / DCL 12ms / load 32ms / DOM 692 / 材质 439KB / 外链 0）。

## 故意失败对照

```bash
node games/boardgame/dixit-premium/e2e.mjs --control
# FAIL intentional failure control (expected)
# RESULT: 0 passed, 1 failed   → exit 1
```

## 复跑

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/dixit-premium/e2e.mjs
```
