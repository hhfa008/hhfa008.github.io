# AZUL · 花砖物语 — 设计文档

> 版本：premium 1.0.0 · 2026-11-10
> 分支：`boardgame/d686a4ca-azul-premium` → `feature/azul-online`
> 状态：**shipped**（单机闭环、美术、性能、移动端、E2E、2–4 人联机全部通过）

## 1. 目标与体验

在浏览器里复刻《Azul》基础版的完整决策闭环：圆盘取同色砖 → 排入容量 1–5 的花纹行 → 回合结束上墙 → 横纵连片即时计分 → 地板罚分 → 终局行/列/整色奖励。默认 2 人对 AI，可切 3/4 人；所有对手由 AI 接管，单机即可完成整局。

视觉目标是“皇家瓷砖工坊”：深色绒布桌面、胡桃木圆盘、釉面花砖、象牙色玩家板、金色描边。所有文字与局面由代码渲染，AI 只负责生成单个材质物件。

## 2. 规则真实性

| 项目 | 实现 |
|---|---|
| 玩家人数 | 2–4；2/3/4 人分别 5/7/9 个圆盘 |
| 花砖 | 5 色 × 20 枚 = 100 枚；每圆盘 4 枚 |
| 颜色 | 蓝 `#2f6fb5`、黄 `#d9a620`、红 `#b94a3f`、黑 `#2b2e37`、白 `#ece2cf` |
| 花纹行 | 每人 5 条，容量 1/2/3/4/5，从右向左填 |
| 墙面 | 5×5 拉丁方，`wallColFor(row,color)=(color+row)%5` |
| 地板 | 7 格，罚分 -1,-1,-2,-2,-2,-3,-3；先手标记占格并计罚 |
| 取砖 | 圆盘取同色，余砖入中央；中央首取者拿先手标记 |
| 落点限制 | 行内同色、不超容量、墙面该行已有同色则不可放 |
| 主动落地板 | 允许（即使花纹行可用） |
| 回合结算 | 仅完成行上墙并清空；未完成行保留；地板扣分后最低 0 |
| 即时计分 | 横/纵连通数相加；四周无邻砖得 1 |
| 终局 | 任一方完成整行墙面后结算本轮 |
| 奖励 | 完整行 +2、完整列 +7、某色 5 枚 +10 |
| 平局 | 先比完整横排，仍平则共享胜利 |

规则依据：B 站教程简介 + UltraBoardGames 公开规则文字；详见 `rules.html#sources`。引擎单测覆盖取砖、标记、溢出、延迟结算、计分、终局、平局与 30 局 AI 自对弈。

## 3. 真实件数 / 尺寸 / 材质

| 组件 | 真实规格 | 本实现 |
|---|---|---|
| 花砖 | 约 22×22×6 mm（社区实测），官方 Next Move 标注 100 枚树脂砖 | CSS 圆角砖 + 本地釉面材质 WebP |
| 玩家板 | 约 241×241 mm（9.5 in，社区实测） | 象牙色板面，5 行 + 5×5 墙 + 7 格地板 |
| 盒子 | 260×260×70 mm（BGG/评测） | 页面不展示盒子 |
| 圆盘 | 官方为厚纸板圆盘，2/3/4 人 5/7/9 个 | 高级版视觉使用胡桃木圆盘；件数/摆法严格按官方 |
| 先手标记 | 1 枚纸板标记 | 金色圆牌，放在中央/地板 |
| 桌面 | 桌游桌布 | 深蓝羊毛绒布 + 胡桃木叠层 |

> 材质说明：官方花砖是树脂而非陶瓷；本作采用“釉面陶瓷观感”的高级美术方向。官方圆盘为纸板；本作使用木质圆盘作为 premium 视觉升级。规则、颜色、件数、比例不因材质升级而改变。

## 4. 美术与素材

遵循 `games/ART-GUIDE.md`：

- **AI 只画单个物件**：5 张釉面砖、木质圆盘、绒布、木纹桌面，纯白背景、左上主光、无文字。
- **字符/花色/局面由代码合成**：所有标题、数字、墙面、花纹行、圆盘排列、分数、封面/OG/详情图均由 HTML/CSS/JS 合成。
- **真实件数先列清单再生成**：5 色×20、每盘 4 枚、5/7/9 圆盘、5×5 墙、7 格地板。
- **字体**：中文衬线标题 `Songti SC Bold(700)`；不使用 900 字重。
- **本地资产**：`games/assets/art/premium/azul/*.webp`（页面引用），PNG 母版同目录；封面/OG/详情在 `games/boardgame/azul-premium/assets/`。
- **零外链**：无 CDN、无外链字体、无图片 API、无追踪。

单物件素材：

| 文件 | 用途 |
|---|---|
| `tile-blue/yellow/red/black/white.webp` | 5 色砖面 |
| `factory-wood.webp` | 木质圆盘 |
| `table-felt.webp` | 桌面绒布 |
| `table-wood.webp` | 木纹叠层 |

合成产物：

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `assets/cover.webp` | 1200×1200 | 封面 |
| `assets/og.webp` | 1200×630 | OG / 社交分享 |
| `assets/detail-1.webp` | 1200×800 | 详情页圆盘/中央工坊 |
| `assets/detail-2.webp` | 1200×800 | 详情页玩家板 |

复现：`node games/boardgame/azul-premium/render-art.mjs`（`art-render.html` 为局面源文件）。渲染后只校验文件尺寸/大小，不做截图内容识别。

## 5. 架构

```text
index.html        单页 UI（渲染、动效、WebAudio、触控/键盘、主题）
engine.js         UMD 纯规则引擎（2–4 人、延迟结算、AI）
rules.html        中文规则 + B 站来源 + 真实件数 + FAQ JSON-LD
test.js           190+ 断言（规则、AI 自对弈、meta/realism）
e2e.mjs           Chrome/CDP 单客户端 E2E（桌面/390/320/横屏/断网/性能）
art-render.html   封面/OG/详情图的代码合成源
render-art.mjs    Chrome 无头渲染 + cwebp
sw.js             离线缓存（同源，本地资源）
meta.json         状态、缺失项、realism 清单
```

引擎不依赖 DOM，所有随机性来自种子；`applyMove` 不修改入参。UI 使用 `applyMove(..., {deferResolve:true})` 拆出“取砖→模式线”和“上墙→计分”两段，便于动画与测试。

## 6. AI

- 只从 `getLegalMoves(state)` 选择，非法动作抛错。
- 先按即时启发式排序（完成行、连片、列/色奖励、溢出、地板罚分），再对前 8 个候选做一步模拟，用局面价值（分数、墙砖、完整行/列、模式线、地板）选最优。
- 30 局 2/3/4 人自对弈：全部结束、无非法动作、砖数守恒、分数有限。
- 支持 `deferResolve` 与多 AI 连续行动；UI 有“AI 思考中”状态。

## 7. 动效、声音、可访问性

- 三段以上：取砖飞入模式线（WAAPI）、回合结束飞入墙面（WAAPI）、得分/罚分浮字（CSS）、落砖 pop、封面/结果 confetti。
- `prefers-reduced-motion: reduce`：CSS 动画关闭，JS 通过 matchMedia 跳过 WAAPI；E2E 断言动画计数不增加。
- WebAudio 合成：选择、落砖、计分、罚分、轮次、胜利/失败；默认静音，开关持久化；iOS 首次 `pointerdown`/`touchend`/`keydown` 解锁 AudioContext。
- 键盘：所有操作是原生 button；`1–5` 选行、`0/X` 地板、`Esc` 取消；`aria-live` 播报；focus-visible 描边。
- 触控：可见交互热区 ≥44×44；无 hover 依赖；`touch-action: manipulation`。

## 8. 移动端 / iOS Safari

- 390×844 与 320×568 竖屏冒烟；844×390 与 568×320 横屏不崩。
- `100dvh` + `100vh` 回退；`viewport-fit=cover` + `env(safe-area-inset-*)`。
- ≤360px 圆盘改为 2 列，保证 44px 砖面；≤720px 关闭 `backdrop-filter`，避免 iOS 滚动掉帧。
- 无横向滚动；页面可纵向滚动，主操作可 `scrollIntoView` 单手到达。
- 断网：`sw.js` 缓存页面、引擎、规则、材质与封面/详情；E2E 用 CDP 离线重载验证。

## 9. 性能预算（E2E 断言）

| 指标 | 预算 |
|---|---|
| FCP | < 2500 ms |
| loadEventEnd | < 4000 ms |
| DOM 节点 | < 2500 |
| rAF FPS（800ms） | ≥ 30 |
| 新局同步渲染 | < 200 ms |
| 材质 WebP 总量 | < 1.5 MB |
| 外部请求 | 0 |

## 10. 复用 games/shared

| 模块 | 处理 |
|---|---|
| `shared/shuffle.js` | **复用**：引擎 Node `require` + 页面 `<script>`；seed 洗牌，删除自写 mulberry32。 |
| `shared/sfx.js` | **复用**：页面 `<script>`；删除自建 AudioContext/合成器，映射为 click/move/notify/deal/error/win/lose。 |
| `shared/rules.js` | N/A：只含五子棋/四子棋。 |
| `shared/physics.js` | N/A：无物理模拟。 |
| rewards / leaderboard | rewards N/A；联机排行榜复用 `app/leaderboard.js` 的 `sha256Hex`，服务端内存只存匿名摘要。 |

未修改 shared 文件，总门禁仍为 `node games/tests/run-all.js`（0 failed）。

## 11. 联机实现（status: shipped）

`app/server.mjs` 已把 `azul` 纳入服务端权威状态机：

1. **服务端**：`makeGameState` / `azulMatchView` / `matchLegalActions` / `applyAzulAction`；2–4 人座位、`stateVersion`、`lastAction`、按玩家幂等动作键。
2. **客户端**：`online.html` 提供创建/加入/邀请链接/700ms 轮询/session 重连；每个 viewer 的状态轮转为「自己在座位 0」。
3. **AI 与托管**：空位默认 3 秒补 AI；超时由服务器用同一 `chooseAIMove` 代打，`autoPlayed.reason="timeout"`。
4. **入榜与 E2E**：终局写匿名排行榜；`azul-online.test.mjs`（290）+ `online-e2e.mjs`（42，双浏览器 context）纳入 `run-all`。

联机服务为内存态、内网自用；公网部署前需持久化、鉴权与 TLS。

## 12. E2E 与验收

- `node games/boardgame/azul-premium/test.js` → `RESULT: 235 passed, 0 failed`
- `node games/boardgame/tests/azul-online.test.mjs` → `RESULT: 290 passed, 0 failed`
- `node games/boardgame/azul-premium/online-e2e.mjs` → `RESULT: 42 passed, 0 failed`（双浏览器 context）
- `node games/boardgame/azul-premium/e2e.mjs` → 桌面/390×844/320×568/横屏、触控、安全区、离线、性能、规则页、封面合成
- `E2E.md` 记录最近一次运行结果、设备矩阵、shared 缓存、测试原文/退出码与 `--control` 故意失败对照。
- 五项硬性验收（设计/性能/美术/realism/E2E/联机）全部通过 → shipped。
