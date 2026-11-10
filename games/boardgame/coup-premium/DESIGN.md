# 政变 · COUP PREMIUM — 设计说明

## 主题

未来官僚 / 黑色权谋：暗红丝绒桌面、黄铜与烫金徽记、深色木桌、羊皮卷与仪式道具。页面不画任何人脸；五种角色的识别完全由代码合成的 SVG 徽记承担：

| 角色 | 徽记 | 能力 |
|---|---|---|
| 公爵 Duke | 王冠 | 征税 +3；阻挡外援 |
| 刺客 Assassin | 匕首 | 暗杀（支付 3） |
| 队长 Captain | 船锚 | 偷取最多 2；阻挡偷取 |
| 大使 Ambassador | 卷轴 | 交换身份；阻挡偷取 |
| 女伯爵 Contessa | 面具 | 阻挡暗杀 |

主界面以「密档 / 牌桌 / 席位」为结构：六席网格在上，中央行动面板与日志在侧。所有标题、角色名、金币与行动说明使用 `Songti SC` 700，避免 900 缺字。

## 规则引擎

`engine.js` 是 UMD 纯函数式状态机，Node 与浏览器共用。状态包含 15 张唯一 ID 的身份牌、牌堆、弃牌区、玩家隐藏身份、金币、阶段与 `pending` 决策委托。相位：

`action → challenge → block → blockChallenge → discard → exchange → over`

支持 2–6 人；所有行动、费用、挑战、阻挡、阻挡挑战、失去身份、淘汰与牌堆耗尽重洗严格按官方规则。挑战亮牌后洗回牌堆并补抽；暗杀费用在宣称时支付且不退。洗牌复用 `games/shared/shuffle.js` 的 seeded Fisher-Yates，通过 `seed + shuffleCounter` 让每次洗牌可复现且状态可 JSON 序列化。

## AI

三档难度：简单 / 普通 / 困难。AI 会选择合法行动，并根据自己的隐藏手牌与公开弃牌估算宣称可信度：

- 简单：偏收入与外援，挑战率低，弃牌与交换接近随机。
- 普通：会使用真实角色、偶尔诈称、按概率挑战与阻挡。
- 困难：优先政变与暗杀、倾向保留女伯爵/公爵；挑战率最高，会针对低身份玩家。

30 局混合自对弈在 `test.js` 中校验：全部终局、无死循环、15 张牌守恒、胜者合法。

## 联机

`online-server.mjs` 复用只读的 `../app/rooms.js` 房间状态机（邀请 token、密码房、TTL、host 权限）。服务端持有权威状态：

- 创建 2–6 人房间；密码房与单次邀请链接。
- 空位由 AI 补足；房主开始。
- 客户端通过 HTTP 轮询获取**座位私有视图**：自己的身份可见，其他人的身份只发送数量。
- 合法动作由服务端 `engine.js` 验证；越回合、错误阶段、金币不足均拒绝。
- 断线用 session 重连；超时未操作由 AI 托管，轮询/重连清除托管。
- 结果榜、重赛、离座转 AI、关房均由服务端实现。
- `test-online.js` 三客户端同局跑完整流程。

## 美术

AI 只生成八个单物件材质：`card-back`、`coin`、`velvet`、`dagger`、`crown`、`mask`、`scroll`、`table-wood`；纯白底、单物件、无文字。封面 / OG / 详情由 `art-render.html` 用 HTML/CSS + 代码 SVG 合成，固定展示 **15 张身份牌、6 个席位、每席 2 枚金币**；`render-art.mjs` 用 headless Chrome 输出 PNG 母版与 WebP。

## 移动端与可访问性

- 390×844 与 320×568 全流程：无横向滚动，六席两列，行动按钮两列。
- 所有主触控目标 ≥44×44；可见字号 ≥12px。
- `100dvh`、`env(safe-area-inset-*)`、`overflow-x:hidden`。
- `prefers-reduced-motion: reduce` 关闭动画；触屏/窄屏关闭 `backdrop-filter`。
- 原生 `<button>`/`<a>`；`aria-label`、`aria-live` 日志与提示、Escape 关闭目标弹窗/清除交换选择。
- 音频只在用户手势后解锁，复用 `games/shared/sfx.js`。

## 测试与门禁

- `test.js`：450 条断言，覆盖 2/3/4/6 人、行动、挑战真假、阻挡、阻挡挑战、暗杀支付、交换、淘汰、重洗、非法动作、三档 AI 与 30 局自对弈。
- `test-online.js`：117 条断言，三客户端同局；输出 `ONLINE_E2E_JSON`。
- `e2e.mjs`：真实浏览器 CDP 点击、移动端矩阵、SW 离线、规则 JSON-LD、art-render 计数与性能。
- `--control` 两个浏览器/联机脚本都必须 exit 1。


## 规则与来源

- 官方规则文本：Indie Boards & Cards《Coup》（<https://www.indieboardsandcards.com/coup.php>）与 UltraBoardGames 规则整理（<https://ultraboardgames.com/coup/game-rules.php>）。
- B 站规则来源：《【新德里玩桌游】桌游《政变（Coup）》教学+实录》BV1pW411Y7kr；《你有公爵? 他也有公爵? 政变: 规则+游玩体验分享》BV1ja411575N。
- 本实现的差异只允许在材质与视觉层（黄铜金币、丝绒桌面、SVG 徽记）；件数、行动、费用、挑战/阻挡与隐藏信息规则与官方一致。
