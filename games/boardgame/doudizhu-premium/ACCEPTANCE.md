# 斗地主 · 精品版 — 验收记录

日期：2026-11-10

## 门禁总览

| 项目 | 结果 |
|---|---|
| 单测 `node games/boardgame/doudizhu-premium/test.js` | 421 passed, 0 failed |
| 联机 E2E `node games/boardgame/doudizhu-premium/test-online.js` | 57 passed, 0 failed |
| 对照 `--control` | 故意失败，exit 1 |
| 美术尺寸 | cover 1200×1200、og 1200×630、detail-1/2 1200×800 |
| 手机冒烟 390×844 | PASS |
| 手机冒烟 320×568 | PASS |

## 规则验收

- [x] 牌堆 54 张，四种花色各 13 点 + 双王，54 个唯一 id。
- [x] 发牌 17/17/17 + 3 张底牌，合计 54；不同种子不同、同种子可复现。
- [x] 叫分 1/2/3 与不叫；只能加价；3 分立即结束；最高叫分者成为地主并拿底牌变 20 张；全不叫自动重发并记录 `redeals`。
- [x] 14 种牌型全部有判定：单、对、三、三带一、三带二、顺子（≥5）、连对（≥3）、飞机（≥2 组三张）、飞机带单/带对、四带二单/两对、炸弹、王炸。
- [x] 顺子/连对/飞机机身限制 3–A，不含 2 与王；飞机翅膀不能复用机身点数；四带两对必须是两个不同对子。
- [x] 压牌必须同型同张数且主牌更大；炸弹压普通牌、炸弹之间比点数、王炸最大。
- [x] 自由出牌不能不要；两家连续不要后清空上一手，最后出牌者重新自由出牌。
- [x] 先出完手牌的一方获胜；地主对两农民；地主 2 倍、农民各 1 倍收付。
- [x] 记分 = 底分 × 叫分 × 2^(炸弹+王炸)，页面同时展示四项与最终分值。
- [x] 三档 AI 全部只产生合法动作；高手档使用未见牌推断，不读取对手手牌（Proxy 守卫测试）。
- [x] `publicView` 不包含其他两家手牌身份；底牌结束前只给数量、结束后才揭示。

## 联机验收（`test-online.js`，57 条断言）

- 两个独立 HTTP client + 第 3 座 AI 补位。
- 建房 201、3 座、邀请 token、密码错误拒绝、邀请码加入、邀请重放拒绝。
- 房主开始；两家看到同一 `stateVersion`、同一回合并、同一底牌数量；各自只拿到自己的手牌。
- 非当前玩家动作 409；合法动作 200；同一 `idempotencyKey` 重放返回同一 `stateVersion`。
- 自动对局在 900 轮内结束；双方赢家、分值表、倍数、本局分值、结算详情完全一致，分值和为 0。
- 排行榜 >=3 条、包含 AI、原始 `playerId` 已哈希。
- 重赛回到叫分、17 张、底牌重新遮罩；session 重连成功。
- 1400ms 无请求后进入托管；重连清除该座位托管。
- 关房 200，再查 404。

## 页面与美术

- [x] `index.html`：viewport、description、OG、Songti SC、无外部脚本/图片、无 emoji。
- [x] 手牌 `div[tabindex="0"]`，无 `role="button"`；主操作按钮 48px；`--tap: 52px`。
- [x] `rules.html`：Article + FAQPage JSON-LD 可解析、>=1200 汉字、2 张本地配图、无外部图片。
- [x] 美术：四个材质母版 + WebP；封面/OG/详情由本地代码合成；PNG 母版入库。
- [x] 预缓存：读取 `../../sw.js` 的 `CACHE_VERSION` 与 `../../precache-manifest.js` 的 version 必须相等；本 slug 已入 v22 清单（`scripts/gen-precache.js` 已运行）。

## 冒烟命令

```
printf 'doudizhu-premium\n' > games/.tmp/doudizhu-list.txt
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games games/.tmp/doudizhu-list.txt --width 390 --height 844 --json games/.tmp/doudizhu-smoke-390.json --resources games/.tmp/doudizhu-resources.json --throttle 0
node games/boardgame/scripts/game-smoke.mjs --root games/boardgame --games games/.tmp/doudizhu-list.txt --width 320 --height 568 --json games/.tmp/doudizhu-smoke-320.json --resources games/.tmp/doudizhu-resources.json --throttle 0
```

## 已知边界

- 叫分按每人一次、最高者得；不实现“有人叫 3 分前可反复抢”的地方变体。
- 底牌在非联机页面结束前只显示牌背；这是服务端/视图的隐藏策略，不影响地主手牌中已包含底牌。
- 预缓存清单最终由统一 regen 生成，本目录不运行该脚本。
