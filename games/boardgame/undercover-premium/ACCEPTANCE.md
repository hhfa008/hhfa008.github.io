# Undercover Premium — ACCEPTANCE

> 游戏：谁是卧底 · 精美版
> 分支：`boardgame/d686a4ca-b6-g7`
> 日期：2026-11-10
> 状态：**draft（实现与本地门禁完成；手机 390/320 冒烟与 gen-precache 由集成方串行复跑后改 shipped）**

## 0. 结论

| 门禁 | 本目录结果 | 证据 |
|---|---|---|
| 1. 流程 | PASS | DESIGN.md、engine/data/UI、test.js 157/0、`--control` exit 1 |
| 2. 美术 | PASS（本地） | `art-render.html` 合成 + 本地 WebP；gate-artifacts `imageArtifacts/classifyArt` 找到 cover/og/detail，字节 75KB/42KB/81KB |
| 3. 真实 | PASS | `realism.json` 8 项 / 8 类，全 ok；221 组词对、63×88mm、300gsm、Songti SC 700 |
| 4. 手机 | 待集成方串行 | 页面按 390×844 / 320×568 设计；本 fork 不运行 game-smoke，避免并发抢 CDP / 写共享 audit |
| 5. 联机 | PASS | `test-online.js` 120/0；4 客户端同局、结算一致、重连、托管、榜单；`--control` exit 1 |

`meta.json` 保持 `draft`，符合“未标 shipped 前不进大厅”的规则；集成方跑完五项后改 `shipped`。

## 1. 单元测试与对照

```
$ node games/boardgame/undercover-premium/test.js
...
[PASS] 词库 data.js: 9 项断言, 0 失败
[PASS] 人数、卧底与白板配置: 19 项断言, 0 失败
[PASS] 发角色与发词: 11 项断言, 0 失败
[PASS] 胜负判定: 6 项断言, 0 失败
[PASS] 创建对局与可复现: 16 项断言, 0 失败
[PASS] 看词流程与不可变: 8 项断言, 0 失败
[PASS] 投票、淘汰与平票: 19 项断言, 0 失败
[PASS] AI 补位行为: 7 项断言, 0 失败
[PASS] 隐藏信息视图: 7 项断言, 0 失败
[PASS] 静态页面与文件契约: 48 项断言, 0 失败
[PASS] 性能预算 PERF_BUDGET: 7 项断言, 0 失败
总计: 157 通过, 0 失败
RESULT: 157 passed, 0 failed
```

对照：

```
$ node games/boardgame/undercover-premium/test.js --control
...
RESULT: 157 passed, 1 failed
$ echo $?
1
```

覆盖：配置边界（4 人白板非法、6 人 2 卧底 1 白板非法）、发角色计数、词对唯一/纯中文/≥120、白板无词、胜负分支、平票无人出局、卧底被投出平民胜、卧底方通过票平民胜、AI 不投自己且卧底 AI 优先投平民、隐藏信息视图、seed 复现、state 不可变。

## 2. 联机双客户端（实为 4 客户端）

```
$ node games/boardgame/undercover-premium/test-online.js
ONLINE_E2E_JSON: {"game":"undercover","clients":4,"sameGame":true,
"settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,
"leaderboard":true,"runAll":true,...}
RESULT: 120 passed, 0 failed
```

对照：

```
$ node games/boardgame/undercover-premium/test-online.js --control
RESULT: 0 passed, 1 failed
$ echo $?
1
```

详细链路见 `E2E.md`。

## 3. 美术与真实性

`gate-artifacts` 本地采集（只读调用，不写共享 audit）：

```
cover.webp   75,114 bytes   (render 1200×1200)
og.webp      42,772 bytes   (render 1200×630)
detail.webp  81,556 bytes   (render 1536×1024)
card-face.webp  51,968 bytes
card-back.webp 296,492 bytes
table-wood.webp 70,052 bytes
```

- 单物件材质由 img-gen 生成（象牙卡纸、深酒红锦纹卡背、胡桃木桌面），文字与局面由 `art-render.html` 用代码合成。
- 卡牌 63×88mm、300gsm；字体 Songti SC Bold(700)；左上柔光箱主光 + 右侧补光。
- 封面局面为一局真实发词：平民两枚「可乐」、卧底「雪碧」、白板「无词」、一张机密卡背；票数面板 3/2/1/0。
- `realism.json`：8 项检查，kinds 覆盖 count/dimension/proportion/color/material/rule，`pass=true`。

## 4. 性能

`test.js` 实测（Node 24.12.0）：

| 指标 | 阈值 | 实测 |
|---|---|---|
| 创建 500 局 | <1000ms | 9ms |
| 2000 次合法动作 | <500ms | 1ms |
| 1000 次 AI 决策 | <1000ms | 0ms |
| 300 局完整看词 | <800ms | 12ms |

`perf.json` 记录同一阈值与实测；`PERF_BUDGET` 行会被 verify-shipped 识别为性能证据。

## 5. 预缓存清单

`test.js` 读取 `games/sw.js` 与 `games/precache-manifest.js`：版本必须一致且 ≥ v20。当前清单尚未包含本游戏（gen-precache 由集成方在合并后运行），因此条目检查打印“待集成方重新生成（条目检查跳过）”，不伪造通过。集成方执行：

```
node scripts/gen-precache.js
node games/boardgame/undercover-premium/test.js
```

后，清单应包含 `undercover-premium/index.html`、`online.html`、`rules.html`、`engine.js`、`data.js`、`meta.json` 及 6 个 WebP。

## 6. 未做 / 交由集成方

- 390×844、320×568 真实 Chrome 冒烟（`game-smoke.mjs`）：本 fork 不运行，防并发 CDP 冲突与共享 audit 写入。
- `verify-shipped` / `catalog-status` / `build.mjs` / hub 卡片：由集成方统一执行。
- `gen-precache`：由集成方统一执行。
- `.gitignore` 新增本游戏 PNG 忽略：本 fork 只写两个目录，未改根文件；已删除本地 PNG 母版，仅保留 WebP。

## 集成方复跑（2026-11-10）

五项门禁全部通过，`verify-shipped` 行为 `status=shipped`，`gates` 五项均为 true。

| 门禁 | 结果 | 证据 |
|---|---|---|
| 流程 | PASS | `test.js` 159/0；`test-online.js` 120/0；两个 `--control` 均 exit 1；run-all 568 文件 / 93917 断言 / 0 失败 |
| 精美 | PASS | art gate 本行 `ok:true`；cover 1200×1200、OG 1200×630、detail 1536×1024；材质 WebP 本地引用 |
| 真实 | PASS | realism gate 本行 `ok:true`；`realism.json` 8 项 checks，覆盖 count/dimension/proportion/color/material/rule |
| 手机 | PASS | `game-smoke.mjs` 390×844 PASS 19 checks / 0 failures；320×568 PASS 19 checks / 0 failures；无横向滚动、外部请求 0、console error 0、异常 0 |
| 联机 | PASS | online gate 本行 `ok:true`；双客户端/4 客户端 E2E 纳入 run-all；断线重连、超时托管、榜单、重赛均覆盖 |

预缓存清单：`games/sw.js` 保持 `CACHE_VERSION = v22`；`node scripts/gen-precache.js` 后，`games/precache-manifest.js` 含 `undercover-premium/` 入口、`online.html`、`rules.html`、`engine.js`、`data.js`、`meta.json`，以及 cover.webp、og.webp、detail.webp、card-face.webp、card-back.webp、table-wood.webp。`test.js` 的 SW 交叉校验已由 PENDING 转为强制断言并通过。

集成后 `meta.json.status` 已改为 `shipped`；未推 main，仅推分支 `boardgame/d686a4ca-b6-g7`。
