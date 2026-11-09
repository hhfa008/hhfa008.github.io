# 工具页统一脚手架

位置：`/Users/fa/games/tools/tests/scaffold/`

| 文件 | 用途 |
|---|---|
| `scaffold.html` | 完整基础页：head/SEO、设计系统 CSS、语义结构、三语运行时、`ToolUI`、引擎与 UI 占位 |
| `make-tool.js` | Node CLI 生成器：注入文案/SEO/FAQ/JSON-LD，支持 `--check` 静态检查 |
| `configs/demo.json` | 自测用 demo 配置（`"demo": true`） |
| `examples/demo.html` | 生成器真实产物，可直接打开；也可跑 browser-check |
| `TEST_TEMPLATE.js` | 每个工具的 Node 测试模板（复制后填 `SLUG` 与引擎断言） |
| `README.md` | 本文件 |

动手前先读：
- `/Users/fa/games/tools/tests/CONTRACT.md` — 硬性契约
- `/Users/fa/games/tools/tests/CATALOG.md` — 100 工具目录，找到自己的 slug
- `/Users/fa/games/tools/tests/BATCH_BRIEF.md` — 批次交付与验收
- `/Users/fa/games/AGENTS.md` — 仓库协作规则

---

## 0. 命令速查

```bash
# 生成 demo（自测）
node /Users/fa/games/tools/tests/scaffold/make-tool.js \
  --config /Users/fa/games/tools/tests/scaffold/configs/demo.json \
  --out /Users/fa/games/tools/tests/scaffold/examples/demo.html

# 静态检查（失败 exit 1）
node /Users/fa/games/tools/tests/scaffold/make-tool.js \
  --check --out /Users/fa/games/tools/tests/scaffold/examples/demo.html

# 真实工具：生成（会留下 body/explain/engine/UI/dict 占位）
node /Users/fa/games/tools/tests/scaffold/make-tool.js \
  --config /Users/fa/games/tools/tests/configs/<slug>.json \
  --out /Users/fa/games/tools/<slug>/index.html

# 单测（必须 0 失败）
cd /Users/fa/games
node tools/tests/<slug>.test.js

# 真实 Chrome 三语检查（必须全 PASS）
node games/tests/browser-check.js <slug> --langs zh,en,id

# 全量回归
node games/tests/run-all.js
```

`--check` 也接受位置参数：`node make-tool.js --check path/to/index.html`。

---

## 1. 一个工具从 0 到交付的 8 步

### 第 1 步：准备 config
在仓库可见目录创建 `/Users/fa/games/tools/tests/configs/<slug>.json`（不要放 `/tmp`）。可以直接复制 `configs/demo.json` 改。

### 第 2 步：填 config
字段如下（三个语言都必须有）：

```json
{
  "slug": "compound-interest-calculator",
  "category": "calc-finance",
  "zh": {
    "title": "复利计算器 — 逐年明细与追加存款",
    "desc": "中文 description，说清能做什么、数据留在本地。",
    "appTitle": "复利计算器",
    "tagline": "输入本金、利率和年限，看到终值、总利息与逐年表。"
  },
  "en": { "title": "...", "desc": "...", "appTitle": "...", "tagline": "..." },
  "id": { "title": "...", "desc": "...", "appTitle": "...", "tagline": "..." },
  "faqs": [
    { "q": "中文问题 1", "a": "中文答案 1" },
    { "q": "中文问题 2", "a": "中文答案 2" },
    { "q": "中文问题 3", "a": "中文答案 3" }
  ]
}
```

- `slug`：小写字母/数字/连字符，≤ 60。
- `category` 只能是：`calc-finance` / `text-dev` / `design-image` / `date-time` / `math` / `health` / `life-home` / `random-fun` / `ledger`。
- `title` 用于 `<title>`、OG/Twitter、`docTitle`；`appTitle` 用于 h1 与 JSON-LD；`tagline` 用于 lede 与 `tagline`。
- `faqs` 必须是 3–4 条。生成器会用它生成可见 FAQ（中文默认）和 FAQPage JSON-LD。
- **FAQ 同步**：config 里的中文 FAQ 必须与字典 `zh.faqQ1/faqA1…` 完全一致；`en` / `id` 的 FAQ 答案写在各自字典的 `// TOOL_DICT_EN` / `// TOOL_DICT_ID` 下方。
- 真实工具**不要**写 `"demo": true`。

### 第 3 步：生成
```bash
node /Users/fa/games/tools/tests/scaffold/make-tool.js \
  --config /Users/fa/games/tools/tests/configs/<slug>.json \
  --out /Users/fa/games/tools/<slug>/index.html
node /Users/fa/games/tools/tests/scaffold/make-tool.js \
  --check --out /Users/fa/games/tools/<slug>/index.html
```

非 demo 模式下生成器会：
- 替换 head 的 title/description/canonical/OG/Twitter；
- 注入三条 JSON-LD、可见 FAQ 与 FAQ JSON-LD；
- 把引擎重置为带 `TOOL_ENGINE_START/END` 的空 IIFE；
- 清空 `TOOL_UI_START/END` 里的 demo 逻辑；
- 保留 `<!--TOOL_BODY-->`、`<!--TOOL_EXPLAIN-->` 与 `TOOL_DICT_*`，等 builder 填。

此时页面能打开但还没有工具主体；`--check` 会对两个内容占位给出 WARN，不会失败。

### 第 4 步：填四个区（只改这些地方）
1. `<!--TOOL_BODY-->`：表单、结果、表格、复制/下载、错误提示。
2. `// TOOL_ENGINE_START` … `// TOOL_ENGINE_END`：纯计算函数，并同步更新 IIFE 的 `return { ... }`。
3. `// TOOL_DICT_ZH` / `// TOOL_DICT_EN` / `// TOOL_DICT_ID`：替换 demo 键为工具自有键；三种语言键必须完全一致。FAQ 键 `faqQ1/faqA1…` 必须与 config 的条数一致。
4. `<!--TOOL_EXPLAIN-->`：公式、假设、取整规则、限制；健康/金融写“仅供估算，不构成建议”。
5. `// TOOL_UI_START` … `// TOOL_UI_END`：绑定输入、渲染结果、注册 `ToolUI.onLangChange(render)`。
6. 可见 FAQ 由生成器从 config 注入。改 config 后重新生成，或手工同步 HTML 与字典。

### 第 5 步：写测试
```bash
cp /Users/fa/games/tools/tests/scaffold/TEST_TEMPLATE.js \
   /Users/fa/games/tools/tests/<slug>.test.js
```
- 把 `var SLUG = 'example-tool';` 改成真实 slug。
- 用至少 10 条断言替换 `/* ENGINE_ASSERTIONS */`。未填时测试会失败并提示。
- 覆盖：正常值、0、负数（若允许）、非法输入、边界、取整；金额类必须验证“分项之和 == 总额”。

### 第 6 步：跑单测
```bash
cd /Users/fa/games
node tools/tests/<slug>.test.js
```
必须看到 `RESULT: N passed, 0 failed`，且 exit code 为 0。

### 第 7 步：跑真实浏览器
```bash
cd /Users/fa/games
node games/tests/browser-check.js <slug> --langs zh,en,id
```
三种语言必须全 PASS：无 console error、无外部请求、390/320 无横向溢出、触控 ≥44×44px、深色模式、`data-i` 全翻译、语言切换生效。失败就改页面，不要改校验器。

### 第 8 步：回报
按 `BATCH_BRIEF.md` 的格式：文件与字节数、实测 `RESULT`、browser-check 汇总、引擎导出函数、已知限制。不要编造未运行的验证结论。

---

## 2. 生成器

### 选项
```
--config <file>    工具配置 JSON
--out <file>       输出 HTML（--check 时可省略，默认 examples/demo.html）
--scaffold <file>  覆盖 scaffold.html 路径
--demo             注入内置演示 body/explain（config 里 "demo": true 等效）
--check            生成后（或对已有文件）运行静态检查
--max-bytes <kb>   --check 体积上限，默认 90 KB
--quiet            只输出错误
--help             帮助
```

### `--check` 检查项
- 文件 ≤ 上限（默认 90 KB）。
- 禁止：`<script src>`、`<link rel=stylesheet>`、`@import`、`url(http...)`、`fetch(`、`XMLHttpRequest`、`sendBeacon`。
- 无未替换的 `__TOKEN__`；`<!--TOOL_FAQ-->` / `<!--TOOL_FAQ_JSONLD-->` 必须已被替换。
- 三条 JSON-LD 均可 `JSON.parse`，类型为 `SoftwareApplication` / `FAQPage` / `BreadcrumbList`；FAQPage 至少 3 条且与可见 FAQ 数量一致。
- 三语字典可求值、键集合完全一致、值非空且不等于键名；通用键齐全。
- 所有 `data-i` / `data-i-ph` / `data-i-aria` 引用的键在三语字典中都存在。
- `<title>`、viewport、meta description、author=Devin、robots、明暗 theme-color、canonical、内联 favicon、OG/Twitter、`html lang="zh-CN"`、三个语言按钮、`<script id="engine">`。
- canonical 必须等于 `https://hhfa008.github.io/tools/<slug>/`。
- 警告（不失败）：`innerHTML` 出现；`<!--TOOL_BODY-->` / `<!--TOOL_EXPLAIN-->` 仍是占位。

### 退出码
- `0`：成功。
- `1`：生成或 `--check` 失败。
- `2`：参数错误 / 未提供必要参数。

### 转义
- head 文本与属性用 HTML 转义；
- 字典值用单引号 JS 字符串转义（含 `'`、`\`、`<`、U+2028/2029）；
- JSON-LD 用 JSON 转义，`<` 写成 `<`，防止 `</script>` 截断。

---

## 3. 可编辑区域与占位符

| 标记 | 位置 | 谁负责 |
|---|---|---|
| `<!--TOOL_BODY-->` | `<main>` 内 | builder 替换为工具主体 |
| `<!--TOOL_EXPLAIN-->` | `.explain-body` 内 | builder 写公式/假设/取整/限制 |
| `<!--TOOL_FAQ-->` | `.faq` 内 | 生成器注入 config 的中文 FAQ |
| `<!--TOOL_FAQ_JSONLD-->` | FAQPage JSON-LD | 生成器注入 |
| `// TOOL_ENGINE_START` … `// TOOL_ENGINE_END` | `<script id="engine">` | builder 写纯函数 |
| `// TOOL_UI_START` … `// TOOL_UI_END` | 最后的 UI `<script>` | builder 绑定表单与渲染 |
| `// TOOL_DICT_ZH` | `TOOL_I18N.zh` 内 | builder 从该行到对象结尾换成工具键 |
| `// TOOL_DICT_EN` | `TOOL_I18N.en` 内 | 同上 |
| `// TOOL_DICT_ID` | `TOOL_I18N.id` 内 | 同上 |

规则：
- `data-i` 只放在**叶子节点**上；运行时用 `textContent` 覆盖，节点里不要塞子元素。
- 测试用的 `dataIKeys()` 只识别双引号写法，统一写 `data-i="key"`。
- 不要在 HTML 注释里写 `data-i="..."`，否则测试会把注释当成真实引用。

---

## 4. 三语运行时

- 语言优先级：`?lang=zh|en|id` > `localStorage['hhfa.tool.<slug>.lang']` > `navigator.language`（`zh*`→zh，`id*`/`in*`→id，其他→en）。
- `?lang` 不写回 localStorage；点击语言按钮会写。
- 切换时更新：
  - 所有 `[data-i]` 的 textContent；
  - `[data-i-ph]` 的 placeholder；
  - `[data-i-aria]` 的 aria-label；
  - `<html lang>`（`zh-CN` / `en` / `id`）；
  - `document.title`（`docTitle`）；
  - meta description、og:title、og:description、og:locale、twitter:title/description；
  - 所有 `[data-tools-link]` 指向 `/tools/`、`/tools/en/`、`/tools/id/`；
  - 语言按钮的 `aria-pressed`。
- 动态文案用 `ToolUI.T(key, vars)`，变量写成 `{n}` / `{result}`。不要在 JS 里拼三语字符串。
- 切换语言后会依次调用 `ToolUI.onLangChange(fn)` 注册的渲染函数；初始化时也会调用一次。工具应在该回调里重新渲染结果区的动态文案。
- 字典值不得为空、不得等于键名、不得把中文直接复制到 en/id。英文自然地道，印尼语用标准 Bahasa Indonesia。

---

## 5. 通用字典键（三种语言都必须有）

```
docTitle docDesc appTitle tagline eyebrow privacy skip
navAria navHall navGames langLabel langZh langEn langId
brandName brandHome navHome footerAria footerNote copyright
copy copied copyFail copyHint reset result
explainTitle faqTitle formulaTitle assumptionsTitle
backTools moreTools notMedical notFinancial unitNote
download downloadFail clear swap add remove close yes no
errorInvalid errorRequired errorGeneric storageFail noscript
```

工具自有键（含 `faqQ1…` / `faqA1…`）写在 `// TOOL_DICT_*` 下方，三语键集合必须与 zh 完全一致。

---

## 6. `ToolUI` API

全局 `window.ToolUI`（同时暴露 `window.T`）。

| API | 说明 |
|---|---|
| `T(key, vars)` | 当前语言文案；`vars` 替换 `{name}` 占位，缺失变量替换为空串 |
| `fmt(n, opts)` | 按当前语言 `Intl.NumberFormat` 格式化；非有限数字返回 `—` |
| `copy(text)` | 复制 + toast；返回 `Promise<boolean>`，失败自动回退 `execCommand` |
| `toast(msg)` | 页内提示，2.6s 自动隐藏 |
| `download(name, content, mime)` | Blob 本地下载；返回 boolean |
| `readStore(key, fallback)` | `localStorage` 读取 + JSON 解析，异常返回 fallback |
| `writeStore(key, value)` | JSON 写入；异常 toast 并返回 false |
| `debounce(fn, ms)` | 防抖 |
| `on(target, event, fn)` | `target` 可以是选择器或元素；返回取消函数 |
| `setError(el, msg)` | 显示 `role="alert"` 错误；空 msg 等于清除 |
| `clearError(el)` | 清空并 `hidden` |
| `$(sel)` / `$$(sel)` | 单元素 / 数组 |
| `onLangChange(fn)` | 语言切换回调；初始化时也会调用一次 |
| `lang()` / `locale()` | 当前 `zh/en/id` 与 `zh-CN/en-US/id-ID` |

**禁止**用 `innerHTML` 拼接用户输入；所有用户输入一律 `textContent`。`download` / 图片处理只用 Blob、canvas、FileReader。

---

## 7. 引擎约定

```js
var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  // ... pure functions ...
  // TOOL_ENGINE_END

  return { /* exports */ };
})();
```

- 只放纯函数：不碰 DOM、`window`、`document`、`localStorage`、时间、`Math.random`。
- 必须能在 Node 中直接求值；测试用 `lib.evalScript(html, 'engine', 'ToolEngine')` 抽取。
- 需要“当前日期”“随机数”时由 UI 传入参数；随机函数接收 `rng` 参数，生产端用 `crypto.getRandomValues`。
- 输入先校验：`typeof x === 'number' && isFinite(x)`；非法返回 `{ ok:false, error:'code' }`（或统一抛 TypeError，并在文件头注明）。
- UI 负责把错误码翻译成三语文案，不要在引擎里返回文案。
- 浮点结果按明确规则取整；不要在业务舍入里直接 `toFixed`。

### 推荐错误码
`bad_value`、`bad_percent`、`bad_base`、`bad_decimals`、`bad_mode`、`empty_input`、`zero_base`、`range`、`overflow`、`unsupported`、`invalid_input`、`not_found`。

---

## 8. 数字 / 金额 / 日期 / 随机约定

- **显示**：`ToolUI.fmt` + `Intl.NumberFormat`；货币/百分比显式传 `minimumFractionDigits` / `maximumFractionDigits`。
- **业务舍入**：整数分位运算后再 `Math.floor(x + 0.5 + 1e-9)`；负数先取绝对值再还原（half away from zero）。不要把 `toFixed` 当业务舍入。
- **金额**：内部用最小单位整数（分 / cents / sen），避免浮点误差；展示时再除 100。分摊类必须验证“分项之和 == 总额”，余数按最大余数法分配。
- **百分比**：内部保留完整精度，显示默认 2 位，明确写四舍五入规则。
- **件数/箱数/桶数**：向上取整 `Math.ceil`，并在 explain 里写明。
- **日期**：跨时区计算用 UTC 序数或 `{y,m,d}` 结构；时区转换用 `Intl`，不要手算 DST；“今天”由 UI 传入。
- **随机**：注入 `rng`（返回 `[0,1)`）；生产端用 `crypto.getRandomValues`，测试用 `mulberry32` 等确定性 rng。

---

## 9. 禁止事项

- 禁止任何外部请求：CDN、Web 字体、外链图片、第三方 SDK、追踪脚本、`fetch`、`XMLHttpRequest`、`sendBeacon`。
- 禁止把用户输入塞进 `innerHTML`（包括模板字符串拼接用户内容）。
- 禁止硬编码可见文案；所有文本、placeholder、aria-label、title 必须走字典（静态 HTML 可写中文默认值，但必须带 `data-i`）。
- 禁止 `alert()` / `confirm()` 作为主流程；用页内 `.error` / `.toast`。
- 禁止未 try/catch 的 `localStorage`。
- 禁止改 `tools/tests/lib.js`、`games/tests/*`、大厅页面、别人的工具、根目录文件。
- 禁止把 config 或脚手架代码放 `/tmp` / 隐藏目录；交付物必须在仓库可见路径。
- 禁止 `git commit` / 自动合入 MR（按全局规则）。
- 禁止为了过检查而删测试或改校验器。

---

## 10. 测试与浏览器验收

### 单测模板
`TEST_TEMPLATE.js` 自动检查：
- 三语键一致、非空、通用键齐全；
- 所有 `data-i` / `data-i-ph` / `data-i-aria` 键存在；
- `externalRefs` 为空；
- JSON-LD 三条且类型正确；
- canonical / viewport / title / description / author / robots / favicon；
- 引擎无 DOM/时钟/存储/`Math.random`；
- 文件体积默认 ≤ 90 KB；QR / 条码 / 图片类可到 120 KB，需在交付说明中列明，并在测试里把 `MAX_BYTES` 调到 120 KB、静态检查加 `--max-bytes 120`；
- 引擎断言 ≥ 10 条（未填会失败）。

输出固定以 `RESULT: N passed, M failed` 结尾；有失败时 exit 1。

### browser-check
- 真实 Chrome headless，默认 390×844，并额外测 320 宽。
- 三种语言逐个加载 `?lang=...`，点击语言按钮验证切换。
- 检查：无 console error / 异常 / 外部请求；390/320 无横向滚动；触控 ≥44×44px；深色/浅色背景亮度；`data-i` 全翻译；标题变化；`aria-pressed`。
- 自测 demo 时，browser-check 需要目录名 = slug：
  ```bash
  mkdir -p /tmp/tools-scaffold-check/example-tool
  cp /Users/fa/games/tools/tests/scaffold/examples/demo.html \
     /tmp/tools-scaffold-check/example-tool/index.html
  cd /Users/fa/games
  TOOLS_CHECK_ROOT=/tmp/tools-scaffold-check \
    node games/tests/browser-check.js example-tool --langs zh,en,id
  ```
  真实工具直接在 `tools/<slug>/index.html`，不需要复制。

---

## 11. 已知限制

- `--check` 是**静态**检查：不执行页面、不验证视觉效果、不验证翻译质量或引擎业务正确性。运行时问题靠单测 + browser-check。
- 生成器只注入 config 的中文 FAQ 到可见 HTML 和 JSON-LD；`en` / `id` FAQ 必须由 builder 写进字典，`--check` 只保证键存在，不保证内容对应。改 config 后要同步字典 FAQ。
- 非 demo 模式保留 demo 字典键作为示例；builder 必须把 `// TOOL_DICT_*` 下方的 demo 键替换干净。
- `--check` 默认 90 KB；QR / 条码 / 图片类允许 120 KB 时，可显式 `--max-bytes 120`，并在交付说明中列明。
- browser-check 依赖本机 Chrome（默认 `/Applications/Google Chrome.app/...`，可用 `CHROME_PATH` 覆盖）。
- 触控检查会把 `main input[type=checkbox]` 本身量到 44×44；脚手架已把 `.check input` 设为 44×44。若自定义勾选控件，需自己保证可测尺寸。
- 页面按 `file://` 设计；`navigator.clipboard` 在 `file://` 可能不可用，`ToolUI.copy` 会自动回退到 `execCommand` 并 toast 提示。
