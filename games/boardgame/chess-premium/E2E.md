# 国际象棋 Chess Premium — 浏览器 E2E 记录

- 脚本：`e2e.mjs`
- 命令：`node games/boardgame/chess-premium/e2e.mjs`
- 对照：`node games/boardgame/chess-premium/e2e.mjs --control` → exit 1
- 环境：常驻审计 Chrome，CDP 端口 `9331`（`CHESS_PORT` 可覆盖）；打开一个标签页并在结束时关闭；不启动临时 Chrome profile。
- 记录：本文件；性能数据写入 `perf.json`。

## 覆盖与断言

1. 首屏：标题、meta description、viewport、OG 图片、64 格、32 枚、16+16、坐标 a–h / 1–8、零外部请求。
2. 真实点击：人机/双人切换、愚人杀 `1.f3 e5 2.g4 Qh4#`、状态变为将死、棋谱 4 个半回合、吃子托盘、非法目标无反应。
3. 悔棋与重开：悔棋回到人类回合；新局 32 枚、棋谱清空、状态白方走棋。
4. AI：走 `e2e4` 后等待 AI 回复，moveCount ≥2，AI 着法合法；三档强度选择器更新。
5. 升变：通过 FEN 载入 `4k3/P7/8/8/8/8/8/4K3 w - - 0 1`，点击 a7→a8，弹窗 4 个选择，选后升变生效。
6. 键盘/aria：棋盘可聚焦，方向键移动光标，Enter 选中，aria-label 含坐标与棋子。
7. 两档手机：390×844 / 320×568 无横向溢出；按钮/下拉 ≥44px；可见字号 ≥12px；棋盘 64 格与 8×8 比例正确。
8. 规则页：Article + FAQPage JSON-LD、≥1200 汉字、两张详情图、≥2 个 B 站 BV 链接。
9. 美术：封面合成 64 格 + 32 枚 + 合法初始局面；OG/详情尺寸；四张成品 WebP。
10. 性能：FCP ≤2500ms、DCL ≤4000ms、DOM ≤2500、FPS ≥30、新局渲染 ≤200ms、素材 ≤2MB、外部请求 0。
11. 联机：自建服务器、创建房间、浏览器渲染 2 座位/64 格/32 枚、点击落子、stateVersion 前进、reconnect、leaderboard。

## 结果

`RESULT: 152 passed, 0 failed`。实测：FCP 36ms、DCL 14ms、loadEventEnd 15ms、DOM 325、FPS 61、新局渲染 0.3ms、页面资源 743,695 B、外部请求 0；390×844 棋盘 358px，320×568 棋盘 292px，两档均无横向溢出、主控件 ≥44px、字号 ≥12px。
