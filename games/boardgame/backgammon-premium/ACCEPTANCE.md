# 双陆棋 Backgammon · 验收记录

## 五项门禁

| # | 项目 | 证据 | 结果 |
|---|---|---|---|
| 1 | 流程测试 | `node games/boardgame/backgammon-premium/test.js` | **334 通过 / 0 失败** |
| 2 | 美术 | `assets/cover.webp` 1200×1200、`assets/og.webp` 1200×630、`assets/detail-1/2.webp` 1200×800；4 件本地 img-gen 材质 + 代码合成；总 1,293,406 bytes | **PASS** |
| 3 | 真实 | `realism.json` 8 项 7 类检查全部 ok；规则页 Article + FAQPage，3055 可见汉字，3 条 B 站来源 | **PASS** |
| 4 | 手机 | 390×844、320×568：冒烟各 19 项 PASS；无横向滚动、主控件 ≥44px、可见字号 ≥12px、0 console error、0 外部请求 | **PASS** |
| 5 | 多人 | 双客户端同房同局 73/0；房间/邀请/密码/加倍/走子同步/AI 补位/重连/超时托管/排行榜/重赛；`--control` exit 1 | **PASS** |

## 关键命令

```bash
export PATH=$HOME/.local/node/bin:$PATH

node games/boardgame/backgammon-premium/test.js                       # 334 passed, 0 failed
node games/boardgame/backgammon-premium/test-online.js                # 73 passed, 0 failed
node games/boardgame/backgammon-premium/test-online.js --control      # exit 1
node games/boardgame/backgammon-premium/e2e.mjs                       # 142 passed, 0 failed
node games/boardgame/backgammon-premium/e2e.mjs --control             # exit 1

node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /Users/fa/games/.tmp/backgammon-games.txt --width 390 --height 844 \
  --json /Users/fa/games/.tmp/backgammon-smoke-390.json               # PASS
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /Users/fa/games/.tmp/backgammon-games.txt --width 320 --height 568 \
  --json /Users/fa/games/.tmp/backgammon-smoke-320.json               # PASS

node games/boardgame/backgammon-premium/render-art.mjs                 # 4 WebP, no PNG masters
```

## 实测数字

- 单测：`RESULT: 334 passed, 0 failed`。13 个分组覆盖开局、骰子、走法、bar、较骰、离盘、终局、倍数方块、AI、公共视图、守恒、页面静态检查与交付产物。
- 联机：73 passed, 0 failed；`ONLINE_E2E_JSON` 全 true；控制组 0 passed, 1 failed（exit 1）。完整对局 184 步结束，双方结算一致（cube 2 的 single，+2/−2）。
- 浏览器 E2E：142 passed, 0 failed；控制组 exit 1。FPS 62、新局渲染 0.8ms、DOM 450 节点、loadEventEnd 33ms、materialBytes 835,212。
- 冒烟：390×844 与 320×568 各 19 项 PASS，0 failed、0 console error、0 external request。
- 美术：4 件材质 WebP（walnut 292,806 / maple 149,722 / leather 282,342 / ivory-checker 27,512 bytes）+ 四张合成图（cover 185,638 / og 101,396 / detail-1 123,452 / detail-2 130,538 bytes），合计 **1,293,406 bytes**；仅交付 WebP，PNG 母版已删除。
- 规则页：3055 可见汉字（源码含 JSON-LD 共 3505），Article + FAQPage，两张详情图，三条 B 站来源（BV1BL4y1z7SB / BV14D4y197By / BV1cU516ME9k）。
- 性能预算：FCP ≤2500ms（实测 0）、loadEventEnd ≤4000ms（33ms）、DOM ≤2500（450）、FPS ≥30（62）、新局 ≤200ms（0.8ms）、materialBytes ≤2MB（835,212 bytes）、externalRequests 0。

## 已覆盖的规则边界

- 24 点 / 4 象限 / 每象限 6 点；双方各 15 枚、总数 30；标准开局白 2/5/3/5、黑 2/5/3/5，双方 pip 167。
- 白 24→1、黑 1→24；白 home 1–6、黑 home 19–24。
- 封闭点（2+ 对方子）不可落；落在一枚对方散子上即击中送 bar。
- bar 有子时必须先按骰点进场；白 25−die、黑 die；进场点封闭则不能进；两个进场点都封死时跳过回合。
- 对子走四步；两枚都能走时必须都走；只能走一枚时必须走较大的那枚；两枚都不能走才算无走法。
- 离盘需 15 枚全在 home 且 bar 为空；精确骰点直接离盘；超点只能从最高已占点离盘；不能跳过更高棋子。
- 终局 single ×1、gammon ×2、backgammon ×3；cube 4 的 gammon = 8 分；负方在 bar 上也算 backgammon。
- 倍数方块初始 1 居中；只能在本方回合掷骰前加倍；接受后翻倍并归接受方；放弃输掉当前赌注；上限 64。
- AI 决策纯函数、只返回合法序列；hard 时间 ≤500ms；自对弈结束、总数 30、赢家离盘 15、分数 = cube × multiplier。
- 公共视图不泄漏 seed/rngState/history；legalMoves/legalSequences 只给当前观察者。

## 已知边界

- 联机默认局域网 HTTP 轮询，不包含公网穿透、账号体系或持久化数据库。
- 排行榜为服务端内存榜，进程重启即清空；playerId 只保存 sha256 前缀。
- 单局制，不包含多局 match、Crawford 规则或积分赛制。
- 棋盘点位在 320px 宽度下无法各自达到 44px 宽，采用整列可点击区域与高亮目标；所有操作按钮/选择器/链接 ≥44px。

## 6. 离线预缓存（sw v22）

- `games/sw.js` 保持 `CACHE_VERSION = 'v22'` 与 `PRECACHE_MANIFEST` 读取逻辑，未回退到内联清单。
- `node scripts/gen-precache.js` 重新生成后，`sw.js` 版本与 `precache-manifest.js` 的 `version` 均为 `v22`，交叉校验通过。
- 清单包含本游戏 `index.html` / `rules.html` / `online.html` / `engine.js` / `data.js` / `meta.json` 与四张成品 WebP（`assets/cover.webp`、`og.webp`、`detail-1.webp`、`detail-2.webp`）。
