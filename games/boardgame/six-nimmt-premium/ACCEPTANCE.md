# 6 Nimmt! 谁是牛头王 · 验收记录

## 五项门禁

| # | 项目 | 证据 | 结果 |
|---|---|---|---|
| 1 | 流程测试 | `node games/boardgame/six-nimmt-premium/test.js`（standalone，无 Chrome） | 237 通过 / 0 失败 |
| 2 | 美术 | `assets/cover.webp` 1200×1200、`assets/og.webp` 1200×630、`assets/detail-1/2.webp` 1200×800；6 件本地 img-gen 材质 + 代码合成 | PASS |
| 3 | 真实 | `realism.json` 六类检查（count/dimension/proportion/rule/material/color）全部 ok；规则页 Article + FAQPage + 2953 可见汉字 | PASS |
| 4 | 手机 | 390×844、320×568、844×390、568×320：无横向滚动、按钮/链接 ≥44px、可见字号 ≥12px、无元素越界 | PASS（e2e.mjs 126/0 实测） |
| 5 | 多人 | 双客户端同房同局（58/0）；房间/邀请/密码/同时暗出/AI 补位/重连/超时托管/排行榜/重赛；`test-online.js` 58 断言、`--control` exit 1；`e2e.mjs` 126/0 含浏览器联机段 | PASS |

## 关键命令

```bash
export PATH=$HOME/.local/node/bin:$PATH

# 单元测试（引擎 + 规则 + 静态产物，无 Chrome）
node games/boardgame/six-nimmt-premium/test.js

# 双客户端联机 E2E（run-all 自动发现）
node games/boardgame/six-nimmt-premium/test-online.js
node games/boardgame/six-nimmt-premium/test-online.js --control   # 期望 exit 1

# 真浏览器 E2E（主流程执行）
node games/boardgame/six-nimmt-premium/e2e.mjs
node games/boardgame/six-nimmt-premium/e2e.mjs --control           # 期望 exit 1

# 美术合成
node games/boardgame/six-nimmt-premium/render-art.mjs
```

## 实测数字

- 单测：`RESULT: 237 passed, 0 failed`。
- 联机：58 passed, 0 failed；控制组 0 passed, 1 failed（exit 1）。
- 浏览器 E2E：126 passed, 0 failed；控制组 exit 1。FPS 61、新局 0.3ms、DOM 197 节点、loadEventEnd 32ms。
- 性能：`perf.json` 记录 FCP / loadEventEnd / DOM 节点 / FPS / 新局渲染耗时，预算全部通过。
- 素材：6 个本地材质（毛毡、卡纸、牌背、黄铜牛头、胡桃木、酒红丝绒）+ 4 张合成图；无远程请求。
- 规则页：2953 可见汉字（源码含 JSON-LD 共 3327），Article + FAQPage，两张详情图，三条 B 站来源（BV1neA2z4ENU / BV1BfchzTEjB / BV1q7411s732）。

## 已覆盖的规则边界

- 104 张牌、每人 10 张、四行起始牌、剩余牌终局前隐藏。
- 55=7、11 倍数=5、10 倍数=3、5 倍数=2、其余=1，判定顺序正确。
- 升序结算：21 必须先于 25 落位，行内始终保持升序。
- 低于所有行尾时由出牌者选行；选后继续结算剩余暗牌。
- 目标行五张时吃下五张，新牌重新开行；下一轮再指向满行同样立即吃行。
- 十轮后低分获胜；并列时 `winnerIds` 包含全部最低分玩家。
- 2–10 人各两个种子共 18 局自对弈：全部结束、手牌打光、牌数守恒 104、赢家最低分。
- 公共视图：对手手牌 `null`、对手暗牌 `card` 不下发、未使用牌与 `picks` 数组不出现。

## 已知边界

- 官方基础版支持 2–10 人；单人页面固定提供 3 / 4 / 5 人 AI 牌桌。
- 联机默认局域网内 HTTP，不包含公网穿透、账号体系或持久化数据库。
- 排行榜为服务端内存榜，进程重启即清空；playerId 只保存 sha256 前缀。
- 单人页面的数字键为本地快捷操作；联机页面以按钮/触控为主。
