# 卡卡颂 · Carcassonne — 验收清单

## 五项硬性要求

| 项 | 命令 / 证据 | 结果 |
|---|---|---|
| 流程 | `node games/boardgame/carcassonne-premium/test.js`；`node games/tests/run-all.js` | 单测 120/0；run-all 见最终复跑 |
| 精美 | `art` gate 行；`cover.webp` / `og.webp` / `detail.webp` | 本地真实 raster，代码合成，Songti SC 700 |
| 真实 | `realism.json` | 6 类检查全部 ok；72 张瓦片 / 24 型 / 6 纹章 |
| 手机 | `game-smoke.mjs` 390×844 与 320×568 | 两档 PASS（19 checks，0 外部请求，字号 ≥12px，触控 ≥44px） |
| 联机 | `node games/boardgame/carcassonne-premium/test-online.js` | 50/0；双客户端同局、结算一致、重连、托管、榜单、重赛 |

## 故意失败对照

- `node games/boardgame/carcassonne-premium/test-online.js --control` → exit 1（预期）。
- 单测拒绝：边不匹配、无相邻、重复占用、缺米宝、非法农田邻接、非房主开始、一次性邀请复用、PII。
- 联机测试拒绝：越权行动 409 `E_TURN`；非法放置 422；错误 session 403。

## 证据文件

- `DESIGN.md`、`E2E.md`、`realism.json`、`perf.json`、`meta.json`
- `online-server.mjs`、`online.html`、`test-online.js`
- `sw.js`：页面、引擎、数据、共享模块、封面/OG/详情与全部材质。

## 状态

五项全部通过后 `meta.json.status = "shipped"`；任一缺失保持 `draft`。
