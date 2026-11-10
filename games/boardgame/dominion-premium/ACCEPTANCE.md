# 领土 · Dominion — 验收清单

## 五项硬性要求

| 项 | 命令 / 证据 | 结果 |
|---|---|---|
| 流程 | `node games/boardgame/dominion-premium/test.js`；`node games/tests/run-all.js` | 单测 150/0；run-all 见最终复跑 |
| 精美 | `art` gate 行；`cover.webp` / `og.webp` / `detail.webp` | 本地真实 raster，代码合成，Songti SC 700 |
| 真实 | `realism.json` | 6 类检查全部 ok（count/dimension/proportion/color/material/rule） |
| 手机 | `game-smoke.mjs --width 390x844` 与 `--width 320x568` | 两档均 PASS（19 checks，0 外部请求，0 console error，字号 ≥12px，触控 ≥44px） |
| 联机 | `node games/boardgame/dominion-premium/test-online.js` | 63/0；双客户端同局、结算一致、重连、托管、榜单、重赛 |

## 故意失败对照

- `node games/boardgame/dominion-premium/test-online.js --control` → exit 1（预期）。
- 单测拒绝：非法购买、金币不足、行动阶段越权、工坊选择超费、非房主开始、一次性邀请复用、PII 提交。
- 页面静态契约拒绝外部脚本、外部样式表、远程图片、`Math.random` 与缺失的联机入口。

## 证据文件

- `DESIGN.md`、`E2E.md`、`realism.json`、`perf.json`、`meta.json`
- `online-server.mjs`、`online.html`、`test-online.js`
- `sw.js`：页面、引擎、数据、共享模块、封面/OG/详情与全部材质。

## 状态

五项全部通过后 `meta.json.status = "shipped"`；任一缺失保持 `draft`。
