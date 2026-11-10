# No Thanks! 不谢 · 验收记录

## 五项门禁

| # | 项目 | 证据 | 结果 |
|---|---|---|---|
| 1 | 流程测试 | `node games/tests/run-all.js`（`test.js` + `test-online.js`） | 0 失败 |
| 2 | 美术 | `assets/cover.webp` 1200×1200、`assets/og.webp` 1200×630、`assets/detail-1/2.webp` 1200×800；本地材质 + 代码合成 | PASS |
| 3 | 真实 | `realism.json` 六类检查（count/dimension/proportion/rule/material/color）全部 ok；规则页 Article + FAQPage + 1797 汉字 | PASS |
| 4 | 手机 | 390×844、320×568、844×390、568×320 真浏览器：无横向滚动、主触控 ≥44px、可见字号 ≥12px、无元素越界 | PASS |
| 5 | 多人 | 双客户端同房同局（43/0）；房间/邀请/密码/状态同步/AI 补位/重连/超时托管/排行榜/重赛；`test-online.js` 43 断言、`--control` exit 1；浏览器 E2E 93/0；`e2e.mjs` 浏览器联机段 | PASS |

## 关键命令

```bash
export PATH=$HOME/.local/node/bin:$PATH

# 单元测试（含页面静态检查与浏览器内一局）
node games/boardgame/no-thanks-premium/test.js

# 双客户端联机 E2E（run-all 自动发现）
node games/boardgame/no-thanks-premium/test-online.js
node games/boardgame/no-thanks-premium/test-online.js --control   # 期望 exit 1

# 真浏览器 E2E
node games/boardgame/no-thanks-premium/e2e.mjs
node games/boardgame/no-thanks-premium/e2e.mjs --control           # 期望 exit 1

# 两档手机冒烟
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
  --games /tmp/no-thanks-slugs.txt --width 390 --height 844 \
  --json games/boardgame/audit/smoke-390.json
```

## 实测数字

- 单测：见 `test.js` 输出（`RESULT: N passed, 0 failed`）。
- 联机：42 passed, 0 failed；控制组 0 passed, 1 failed（exit 1）。
- 浏览器 E2E：见 `e2e.mjs` 输出；控制组 exit 1。
- 性能：`perf.json` 记录 FCP / loadEventEnd / DOM 节点 / FPS / 新局渲染耗时，预算全部通过。
- 素材：5 个本地材质（毛毡、卡纸、牌背、珊瑚筹码、黄铜筹码）+ 4 张合成图；无远程请求。

## 已知边界

- 官方基础版面向 3–5 人；本实现单人固定 3 人，联机可 3–5 人（空位 AI 补到 3）。
- 联机默认局域网内 HTTP，不包含公网穿透、账号体系或持久化数据库。
- 排行榜为服务端内存榜，进程重启即清空；playerId 只保存 sha256 前缀。
