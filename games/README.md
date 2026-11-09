# 游戏集合维护说明

28 款纯静态网页桌游/棋牌：免费、免登录、单文件，打开即玩。

## 游戏清单

**权威数据源是 `games/registry.json`**（当前 33 条，其中 28 条 live；`profile`、`leaderboard`、`ai-eval`、`agents` 四个工具页与 `turtle-soup` 登记为 draft，不进三语大厅）：三语大厅的卡片区、分类计数与 ItemList 都由 `scripts/gen-hubs.js` 从它生成，并由 `scripts/check-registry.js` 校验。下表是人工摘要，自检项数来自测试输出；改名、改人数、改 AI 档位、增删游戏一律先改 registry，不要再手改三语大厅的卡片。

自检项数＝对应 node 单元测试通过的检查/断言条数；Tap Match、语音房无纯逻辑，记为浏览器 E2E 检查项。

| 中文名 | 英文名 | 路径 | 分类 | 人数 | AI 难度 | 规则页 | 自检项数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 中国象棋 | Xiangqi | /games/xiangqi/ | 棋类 | 2 | 三档·中等 | rules.html | 76 |
| 国际象棋 | Chess | /games/chess/ | 棋类 | 2 | 三档·较难 | rules.html、rules-en.html | 37 |
| 五子棋 | Gomoku | /games/gomoku/ | 棋类 | 2 | 三档·简单 | rules.html、rules-en.html | 24 |
| 黑白棋 | Reversi | /games/reversi/ | 棋类 | 2 | 三档·中等 | rules.html | 30 |
| 中国跳棋 | Chinese Checkers | /games/checkers-jump/ | 棋类 | 2/6 | 三档·简单 | rules.html | 49 |
| 国际跳棋 8×8 | Draughts | /games/draughts/ | 棋类 | 2 | 三档·中等 | rules.html | 49 |
| 西洋双陆棋 | Backgammon | /games/backgammon/ | 棋类 | 2 | 三档·较难 | rules.html | 75 |
| 暗棋（翻棋） | Banqi (Dark Chess) | /games/banqi/ | 棋类 | 2 | 三档·中等 | rules.html | 111 |
| 四子棋 | Connect Four | /games/connect4/ | 棋类 | 2 | 三档·中等 | rules.html | 22 |
| 围棋 9 路 | Go 9×9 | /games/go9/ | 棋类 | 2 | 三档·困难 | rules.html | 20 |
| 接龙 | Klondike | /games/solitaire/ | 纸牌 | 1 | — | rules.html、rules-en.html | 218 |
| 空当接龙 | FreeCell | /games/freecell/ | 纸牌 | 1 | — | rules.html | 45 |
| 蜘蛛纸牌 | Spider | /games/spider/ | 纸牌 | 1 | — | rules.html | 60 |
| 24 点 | 24 Game | /games/24game/ | 纸牌 | 1 | — | rules.html | 51 |
| 斗地主 | Dou Dizhu | /games/doudizhu/ | 卡牌 | 3 | 单档·规则式 | rules.html | 110 |
| 德州扑克 | Texas Hold'em | /games/texas-holdem/ | 卡牌 | 4 | 三档 | rules.html | 156 |
| 麻将 | Mahjong | /games/mahjong/ | 麻将 | 4 | 三档 | rules.html | 77 |
| 余烬牌组工坊 | Ember Deck Forge | /games/tcg-deck/ | 卡牌 | 1 | — | rules.html | —（无自动化测试） |
| 灯语者：余烬对决 | Lamptongue: Duel of Embers | /games/tcg-sample/ | 卡牌 | 2 | 两档 | rules.html | 46 |
| 拓荒者：九岛 | Pioneers of Nine Isles | /games/pioneers/ | 德式 | 2–4 | 单档·贪心 | rules.html | 52 |
| 谁是卧底 | Undercover | /games/undercover/ | 聚会 | 4–12 | — | rules.html | 50 |
| 飞行棋 | Aeroplane | /games/aeroplane/ | 聚会 | 2–4 | 单档·简单 | rules.html | 36 |
| Tap Match | Tap Match | /games/tap-match/ | 小游戏 | 1 | — | rules.html | 9（E2E） |
| 语音房 | Voice Room | /games/voice-room/ | 在线联机 · 井字棋/五子棋/四子棋 | 2–4 | — | guide.html | 14（E2E） |
| 2048 | 2048 | /games/2048/ | 数字 | 1 | — | rules.html | 24 |
| 2048 3×3 | 2048 3×3 | /games/2048-3/ | 数字 | 1 | — | rules.html | 24 |
| 2048 5×5 | 2048 5×5 | /games/2048-5/ | 数字 | 1 | — | rules.html | 24 |
| 关灯 3×3 | Lights Out 3×3 | /games/lights-3/ | 小游戏 | 1 | — | rules.html | 16 |
| 海龟汤 | Turtle Soup | /games/turtle-soup/ | 聚会 | 1 | — | rules.html | 395 |

## 技术约定

- 单文件：CSS/JS 内联在 `index.html`；例外是 `pioneers/engine.js`、`shared/rules.js`（五子棋/四子棋单机版与语音房服务端共用规则）、`shared/share.js`（全站分享按钮：原生分享优先，不支持时复制链接）和 `shared/hand-eval.js`（德州扑克/麻将共用验牌引擎），均同目录同源加载，仍无外部依赖。
- 分享：每个游戏页与三个大厅底部都有分享按钮，链接不带用户标识、不带追踪参数；语音房另提供「复制邀请链接」「复制邀请文案」，邀请链接形如 `/games/voice-room/?room=1234`。
- 无外部依赖：不引 CDN、字体、图标库；棋盘与棋子用内联 SVG/CSS 自绘。
- 无追踪：不接 analytics、不上报；最高分与战绩只写 `localStorage`。
- 三语：15 款走 EN／简中／ID 字典与切换；Tap Match 为 EN／ID／FIL；中国象棋、语音房暂为中文单语，改版时应优先补齐。
- 触控优先：以手机竖屏为基准，点按目标不小于 32px，棋盘随视口缩放。

## 随机与洗牌

所有卡牌游戏共用 `shared/shuffle.js`（UMD、无依赖；浏览器在游戏页里用 `<script src="/games/shared/shuffle.js">` 先加载，Node 用 `require`）。

- 生产随机源：`crypto.getRandomValues`（浏览器）/ `node:crypto.randomBytes`（Node）。默认路径不用 `Math.random`；两个来源都不存在时直接抛错，不做静默降级。
- 洗牌算法：Fisher-Yates 从后往前，每一步在剩余元素中等概率取一张，因此 n! 种排列等概率。禁止 `sort(() => Math.random() - 0.5)`：比较排序的比较次数与数据相关，结果有偏。
- 整数取样：自带随机源时对 32 位字做拒绝采样（丢弃不完整的最高桶），消除取模偏差；调用方传入浮点 rng（各游戏旧的 mulberry32，为兼容旧存档保留）时用 `floor(rng() * n)`，只剩浮点量化误差。
- 种子模式：`createRng(seed)` 用 FNV-1a 哈希种子、splitmix32 展开、sfc32 生成；同 seed 在任何平台得到同一序列，用于测试、复盘和每日挑战。
- API：`shuffle(a, {seed})` 返回新数组；`shuffleInPlace(a, {seed})` 原地；`createRng(seed)`；`shuffleDeck({jokers})` 52/54 张；`deal(deck, hands, perHand)` 校验张数够不够。
- 已接入：接龙、空当接龙、蜘蛛纸牌、斗地主、德州扑克。接入时把各游戏原有 `rng` 原样传给共享引擎（而不是改成共享 seed），所以旧 seed 的发牌逐字节不变，旧存档/复盘链接不受影响；无 seed 时改用共享 CSPRNG。
- 统计检验：`node games/shared/shuffle.test.js`（`run-all.js` 跳过 `shared/`，需单独跑）。一次实测：52×52 卡方 χ²=2675.55，df=2601，p≈0.151；A♠ 落在第一张 3785 次（期望 3846.15，偏差 −1.59%，z=−1.00）；100,000 次洗牌得到 100,000 个互异排列；共 47 项断言。

## 验牌引擎（shared/hand-eval.js）

`shared/hand-eval.js` 是德州扑克与麻将共用的单文件 UMD 引擎（浏览器读 `window.HandEval`，Node 用 `require`，无依赖）。`run-all.js` 会把 `shared/hand-eval.test.js` 一并执行（其余 `shared/*.test.js` 仍需单独跑）。

- 扑克：`evalPoker(cards5Or7) -> {rank, tiebreak, name}`（rank 0–9，越大越强）；`comparePoker(a,b) -> -1|0|1`；`best5of7(cards7) -> {cards, eval}`。
  - 十种牌型：高牌、一对、两对、三条、顺子、同花、葫芦、四条、同花顺、皇家同花顺。
  - 6–7 张输入会枚举 C(7,5)=21 种组合取最强五张；A 可高可低（A2345 的高牌为 5，TJQKA 为皇家同花顺）。
  - 踢脚完整：两对比较「大对、小对、踢脚」，葫芦比较「三条、对子」，同花与高牌逐张比较；平局精确返回 0。
  - 输入接受 `"As"`／`"10h"` 字符串或 `{r,s}` 对象；重复牌、非 5–7 张会抛错。
- 麻将：`isWinningHand(tiles34) -> boolean`；`winningTiles(hand13) -> number[]`；另提供 `checkWinningHand(tiles34)` 返回 `{winning, reason, patterns}`，`isWinningHand.lastReason` 同步给出判 false 的原因。
  - 支持基本胡（4 副面子 + 1 对将）、七对（4 张相同算两对）、十三幺。
  - `tiles34` 为 34 长度计数数组（0–4）：0–8 一万到九万，9–17 一筒到九筒，18–26 一条到九条，27–33 东南西北中发白。
  - 张数不是 14、单种牌超过 4 张、数组长度不对均判 false 并给出原因。
- 不支持：不做番种/台数计分，不处理花牌、抢杠、杠上开花等流程性规则，也不额外判定九莲宝灯等特殊牌型（仍按基本胡判胡）。
- 自检：`node games/shared/hand-eval.test.js`，376 项断言；含 100,000 手随机 7 张牌的穷举验证（每手与另外 20 个五张组合比对）。
- 已接入：`games/texas-holdem/` 的牌型判定改为调用本引擎，页面通过 `<script src="/games/shared/hand-eval.js">` 加载。

## 音效系统

所有游戏共用 `shared/sfx.js`（UMD、无依赖、单文件）。音效**全部在浏览器里实时合成**：`OscillatorNode`、`BiquadFilterNode`、`GainNode` 和代码生成的噪声 `AudioBuffer`，不加载任何音频文件，因此播放不产生网络请求，也不增加包体。

- 18 个音效：`click`、`move`、`capture`、`deal`、`dice`、`win`、`lose`、`error`、`notify`；共振峰人声 `voice-a`／`voice-i`／`voice-u`／`voice-yeah`（2–3 个带通滤波器模拟元音）；合成动物 `bird`、`cat`、`dog`、`cow`、`duck`。
- API：`Sfx.play(name, {volume})`、`Sfx.setVolume(0..1)`、`Sfx.mute(bool)`、`Sfx.isMuted()`、`Sfx.list()`。另有 `Sfx.stats()` 与 `Sfx._render(name, seconds)` 供自检使用。
- 首次播放必须发生在用户手势之后。未解锁时 `play` 会静默排队（最多 16 条），在第一次 pointerdown／touchstart／keydown 时恢复 `AudioContext` 并补播，不会抛错。
- 音量与静音存 `localStorage`：`hhfa-sfx-volume`、`hhfa-sfx-muted`，刷新后保持。所有音效经过同一个 master gain，单个音效峰值 ≤ 0.8。
- 每次播放结束后断开全部节点（`onended` + 定时兜底），长会话不会累积音频节点。
- 静音按钮：页面放 `<button type="button" class="sfx-toggle" aria-label="静音"></button>`，`sfx.js` 自动注入样式、两态 SVG 图标与点击逻辑。
- 已接入：中国象棋（move／capture／win／lose）、接龙（deal／move／win）、斗地主（deal／move／capture／win／lose／error）。三个游戏的按钮分别位于工具栏和语言切换旁，不遮挡棋盘。
- 试听页：`/games/shared/sfx-demo.html`（逐条点击试听，支持音量与静音；第一次点击解锁音频）。
- Node 下没有 `AudioContext`，`play` 为空操作，因此 `run-all.js` 取页面源码时不受影响。

## 物理引擎

`shared/physics.js`（UMD、无依赖）只服务表现层物理：发牌动效、棋子跳跃、粒子等，不做通用刚体库。

- 刚体：位置、速度、角度、角速度、质量、弹性、摩擦；形状为圆与 AABB。卡牌用 AABB + 渲染层旋转角，碰撞仍按未旋转 AABB 近似。
- 碰撞：圆-圆、圆-AABB、AABB-AABB；顺序冲量求解加位置投影，穿透在一个子步内消除。碰撞可用 `group` / `mask` 过滤（发牌时牌与牌互不碰撞，但仍会落到桌面上）。
- 积分：固定步长 1/60；`substeps` 子步进防止高速穿透。实测 3000px/s 射向 5px 墙：16 子步停在外侧，1 子步作为对照成功穿过。
- 约束：`Physics.spring(a, b, opts)` 支持刚体-刚体或刚体-固定点；`Physics.fixedPoint(body, point)` 把局部点钉在空间里。
- 休眠：静止 2 秒后入睡，快速碰撞或 `Physics.applyImpulse` 唤醒；100 刚体单步约 0.1–0.2 ms（Node `process.hrtime`，1000 步均值）。
- 确定性：不读 `Math.random`、不读真实时间；相同初始状态跑 600 步两次，位置/角度/速度逐位一致。
- API：`Physics.createWorld`、`world.addBody`、`world.step(dt)`、`world.bodies`（只读副本）、`Physics.spring`、`Physics.fixedPoint`、`Physics.applyImpulse`。
- 自检：`node games/shared/physics.test.js`，50 项断言（已列入 `run-all.js` 的共享测试清单，也可单独跑）。覆盖动量守恒（误差 0）、e=1 能量守恒（误差 0%）、e=0 静止、自由落体 1 秒 y=450（误差 0%）、穿透对照、确定性、100 刚体性能、休眠与约束。
- 已接入：接龙「发牌动效」（默认开，可关，尊重 `prefers-reduced-motion`）；飞行棋掷骰的短促物理翻滚。演示页 `/games/shared/physics-demo.html`。

## 质量约定

每个游戏必须有能脱离 DOM、在 node 下运行的单元测试；纯 UI 游戏用无头浏览器 E2E 兜底。提交前全部通过，测试要点与项数如下：

- 象棋：七类棋子走法、马腿/塞象眼/炮翻山/飞将；AI 自对弈无非法着法。
- 国际象棋：perft(1/2/3)=20/400/8902；易位、吃过路兵、升变、将死/逼和。
- 五子棋：横竖斜连五与拦截；三档 AI 都能抓必胜、必防。
- 黑白棋：开局四合法点、八方向翻转、终局计数。
- 中国跳棋：121 孔邻接、三连跳路径、对家三角判定。
- 国际跳棋：必吃、连吃、升王、非法走法拒绝。
- 西洋双陆棋：24 点标准摆法、bar 复活、封闭点、必须走满、bear off、gammon/backgammon 倍数、50 局 AI 自对弈。
- 暗棋：4×8 全暗开局与棋子构成、等级吃子、兵吃帅、炮隔子吃、走子与胜负、50 局 AI 自对弈。
- 四子棋：重力落子、四向连线、悔棋后局面一致。
- 围棋：提子、禁自杀、打劫、数子、AI 自对弈。
- 接龙/空当接龙/蜘蛛：发牌结构、移动合法性、自动收牌、撤销一致。
- 24 点：分数精确求解；1000 手连续发牌均有解；提示不破坏可解性。
- 拓荒者：开局摆放、建造与交易合法性、掷 7 弃半、AI 与热座状态机。
- 谁是卧底：40 组词库无重复、人数与卧底配置、胜负判定、发词分配。
- 飞行棋：起飞、踩敌机、跳格、精确终点、胜负。
- Tap Match／语音房：计时、计分、三语切换与房间信令走浏览器 E2E。

## 新增游戏的标准流程（唯一数据源）

`games/registry.json` 是三语大厅的唯一数据源。**不要再手改 `games/index.html`、`games/en/index.html`、`games/id/index.html` 里的卡片和分类计数**；下半节「新增一个游戏」保留为页面实现要求，其中第 3 步（手改三语大厅）已废弃，改由下面的流程完成。

1. 先改 `games/registry.json`：在 `games` 数组加一条，写全 `slug`、`category`、三语 `names` / `blurb`（每语言 ≤30 字）、`players`、`ai`、`rules`、`icon`、`status`。没有规则页或图标时把 `rules` / `icon` 置为 `null`，并在评审里说明。
2. 跑 `node scripts/gen-hubs.js --write`：只替换 `<!-- HUBS:AUTO-START/END -->` 与 `<!-- HUBS:ITEMLIST-START/END -->` 标记块，重新生成三语分类跳转、卡片区和 ItemList；`--check` 只校验不写入。
3. 跑 `node scripts/check-registry.js`：目录、`index.html`、`rules.zh`、`icon`、三语字段必须全部对上实际文件，任何一项不满足都 exit 1。
4. 跑 `node games/tests/run-all.js`：测试全绿；把新的自检项数补进上表。
5. 更新 `sitemap-pages.xml`，收录游戏页与规则页；再按下面的发布流程部署。

## 新增一个游戏

1. 建 `games/<slug>/index.html`：单文件、三语字典、触控优先、无外部依赖与追踪。
2. 写 `games/<slug>/rules.html`：中文 1200–1600 字，含 `Article` + `FAQPage` JSON-LD，文末 CTA 回游戏页；补图标与 OG 图。
3. 三语大厅同步：`games/index.html`、`games/en/`、`games/id/` 各加一张同 slug 卡片，数量与 hreflang 保持一致。
4. 更新 `sitemap-pages.xml`，收录游戏页与规则页。
5. 抽离纯引擎写 node 单测并跑通，把项数补进上表。
6. 部署与收录：`git archive` 打干净快照，`wrangler pages deploy`；curl 验证 200，再用 `indexnow-ping --url` 提交新 URL。

## 发布流程（三道闸门）

任何发布都必须按顺序过三道闸门，前一道不过不得进入下一道；每一步失败都会打印具体是哪一项失败，不静默跳过。

1. **测试**：`node games/tests/run-all.js` 必须 0 失败。CI（`.github/workflows/games-test.yml`）在每次 push / PR 上用 Node 22 跑同一命令，失败即红。
2. **预发布闸门**：`scripts/predeploy.sh`，七项依次检查并在最后汇总：
   - 单元测试 0 失败；
   - `games/`、`tools/` 下所有 HTML 不引用外部域名资源（脚本唯一明确允许的站外「导航链接」是 screen-share-calc 的 Gumroad 购买链接，每次运行会打印 INFO）；
   - 三语大厅（`/games/`、`/games/en/`、`/games/id/`）卡片数一致，且每张卡片链接在本地文件系统里存在；
   - `games/sw.js` 的 `CACHE_VERSION` 可解析；有页面文件比 sw.js 新时打印 WARN（改了页面就要升版本，WARN 不阻断但发布前应处理）；
   - `sitemap-pages.xml` 的 URL 数 ≥ 实际可收录页面数，且 `games/`、`tools/` 页面无漏收录；
   - `games/registry.json` 与实际目录、`rules.zh`、`icon`、三语字段一致（`check-registry.js`）；
   - 三语大厅卡片区与 ItemList 与 registry 的生成结果一致（`gen-hubs.js --check`）。
   任一项 FAIL 即 exit 1，禁止部署。
3. **部署**：`scripts/deploy.sh`（`--dry-run` 只跑到快照安全检查）。默认流程：
   - `git archive HEAD | tar -x -C /tmp/cf-deploy-$$` 打干净快照；
   - 安全检查：快照中不得出现 `.git`、`.env`、`.wrangler`、私钥、`node_modules`；
   - 用本机 wrangler OAuth 部署到 Cloudflare Pages 项目 `hhfa008-pages` 的 `main` 分支（部署时 unset `CLOUDFLARE_API_TOKEN`，该 token 对 Pages 不可用）；
   - 验证三语大厅卡片数、5 个页面特征串、404 对照、2 个页面 pages.dev vs github.io 的 md5（走 7899 代理）；
   - 全部通过才打印 `DEPLOY OK`，否则 `DEPLOY FAILED` 并 exit 1。

双机同步：`scripts/sync-mac2.sh push|pull`（远端 `mac2` 裸库）。push 遇非快进被拒会自动 `pull --rebase` 后重试一次；脚本只同步已提交内容，`games/`、`tools/` 下的未提交改动会打印 WARN 且不会同步。

## 已知限制

- 语音房是 WebRTC mesh，最多 4 人；房号可被枚举，密码为可选且通过服务端校验（连续错 5 次限流 60 秒），不是账号体系。
- 部分 AI 是启发式或贪心（拓荒者、飞行棋），不是搜索；棋类才是 Alpha-Beta。
- 无账号、无跨设备战绩同步；成绩只存在本机浏览器。
- 无服务器、排行榜、好友系统；除语音房外均可离线。
