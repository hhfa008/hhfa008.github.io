# 东京妖都（Kot Premium）设计说明

> 状态：**shipped**。本地人机 2–4 人与 Node 联机房间均完成；联机复用 app/rooms.js，含邀请、权威状态同步、空位 AI、重连托管、榜单与双客户端 E2E。已 merge origin/main c5c583b（含 Azul）。
>
> 验收日期：2026-11-10。素材生成与验收均不做截图分析、OCR 或图像内容识别，只使用尺寸、alpha、文件大小、DOM 与事件断言。

## 1. 设计目标

- 把「东京之王」式 6 骰 3 掷、东京城/湾争夺、能力卡市场，做成手机优先、单机 2–4 人 vs AI 的原创怪兽桌游。
- 局面必须由代码合成：骰子点数、血量、分数、能量、卡牌、东京驻守位置全部来自 `engine.js` 的真实 state。
- 怪兽名、数值、骰面图案与分数由 DOM/SVG 代码渲染；生成式素材只承担无字符的立绘、骰面材质与夜景背景。
- 所有资源本地化，不请求 CDN、外部字体、追踪脚本或远程图片。

## 2. 规则真实清单（realism）

| 项目 | 实际规格 | 代码/校验位置 |
|---|---|---|
| 玩家人数 | 2–4 人；1 名人类 + 1–3 AI | `createGame`、`meta.json` |
| 骰子 | 6 颗；数字 1/2/3、爪击、治疗、能量各一面 | `FACES`、测试「六种骰面」 |
| 掷骰 | 每回合最多 3 次；可锁定/解锁；第三次后必须结算 | `rollsLeft`、测试「掷骰与锁定」 |
| 生命 | 初始 10；巨化骨骼后最大 12；上限治疗 | `START_HP`、`giant-bones` |
| 分数 | 0–20；数字三连得分；达到 20 立即获胜 | `WIN_VP`、`checkVictory` |
| 东京 | 东京城常驻；4 人局开放东京湾；进入 +1，回合开始驻守 +2 | `afterResolution`、`startTurn` |
| 爪击 | 东京内打全部城外；城外打全部东京内；空城不造成伤害 | `resolveSmash` |
| 治疗 | 城外每心 1 点；东京内爱心无效 | `resolveDice` |
| 能量/卡牌 | 每闪电 1 能量；3 张明牌；14 张原创卡；刷新 2 能量 | `buyCard`、`sweep` |
| 撤离 | 东京内受爪击并存活后可撤离或坚守 | `yieldDecision` |

所有规则断言在 `test.js` 中直接跑 `engine.js`；页面不复制规则。

## 3. ART-GUIDE 对照

- **§1 谁能画什么**：怪兽立绘、骰面材质、城市背景由 `img-gen` 生成；怪兽名、数值、骰子点数、分数、按钮文字全部由代码和系统字体渲染。
- **§2 单元素规格**：生成提示词要求纯白 `#FFFFFF` 背景、单一物件居中、≥15% 白边、左上主光、右侧补光、100mm macro f/11、真实材质微纹理、无文字/字母/数字/logo/水印。
- **§4 抠图**：没有使用 colorkey。`kot-postprocess.py` 从四角与边缘做连通白底 flood fill，再对 alpha 做 1px 腐蚀，裁切到 alpha bbox；记录中心 alpha 与覆盖率。内部像素不会被误删。
- **§6 合成**：完整局面由代码合成。封面、OG、详情图由本地 cutout 立绘 + 夜景背景用 Pillow 离线合成；游戏内场景由 HTML/CSS 布局、槽位、怪兽 token 与 state 驱动。
- **字体**：中文标题使用 `Songti SC` **Bold(700)**（ttc index 1），没有使用缺字的 Black(900)；UI 使用系统无衬线字体。

## 4. 美术资产

生成模型：`gpt-image-2.5-flare`，`--quality high`。原始 PNG 与页面 WebP 均保存在：

`games/assets/art/premium/kot/`

| 资产 | 文件 | 页面尺寸 | 用途 |
|---|---|---|---|
| 烬鳞龙 | `monster-emberwyrm.webp` | 768×768 | 立绘/token/头像 |
| 潮汐鳌 | `monster-tideback.webp` | 768×768 | 立绘/token/头像 |
| 月影螳 | `monster-lunamantis.webp` | 768×768 | 立绘/token/头像 |
| 锈齿兽 | `monster-rustfang.webp` | 768×768 | 立绘/token/头像 |
| 霜角鲸 | `monster-frosthorn.webp` | 768×768 | 立绘/token/头像 |
| 孢子巨像 | `monster-sporecolossus.webp` | 768×768 | 立绘/token/头像 |
| 骰面材质 | `die-face.webp` | 512×512 | CSS 3D/平面骰面底材，点数由代码叠加 |
| 东京夜景 | `tokyo-night.webp` | 1536×1024 | 东京城/湾场景背景 |
| 封面 | `cover.webp` | 1024×1024 | 封面/分享 |
| OG | `og.webp` | 1200×630 | `og:image`、`twitter:image` |
| 详情配图 | `detail.webp` | 1536×1024 | 详情页/世界图鉴 |
| 母版 | `masters/*.png` | 原始裁切 | 重压/重上色来源 |
| 清单 | `art-manifest.json` | — | 尺寸、字节、alpha、生成方式 |

封面/OG/详情图为代码合成：夜景背景 + 透明立绘 + 渐变光 + Songti SC Bold 标题/图注。生成式素材本身不含任何文字。

## 5. 视觉与动效

- 视觉：深海军蓝底、霓虹金/青/品红；原创怪兽不同轮廓、配色、纹理与眼睛；东京城/湾槽位、生命条、20 分环、能量计数、能力卡市场、战报。
- 骰子：正常设备使用 CSS 3D 立方体六面；骰面底材引用本地生成的象牙材质 WebP，数字/爪/心/闪电由代码 SVG/文本绘制。
- 动效：掷骰 3D 翻滚、锁定弹跳、攻击斩击 + 冲击环 + 受击后坐 + 场景震动、治疗浮动、购卡脉冲、进入东京到达、终局彩带/射线。
- 声音：WebAudio 合成掷骰、攻击、治疗、能量、购卡、淘汰、胜利音效；可静音；无外部音频。
- `prefers-reduced-motion` 与 iOS 低性能路径会关闭 3D 骰子动画，使用平面骰面与静态状态更新。

## 6. 手机适配

- 390×844 与 320×568 两档冒烟；横屏 844×390 与平板 768×1024/1024×768 只要求不崩、不横向滚动。
- 触控热区：主要按钮、骰子、购买按钮、头部导航均 ≥44px；不使用 hover 才能触发的关键操作。
- 单手操作：≤620px 显示固定底部 `#actionDock`，提供掷骰/结算/进入东京/撤离/购卡/结束回合；`env(safe-area-inset-*)` 处理刘海与底部 Home 指示条。
- `min-height:100vh` + `min-height:100dvh`；`viewport-fit=cover`；`overscroll-behavior-y:contain`。
- 320px：`--die:44px`、骰子 gap 2px、wrap/game/dice 内边距收紧；6 颗骰子 274px 宽可放入 320px 视口。
- iOS Safari：检测 iPhone/iPad 或低内存设备，给 `<html>` 加 `simple-dice`，隐藏 3D 面并用平面骰面 + 2D 翻滚；首次 `touchstart/pointerdown/click` 内创建/恢复 AudioContext 并播放静音 buffer 解锁。

## 7. 共享模块复用（禁止复制）

| shared 模块 | 用法 | 说明 |
|---|---|---|
| `shuffle.js` | `engine.js` 的牌库洗牌 | 使用 `Shuffle.shuffle(cardIds, {seed})`；测试比对牌库顺序，未复制 Fisher-Yates |
| `sfx.js` | `AudioFX` 包装器 | dice/capture/notify/move/lose/win 全部走 shared WebAudio 合成；无外部音频 |
| `rewards.js` | 终局 `Rewards.record` | 记录本局 XP/等级/连胜；localStorage，无网络 |
| `leaderboard.js` | 仅 `buildChallenge/parseChallenge` | 终局面板生成挑战码；不调用 submit/board，未发外部请求 |
| `rules.js` | 未使用 | 该模块只覆盖五子棋/四子棋等，没有 Kot 规则 API；引擎规则未复制该文件 |
| `physics.js` | 未使用 | 回合制骰子游戏没有刚体/碰撞需求 |

`games/sw.js` 已升级到 `CACHE_VERSION = 'v22'`；预缓存清单由 `scripts/gen-precache.js` 生成到 `games/precache-manifest.js`，包含 Kot 入口、规则页、data/engine、6 张怪兽立绘、骰面、夜景、封面、OG、详情图，以及 shared rewards/leaderboard。测试会交叉校验 sw 与清单版本并逐项检查资源，避免离线打开时缺资源。

## 8. 性能预算与验收记录

### 性能预算

| 指标 | 预算 | 实测 |
|---|---|---|
| 页面引用 WebP 总量 | ≤3MB | 1,590,736 bytes |
| 30 局 AI 自对弈 | ≤5s | 见 test.js 性能组 |
| 首屏渲染 | ≤120ms | 1.8ms |
| 单次掷骰渲染 | ≤100ms | 0.2ms |
| DOM 节点 | ≤1200 | 536 |
| 外部请求 | 0 | 0 |
| console error | 0 | 0 |

### 验收记录

| 项目 | 结果 |
|---|---|
| `test.js` | 566 assertions，exit 0 |
| 全仓 `run-all.js` | 87258 assertions，0 failed，exit 0 |
| 桌面 E2E | 79/0，390×844 + 320×568 全流程 |
| iOS E2E | 32/0，simple-dice + 音效解锁 |
| 页面资源 | 1,590,736 bytes（≤3MB） |
| 官方 game-smoke | 19/19 PASS（390/320，字号 ≥12px，输入框 ≥16px） |
| 双客户端联机 | 79/0（房间/邀请/权威同步/AI/重连/托管/榜单） |
| boot / 单次掷骰渲染 | 1.6ms / 0.2ms |
| DOM | 538 节点（≤1200） |
| 外部请求 / console error | 0 / 0 |
| sw.js 预缓存 | 含全部新资源 |

原始测试输出、退出码、实测视口、CPU/内存/耗时与故意失败对照见 `ACCEPTANCE.md`；E2E 细节见 `E2E.md`；可中断续跑进度见 `PROGRESS.md`。

## 9. 联机实现

- 服务端 `online-server.mjs`：复用 `games/boardgame/app/rooms.js` 的房间状态机（密码房、单次邀请、TTL、房主/加入/离开），沿用 Codenames Node HTTP 样板，不新造协议。
- 客户端 `online.html`：创建/加入/邀请链接/密码房/4 座位/开始/行动/重连/离开/结果榜；手机全文字 ≥12px。
- 权威状态：服务端只接受 `E.getLegalMoves(state)` 的动作；非当前玩家、非法动作、托管座位均拒绝。
- 空位 AI：`E.selectAIMove` 驱动空位、离开位与超时位；规则与本地共用 `engine.js`。
- 重连/托管：session token 重连；`idleTimeoutMs` 后 AI 托管，轮询/重连解除。
- 榜单：终局写入内存榜，`GET /api/leaderboard`。
- 双客户端 E2E：`test-online.js` 79/0，run-all 自动识别；`online-e2e.json` 为证据。

`meta.json` 已标 `status: "shipped"`，`acceptance.multiplayer=true`。

## 10. 验收记录

- 单元/规则/页面/realism/性能：`node games/boardgame/kot-premium/test.js`（见 `E2E.md` 尾部实际断言数）。
- 全仓：`node games/tests/run-all.js`。
- 浏览器：`node E2E 脚本`（390×844、320×568、844×390、768×1024、1024×768；触屏、横竖屏、iOS UA、reduced-motion、音效解锁、资源加载、0 外部请求）。
- 详细结果与耗时见 `E2E.md` 与 `meta.json`。
