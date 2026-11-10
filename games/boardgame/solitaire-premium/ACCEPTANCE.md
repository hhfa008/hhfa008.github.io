# 接龙 · Solitaire 精品版 — 验收记录

> 日期：2026-11-10 · 分支：`boardgame/d686a4ca-b8-g10` · 状态：shipped

## 门禁结果

| 门禁 | 结果 | 证据 |
|---|---|---|
| 流程 / 单测 | PASS | `node games/boardgame/solitaire-premium/test.js` → **RESULT: 142 passed, 0 failed** |
| 性能 | PASS | `perf.json`：FCP 64ms、DCL 36ms、loadEventEnd 37ms、DOM 347 节点；预算 2500/4000/2500 |
| 浏览器 E2E | PASS | `node games/boardgame/solitaire-premium/e2e.mjs` → **RESULT: 70 passed, 0 failed** |
| E2E 对照 | PASS | `node games/boardgame/solitaire-premium/e2e.mjs --control` → 打印失败并 **exit 1** |
| 美术 | PASS | `assets/cover.webp` 1200×1200、`og.webp` 1200×630、`detail-1.webp` 1536×1024、`thumb.webp` 480×320 |
| realism | PASS | `realism.json`：11 项检查、6 种 kind（count/dimension/rule/color/material/proportion）全部 true |
| 手机 390×844 | PASS | `game-smoke` 19/19 PASS；无横向滚动、0 console error、0 exception、0 外部请求 |
| 手机 320×568 | PASS | `game-smoke` 19/19 PASS；无横向滚动、0 console error、0 exception、0 外部请求 |
| 单人标注 | PASS | `index.html` 与 `rules.html` 均含可见「单人」徽章/文字 |
| 联机 | 不适用 | 单人 Klondike，无对手；按单人门禁直通，未伪造联机 E2E |

## 复跑命令

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/solitaire-premium/test.js
node games/boardgame/solitaire-premium/e2e.mjs
node games/boardgame/solitaire-premium/e2e.mjs --control
printf 'solitaire-premium\n' >/tmp/solitaire-games.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /tmp/solitaire-games.txt --width 390 --height 844 --json /tmp/solitaire-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /tmp/solitaire-games.txt --width 320 --height 568 --json /tmp/solitaire-320.json
```

## 浏览器 E2E 覆盖

- 初始渲染：52 张守恒、七列 1–7、牌堆 24、基础堆空、标题/描述/viewport/og、单人徽章。
- 共享模块：`Shuffle`、`Sfx`、`Store` 均加载；毛毡、牌背、卡纸均为本地 WebP。
- 真实交互：点击牌堆翻牌、撤销、提示高亮、收牌收走四张 A 并 +40 分。
- 点击通关：弃牌堆 K 点选后点基础堆，状态变为 won，弹窗显示得分/步数/时间。
- 键盘 N 新局、音效按钮 aria-pressed、每次操作写本地存档、刷新后恢复上局。
- 规则页：Article + FAQPage JSON-LD、1746 汉字、3 条 B 站来源、6 个 FAQ、详情配图。
- 手机两档：无横向滚动、主控件 ≥44px、可见字号 ≥12px、无元素越界、七列可见。
- 零外部请求、零 4xx/5xx、零 console error、零未捕获异常。

## 已知边界

- 本作不保证每一局都可解；这是 Klondike 的固有性质，不是缺陷。
- 撤销历史最多 400 步；刷新恢复后从当前局面继续，不恢复更早的撤销链。
