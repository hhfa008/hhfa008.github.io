# 情书 LOVE LETTER · PREMIUM — E2E 记录

> 脚本：`games/boardgame/love-letter-premium/e2e.mjs`
> 环境：常驻 audit Chrome，CDP `127.0.0.1:9222`；脚本只新开一个标签，结束时关闭；不启动临时 Chrome、不杀现有 Chrome。
> 结果：`RESULT: 62 passed, 0 failed`

## 步骤

1. 本地 HTTP 服务随机端口，`service-worker-allowed` 指向 `boardgame/love-letter-premium/`。
2. `chrome-ensure` 复用常驻 Chrome；`PUT /json/new` 开测试标签；清理该 origin 的 SW/cache。
3. 打开 `index.html`，等待 `window.__LL_READY__` 与两张手牌。
4. 初始渲染与性能：标题、描述、2 人桌、第 1 轮、目标 7、1 名对手、牌背、无横向滚动、reduced-motion、100dvh、safe-area、FCP/DCL/load、DOM 节点、材质字节。
5. 真实交互：`setFastAI(true)` → `newGame({seed:42})` → 点击可出的牌 → 必要时点猜测 8 与对手 → 点「打出」→ 断言 `turn` 前进 → 等待 AI 再走一步。
6. seed 复现：同 seed 两次 `newGame` 手牌一致；3 人桌显示 2 名对手。
7. Service Worker：注册、`caches.keys()` 含 `love-letter-premium-v1`、缓存含 `index.html` 且条目 ≥5。
8. 规则页：FAQPage JSON-LD ≥4 问、回游戏链接、角色文本覆盖。
9. 本地美术：cover / og / detail-1 / detail-2 存在且 >12KB；og:image 指向本地；5 个材质与 2 个 shared 脚本存在。
10. 390×844：无横向滚动；所有可见 button/input/select/a.btn ≥43.5px；所有可见文字 ≥12px。
11. 320×568：同上。
12. 卫生：零外部请求、零 console error、零未捕获异常。
13. 写 `perf.json`（FCP 76ms / DCL 10ms / load 32ms / DOM 204 / 材质 623KB / 外链 0）。

## 故意失败对照

```bash
node games/boardgame/love-letter-premium/e2e.mjs --control
# FAIL intentional failure control (expected)
# RESULT: 0 passed, 1 failed   → exit 1
```

## 复跑

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/love-letter-premium/e2e.mjs
```
