# tools/tests 维护说明

工具站的测试、配置与大厅生成都集中在本目录。本文件只描述维护架构；具体实现契约以 `CONTRACT.md`、`CATALOG.md`、`scaffold/README.md` 为准。

## 目录职责

| 路径 | 职责 |
|---|---|
| `scaffold/` | 模板与生成器：`scaffold.html`、`make-tool.js`、`configs/demo.json`、`examples/demo.html`、`TEST_TEMPLATE.js` |
| `configs/` | 88 份三语 `<slug>.json`，是新工具**唯一数据源**（文案、SEO、FAQ、引擎提示）；`_check.js` 为公共校验 |
| `catalog.json` + `hall-build.js` | 100 工具目录驱动三语大厅（`tools/index.html`、`tools/en/index.html`、`tools/id/index.html`）；`hall-check.js` 校验大厅 |
| `*.test.js` | 每个工具的 Node 测试（100 份，模板见 `scaffold/TEST_TEMPLATE.js`） |
| `catalog-integrity.test.js` | 全站完整性门禁：目录、页面、配置、测试、体积、外部请求等交叉校验 |

`CONTRACT.md` 是硬性契约，`CATALOG.md` 是 100 工具规格，`BATCH_BRIEF.md` 是批量交付说明，`screenshots/` 是生成产物（约 24MB，不参与测试）。

## 命令入口

```bash
# 唯一测试入口（Node）：100 个工具测试 + catalog-integrity 门禁
node games/tests/run-all.js

# 真实浏览器校验（默认 390×844，并测 320 宽；可一次传多个 slug）
node games/tests/browser-check.js <slug> [<slug>...] --langs zh,en,id

# 三语大厅生成与校验
cd tools && node tests/hall-build.js
cd tools && node tests/hall-check.js
```

## 新增 / 修改工具的 8 步流程

完整细节见 `scaffold/README.md` 第 1 节，摘要：

1. 在 `tools/tests/configs/<slug>.json` 建配置（复制 demo 改，禁止放 `/tmp` 或隐藏目录）。
2. 填 config 的文案、SEO、FAQ、引擎函数名与断言提示。
3. `node tools/tests/scaffold/make-tool.js --config tools/tests/configs/<slug>.json --out tools/<slug>/index.html`，再跑 `--check`。
4. 只填四个可编辑区：`TOOL_BODY`、`TOOL_EXPLAIN`、`engine`、三语字典与 UI 绑定。
5. 复制 `TEST_TEMPLATE.js` 为 `tools/tests/<slug>.test.js`，补 ≥10 条引擎断言。
6. 跑 `node tools/tests/<slug>.test.js`，直到 0 失败。
7. 跑 `node games/tests/browser-check.js <slug> --langs zh,en,id`，三语全 PASS。
8. 若新增工具，更新 `catalog.json` 后重建大厅并跑 `hall-check.js`；禁止 `git commit`。

## 存量例外

以下页面按 `catalog.json` 的 `supportedLangs` 维护，不走三语 config 流程；它们各有独立测试文件，但不使用新契约的 `#i18n` 结构：

- `screen-share-calc`：en / id / vi / th 四语目录；`?lang=zh` 显示中文提示 + 英文内容。
- `sari-sari-ledger`：en / zh / id / fil 四语页内切换；`?lang=zh|en|id` 覆盖本地设置。

因此 `configs/*.json` 为 88 份、单工具测试为 100 份；`catalog-integrity.test.js` 额外覆盖全站一致性。

## 阈值与断言

体积、触控、横向溢出、引擎断言数量、外部请求等阈值**全部以 `CONTRACT.md` 为准**：默认单文件 ≤ 90KB（QR / 条码 / 图片类可 120KB，需列明并加 `--max-bytes 120`）；触控 ≥ 44×44px；390px 与 320px 均不得横向溢出；引擎断言 ≥ 10 条。`scaffold/README.md` 第 10、11 节记录了检查器行为与已知限制。

## 路径约定

- 测试与脚本中的 `/Users/fa/games` 是**本机工作副本约定**（仓库根），保留；换机器需同步改根路径或通过 `TOOLS_CHECK_ROOT` 覆盖 browser-check 的 tools 根。
- 文档和交付物不得引用 `/tmp`、`/private/tmp` 或隐藏目录；配置、脚手架代码、demo 校验目录都必须放在仓库可见路径。
