# 国际象棋 Chess Premium — 验收记录

五项门禁，全部以实际运行输出为准；以下数字均来自最终验证运行。

## 1. 流程与单元测试

- 命令：`node games/boardgame/chess-premium/test.js`
- 覆盖：初始 32 枚 / 16+16 子力分布、FEN 往返与非法拒绝、起始 perft(1–4)=20/400/8902/197281、Kiwipete 与另外三个标准局面、兵双步/吃过路兵/四选升变、六种棋子走法、双侧易位与全部权利/过将规则、将军/将死/逼和、三次重复、五十回合、子力不足、SAN/UCI、AI 合法性与一步杀、随机 40 步 make/unmake 还原、静态页面与产物。
- 结果：`RESULT: 281 passed, 0 failed`。

## 2. 联机

- 命令：`node games/boardgame/chess-premium/test-online.js`
- 覆盖：建房 / 邀请 / 密码、加入、开局、AI 补位、双客户端同态、非法动作拒绝、幂等、完整将死结算、断线重连、超时托管、排行榜、重赛交换颜色、关闭房间。
- 结果：`RESULT: 80 passed, 0 failed` + `ONLINE_E2E_JSON: {"clients":2,"sameGame":true,"settlementConsistent":true,"reconnect":true,"timeoutTakeover":true,"leaderboard":true,"runAll":true}`。
- 对照：`node ... test-online.js --control` 必须 exit 1。

## 3. 浏览器 E2E

- 命令：`node games/boardgame/chess-premium/e2e.mjs`
- 覆盖：真实点击愚人杀将死、悔棋/新局、AI 回复、三档强度、键盘/aria、390×844 与 320×568、规则 JSON-LD 与 B 站来源、封面 64 格/32 枚与两个详情图、零外部请求/零 console error、性能预算、浏览器内联机同步。
- 结果：`RESULT: 152 passed, 0 failed`。
- 对照：`--control` 必须 exit 1。

## 4. 美术与真实性

- 单材质：4 张 1024×1024 WebP（light-maple / dark-walnut / felt-cloth / board-edge）。
- 成品：cover 1200×1200、og 1200×630、detail-1 / detail-2 1200×800，全部 WebP，无 PNG 母版。
- 字节：材质 836,134 B + 成品 468,920 B = 1,305,054 B，≤ 2MB；页面实际加载 743,695 B（FCP 36ms / FPS 61；DCL 14ms / load 15ms）。
- `realism.json`：count / dimension / proportion / color / material / rule 六类检查全部 `ok:true`。
- B 站来源：BV1PuokBiEb6、BV1uA4y1Q7uQ、BV1HS4y1w7Ey（仅文本核对，无截图/OCR）。

## 5. 手机两档

- 命令：

```
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /Users/fa/games/.tmp/chess-premium-games.txt --width 390 --height 844 \
  --json /Users/fa/games/.tmp/chess-premium-smoke-390.json
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /Users/fa/games/.tmp/chess-premium-games.txt --width 320 --height 568 \
  --json /Users/fa/games/.tmp/chess-premium-smoke-320.json
```

- 结果：390×844 PASS（19/19 检查）、320×568 PASS（19/19 检查）；0 console error / 0 external request / 无横向溢出。
- 例外说明：8×8 棋盘是单一复合网格控件，格子随棋盘宽度缩放；主按钮/下拉/输入框均 ≥44px。

## 结论

状态：shipped；五项门禁全部实测通过。

## 6. 离线预缓存（sw v22）

- `games/sw.js` 保持 `CACHE_VERSION = 'v22'` 与 `PRECACHE_MANIFEST` 读取逻辑，未回退到内联清单。
- `node scripts/gen-precache.js` 重新生成后，`sw.js` 版本与 `precache-manifest.js` 的 `version` 均为 `v22`，交叉校验通过。
- 清单包含本游戏 `index.html` / `rules.html` / `online.html` / `engine.js` / `data.js` / `meta.json` 与四张成品 WebP（`assets/cover.webp`、`og.webp`、`detail-1.webp`、`detail-2.webp`）。
