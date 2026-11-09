# 留存与时长：机制、证据、我们的缺口

> 记录时间：2026-11-10
> 适用对象：`hhfa008.github.io/games/`（25 款单文件静态游戏 + 100 个工具）
> 前提约束：**免登录、无推送、无第三方追踪、无排行榜后端（排行榜正在新建）**

这份文档只回答一个问题：**在不开账号、不加追踪的前提下，哪些机制真的能让人明天再来、并且多玩一会儿。**

结论先给：有公开数据支撑、且我们做得起的只有三件事——**每日同题、跨游戏每日路线、连续天数（带补签）**。社交排名被你要了，我们做，但它是**逆着证据走的**，所以必须配冷启动缓冲（见第 5 节）。

---

## 1. 有数据支撑的机制

| 机制 | 产品 | 数字 | 来源 | 数据时间 | 我们适用吗 |
|---|---|---|---|---|---|
| 每日一题（每天一局、次日刷新） | LinkedIn Games | 84% 玩家次日回来；80% 一周后仍在玩 | [CMI 采访 LinkedIn 游戏高级 PM](https://contentmarketinginstitute.com/strategy-planning/linkedin-gaming-strategy) | 2025-04-09 | **适用**，本地日期做种子即可 |
| 每日一题 + 无剧透结果分享 | Wordle | DAU 90（2021-11-01）→ 30 万（2022-01-02）→ 200 万+；13 天 120 万条分享；59% 玩家经常分享；43% 首次听说来自社交媒体 | [Wikipedia](https://en.wikipedia.org/wiki/Wordle)、[Morning Consult 调查](https://www.199it.com/archives/1386152.html) | 2022-01 | **适用**，但分享是拉新不是留存 |
| 每日免费题 → 订阅漏斗 | NYT / Wordle | 2022Q1 净增 38.7 万数字订户；2023-03 Games 订阅破 100 万；2026Q2 数字订户 1280 万、数字收入 4.079 亿美元 | [Axios](https://www.axios.com/2022/05/04/new-york-times-earnings-wordle-acquisition-users)、[Press Gazette](https://pressgazette.co.uk/north-america/new-york-times-games-puzzles-wordle-subscriptions/)、[Zacks](https://zrsa.zacks.com/stock/news/2971357/nyt-earnings-show-digital-growth-as-subscriber-momentum-moderates) | 2022-05 / 2023-03 / 2026-08 | 漏斗逻辑适用，订阅/账号不适用 |
| 多款每日游戏组合拉长单次会话 | NYT Games | 2024 年 111 亿次游玩、1000 万+ 日活 → 约 **3.0 局/日活/天**；Wordle 单款 53 亿次 → 约 **1.5 局** | [Wikipedia](https://en.wikipedia.org/wiki/The_New_York_Times_Games)（原始数字来自 NYT 发言人） | 2024 年度 | **强适用**：25 款正好组「每日 3 款」路线 |
| 连续天数 + 下注/冻结 | Duolingo | Streak Wager：D7 留存 **+14%**；Weekend Amulet：一周后回访 **+4%**、掉 streak 概率 **−5%**；streak 与每日目标解耦：DAU **+1%**、D14 留存 **+3.3%**、20 天后持 streak 的日活 **+10.5%**（新用户 **+19%**） | [Duolingo 2017](https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/)、[Duolingo 2020](https://blog.duolingo.com/improving-the-streak/) | 2017-05 / 2020-11 | **部分适用**：无推送会打折 |
| 连胜补签/复活 | Duolingo | 2026-06 一期活动恢复 1540 万用户 streak，其中近 800 万原本没有活跃 streak；当季 DAU 5870 万（+23%），CURR 84% 创历史最高 | [Pulse2 引 Q2 2026 股东信](https://pulse2.com/duolingo-daily-active-users-reach-58-7-million-as-retention-hits-record-84-and-social-accounts-top-1-billion-organic-impressions/) | 2026-08-10 | **适用变体**：「错过 1 天不归零」 |
| 结果分享的绝对量级 | Wordle | 2025 年平均每秒 46 条结果被分享；单日最高 300 万条（2025-04-22） | [TODAY](https://www.today.com/popculture/hardest-wordle-connections-puzzle-2025-new-york-times-games-rcna251022) | 2025-12 | 适用，但见第 3 节反例 |
| 平台规模 + 异步对局 | Board Game Arena | 1089.4 万注册、1429 款游戏、每月 899 万局 | [BGA 实时首页](https://boardgamearena.com/)、[GamesBeat](https://gamesbeat.com/board-game-arena-surpasses-10m-user-account-milestone/) | 2026-11-10 / 2024-08 | 排名/异步对局需后端与账号，本地只能做个人最佳 |

**口径警告（必须一起看）**

- LinkedIn 的 84% / 80% 是负责人对外口径的**观察值**，未披露样本与统计口径，**不是 A/B 实验**
- Duolingo 的数字全部是**公司自报 A/B**，未经同行评审
- NYT 的 3.0 / 1.5 局是拿官方年度游玩数除以「1000 万+ 日活」的**粗算**，不是 NYT 官方指标；NYT 不单独公布 Wordle DAU
- 「每日谜题品类统一的 D1/D7 留存基准」**未找到公开数据**；「加入每日挑战的公开 A/B」也**未找到**

---

## 2. 反例：这些机制在我们这里会失效

| 机制 | 为什么失效 | 证据 |
|---|---|---|
| **社交/好友系统（小基数）** | 需要网络密度。装机量大时社交功能让成为「爆款」的概率 **+49 个百分点**，装机量小时 **−26 个百分点** | Rietveld & Ploog, *Strategic Management Journal* 2021，9700 款 Steam 游戏，[PDF](https://discovery.ucl.ac.uk/id/eprint/10138499/7/Rietveld_Strategic%20Management%20Journal%20-%202021%20-%20Rietveld%20-%20On%20top%20of%20the%20game%20%20The%20double%E2%80%90edged%20sword%20of%20incorporating%20social.pdf) |
| **自愿好友 / 邀请链接** | 采用率极低，形不成回路 | Aalto University 2026：CrazyGames 上自愿好友采用率 **0.58%（7/1204）**；强制匹配 62.8% 发生互动，但 D1/D7 留存**不显著**，[PDF](https://aaltodoc.aalto.fi/bitstreams/309f4add-3dde-4963-bcef-253ec884141f/download) |
| **全球排行榜冷启动** | 空榜或被头部碾压，新人没有可比对象 | **无直接对照实验**。只有社会比较理论 + 上两条邻近证据。找不到「空榜导致留存下降 X%」的公开数据 |
| **只做单款每日一题** | 回访封顶 1 局，单次时长上不去，且会衰减 | Wordle 2025 年 42 亿次 vs 2024 年 53 亿次（**−21%**），NYT 要做电视节目唤回流失玩家，[A Media Operator](https://www.amediaoperator.com/analysis/wordle-tv-show-new-york-times-games-jonathan-knight/) |
| **超难第二关 + 分享复活** | 话题冲顶后快速崩塌 | 羊了个羊：2022-09-15 单日 **>8000 万**人；微信指数 9/19 约 3.88 亿 → 9/22 8543 万 → 10/8 **不足 1500 万**，[36氪](https://www.36kr.com/p/1948583626703494) |
| **依赖推送的 streak** | 网页无稳定推送；游戏类原生推送 opt-in：iOS **20.6%**、Android **27.8%**；网页推送还要先装 PWA | [OneSignal 2024](https://onesignal.com/mobile-app-benchmarks-2024)；Duolingo 34 天发 2 亿条，DAU 仅 **+0.5%**、新用户留存 **+2%**，[KDD 2020](https://research.duolingo.com/papers/yancey.kdd20.pdf) |
| **只用 localStorage 存 streak** | 清缓存/换设备/换域名即丢，用户会认为「记录被吞了」 | Wordle 迁移到 NYT 时大量用户 streak 被重置为 1，NYT 发言人确认数据只存在用户浏览器、官方无存档，[The Verge](https://www.theverge.com/2022/2/11/22929229/wordle-new-york-times-streak-stats-issues) |
| **把分享当留存机制** | 分享是拉新/表达，不是回访；没有受众时分享不产生回流 | Wordle 作者受访：原本带链接，因为「看起来像垃圾推广」而移除；「大多数人在群聊里分享，而不是 Twitter」，[AssetBank 引述](https://www.assetbank.co.uk/blog/gamings-gone-viral) |

---

## 3. 我们现在缺什么（2026-11-10 代码实测）

审计口径：以工作区代码为准，逐个 grep，不是看 README。

| 机制 | 覆盖率 | 事实 |
|---|---|---|
| **保存对局进度** | **0 / 23** | 只存 `lang` 和最好成绩。`chess:896` 存 `{lang,level}`；`go9:521` 只存 W/L/D；`aeroplane`/`backgammon`/`banqi`/`checkers-jump`/`connect4`/`draughts`/`xiangqi` 完全无 localStorage |
| **每日挑战 / 日期种子** | **0 / 23** | `Date.now()` 只用于摇随机种子，从未参与「今天全站同一局」 |
| **成就 / 新手引导 / 结果分享** | **0 / 23** | 21 页挂了 `shared/share.js`，但 `share.js:150-153` 分享的是固定文案「游戏名 · 打开就能玩」，**没有一款分享过比分** |
| **连续天数 streak** | 1 / 23 | 唯一一个在 24 点里，是局内连对，刷新归零 |
| 难度分级 | 13 / 23 | 完整分档 56.5% |
| 撤销 / 提示 | 16 / 23 | 撤销 UI 13 款，纯提示 3 款 |
| 最好成绩 | 8 / 23 | freecell/solitaire/spider 存最佳时间+步数 |
| 离线预缓存 | 22 / 23 | 缺口见下 |
| 音效 / 物理 | 5 / 23（+3 部分） | `shared/sfx.js`、`shared/physics.js` 已可用但多数游戏没接 |

**三处结构性问题（比缺功能更伤）**

1. **PWA 只挂在大厅**。manifest 与 SW 注册只写在 `games/index.html:11`、`:591-593`，23 个游戏页一个都没挂。用户从搜索直接落到 `/games/chess/`，不会注册 SW、拿不到离线、也无法从当前页安装——每次都只是「一次性网页」。离线预缓存能力本身有，**入口没接**。
2. **`tcg-deck` 离线破图**：`index.html:1160` 运行时 `fetch('../tcg-sample/cards.json')`，而 `sw.js` 预缓存列表没有这个文件。离线时页面能开，卡牌库加载失败。
3. **对局历史只在内存**：18/23 有撤销栈或可见日志，全部不跨刷新，0 款支持回放（而 `shared/tcg.js` 引擎已经有 `replay()`，页面没暴露）。

**技术约束（已核实）**

- 后端只有一个：`games/voice-room/worker/`（Durable Object `RoomDO`，只管语音信令）。**没有排行榜、没有账号、没有 D1/KV/R2 持久化**
- **零第三方追踪脚本**：无 gtag/GTM/Plausible/Umami/Clarity/Hotjar/Sentry/Segment/Mixpanel/PostHog/Matomo，无 `sendBeacon`
- `CACHE_VERSION` = v14
- `manifest.webmanifest` 只有 1 个 SVG 图标，无 192/512 PNG，无 iOS `apple-touch-icon`，全站无 `beforeinstallprompt`

---

## 4. 落地清单（按「证据强度 × 改动量」排序）

### P0｜有数据支撑、改动小、先做

1. **对局存档**（0/23 → 全量）
   长局（chess、xiangqi、go9、mahjong、pioneers、backgammon、solitaire、spider、freecell、tcg-sample）刷新后必须原样恢复。
   *为什么*：现在离开一次 = 整局重来，直接抬高「下次再打开」的成本；这是最基础的尊重。
   *验证*：中途刷新后棋盘哈希一致；`localStorage` 有单键 ≤ 8KB 的快照。

2. **每日同题**（0/23 → 覆盖所有可复现对局）
   用本地日期 `YYYY-MM-DD` 哈希成种子，喂给已有的 `Shuffle.hashSeed` + `sfc32`。每天全站同一局，每天只算一次成绩。
   *为什么*：LinkedIn 84% 次日回访、Wordle 120 万条/13 天。
   *验证*：同一日期在不同设备/不同浏览器生成的初始局面 md5 一致；改系统日期不能重复计分。

3. **连续天数 + 每月 1 次补签**，首页第一屏
   *为什么*：Duolingo Streak Wager D7 +14%、补签让 1540 万人恢复连胜。
   *验证*：断签 1 天可用补签救回，断 2 天归零；时间倒退不刷分。

4. **PWA 生命周期下沉到每个游戏页**
   每个游戏页加 manifest 引用 + SW 注册（幂等）+ iOS `apple-touch-icon`；补 192/512 PNG 图标；补 `tcg-deck` 的 `cards.json` 预缓存。
   *为什么*：这是所有留存机制的地基——装不上、离线打不开，前面三条都白做。
   *验证*：从 `/games/chess/` 直接进入后 `navigator.serviceWorker.controller` 非空；断网刷新可玩；控制项（不存在路径）必须 404。

### P1｜有证据但改动更大

5. **今日 3 款路线**：按日期从 25 款里轮换 3 款，记录进度与路线总分。
   *为什么*：NYT 全站 ≈3.0 局/日活/天 vs Wordle 单款 ≈1.5 局。
6. **无剧透结果串**：emoji 方块 + 步数/用时，一键复制，带站点 URL。
   *为什么*：Wordle 每秒 46 条；注意它是拉新不是留存。
7. **设备唯一 ID 三处冗余**（localStorage + IndexedDB + cookie）。
   *为什么*：iOS Safari 对非安装站点有 7 天不访问清本地存储的策略；Wordle 迁移时 streak 全被重置的教训。

### P2｜正在做

8. **积分 / 晋级 / 奖杯 / 分享卡**（`shared/rewards.js` + `games/profile/`）
9. **社交排名**（独立 Worker + KV，设备 ID 为主身份）
   *必须配的冷启动缓冲*：按游戏分榜（小池子好过大池子）、每周清零、空榜显示「你是第 N 位」而非空表、好友挑战链优先于全球榜。

### 明确不做

- **推送**：网页无稳定推送，游戏类 opt-in 仅 20–28%，Duolingo 花 2 亿条只换到 +0.5% DAU
- **账号体系**：与免登录定位冲突，且带来真正的隐私责任
- **第三方追踪**：站点「无追踪」是承诺，不是暂未启用
- **全球好友系统**：小基数下 Rietveld 证据是 −26 个百分点，Aalto 实测采用率 0.58%
- **真钱赌博、现有 IP 复刻**：合规红线

---

## 5. 需要你拍板的三件事

1. **排行榜的分榜粒度**：按游戏分（25 个榜）还是按品类分（棋类/卡牌/聚会）？我倾向按游戏，但要接受大部分榜单长期只有个位数玩家。
2. **每日同题是否允许「练习模式」**：当日题只算一次成绩，但可以无限重玩。允许能拉时长，风险是成绩含金量下降。
3. **补签次数**：每月 1 次（保守，数据上够用）还是 2 次（对偶尔来访的人更友好，但会稀释「连续」的意义）。

---

## 6. 这份文档的可信度边界

- 所有外部数字都在第 1、2 节给了链接与时间；**没有链接的数字一律不写**
- 三个核心结论都不是我们的实测，是别人的数据；我们自己的留存率**目前无法测量**（无追踪脚本），所以本文件的所有优先级都是**借用证据 + 代码缺口**推出来的，不是 A/B 结果
- 如果以后要测，最小侵入方案是：只统计 `localStorage` 里的本地计数（如「今日是否已玩」的写入次数），**不上报、不识别个人**——但这仍不能算出留存率，只能算本机行为
