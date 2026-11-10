# 接龙 · Solitaire 精品版 — 浏览器 E2E 记录

## 命令

```bash
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/solitaire-premium/e2e.mjs
node games/boardgame/solitaire-premium/e2e.mjs --control   # 必败对照，exit 1
```

## 环境

- 常驻审计 Chrome，通过 CDP `127.0.0.1:9222` 连接（`chrome-ensure` 复用，不反复启停）。
- 测试只创建一个标签页，结束时只关闭该标签页；不杀 Chrome。
- 本地 Node HTTP 服务托管仓库根目录，页面与素材全部同源；无需外网。
- 视口：桌面 1440×1000 跑交互，移动端 390×844 与 320×568 实测布局。

## 结果

```
RESULT: 70 passed, 0 failed
```

`--control`：

```
FAIL intentional failure control (expected)
RESULT: 0 passed, 1 failed
exit 1
```

## 覆盖清单

1. **初始渲染**：标题、描述、viewport、`og:image` 指向 `assets/og.webp`；七列 1–7；牌堆 24；弃牌堆/基础堆为空；52 张守恒；状态 playing；可见「单人」；`Shuffle`/`Sfx`/`Store` 加载；毛毡/牌背/卡纸本地材质生效。
2. **性能**：FCP 64ms、DCL 36ms、loadEventEnd 37ms、DOM 347 节点；`perf.json` 写入且预算通过。
3. **真实交互**：点击牌堆翻 1 张、撤销恢复；提示按钮给出「送上基础堆」并高亮来源与目标；收牌一次收走四张 A，得分 +40。
4. **点击通关**：构造基础堆 12/13/13/13、弃牌堆 K♠；点击弃牌堆顶牌选中，再点黑桃基础堆，状态 won，四堆各 13，结算弹窗显示。
5. **键盘与存档**：`N` 开新局；音效按钮切换 aria-pressed；每步写入 `hhfa-solitaire-save-v1`；刷新无 seed 恢复弃牌堆 1 张、牌堆 23 张、步数 1，并显示恢复提示。
6. **规则页**：Article + FAQPage JSON-LD；正文 1746 汉字；3 条 B 站来源（BV1ag411x7nm、BV1BC4y1q7sH、BV1pq4M6PEWC）；6 个 FAQ；`detail-1.webp` 配图。
7. **手机两档**：390×844 与 320×568 均无横向滚动；主控件全部 ≥44×44；可见字号最小 12px；无元素越界；七列可见且列宽 >20px。
8. **资源与错误**：`sw.js`、cover、og、detail 均可访问；零外部请求；零 4xx/5xx；零 console error；零未捕获异常。

## 对照证据

`--control` 在脚本入口直接打印一条 FAIL 并 `process.exit(1)`，证明检查脚本本身会失败，不会把缺失证据误判为通过。
