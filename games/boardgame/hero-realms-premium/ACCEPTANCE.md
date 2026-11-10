# 英雄领域 Hero Realms · 验收记录

## 五项门禁

| # | 项目 | 证据 | 结果 |
|---|---|---|---|
| 1 | 流程测试 | `node games/boardgame/hero-realms-premium/test.js`；DESIGN.md；perf.json；ACCEPTANCE.md；`e2e.mjs --control` exit 1 | PASS |
| 2 | 美术 | `assets/cover.webp` 1200×1200、`assets/og.webp` 1200×630、`assets/detail-1/2.webp` 1200×800；7 个本地 img-gen 材质 + 代码合成 | PASS |
| 3 | 真实 | `realism.json` 九项检查（rule/count/dimension/proportion/material/color）全部 ok；规则页 Article + FAQPage | PASS |
| 4 | 手机 | 390×844、320×568 真浏览器：无横向滚动、触控 ≥44px、可见字号 ≥12px、无元素越界 | PASS |
| 5 | 多人 | 双客户端同房同局（53/0）；恰好 2 座、隐藏手牌、状态同步、重连、超时托管、排行榜、重赛；`test-online.js --control` exit 1；浏览器 E2E 100/0（含联机段） | PASS |

## 关键命令

```bash
export PATH=$HOME/.local/node/bin:$PATH

# 单元测试（引擎 / 数据 / 页面静态检查）
node games/boardgame/hero-realms-premium/test.js

# 双客户端联机 E2E（run-all 自动发现）
node games/boardgame/hero-realms-premium/test-online.js
node games/boardgame/hero-realms-premium/test-online.js --control   # 期望 exit 1

# 真浏览器 E2E（主代理执行）
node games/boardgame/hero-realms-premium/e2e.mjs
node games/boardgame/hero-realms-premium/e2e.mjs --control           # 期望 exit 1

# 美术重渲染
node games/boardgame/hero-realms-premium/render-art.mjs
```

## 实测数字

- 单测：`test.js` 输出 `RESULT: 182 passed, 0 failed`。
- 联机：53 passed, 0 failed；控制组 0 passed, 1 failed（exit 1）。
- 浏览器 E2E：100 passed, 0 failed；控制组 exit 1。
- 性能：`perf.json` 记录 FCP / loadEventEnd / DOM 节点 / FPS / 新局渲染耗时。
- 素材：7 个本地材质（皮革垫、金币、匕首、生命水晶、冠军立牌、羊皮纸、石桌）+ 4 张合成图；WebP 材质合计约 1.86MB；无远程请求。

## 规则差异（已在 rules.html / realism.json 标注）

- 起始牌组按产品口径为 7 金币 + 3 匕首；实体基础版为 7 金币 + 1 红宝石 + 1 匕首 + 1 短剑。
- 市场使用基础版 51 个真实卡名、84 张牌；未纳入 Fire Gem、英雄牌组、守卫关键词与扩展。
- 卡牌名称与派系真实；具体数值为适配本引擎的公开规则实现，不声称逐字复刻实体卡。

## 已知边界

- 联机默认局域网 HTTP，不包含公网穿透、账号体系或持久化数据库。
- 排行榜为服务端内存榜，进程重启即清空；playerId 只保存 sha256 前缀。
- 无守卫关键词；冠军不自动阻挡对英雄的攻击。
- 单人模式固定为玩家 vs AI，AI 使用启发式评分而非搜索。
