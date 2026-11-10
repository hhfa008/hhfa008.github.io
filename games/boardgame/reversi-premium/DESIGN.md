# 黑白棋 · Reversi Premium — 设计

## 目标

把经典 8×8 黑白棋（Othello）做成手机上能完整打完的精品版：标准夹击翻面、跳过与终局数子，三档 AI、悔棋、双人同屏和 2 人联机房间。视觉使用 30mm 双面棋子材质、绿呢桌面与 Songti SC 700 标题，局面与棋盘全部由代码合成。

## 规则口径

- 8×8 棋盘，黑先。初始 d4 白、e4 黑、d5 黑、e5 白，双方各 2 子。
- 落子必须沿横、竖或斜线夹住至少一枚对方棋子；八个方向同时结算，所有被夹住的棋子翻面。
- 没有合法落点时跳过；双方都没有合法落点时终局。
- 终局数黑白棋子，多者胜，数量相同为平局。
- 不做“必须吃最多”“角位特权”等额外简化；引擎即规则单一来源。

## 数据与实现

- `engine.js` 纯函数 UMD：页面、单测与 `online-server.mjs` 共用。`applyMove` 不修改入参，非法动作抛 `Error`。
- 关键 API：`createGame`、`applyMove`、`getLegalMoves`、`chooseAIMove`、`flipsAt`、`legalFor`、`hasMoves`、`count`、`posScore`、`undo`、`publicState`。
- 状态：`board`（64 格数组）、`current`（1/2）、`over`、`winner`、`scores`、`passed`、`moveCount`、`lastMove`、`lastFlips`、`history`、`players`、`aiLevel`、`seed`。
- 跳过语义：当前方无合法点时 `getLegalMoves` 返回 `[{type:'pass'}]`；有合法点时 `applyMove({type:'pass'})` 会被拒绝。落子后对手无合法点且己方仍有合法点时，回合交给对手并标记 `passed`，对手必须跳过。
- AI：简单 = 确定性随机 + 吃子/角位偏好；普通 = 两层搜索 + 位置权重；困难 = 四层 alpha-beta + 行动力/角位/稳定子评估，固定节点上限保证可复现。

## 体验

- 棋盘：绿呢底 + 胡桃木外框，代码绘制 8×8 网格与合法点提示；棋子为 img-gen 单物件材质，翻面时旋转切换双面。
- 控制：人机 / 双人同屏、三档难度、新局、悔棋、音效开关、明暗主题、规则与联机入口、分享。
- 手机：390×844 与 320×568 无横向滚动；按钮 ≥44×44；可见字号 ≥12px；`viewport-fit=cover`、`100dvh`、safe-area；棋盘格使用 `div[role=gridcell]` 而非 button，避免小屏格位被误判为 44px 主触控目标。
- 本地零外部请求；音效复用 `games/shared/sfx.js`，分享复用 `games/shared/share.js`。

## 联机

- `online-server.mjs` 薄封装共享 `../app/online-game.mjs`，房间/邀请/密码/重连/托管/榜单/重赛都走共享实现。
- 2 人房：房主创建、邀请码单次使用、房主开始后双方进入同一局；断线可用 session 重连，超时座位由 AI 托管。
- 公共状态只下发棋盘、回合、比分、最后一手/翻面与结果；不泄露内部 RNG/完整历史。
- `test-online.js` 用两个独立 HTTP 客户端跑通建房、加入、落子翻面同步、重连、托管、完整终局、榜单、重赛、离开转 AI 与关房。

## 美术

- 单物件：黑面棋子（纯白底）、白面棋子（深灰底）、绿呢与胡桃木纹理，均由 img-gen 生成，四角洪水填充抠图，不用 colorkey。
- 封面/OG/详情：`art-render.html` 代码绘制真实成立的 8×8 中盘局面（由 `engine.js` 自对弈生成），叠双面棋子材质与 Songti SC 700 标题，经 `games/boardgame/scripts/render-premium-art.mjs` 输出 1200×1200 / 1200×630 / 1536×1024。
- 参考：ART-GUIDE §1 单物件、§2 真实尺寸、§5 现实规则、§6 合成；B站 BV1CuxQ6EExW、BV1Bs4y1c7Y9、BV1UC411L7vj、BV1Hjz9BUEAY。
