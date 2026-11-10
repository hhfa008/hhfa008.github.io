# 四子棋 CONNECT 4 PREMIUM — 浏览器 E2E 记录

脚本：`e2e.mjs`
命令：`node games/boardgame/connect4-premium/e2e.mjs`
对照：`node games/boardgame/connect4-premium/e2e.mjs --control`（必须 exit 1）
环境：常驻 headless Chrome，CDP `9332`；只开一个标签页，结束只关该标签，不杀进程。

## 断言范围

1. 首屏：标题 / description / viewport / og:image；42 个棋格、42 个孔位、7 个落子列、
   7 个合法列、role=grid、红先、0 手、普通强度；本地蓝框/红片/毛毡材质；共享 sfx 模块。
2. 真实 UI：悬停落点预览、点击落子、AI 应手（2 手、1 红 1 黄）、最后一手内圈、
   gridcell aria-label、数字键落子、强度选择 1/2/3、主题切换。
3. 完整对局：真实点击（简单 AI，`?fast=1`）直到结束；校验手数 ≤42、圆片守恒、结果
   面板、胜利连线每格同色或 42 格平局、比分累计；随后悔棋与新局。
4. 手机：390×844 与 320×568，无横向滚动、主控件 ≥44px、可见字号 ≥12px、无越界、
   棋盘列宽 ≥43.5px。
5. 规则页：标题、Article + FAQPage JSON-LD、两张详情图、≥1200 汉字、3 个真实 BV
   号与 3 条 Bilibili 链接、尺寸表。
6. 美术：封面 42 格、24 枚、12 红 12 黄、1 个最后落点环、无四连、每列连续；标题
   Songti SC；引用本地 frame/disc/felt 材质；四张产物尺寸；四张材质 1024×1024；总体积。
7. 性能：FCP ≤2500ms、DCL ≤4000ms、DOM <2500、FPS ≥30、新局 <200ms、
   materialBytes ≤2MB、外部请求 0；写 `perf.json`。
8. 联机浏览器：创建房间、第二名 HTTP 客户端加入、开局；渲染 2 座位 / 42 格 / 7 个
   合法列；点击第 4 列推进服务端 stateVersion；两客户端同棋盘；HTTP 收尾至红方四连；
   浏览器显示结算；rematch 后 firstSeat 交换；重连；排行榜有记录；大厅页可打开。
9. 清洁度：零外部请求、零 console error、零页面异常。

## 结果

最近一次运行（2026-11-10）：`RESULT: 150 passed, 0 failed`。
`perf.json` 记录：FCP 0ms、DCL/load 32ms、DOM 207、FPS 61、新局渲染 0.2ms、
materialBytes 400553、shippedBytes 625456、externalRequests 0。
`--control` 退出码 1。390×844 与 320×568 均无溢出、主控件 ≥44px、字号 ≥12px、
棋盘列宽 48.6px / 44.0px。
