# 工具页统一契约（tools/ 新工具）

本文件是所有新工具页必须遵守的实现契约。先完整读一遍，再动手。

参考页（务必先读）：
- `/Users/fa/games/tools/sari-sari-ledger/index.html` —— 页内三语切换、移动端布局、本地存储写法
- `/Users/fa/games/tools/screen-share-calc/index.html` —— SEO / JSON-LD / 结果展示 / 公式透明度

仓库根：`/Users/fa/games`。只允许写自己负责的 `tools/<slug>/index.html` 与 `tools/tests/<slug>.test.js`，不要改大厅、不要改其他工具、不要改根目录文件。

## 1. 硬性边界

1. 每个工具是**单文件** `tools/<slug>/index.html`，内联 CSS + JS，无构建步骤，`file://` 直接打开可用。
2. **零外部请求**：不允许 `<script src>`、`<link rel=stylesheet>`、`@import`、`url(http...)`、CDN、Web 字体、第三方 SDK、追踪脚本、`fetch`、`XMLHttpRequest`、`sendBeacon`、图片外链。图标全部内联 SVG 或 data URI。
3. 不采集、不上传任何数据。可选本地持久化只能进 `localStorage`，读写必须 try/catch。
4. 目标体积默认 ≤ 90KB（单文件，含三语字典）。QR / 条码 / 图片类可到 120KB，但必须在交付说明中列明，并用 `--max-bytes 120` 跑校验；除此之外超过 90KB 就删冗余，不要牺牲可用性。
5. 正文默认语言为简体中文；页内支持 `zh` / `en` / `id` 三语实时切换。
6. 触控目标 ≥ 44×44px；390px 宽度无横向溢出；深色模式跟随系统；`prefers-reduced-motion` 时关闭动画。
7. 不编造数据或结论；计算器必须展示公式、假设与四舍五入规则。医学/金融类必须写“仅供估算，不构成建议”。

## 2. 页面骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>中文标题 — 关键卖点</title>
  <meta name="description" content="中文描述，120–160 字以内，说清能做什么、数据留在本地。">
  <meta name="author" content="Devin">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="theme-color" content="#f2efe7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#101316" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="https://hhfa008.github.io/tools/<slug>/">
  <link rel="icon" href="data:image/svg+xml,...">  <!-- 内联 -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Devin">
  <meta property="og:title" content="...">
  <meta property="og:description" content="...">
  <meta property="og:url" content="https://hhfa008.github.io/tools/<slug>/">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary">
  ...
  <script type="application/ld+json">{ SoftwareApplication + FAQPage + BreadcrumbList }</script>
  <style>...</style>
</head>
<body>
  <header class="site-header">...</header>
  <main class="wrap">
    <section class="hero">eyebrow + h1 + lede + 隐私提示</section>
    <section class="card">工具主体</section>
    <section class="explain">公式 / 假设 / 使用说明</section>
    <section class="faq">可见的 3–4 条常见问题（与 JSON-LD 对应）</section>
  </main>
  <footer class="site-footer">...</footer>
  <noscript>...</noscript>
  <script id="engine">纯计算引擎（无 DOM）</script>
  <script id="i18n">var TOOL_I18N = {...}</script>
  <script>UI / 渲染 / 语言切换</script>
</body>
</html>
```

## 3. 计算引擎（`<script id="engine">`）

- 只放**纯函数**：不碰 DOM、不读 `window`、不读时间（当前日期由 UI 传入）。
- 必须能在 Node 中直接求值：写成
  ```js
  var ToolEngine = (function () {
    'use strict';
    // ...
    return { /* 导出函数 */ };
  })();
  ```
- 所有输入先校验：`typeof x === 'number' && isFinite(x)`；非法返回 `{ ok:false, error:'code' }` 或抛 TypeError 并在文件头注明；UI 负责把错误码翻成三语文案。
- 金额、百分比、日期等边界要有明确规则（见各工具 brief），并在“公式与假设”里写出来。
- 浮点结果按明确规则取整；不要用 `toFixed` 直接当业务舍入（先乘再取整，避免二进制误差）。
- 测试会用 `tools/tests/lib.js` 的 `evalScript(html, 'engine', 'ToolEngine')` 抽取引擎，所以全局名必须是 `ToolEngine`。

## 4. 三语字典（`<script id="i18n">`）

```js
var TOOL_I18N = {
  zh: { docTitle:'…', docDesc:'…', appTitle:'…', /* 所有键 */ },
  en: { /* 键集合必须与 zh 完全相同 */ },
  id: { /* 键集合必须与 zh 完全相同 */ }
};
```

- 三种语言的**键必须完全一致**，值不能为空、不能是占位符、不能直接复制中文。
- 英文要自然地道；印尼语用标准 Bahasa Indonesia。中文用自然简体，不要翻译腔。
- 页面里所有可见文案、placeholder、aria-label、title 都必须走字典，禁止硬编码中文/英文文本节点。
- 静态 HTML 里直接写**中文默认值**（无 JS 也能读），同时加 `data-i="key"`；placeholder 用 `data-i-ph="key"`。
- UI 切换语言时：
  - 所有 `[data-i]` 节点的 textContent 更新；`[data-i-ph]` 的 placeholder 更新；`[data-i-aria]` 的 aria-label 更新。
  - `document.documentElement.lang = 'zh-CN' | 'en' | 'id'`。
  - `document.title = T('docTitle')`；同步更新 `meta[name=description]` 与 `og:title` / `og:description`。
  - 语言按钮 `aria-pressed="true/false"`；导航“工具大厅”链接指向 `/tools/`、`/tools/en/`、`/tools/id/`。
  - 数字格式随语言：`Intl.NumberFormat({zh:'zh-CN',en:'en-US',id:'id-ID'}[lang], ...)`。
- 语言优先级：`?lang=zh|en|id` > `localStorage['hhfa.tool.<slug>.lang']` > `navigator.language`（`zh*`→zh，`id*`→id，其他→en）。`?lang` 不写回 localStorage 也可以，但切换按钮要写。
- 动态文案（如“共 3 位”“第 2 期”）用字典函数或 `{n}` 占位替换，保证三语自然。

## 5. 视觉与交互规范

统一设计语言（与现有工具一致）：

```css
:root{
  --paper:#f2efe7; --paper-2:#fbf9f4; --panel:#ffffff;
  --ink:#14171a; --muted:#5b615c; --muted-2:#7b807a;
  --line:#d5d0c4; --line-strong:#bcb5a7;
  --accent:#b93d12; --accent-soft:#f2a07a; --accent-wash:#f7e5da;
  --ok:#2f6b3c; --ok-wash:#e8f2e7; --warn:#8a5a00; --warn-wash:#fbf1db;
  --bad:#a32216; --bad-wash:#fbe7e3;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --radius:16px; --max:1040px;
}
@media (prefers-color-scheme:dark){:root{ --paper:#101316; --paper-2:#171b1f; --panel:#1a1f23;
  --ink:#f2efe7; --muted:#b7b3a8; --muted-2:#948f85; --line:#333a40; --line-strong:#4a535b;
  --accent:#f08a5d; --accent-wash:#2b211c; --ok:#8fd19e; --ok-wash:#1b2b1e;
  --warn:#f0c36a; --warn-wash:#2d2618; --bad:#ff8a7a; --bad-wash:#321d1a; }}
```

- 顶栏：品牌 `Devin` → `/`；导航“工具大厅”（按语言指向上面对应 URL）与“在线桌游” → `/games/`；右侧语言按钮 `中文 / EN / ID`。
- 页脚：`© 2026 Devin · 工具大厅 · 在线桌游 · 首页`，再一行隐私说明。
- 布局：`.wrap` 最大 1040px，左右 18px（≥720px 时 32px）。桌面双栏（表单 + 结果），≤720px 单栏。所有表格放进 `overflow-x:auto` 容器，页面本身不得横向滚动。
- 表单：每个 input 都有可见 `<label for>`；数字输入用 `inputmode="decimal"`；错误就地显示，`role="alert"`。
- 结果区用 `aria-live="polite"`；大数字用 `font-variant-numeric: tabular-nums`；结果可一键复制（`navigator.clipboard` 失败时回退选中文本并提示）。
- 按钮触控目标 ≥ 44×44px；`:focus-visible` 有 2px 以上轮廓；hover 不依赖颜色单独传达状态。
- 禁止使用 `alert()` / `confirm()` 作为主流程；用页内提示。
- 动画只用 transform/opacity，≤200ms；尊重 reduced-motion。
- 打印样式：隐藏导航/按钮，结果和表格完整可打印。

## 6. SEO / 结构化数据

- `<title>` 中文，含核心词 + 卖点，≤ 60 个汉字左右；description 自然，不堆词。
- canonical 固定为 `https://hhfa008.github.io/tools/<slug>/`（不带 `?lang`）。
- JSON-LD 用三条：`SoftwareApplication`（name/url/applicationCategory/operatingSystem/offers price 0）、`FAQPage`（3–4 问，与页面可见 FAQ 一致）、`BreadcrumbList`（首页 → 工具大厅 → 本工具）。JSON 必须能被 `JSON.parse`。
- 不做假的 hreflang（本工具只有一个 URL，页内切换）。

## 7. 测试（必须写）

在 `tools/tests/<slug>.test.js` 写 Node 测试，使用 `/Users/fa/games/tools/tests/lib.js`（由基建 agent 提供，API 与 `games/tests/lib.js` 相同：`page / scriptCode / evalScript / evalBetween / suite / mulberry32`；`suite` 提供 `ok/eq/near/group/done`）。

每个测试文件至少覆盖：

1. **引擎正确性 ≥ 10 条断言**：正常值、0、负数（若允许）、非法输入、边界、取整规则；金额类必须验证“分项之和 == 总额”。复杂工具（QR、条码、diff、cron、markdown、统计等）建议写更多断言。
2. **三语键一致性**：`Object.keys(zh)` 与 en/id 完全相等；无空值；每个值不是键名本身。
3. **`data-i` / `data-i-ph` / `data-i-aria` 引用的键在三个字典里都存在**。
4. **静态合规**：无 `<script src`、无 `fetch(`/`XMLHttpRequest`/`sendBeacon`、无 `@import`、无 `url(http`；有 viewport/canonical/title/meta description；JSON-LD 全部可解析且类型正确；文件体积默认 ≤ 90KB（QR / 条码 / 图片类可到 120KB，需在交付说明中列明并用 `--max-bytes 120` 校验）。
5. 测试结束调用 `t.done()`，输出 `RESULT: N passed, M failed`；失败时 exit code 非 0。

命名：`tools/tests/<slug>.test.js`。不要创建或修改 `tools/tests/lib.js`、`run-all.js`、`browser-check.js`（基建 agent 负责）。

## 8. 交付回复

完成后回复：
- 写了哪些文件、各自体积
- 测试命令与输出摘要（必须是你实际运行过的）
- 引擎导出的函数清单
- 已知限制 / 没做的部分
