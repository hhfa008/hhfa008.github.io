# 验收证据 — 空当接龙 FreeCell 精品版

工作树：`/private/tmp/wt-b8-g10`（分支 `boardgame/d686a4ca-b8-g10`）。本文件只记录实际运行输出，未运行的项目明确标注为待办。

## 1. 单元测试

命令：

```
export PATH=$HOME/.local/node/bin:$PATH
node games/boardgame/freecell-premium/test.js
```

实际输出：`RESULT: 198 passed, 0 failed`，退出码 0。

覆盖：微软 RNG 序列与 deal #1 指纹、52 张守恒、8 列 7/7/7/7/6/6/6/6、叠牌/连续串、基础堆 A→K、超级搬运公式（1280/640/512/256、整列例外）、开局全部合法动作可应用、非法动作抛错、不修改入参、自动安全收牌、提示、序列化校验、80 步随机走子守恒压力、四张 WebP 尺寸与材质存在性。

## 2. 浏览器 E2E

命令：

```
node games/boardgame/freecell-premium/e2e.mjs
node games/boardgame/freecell-premium/e2e.mjs --control
```

实际输出：

- 正常：`RESULT: 142 passed, 0 failed`，退出码 0。
- 对照：`RESULT: 0 passed, 1 failed`，退出码 1（故意失败）。

E2E 使用常驻 Chrome CDP 9222，只新开一个标签页并在结束时关闭；验证了真实点击走子、非法移动提示、撤销、提示、键盘 N/H、胜利判定、自动收牌胜利、service worker、390/320 两档布局、规则页 JSON-LD、四个美术镜头、零外部请求、零 console/页面错误、零 404 与性能预算。

## 3. 手机两档冒烟（仅 freecell-premium）

命令：

```
printf 'freecell-premium\n' >/tmp/freecell-premium-games.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/freecell-premium-games.txt --width 390 --height 844 --json /tmp/freecell-premium-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games /tmp/freecell-premium-games.txt --width 320 --height 568 --json /tmp/freecell-premium-320.json
```

实际摘要：

| 档位 | pass | fail | checks | externalRequests | consoleErrors | exceptions | click |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 390×844 | 1 | 0 | 19 | 0 | 0 | 0 | 新局 N，未跳转 |
| 320×568 | 1 | 0 | 19 | 0 | 0 | 0 | 新局 N，未跳转 |

两档均满足：无横向滚动（390/390、320/320）、主触控目标 ≥44×44、主控件横向可达、可见字号 ≥12px、输入框 16px、无外部请求、无 console error/异常/Log error。

## 4. 美术产物

渲染命令：

```
node games/boardgame/scripts/render-premium-art.mjs \
  --slug freecell-premium --out games/boardgame/freecell-premium/assets \
  --shots cover:1200x1200,og:1200x630,detail:1536x1024,card:480x320
```

实际文件：

| 文件 | 尺寸 | 字节 |
| --- | --- | --- |
| assets/cover.webp | 1200×1200 | 134842 |
| assets/og.webp | 1200×630 | 144366 |
| assets/detail-1.webp | 1536×1024 | 187296 |
| assets/card.webp | 480×320 | 38360 |
| assets/art/premium/freecell/felt.webp | 1536×1024 | 176154 |
| assets/art/premium/freecell/card-back.webp | 1060×1484 | 327270 |

`art-render.html?shot=cover|og|detail|card` 用真实引擎发 deal #1 并推进到合法中局，四镜头均验证 52 张牌、8 列、4 空位、4 基础堆；牌面为代码绘制，材质为本地 WebP。

E2E 还在各镜头目标画布下实测无溢出：cover 1200×1200（牌桌 339–942）、og 1200×630（96–534）、detail 1536×1024（198–919）、card 480×320（81–293），52 张牌全部在 DOM 中。

## 5. 官方 verify-shipped 门禁（只读）

共享目录已由协调方把 `freecell-premium` 加入 `PREMIUM_SLUGS` 与 `SINGLE_PREMIUM`（`modeOf` 返回 `single`）。为避免写入共享 `catalog-status.json`，以下运行把输出放到 `/tmp`，并且不运行全部游戏的单测：

```
node games/boardgame/scripts/verify-shipped.mjs --gate art --no-tests --smoke /tmp/freecell-premium-390.json --smoke-320 /tmp/freecell-premium-320.json --gate-out /tmp/fc-gate-art.json
node games/boardgame/scripts/verify-shipped.mjs --gate realism --no-tests --smoke /tmp/freecell-premium-390.json --smoke-320 /tmp/freecell-premium-320.json --gate-out /tmp/fc-gate-realism.json
node games/boardgame/scripts/verify-shipped.mjs --gate mobile --no-tests --smoke /tmp/freecell-premium-390.json --smoke-320 /tmp/freecell-premium-320.json --gate-out /tmp/fc-gate-mobile.json
node games/boardgame/scripts/verify-shipped.mjs --gate mode --no-tests --smoke /tmp/freecell-premium-390.json --smoke-320 /tmp/freecell-premium-320.json --gate-out /tmp/fc-gate-mode.json
```

实际单行结果：art `ok=true`（reasons=[]，art control `ok=true`）、realism `ok=true`、mobile `ok=true`、mode `ok=true`。四个命令的总退出码为 1 是因为同一份目录里其他游戏没有本轮的 smoke/test 证据，与 freecell-premium 无关。

process 门禁的五项组件已分别验证（DESIGN.md 5004 bytes、test.js 198/0、perf.json `ok:true`、390/320 smoke PASS、ACCEPTANCE.md 存在），但未把 `--gate process` 作为一次官方整跑，以避免运行整个目录所有游戏的 test.js 或写入共享 catalog 文件。

## 6. 真实性与性能

`realism.json`：10 条检查全过，kind 覆盖 count / proportion / dimension / material / color / rule。含 52 张四花色各 13、7/7/7/7/6/6/6/6、63×88mm 比例、午夜蓝毛毡实测 sRGB、牌背海军蓝+银色实测 sRGB、基础堆 A→K、超级搬运公式、deal #1 RNG 指纹。

`perf.json`（e2e 实测写入）：FCP 92ms、DOMContentLoaded 18ms、loadEventEnd 33ms、DOM 节点 956、FPS 62、新局渲染 1.4ms、单次纯移动 0.026ms、传输 704244 bytes、外部请求 0；全部低于预算。

## 7. 单人标注

`index.html` 与 `rules.html` 都有可见「单人」文本；`meta.json` 的 `mode` / `gameType` 为 `single`、`singlePlayer: true`、`modeLabel: 单人 · 单机`。

## 8. 边界与残留风险

- 未修改任何共享文件（`scripts/`、`build.mjs`、`audit-catalog.mjs`、`.gitignore`、`precache-manifest.js`、其他游戏目录）。
- 共享目录已注册本 slug（`PREMIUM_SLUGS` + `SINGLE_PREMIUM`）；官方 art/realism/mobile/mode 四门单行结果均已 ok=true。process 门禁未作整体官方运行，原因见上一节。
- 未执行 git commit / push / merge（`HANDOFF.md` 由协调方生成，非本 agent 的交付文件）。
