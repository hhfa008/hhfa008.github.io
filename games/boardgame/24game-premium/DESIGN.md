# 24 点 · 24 Game Premium — 设计说明

## 定位

单人、单机、离线可玩的 24 点精品版。每题四张牌，点数 1–10（A=1），每种花色各一张牌面载体；玩家用 `+ − × ÷` 与括号，把四个点数各用一次，精确凑出 24。没有联机、没有账号、没有网络请求，成绩只写入本机浏览器存储。

## 规则口径

- 牌组固定 40 张：10 个点数 × 4 种花色（♠ ♥ ♦ ♣）。每题从 40 张中取 4 张，牌库保留 36 张；任一时刻 `deck + cards = 40`，id 唯一，这是引擎每条动作后的守恒不变量。
- 四个点数允许重复，但表达式必须按多重集恰好使用一次；漏用、多用、替换点数都会被拒绝。
- 中间结果允许负数与分数；除数不能为 0；禁止小数、科学计数法、字母、函数调用、分号与数字拼接。
- 最终值用约分后的整数分数与 `24/1` 比较，不使用浮点近似。

## 引擎架构（engine.js，UMD）

- 浏览器全局 `Game24Engine`，Node 直接 `require('./engine.js')`。
- 洗牌复用 `games/shared/shuffle.js` 的 seeded Fisher-Yates；引擎内不出现 `Math.random`。
- `createGame` / `newGame` 接受 `{seed, mode|drawMode, difficulty, date}`。`mode` 为 `free` 或 `daily`；每日种子为 `24game:daily:<YYYY-MM-DD>:<difficulty>`。
- 有理数：`makeFraction` 做符号归一与 gcd 约分；`add/sub/mul/div` 全部整数运算；`div` 分母为 0 抛错。
- 安全解析器：词法切分 → 递归下降（`expr → term → unary → primary`）→ AST 求值，不使用 `eval` / `Function`。同时支持 ASCII `+ - * /` 与 `× ÷`、Unicode 减号、全角括号。
- 求解器：枚举四个数的两两合并与六种方向（加、乘、减、反减、除、反除），用规范表达式字符串去重；`+` 与 `×` 的交换律归一，因此“规范解”数量稳定、可复现。
- 难度按规范解数量分档：简单 ≥4、普通 2–3、困难恰好 1。每题生成时在带种子的洗牌结果中寻找符合档位的四张牌；240 次尝试失败才使用确定性兜底模板。
- 状态机：`playing → solved | revealed | skipped → next → playing`。动作类型为 `submit/hint/show-solution/skip/next`，均带稳定 `key`；非法动作抛 `Error`，`applyMove` 先深拷贝，绝不修改入参。
- 计分：难度基础分 + 速度奖励 + 连胜奖励 − 提示扣分，最低 10 分；查看答案/跳过清零连胜。计时由页面负责，提交时以 `elapsedMs` 传入，保证引擎仍然是纯函数、可测试。

## 页面（index.html）

- 胡桃木桌面 `table.webp`、象牙卡纸 `card-paper.webp`、黄铜筹码 `brass-token.webp` 三种共享材质；零外部字体/脚本/图片。
- 牌面全部代码绘制：标准 SVG 花色路径、标准 1–10 点阵、上下 180° 镜像角标、A 单枚大花色；不使用 AI 牌面。
- 交互：点按牌面插入点数、五列数字键盘、输入框（支持键盘与 Enter）、撤销/清空/提示/答案/新题；全局 N/U/H 快捷键。
- 计时器、得分、连胜、最佳、完成数实时显示；最佳分数/连胜、每日记录、主题通过 `games/shared/store.js` 持久化，全部 try/catch 包裹。
- 模式：每日挑战（日期种子 + 连续天数）与自由练习（时间戳种子）；三档难度分段按钮。
- 移动优先：390×844 与 320×568 两档无横向滚动，所有 button ≥44×44，可见文字 ≥12px，输入框 ≥16px 防止 iOS 缩放；卡片是 `div[tabindex]` 而非 button。支持 `prefers-reduced-motion` 与浅色主题。

## 美术（art-render.html → assets/*.webp）

- 合成一个真实成立的题面：5♠ 5♥ 5♦ A♣，参考解 `5 × (5 − 1 ÷ 5) = 24`（三张 5 与一张 1 各用一次，恰好是困难档的 1 种规范解）。
- `?shot=cover|og|detail|card` 四档：1200×1200、1200×630、1536×1024、480×320；由既有 `render-premium-art.mjs` 渲染，PNG 母版留在本地，WebP 入库。
- 材质只画单个物件；花色、点阵、角标、算式与规则信息全部由代码合成。

## 测试与验收

- `test.js`：375 条断言，覆盖牌组、有理数、解析器、用牌多重集、求解器已知有解/无解集合、三档生成、每日种子、状态机、不可变、序列化、48 步长序列守恒与真实尺寸/点阵。
- `e2e.mjs`：常驻 Chrome + CDP，真实页面完整流程、键盘、提示/答案、错误反馈、移动两档、规则页 JSON-LD、美术页真实题面、零外部请求、性能预算与四张 WebP 尺寸。
- `game-smoke.mjs`：390 与 320 两档各 19 checks PASS，0 console error / 0 exception / 0 external request。
