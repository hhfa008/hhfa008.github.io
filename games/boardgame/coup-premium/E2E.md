# 政变 · COUP PREMIUM — 浏览器 E2E 记录

## 命令与环境

```bash
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
node games/boardgame/coup-premium/e2e.mjs
node games/boardgame/coup-premium/e2e.mjs --control
```

- 常驻审计 Chrome CDP `127.0.0.1:9222`（本机实测 Chrome 156）。
- `chrome-ensure` 复用现有 Chrome；脚本只新开一个 tab，结束时只关闭该 tab，不 kill Chrome、不建临时 profile。
- 本地 Node 静态服务器以 `games/` 为根，端口随机；所有请求同源，零外部请求。
- 页面零外链、无 CDN、无外链字体、无追踪；Service Worker 只缓存同源资源。

## 结果

```text
RESULT: 183 passed, 0 failed
PERF {"fcp":72,"domContentLoaded":22,"loadEventEnd":26,"domNodes":266,"materialBytes":496920,"externalRequests":0,"fps":60,"newGameRenderMs":1.8,"pureMoveMs":1}
```

对照失败：

```text
node e2e.mjs --control
RESULT: 0 passed, 1 failed   (exit 1)
```

## 覆盖内容

1. **初始渲染与性能**：标题/4 席/7 行动/2 张己方身份/6 张暗牌/每人 2 金币/牌堆 7；FCP 72ms、DCL 22ms、load 26ms、DOM 266、FPS 60、首屏材质 496,920B、外部请求 0。
2. **WebAudio 与动效偏好**：用户手势解锁音频；`prefers-reduced-motion: reduce` 实时生效；CSS 含有 `prefers-reduced-motion`、`100dvh`、`safe-area-inset`、`turnGlow/blink/fall`。
3. **新局 UI**：打开新局弹窗，选 6 人/困难，真实点击开始；6 席、10 张暗牌、牌堆 3、全部 2 金币/2 身份、桌面无横向滚动。
4. **移动端矩阵**：390×844、320×568、844×390、568×320；无横向滚动；所有可见 `button/a` ≥44×44；所有可见文字 ≥12px；body 16px；行动可达；六席不重叠、不出屏；触摸下 `backdrop-filter:none`。
5. **真实点击行动**：收入 +1 并等待 AI 完成回合（人类遇到挑战/阻挡/弃牌/交换提示时按规则自动放弃/弃牌，直到 AI 回合结束）。
6. **挑战 → 弃牌**：构造“玩家 1 宣称公爵征税”状态，真实点击“挑战”，再点身份牌翻开；宣称者 +3、挑战者失 1 牌、日志、弹窗关闭。
7. **阻挡挑战 → 弃牌**：构造公爵阻挡外援状态，真实点击“挑战阻挡”，翻开身份；行动者失 1 牌、阻挡者保留 2 牌、外援不结算、回合结束。
8. **交换**：4 张候选、点击选择、Escape 清空选择、再选 2 张确认；保留 2 张、回合推进、15 张牌守恒、日志。
9. **目标选择器**：7 金币时点政变，目标弹窗出现 1 名对手；点击后扣 7 金币、目标失 1 牌，AI 自动弃牌并交回回合。
10. **终局/结算/重开**：2 人自动跑至终局；结算弹窗、2 行、1 人存活、胜者日志；点“再来一局”重置金币/身份。6 人局同样跑到终局，结算 6 行、15 张牌守恒。
11. **Service Worker 离线**：注册、控制页面、缓存 index/engine/rules/shuffle/sfx/card-back/cover；CDP 离线后 `Page.reload` 仍能从缓存启动游戏。
12. **规则页**：标题、≥6 个 h2、≥8 个 FAQ、`Article` 与 `FAQPage` JSON-LD 可解析、2–6 人、B 站 BV1pW411Y7kr / BV1ja411575N、官方来源、无横向滚动、零外部请求。
13. **art-render**：cover 15 张牌/6 席/12 枚金币/5 角色、1200×1200；OG 15/6/1200×630；detail-1/detail-2 15/6/1200×800；图片全部加载、零外链。
14. **online.html 大厅**：创建/加入按钮、7 个表单控件；390/320 无横向滚动、触控 ≥44px、零外部请求。
15. **收尾**：最终 DOM 266、外部请求 0、console error 0、未捕获异常 0。

## 设备矩阵

| 视口 | 横向滚动 | 最小触控 | 最小可见字号 | 六席布局 |
|---|---|---|---|---|
| 390×844 | 无 | 44px | 12px | 2 列 |
| 320×568 | 无 | 44px | 12px | 2 列 |
| 844×390 | 无 | 44px | 12px | 2 列 |
| 568×320 | 无 | 44px | 12px | 2 列 |

## 缺口

- 只做 Chrome 设备模拟，未覆盖真实 iOS Safari / Android WebView 的字体回退与安全区像素。
- 离线验证为同一 Chrome 会话的 CDP 离线重载；未覆盖首次访问即断网（无 SW 控制）的场景。
- 未运行官方 `verify-shipped`；E2E 结果供 lead 门禁引用。
