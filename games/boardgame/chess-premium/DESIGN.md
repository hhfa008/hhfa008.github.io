# 国际象棋 Chess Premium — 设计说明

## 规则引擎

`engine.js` 是一个零依赖、无 DOM 的 FIDE 规则内核。棋盘使用 64 元素数组，索引 0 = a8，63 = h1；局面包含 `board / turn / castling / ep / half / full / lastMove`。`makeMove` 是显式原地 API 并返回 undo token，供 perft 与搜索高速使用；`unmakeMove` 精确还原。`newGame / applyMove / undoMove` 在其上维护重复局面 key、SAN 棋谱与吃子托盘。

合法性由「伪着法 + 走子后检查己方王」过滤，因此钉住、将军应将、易位经过格、吃过路兵暴露王等边界都被覆盖。易位权在玉/车移动或车被吃时立即撤销；FEN 导入校验 8 行、双方各一王、行棋方、易位字段与 ep 格。`positionKey` 按 FIDE 只把「确实可吃的吃过路兵」纳入重复局面比较，而 `toFEN` 按 FEN 规范保留 ep 目标格。

精确性由 perft 锁定：起始局面深度 1–4 为 20 / 400 / 8902 / 197281；Kiwipete 深度 3 为 97862，另外三个标准局面也逐项吻合。

## AI

`aiMove(pos, {level, timeMs, depth, seed})` 在克隆局面上做迭代加深 Alpha-Beta，默认入门 2 层 / 120ms、进阶 3 层 / 260ms、高手 5 层 / 380ms，浏览器上限 400ms。叶子评估 = 子力 + 位置表 + 双方机动性 + 王前兵盾/开放线/周边受攻击压力。只从合法着法选子；走法排序按 MVV-LVA、升变与易位；quiescence 处理吃子与升变；将死返回 `MATE - ply`，根节点用注入的 seeded RNG 对同分着法做确定性选择。

## 界面

`index.html` 打开即用（file://、零外部请求）。棋盘由 64 个 `div[role=gridcell]` 组成（避免 320px 下把每格误当 44px 独立按钮），浅色 #e8d3a9 枫木、深色 #6b4a2f 胡桃木，纹理来自 1024px 单材质贴图并按格连续铺排。棋子为代码 SVG，轮廓按真实高度比例（95/82/70/62/55/45mm）绘制，浅色枫木渐变、深色胡桃木渐变，共用底座尺度。交互：先点己方棋子再点目标；合法空格圆点、可吃子圆环、最后一步与将军高亮；升变弹窗；吃子托盘与材料差；SAN 棋谱；新局 / 悔棋 / AI 强度 / 音效 / 主题 / FEN 导入导出。键盘可用方向键移动棋盘光标、Enter 选格。

## 联机

`online-server.mjs` 只实现共享房间服务器的 adapter 契约：`createMatch / view / legalActions / applyAction / aiAction / isOver / result / restart`。动作固定为 `{type:'move', from, to, promotion?}`，服务端校验轮次、颜色与合法着法后落子；chess 是完全信息游戏，双方 view 共享同一棋盘、SAN、托盘与状态，只有 seat/color 是观察者特定字段。空位由 AI 补位，默认 15 秒无请求触发托管，session 重连清除托管，结算写入共享排行榜；重赛创建新局并交换黑白。

## 美术

4 张 img-gen 单材质特写（浅枫木、深胡桃木、羊毛桌布、木框边）→ 1024×1024 WebP。`art-render.html` 用代码合成封面（真实初始 32 枚）、OG、棋子尺寸图（6 枚按真实比例）与纳伊多夫中局（合法 FEN，30 枚）。`render-art.mjs` 调用共享 `render-premium-art.mjs` 输出 1200×1200 / 1200×630 / 1200×800×2，PNG 母版不随包发布。

## 手机与性能

390×844 与 320×568 两档：无横向溢出、主控件（按钮/下拉）≥44px、可见字号 ≥12px、输入框 16px、safe-area 与 dvh 感知。页面只加载本地脚本与 4 张材质图；棋盘为复合网格控件，格子随棋盘缩放。预算：FCP ≤2500ms、DCL ≤4000ms、DOM ≤2500、FPS ≥30、新局渲染 ≤200ms、素材 ≤2MB、外部请求 0。
