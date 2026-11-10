# 验收记录 · 蜘蛛纸牌 Premium

所有数字来自实际命令输出；未运行的项目明确标注为待跑，不预估。

## 1. 引擎单测

```
node games/boardgame/spider-premium/test.js
```

实际输出：`RESULT: 227 passed, 0 failed`。

覆盖范围：104 张牌组构成（1/2/4 花色）、初始 10 列 6/6/6/6/5/5/5/5/5/5、50 张牌堆与 5 次发牌、同花连续段与放置规则、空列禁发、K→A 自动收组与级联收组、8 组胜利与判负、提示、序列化、计分公式、随机走子与提示自走局的 104 张守恒和唯一性。

## 2. 浏览器端到端

```
node games/boardgame/spider-premium/e2e.mjs
node games/boardgame/spider-premium/e2e.mjs --control
```

实际输出：`RESULT: 142 passed, 0 failed`；`--control` 打印 intentional failure 并以退出码 1 结束。

E2E 使用常驻 Chrome CDP 9222（可被 `AUDIT_CDP_PORT` 覆盖），只新建一个标签并在结束时关闭；没有临时 Chrome/profile，不杀 Chrome。覆盖：

- 初始状态：10 列、6/6/6/6/5/5/5/5/5/5、50 张牌堆、500 分、104 张唯一牌、顶端正面/其余背面。
- 真实 UI 点击：选中可移动段 → 点目标列 → 扣 1 分、步数 +1、104 张守恒。
- 撤销：恢复分数、步数、完整列状态；键盘 U 同样生效。
- 提示：返回合法动作、toast 与高亮/发牌建议。
- 发牌：牌堆 −10、每列 +1、发牌次数 +1、分数按 −1 + 100×收组 计算。
- 空列禁发：发牌动作消失、按钮禁用、调用被拒绝且状态不变。
- 构造 7 组完成 + 最后一击：收走第 8 组、`over=true`、`result.win=true`、799 分、104 张守恒、结算面板出现。
- 再来一局与难度 4/2/1 切换：分数、花色数量、标签同步。
- 390×844 / 320×568：无横向滚动、控件 ≥44×44、字号 ≥12px、无越界、完整 10 列、牌格可见。
- 规则页：Article + FAQPage JSON-LD、可见「单人」、2084 汉字、B 站来源、返回牌桌。
- 美术页：10 列、104 张牌、50 张牌堆、点阵牌面、宫廷牌、8 个完成槽位、绒布与牌背材质加载。
- 零外部请求、零 HTTP 4xx/5xx、零 console error、零未捕获异常。

## 3. 手机两档冒烟

```
printf 'spider-premium\n' >/tmp/spider-games.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/spider-games.txt --width 390 --height 844 --json /tmp/spider-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/spider-games.txt --width 320 --height 568 --json /tmp/spider-320.json
```

实际结果：390×844 `pass: 1 / fail: 0`，19 checks，externalRequests 0，consoleErrors 0，exceptions 0；320×568 同为 `pass: 1 / fail: 0`，19 checks，externalRequests 0，consoleErrors 0，exceptions 0。

## 4. 性能预算（e2e 实测）

| 指标 | 预算 | 实测 |
|---|---|---|
| FCP | < 2500ms | 0ms |
| DOMContentLoaded | < 4000ms | 11ms |
| loadEventEnd | < 4000ms | 29ms |
| DOM 节点 | < 2500 | 474 |
| FPS | ≥ 30 | 61 |
| 新局渲染 | < 200ms | 0.8ms |
| 材质与资源 | ≤ 3MB | 742820 bytes |
| 外部请求 | 0 | 0 |

## 5. 美术产物

| 角色 | 文件 | 尺寸 | 字节 |
|---|---|---|---|
| 封面 | assets/cover.webp | 1200×1200 | 115856 |
| OG | assets/og.webp | 1200×630 | 71970 |
| 详情 | assets/detail-1.webp | 1536×1024 | 138284 |
| 卡片 | assets/card.webp | 480×320 | 27180 |

尺寸由 `sips -g pixelWidth -g pixelHeight` 实测；e2e 再次断言。美术合成页 `art-render.html` 使用固定 seed 的合法四色中局，十列 + 50 张牌堆 = 104 张，完成区为空。

## 6. realism

`realism.json`：`pass:true`，10 条检查全部 `ok:true`，覆盖 count / dimension / proportion / rule / color / material 六类。

## 7. 结论

引擎、真实浏览器流程、胜利判定、撤销/提示/键盘、发牌限制、手机两档、离线资源与美术产物均已用实际命令验证；共享目录未修改。最终 shipped 判定由 coordinator 的官方 `verify-shipped.mjs` 汇总。
