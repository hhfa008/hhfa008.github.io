# 游戏集合维护说明

18 款纯静态网页桌游/棋牌：免费、免登录、单文件，打开即玩。

## 游戏清单

自检项数＝对应 node 单元测试通过的检查/断言条数；Tap Match、语音房无纯逻辑，记为浏览器 E2E 检查项。

| 中文名 | 英文名 | 路径 | 分类 | 人数 | AI 难度 | 规则页 | 自检项数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 中国象棋 | Xiangqi | /games/xiangqi/ | 棋类 | 2 | 三档·中等 | rules.html | 76 |
| 国际象棋 | Chess | /games/chess/ | 棋类 | 2 | 三档·较难 | rules.html、rules-en.html | 37 |
| 五子棋 | Gomoku | /games/gomoku/ | 棋类 | 2 | 三档·简单 | rules.html、rules-en.html | 24 |
| 黑白棋 | Reversi | /games/reversi/ | 棋类 | 2 | 三档·中等 | rules.html | 30 |
| 中国跳棋 | Chinese Checkers | /games/checkers-jump/ | 棋类 | 2/6 | 三档·简单 | rules.html | 49 |
| 国际跳棋 8×8 | Draughts | /games/draughts/ | 棋类 | 2 | 三档·中等 | rules.html | 49 |
| 四子棋 | Connect Four | /games/connect4/ | 棋类 | 2 | 三档·中等 | rules.html | 22 |
| 围棋 9 路 | Go 9×9 | /games/go9/ | 棋类 | 2 | 三档·困难 | rules.html | 20 |
| 接龙 | Klondike | /games/solitaire/ | 纸牌 | 1 | — | rules.html、rules-en.html | 218 |
| 空当接龙 | FreeCell | /games/freecell/ | 纸牌 | 1 | — | rules.html | 45 |
| 蜘蛛纸牌 | Spider | /games/spider/ | 纸牌 | 1 | — | rules.html | 60 |
| 24 点 | 24 Game | /games/24game/ | 纸牌 | 1 | — | rules.html | 51 |
| 斗地主 | Dou Dizhu | /games/doudizhu/ | 卡牌 | 3 | 单档·规则式 | rules.html | 110 |
| 拓荒者：九岛 | Pioneers of Nine Isles | /games/pioneers/ | 德式 | 2–4 | 单档·贪心 | rules.html | 52 |
| 谁是卧底 | Undercover | /games/undercover/ | 聚会 | 4–12 | — | rules.html | 50 |
| 飞行棋 | Aeroplane | /games/aeroplane/ | 聚会 | 2–4 | 单档·简单 | rules.html | 36 |
| Tap Match | Tap Match | /games/tap-match/ | 小游戏 | 1 | — | rules.html | 9（E2E） |
| 语音房 | Voice Room | /games/voice-room/ | 在线联机 · 井字棋/五子棋/四子棋 | 2–4 | — | guide.html | 14（E2E） |

## 技术约定

- 单文件：CSS/JS 内联在 `index.html`；唯一例外是 `pioneers/engine.js` 与 `shared/rules.js`（五子棋/四子棋单机版与语音房服务端共用规则），同目录同源加载，仍无外部依赖。
- 无外部依赖：不引 CDN、字体、图标库；棋盘与棋子用内联 SVG/CSS 自绘。
- 无追踪：不接 analytics、不上报；最高分与战绩只写 `localStorage`。
- 三语：15 款走 EN／简中／ID 字典与切换；Tap Match 为 EN／ID／FIL；中国象棋、语音房暂为中文单语，改版时应优先补齐。
- 触控优先：以手机竖屏为基准，点按目标不小于 32px，棋盘随视口缩放。

## 质量约定

每个游戏必须有能脱离 DOM、在 node 下运行的单元测试；纯 UI 游戏用无头浏览器 E2E 兜底。提交前全部通过，测试要点与项数如下：

- 象棋：七类棋子走法、马腿/塞象眼/炮翻山/飞将；AI 自对弈无非法着法。
- 国际象棋：perft(1/2/3)=20/400/8902；易位、吃过路兵、升变、将死/逼和。
- 五子棋：横竖斜连五与拦截；三档 AI 都能抓必胜、必防。
- 黑白棋：开局四合法点、八方向翻转、终局计数。
- 中国跳棋：121 孔邻接、三连跳路径、对家三角判定。
- 国际跳棋：必吃、连吃、升王、非法走法拒绝。
- 四子棋：重力落子、四向连线、悔棋后局面一致。
- 围棋：提子、禁自杀、打劫、数子、AI 自对弈。
- 接龙/空当接龙/蜘蛛：发牌结构、移动合法性、自动收牌、撤销一致。
- 24 点：分数精确求解；1000 手连续发牌均有解；提示不破坏可解性。
- 拓荒者：开局摆放、建造与交易合法性、掷 7 弃半、AI 与热座状态机。
- 谁是卧底：40 组词库无重复、人数与卧底配置、胜负判定、发词分配。
- 飞行棋：起飞、踩敌机、跳格、精确终点、胜负。
- Tap Match／语音房：计时、计分、三语切换与房间信令走浏览器 E2E。

## 新增一个游戏

1. 建 `games/<slug>/index.html`：单文件、三语字典、触控优先、无外部依赖与追踪。
2. 写 `games/<slug>/rules.html`：中文 1200–1600 字，含 `Article` + `FAQPage` JSON-LD，文末 CTA 回游戏页；补图标与 OG 图。
3. 三语大厅同步：`games/index.html`、`games/en/`、`games/id/` 各加一张同 slug 卡片，数量与 hreflang 保持一致。
4. 更新 `sitemap-pages.xml`，收录游戏页与规则页。
5. 抽离纯引擎写 node 单测并跑通，把项数补进上表。
6. 部署与收录：`git archive` 打干净快照，`wrangler pages deploy`；curl 验证 200，再用 `indexnow-ping --url` 提交新 URL。

## 已知限制

- 语音房是 WebRTC mesh，最多 4 人；房号可被枚举，无密码与限流。
- 部分 AI 是启发式或贪心（拓荒者、飞行棋），不是搜索；棋类才是 Alpha-Beta。
- 无账号、无跨设备战绩同步；成绩只存在本机浏览器。
- 无服务器、排行榜、好友系统；除语音房外均可离线。
