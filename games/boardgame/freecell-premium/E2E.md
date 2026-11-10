# E2E 记录 — 空当接龙 FreeCell 精品版

## 命令

```
export PATH=$HOME/.local/node/bin:$PATH
cd /private/tmp/wt-b8-g10
node games/boardgame/freecell-premium/e2e.mjs
node games/boardgame/freecell-premium/e2e.mjs --control
```

- 正常：`RESULT: 142 passed, 0 failed`，退出码 0。
- 对照：`RESULT: 0 passed, 1 failed`，退出码 1（故意失败）。

环境：常驻 Chrome（`~/.local/bin/chrome-ensure`，CDP 端口 `AUDIT_CDP_PORT || 9222`）。e2e 只通过 `/json/new` 新开一个标签页，结束时 `/json/close/:id` 关闭；不启动临时 Chrome、不结束常驻实例。测试服务由 Node 本地 HTTP server 提供仓库 `games/` 目录，随机端口。

## 覆盖范围（实际断言 142 条）

1. **首屏与材质**：title、meta description、viewport、本地 og:image、局号 1、8 列 7/7/7/7/6/6/6/6、52 张、4 空位、4 基础堆、可见「单人」、共享 shuffle/sfx/store、引擎版本、毛毡与牌背材质、牌格为 DIV 且非 role=button。
2. **微软局号**：浏览器牌局首行与 Node `dealDeck(1)` 一致；RNG 序列 `41,18467,6334,26500,19169,15724`；52 张无重复且与引擎牌集一致。
3. **真实点击走子**：用 DOM 点击连续执行 8 步合法移动，无失败、无提前胜利、每步后 52 张守恒。
4. **非法移动与撤销**：点击错误基础堆步数不变并出现「这一步不合法」；合法一步后撤销回到 0 步，牌张守恒。
5. **提示与键盘**：提示高亮来源/目标且文案含中文；键盘 H 触发提示、N 开新局归零；超级搬运公式与实现一致（搬到非空列与空列分别校验），8 列/4 空位常量与 63:88 比例。
6. **胜利**：构造 51 张已归位 + 空位黑桃 K 的真实 52 张局面，点击空位牌再点黑桃基础堆完成胜利；结算面板、步数 12、局号 1、本机记录（wins≥1、bestMoves≤12）。
7. **自动安全收牌**：四堆各 12 张 + 四张 K 的 52 张局面，点击自动收牌后四堆均 13 张并显示结算。
8. **离线与页面**：`sw.js` 可访问、service worker 已注册；规则页 Article + FAQPage JSON-LD、两张本地图、1665 汉字、3 条 BV 来源；四个美术镜头均 52 张牌 / 8 列 / 4 空位 / 4 基础堆 / 毛毡材质，并在各自目标画布（1200×1200、1200×630、1536×1024、480×320）下验证无滚动溢出、牌桌完整落在画布内。
9. **手机两档**：390×844 与 320×568 无横向滚动、主控件 ≥44×44、主控件横向可达、可见字号 ≥12px、8 列 52 张、牌格为 DIV；实测牌面 39×54 与 31×44。
10. **产物与性能**：四张 WebP 尺寸精确匹配、材质存在；FCP 92ms、loadEventEnd 33ms、DOM 956、FPS 62、新局 1.4ms、纯移动 0.026ms、传输 704244 bytes；零外部请求、零 console error、零页面异常、零 404。

## 说明

`e2e.mjs` 结束时把本次实测值写入 `perf.json`（`ok` 为 `failed === 0`）。`--control` 在启动本地服务与浏览器之前就打印故意失败并以 1 退出，用来证明检查本身能失败。
