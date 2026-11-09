# AGENTS.md — games / tools 仓库工作规范

> 2026-11-09 · 适用于 `/Users/fa/games`（mac2 工作副本，仅含 `games/` 与 `tools/`）

## 1. 主对话只调度（模仿 muse）

- 主对话只做：**听懂 → 拆任务 → 派给子 agent → 汇总**。不写代码、不改文件、不跑长命令 / 构建 / 测试。
- 有对口 agent 用对口的；没有就用 default / general-purpose。互不依赖的任务一条消息并行派发。
- 汇报三段式：**结论 → 证据 → 下一步**。子 agent 的长输出只转述结论；只有需要用户拍板的才提问。
- 派发必须写清：**目标、边界（不许碰什么）、验收标准、回报格式（≤400 字 + 命令清单）**。

## 2. 测试基建（tools 与 games 共用，2026-11-09 决定）

- 单元测试入口：`node games/tests/run-all.js`，运行游戏测试与 `tools/tests/*.test.js`。
- 唯一公共测试库：`games/tests/lib.js`；`tools/tests/lib.js` 只是转发，不复制逻辑。
- 浏览器校验：`games/tests/browser-check.js`（Chrome CDP：真实页面、三语、390/320、零外部请求、44×44）。它是独立命令，不在 `run-all.js` 内。
- 报告统一写 `games/tests/report.json`。
- 不再新增 `tools/tests/run-all.js` 或第二套测试库；入口还没落地就先补基建，不要绕开另起一套。
- 基线不写死数字：**以最近一次 `node games/tests/run-all.js` 的输出为准，必须 0 失败**。要写具体数字，必须先实际跑过。
- node 不在默认 PATH，先 `export PATH=$HOME/.local/node/bin:$PATH`。

## 3. 工具页验收标准

- 单文件 `tools/<slug>/index.html`，内联 CSS/JS，`file://` 直接打开可用。
- 零外部请求、无追踪；持久化只能进 `localStorage`，且读写 try/catch。
- 体积默认 ≤ 90KB；QR / 条码 / 图片类可到 120KB，需在交付说明中列明并用 `--max-bytes 120` 校验。390px 无横向溢出；触控目标 ≥ 44×44px；深色模式；`prefers-reduced-motion` 关闭动画。
- 三语 `zh` / `en` / `id` 键完全一致，无空值、无占位符、不复制中文；`data-i` / `data-i-ph` / `data-i-aria` 引用的键三语都存在。
- canonical / JSON-LD 齐全：`SoftwareApplication` + `FAQPage` + `BreadcrumbList`，JSON 必须可解析。
- 引擎放 `<script id="engine">`，纯函数、全局名 `ToolEngine`、Node 可直接求值。
- 计算类必须展示公式、假设与取整规则；健康 / 金融类注明「仅供估算，不构成建议」。
- 测试放 `tools/tests/<slug>.test.js`：引擎断言 ≥ 10 条（复杂工具建议更多），加三语键一致性、`data-i` 引用完整性、静态合规检查。
- **验证不许编造成果**：跑不了就写「跑不了，原因 X」。

## 4. 验证与部署边界

- mac2 只改 `games/` 与 `tools/`，不碰站点首页、`personal/`、`ios/`、`writing/`、`store/` 与根目录 HTML。
- 部署只在主力机执行；mac2 不持有 Cloudflare 凭证，不跑 wrangler。
- 线上验证不能只看状态码：不存在的路径可能返回 200 首页，必须看内容特征串。
- 两站一致性用 md5，不用「看起来一样」。
- 每次验证带一个必然失败的对照（如不存在的路径必须 404），否则检查本身不可信。
- Cloudflare 会 308 去掉 `.html`，GitHub Pages 不会，跨站比对时注意。

## 5. 工具大厅范围与架构（100 个工具 / 9 个分类）

### 架构

- 统一脚手架与模板：起稿用 `/Users/fa/games/tools/tests/scaffold/scaffold.html`（契约骨架、设计 token、三语字典占位），不要手抄旧页面。生成器、模板、片段都放 `tools/tests/scaffold/`，不放临时目录或隐藏目录。
- 配置：脚手架与生成器的 configs 统一放 `tools/tests/configs/`，同样不放临时目录或隐藏目录。
- 目录驱动大厅：`tools/tests/catalog.json` 是唯一工具清单（字段 `slug` / `category` / `name` / `desc` / `href`，其中 `name` / `desc` / `href` 为 zh/en/id 三语对象）；`tools/tests/hall-build.js` 读它生成并校验 `tools/index.html`、`tools/en/index.html`、`tools/id/index.html` 的卡片、分类计数与 `ItemList` 计数。不再手改大厅。
- `node games/tests/run-all.js` 只运行游戏测试与 `tools/tests/*.test.js`；catalog 与大厅一致性由 `hall-build.js` 的静态自检负责，不并入 `run-all.js`。
- 浏览器校验用 `games/tests/browser-check.js`：真实页面、三语、390/320 无溢出、零外部请求、44×44、无 console error、深色模式。
- 不写未验证的断言数字；数字以最近一次实际运行输出为准。
- 工具链用 `?lang=zh|en|id`，保持大厅与工具页语言一致。详细规格见 `/Users/fa/games/tools/tests/CATALOG.md`，实现契约见 `/Users/fa/games/tools/tests/CONTRACT.md`。

### 分类清单（合计 100）

1. **计算与财务 calc-finance（21）**：已有 `percentage-calculator`、`unit-converter`、`loan-calculator`、`tip-splitter`；新增 `compound-interest-calculator`、`savings-goal-calculator`、`inflation-calculator`、`discount-calculator`、`vat-calculator`、`salary-converter`、`overtime-pay-calculator`、`freelance-rate-calculator`、`break-even-calculator`、`profit-margin-calculator`、`roi-calculator`、`debt-payoff-calculator`、`retirement-calculator`、`rent-split-calculator`、`fuel-cost-calculator`、`electricity-cost-calculator`、`aspect-ratio-calculator`。
2. **文本与开发 text-dev（24）**：已有 `screen-share-calc`、`text-tools`、`json-formatter`、`password-generator`；新增 `case-converter`、`lorem-ipsum-generator`、`slug-generator`、`uuid-generator`、`hash-generator`、`base64-encoder`、`url-encoder`、`html-entity-encoder`、`jwt-decoder`、`regex-tester`、`cron-explainer`、`text-diff`、`markdown-preview`、`csv-to-json`、`json-to-csv`、`xml-formatter`、`json-to-typescript`、`css-formatter`、`color-converter`、`number-base-converter`。
3. **设计与图片 design-image（12）**：`color-palette-generator`、`gradient-generator`、`box-shadow-generator`、`border-radius-generator`、`image-compressor`、`image-resizer`、`image-to-base64`、`image-rotate`、`qr-code-generator`、`barcode-generator`、`favicon-generator`、`placeholder-image-generator`。
4. **日期与时间 date-time（8）**：已有 `date-calculator`、`pomodoro-timer`；新增 `stopwatch`、`countdown-timer`、`world-clock`、`timezone-converter`、`unix-timestamp-converter`、`week-number-calculator`。
5. **数学 math（10）**：`fraction-calculator`、`gcd-lcm-calculator`、`prime-factorizer`、`statistics-calculator`、`quadratic-solver`、`triangle-calculator`、`circle-calculator`、`area-volume-calculator`、`speed-distance-time-calculator`、`roman-numeral-converter`。
6. **健康 health（9）**：已有 `bmi-calculator`；新增 `water-intake-calculator`、`sleep-cycle-calculator`、`pregnancy-due-date-calculator`、`ideal-weight-calculator`、`macro-calculator`、`heart-rate-zones`、`steps-to-distance`、`pace-calculator`。
7. **生活与家居 life-home（7）**：`cooking-converter`、`grade-calculator`、`recipe-scaler`、`paint-calculator`、`tile-calculator`、`paper-size-converter`、`shoe-size-converter`。
8. **随机与趣味 random-fun（8）**：`random-number-generator`、`name-picker`、`dice-roller`、`coin-flip`、`lottery-number-generator`、`team-generator`、`list-shuffler`、`decision-wheel`。
9. **记账 ledger（1）**：`sari-sari-ledger`。
