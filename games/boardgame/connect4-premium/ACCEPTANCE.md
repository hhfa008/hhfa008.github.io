# 四子棋 CONNECT 4 PREMIUM — 验收记录

> 最终数字以实际运行输出为准；本文件记录最近一次完整验证。

## Gate 1 — 流程与单测

- 命令：`node games/boardgame/connect4-premium/test.js`
- 结果：`RESULT: 124 passed, 0 failed`
- 覆盖：42 格 / 7×6、红先、交替、重力落点、满列禁投、横竖两条斜线四连与连线索引、
  满盘平局、终局封盘、clone/key 纯度、publicView 副本、AI 立即取胜/封堵/中心偏好/
  400ms 限时/永不非法、自对弈守恒。

## Gate 2 — 联机双客户端

- 命令：`node games/boardgame/connect4-premium/test-online.js`
- 结果：`RESULT: 83 passed, 0 failed`
- `ONLINE_E2E_JSON`：`clients:2, sameGame:true, settlementConsistent:true,
  reconnect:true, timeoutTakeover:true, leaderboard:true, runAll:true`
- 覆盖：创建/邀请/密码、加入、开局、同状态、回合强制、非法列、内部状态不泄漏、
  幂等、完整七手红方纵向胜利、结算一致、排行榜、再来一局交换先手、重连、AI 补位、
  超时托管、关房。
- 对照：`node .../test-online.js --control` 退出码 1。

## Gate 3 — 真实浏览器 E2E

- 命令：`node games/boardgame/connect4-premium/e2e.mjs`
- 结果：`RESULT: 150 passed, 0 failed`；`--control` 退出码 1。
- 实测：FCP 0ms、DCL/load 32ms、DOM 207 节点、FPS 61、新局渲染 0.2ms、
  首屏 materialBytes 400553、零外部请求、零 console error、零页面异常。
- 覆盖：真实点击完整对局、AI 应手、悔棋、新局、强度选择、键盘、390/320 布局、
  规则页 JSON-LD + 两张详情图 + 3 个 BV 号、封面 42 格 / 24 枚 / 12+12、联机浏览器段落。

## Gate 4 — 美术与真实感

- `assets/cover.webp` 1200×1200 · 76510 bytes
- `assets/og.webp` 1200×630 · 75404 bytes
- `assets/detail-1.webp` 1200×800 · 63980 bytes
- `assets/detail-2.webp` 1200×800 · 61160 bytes
- 材质：`../../assets/art/premium/connect4/` 的 disc-red 52154 / disc-yellow 21698 /
  frame-blue 110282 / table-felt 164268 bytes，均为 1024×1024。
- 体积：四张成品 277054 + 四张材质 348402 = 625456 bytes（≤ 2MB，仅 WebP，无 PNG 母版）。
- `realism.json`：7 条不同 kind（count / dimension / proportion / color / material /
  rule / physics）全部 `ok:true`。

## Gate 5 — 手机两档冒烟

- 390×844：PASS，19 项检查；0 console error、0 external request、无横向溢出；
  主控件最小 44px，最小字号 12px，棋盘列宽 48.6px。
- 320×568：PASS，19 项检查；0 console error、0 external request、无横向溢出；
  主控件最小 44px，最小字号 12px，棋盘列宽 44.0px。

## 最终实测数字

- 单测：124 / 0
- 联机：83 / 0
- 浏览器 E2E：150 / 0
- 手机冒烟：390 PASS / 320 PASS
- 美术：625456 bytes（4 张成品 + 4 张材质）

## 6. 离线预缓存（sw v22）

- `games/sw.js` 保持 `CACHE_VERSION = 'v22'` 与 `PRECACHE_MANIFEST` 读取逻辑，未回退到内联清单。
- `node scripts/gen-precache.js` 重新生成后，`sw.js` 版本与 `precache-manifest.js` 的 `version` 均为 `v22`，交叉校验通过。
- 清单包含本游戏 `index.html` / `rules.html` / `online.html` / `engine.js` / `data.js` / `meta.json` 与四张成品 WebP（`assets/cover.webp`、`og.webp`、`detail-1.webp`、`detail-2.webp`）。
