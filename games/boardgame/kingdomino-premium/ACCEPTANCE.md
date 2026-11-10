# 多米诺王国 · Kingdomino — 验收清单

## 五项硬性要求

| 项 | 命令 / 证据 | 通过标准 |
|---|---|---|
| 流程 | `node games/tests/run-all.js`；`node games/boardgame/kingdomino-premium/test.js` | run-all 0 失败；单测含引擎、AI 自对弈、页面契约、性能预算 |
| 精美 | `node games/boardgame/scripts/verify-shipped.mjs --gate art`；`assets/cover.webp`、`og.webp`、`detail-1/2.webp` | art gate 行 ok；封面/OG/详情均为本地真实 raster |
| 真实 | `realism.json`；`test.js` 中的守恒/计分断言 | count/dimension/proportion/color/material/rule 六类全部 ok |
| 手机 | `node games/boardgame/scripts/game-smoke.mjs --width 390 --height 844` 与 `--width 320 --height 568` | 两档 PASS：无横向滚动、字号≥12px、触控≥44px、无 console/外部请求 |
| 联机 | `node games/boardgame/kingdomino-premium/test-online.js` | 0 失败；双客户端同局、结算一致、重连、托管、榜单、重赛 |

## 故意失败对照

- `node games/boardgame/kingdomino-premium/test-online.js --control` → 必须 exit 1。
- 页面静态断言会拒绝外部脚本、外部样式表、远程图片与 Math.random。
- 联机测试覆盖：非房主开始、越权行动、错误密码、一次性邀请复用、PII 拒绝、房间满/关闭。

## 证据文件

- `DESIGN.md`、`E2E.md`、`realism.json`、`perf.json`、`meta.json`
- `online-server.mjs`、`online.html`、`test-online.js`
- `sw.js` 预缓存页面、引擎、数据、共享模块、封面/OG/详情与全部材质。

## 状态

完成上述五项后 `meta.json.status = "shipped"`；任一缺失则保持 `draft`。
